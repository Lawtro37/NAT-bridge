const { app, BrowserWindow, ipcMain, dialog, nativeTheme } = require("electron");
const { spawnSync, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

let currentProcess = null;
let mainWindow = null;

const launcherDataDir = path.join(os.tmpdir(), "nat-bridge-launcher");
const launcherCacheDir = path.join(launcherDataDir, "Cache");
try {
    fs.mkdirSync(launcherCacheDir, { recursive: true });
    app.setPath("userData", launcherDataDir);
    app.setPath("cache", launcherCacheDir);
} catch (_err) {
    // If path override fails, Electron will fall back to defaults.
}

function findNatBridgeExecutable() {
    const isWin = os.platform() === "win32";
    const exeName = isWin ? "nat-bridge.exe" : "nat-bridge";

    // Candidate locations to search for the native helper. When the app is
    // packaged the running exe's directory is the most likely location.
    const candidates = [
        path.resolve(__dirname, exeName),
        path.resolve(__dirname, "..", exeName),
        // also check the parent of the parent (useful when launcher sits in a nested folder)
        path.resolve(__dirname, "..", "..", exeName),
        path.resolve(process.cwd(), exeName),
        path.resolve(process.cwd(), 'dist', exeName),
        path.join(path.dirname(process.execPath || ''), exeName),
        // if nat-bridge is placed next to the app bundle (one level up)
        path.join(path.dirname(process.execPath || ''), '..', exeName),
        path.join(process.resourcesPath || '', exeName),
        path.join(process.resourcesPath || '', '..', exeName),
    ];

    for (const candidate of candidates) {
        try {
            if (candidate && fs.existsSync(candidate)) return candidate;
        } catch (_) {}
    }

    // Fallback: search PATH
    const cmd = isWin ? "where" : "which";
    try {
        const result = spawnSync(cmd, [exeName], { encoding: "utf-8" });
        if (result.status === 0 && result.stdout.trim()) {
            return result.stdout.trim().split(/\r?\n/)[0];
        }
    } catch (_) {}

    return null;
}

function generateRandomID() {
    return Math.random().toString(36).substring(2, 15);
}

function normalizeBridgeId(rawBridgeId) {
    return String(rawBridgeId || "").trim()
        .replace(/\s+/g, "-")
        .replace(/[^a-zA-Z0-9_-]/g, "");
}

function validateModeAndBridgeId(payload) {
    const mode = String(payload.mode || "").toLowerCase();
    if (!["host", "client"].includes(mode)) {
        return { error: "Mode must be host or client.", mode: null };
    }

    // Pull and normalize the bridge id while enforcing rules for host/client modes.
    let bridgeId = String(payload.bridgeId || "").trim();
    if (mode === "host" && !bridgeId) bridgeId = generateRandomID();
    if (mode === "client" && !bridgeId) {
        return { error: "Bridge ID is required in client mode.", mode };
    }

    bridgeId = normalizeBridgeId(bridgeId);
    if (bridgeId.length < 8 || bridgeId.length > 64) {
        return { error: "Bridge ID must be 8-64 characters.", mode };
    }

    return { error: null, mode };
}

function validateProtocol(payload, mode) {
    const protocol = String(payload.protocol || "tcp").toLowerCase();
    if (mode === "host" && !["tcp", "udp", "both"].includes(protocol)) {
        return "Host mode protocol must be tcp, udp, or both.";
    }
    if (mode === "client" && !["tcp", "udp"].includes(protocol)) {
        return "Client mode protocol must be tcp or udp.";
    }

    return null;
}

function validatePort(payload) {
    const port = Number(payload.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return "Port must be an integer between 1 and 65535.";
    }

    return null;
}

function validateNumericOptions(payload) {
    const numericFields = [
        ["status", payload.status],
        ["maxStreams", payload.maxStreams],
        ["kbps", payload.kbps],
        ["tcpRetries", payload.tcpRetries],
        ["tcpRetryDelay", payload.tcpRetryDelay],
    ];

    for (const [key, value] of numericFields) {
        if (value === "" || value === null || value === undefined) continue;
        if (!/^\d+$/.test(String(value))) {
            return `${key} must be a positive integer.`;
        }
    }

    return null;
}

function validatePayload(payload) {
    const base = validateModeAndBridgeId(payload);
    if (base.error) return base.error;

    const protocolError = validateProtocol(payload, base.mode);
    if (protocolError) return protocolError;

    const portError = validatePort(payload);
    if (portError) return portError;

    return validateNumericOptions(payload);
}

function sendLog(stream, text) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("launcher:log", { stream, text });
}

function sendStatus(status) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("launcher:status", {
        status,
        running: !!(currentProcess && !currentProcess.killed),
    });
}

function quoteWinArg(arg) {
    const text = String(arg);
    if (!/[\s"]/g.test(text)) return text;
    return `"${text.replace(/"/g, '\\"')}"`;
}

function startProcessWithArgs(exe, args, options = {}) {
    const useCmdWindow = options.openCommandPrompt && os.platform() === "win32";

    if (useCmdWindow) {
        // Open a detached Command Prompt window on Windows so users can see
        // native console output (useful for interactive debugging).
        const commandText = [quoteWinArg(exe), ...args.map(quoteWinArg)].join(" ");
        currentProcess = spawn("cmd.exe", ["/k", commandText], {
            windowsHide: false,
            stdio: ["ignore", "ignore", "ignore"],
            shell: true,
            detached: true,
        });
        sendLog("stdout", `[info] Opened Command Prompt window for output.\n`);
    } else {
        currentProcess = spawn(exe, args, {
            stdio: ["ignore", "pipe", "pipe"],
            shell: false,
        });

        currentProcess.stdout.on("data", (chunk) => {
            sendLog("stdout", chunk.toString());
        });

        currentProcess.stderr.on("data", (chunk) => {
            sendLog("stderr", chunk.toString());
        });
    }

    currentProcess.on("close", (code) => {
        sendLog("stdout", `\n[info] nat-bridge exited`);
        currentProcess = null;
        sendStatus("idle");
    });

    currentProcess.on("error", (err) => {
        sendLog("stderr", `[launcher-error] ${err.message}\n`);
        currentProcess = null;
        sendStatus("error");
    });
}

function buildBridgeId(rawBridgeId) {
    return normalizeBridgeId(rawBridgeId) || generateRandomID();
}

function buildBridgeArgs(payload) {
    const mode = String(payload.mode || "host").toLowerCase();
    const bridgeId = buildBridgeId(payload.bridgeId);

    const args = [
        mode,
        bridgeId,
        mode === "host" ? "--expose" : "--listen",
        String(payload.port),
        "--protocol",
        String(payload.protocol || "tcp").toLowerCase(),
    ];

    if (payload.verbose) args.push("--verbose");
    if (payload.warnings) args.push("--warnings");
    if (payload.secret) args.push("--secret", String(payload.secret));
    if (payload.status) args.push("--status", String(payload.status));
    if (payload.maxStreams) args.push("--max-streams", String(payload.maxStreams));
    if (payload.kbps) args.push("--kbps", String(payload.kbps));
    if (payload.tcpRetries) args.push("--tcp-retries", String(payload.tcpRetries));
    if (payload.tcpRetryDelay) args.push("--tcp-retry-delay", String(payload.tcpRetryDelay));

    return args;
}

function startFromConfigFile(exe, payload) {
    const configPath = String(payload.configFile || "").trim();
    if (!configPath || !fs.existsSync(configPath)) {
        return { ok: false, message: "Configuration file was not found." };
    }

    startProcessWithArgs(exe, ["config", configPath], {
        openCommandPrompt: !!payload.openCommandPrompt,
    });
    return { ok: true, message: "nat-bridge started." };
}

function startFromInteractiveInput(exe, payload) {
    const error = validatePayload(payload);
    if (error) return { ok: false, message: error };

    const args = buildBridgeArgs(payload);
    startProcessWithArgs(exe, args, {
        openCommandPrompt: !!payload.openCommandPrompt,
    });
    return { ok: true, message: "nat-bridge started." };
}

function startLauncher(payload) {
    const exe = findNatBridgeExecutable();
    if (!exe) {
        return { ok: false, message: "nat-bridge executable not found. Place it in project root/launcher or add it to PATH." };
    }

    if (currentProcess && !currentProcess.killed) {
        return { ok: false, message: "nat-bridge is already running. Stop it first." };
    }

    if (payload.loadFromFile) return startFromConfigFile(exe, payload);
    return startFromInteractiveInput(exe, payload);
}

function killNatBridgeCmdWindows() {
    // Query PowerShell for cmd.exe processes whose command line contains
    // the literal `nat-bridge`, then taskkill only those PIDs.
    try {
        const psArgs = [
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Process -Filter \"Name='cmd.exe' AND CommandLine LIKE '%nat-bridge%'\" | Select-Object -ExpandProperty ProcessId",
        ];
        const ps = spawnSync("powershell.exe", psArgs, {
            encoding: "utf8",
            windowsHide: true,
        });

        const out = String(ps.stdout || "");
        const pids = out
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => parseInt(s, 10))
            .filter((n) => Number.isInteger(n) && n > 0);

        if (pids.length) {
            const args = ["/F", "/T", ...pids.flatMap((pid) => ["/PID", String(pid)])];
            spawnSync("taskkill", args, { windowsHide: true, stdio: "ignore" });
        }
    } catch (_) {
        // ignore any failures here; this cleanup is best-effort only
    }
}

function createMainWindow() {
    const systemBg = nativeTheme.shouldUseDarkColors ? "#1f1f1f" : "#f0f0f0";
    mainWindow = new BrowserWindow({
        width: 645,
        height: 760,
        minWidth: 645,
        minHeight: 600,
        title: "NAT-bridge Launcher",
        backgroundColor: systemBg,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    mainWindow.setMenuBarVisibility(false);

    mainWindow.loadFile(path.join(__dirname, "ui", "index.html"));
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

ipcMain.handle("launcher:browseConfig", async () => {
    const picked = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: "JSON", extensions: ["json"] }, { name: "All Files", extensions: ["*"] }],
    });

    if (picked.canceled || !picked.filePaths.length) return null;
    return picked.filePaths[0];
});

ipcMain.handle("launcher:toggle", (_event, payload) => {
    const isRunning = !!(currentProcess && !currentProcess.killed);

    if (isRunning) {
        currentProcess.kill();
        sendLog("stdout", "[info] stop signal sent\n");
        // use taskkill on Windows to force kill if it doesn't exit gracefully in a few seconds
        if (os.platform() === "win32") {
            setTimeout(() => {
                killNatBridgeCmdWindows();
            }, 1000);
        }
        sendStatus("stopping");
        return { ok: true, running: true, message: "stopping" };
    }

    sendStatus("starting");
    const result = startLauncher(payload);
    if (!result.ok) {
        sendLog("stderr", `[error] ${result.message}\n`);
        sendStatus("error");
        return { ok: false, running: false, message: result.message };
    }

    sendLog("stdout", `[info] ${result.message}\n`);
    sendStatus("running");
    return { ok: true, running: true, message: result.message };
});

app.whenReady().then(() => {
    createMainWindow();
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
});

app.on("window-all-closed", () => {
    if (currentProcess && !currentProcess.killed) currentProcess.kill();
    if (process.platform !== "darwin") app.quit();
});
