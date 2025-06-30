// ------------------------------------------------------------------------------------------------------------
// A simple command-line launcher for the nat-bridge tool.
// This script is for people who want to use nat-bridge without knowing how to use the command line.
// ------------------------------------------------------------------------------------------------------------

const readline = require("readline");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

// Color helpers
const color = (text, c) => process.stdout.isTTY ? `\x1b[${c}m${text}\x1b[0m` : text;
const info = (msg) => console.log(color('[INFO]', '36'), msg);
const warn = (msg) => console.warn(color('[WARN]', '33'), msg);
const error = (msg) => console.error(color('[ERROR]', '31'), msg);

function prompt(question) {
    return new Promise((res) => rl.question(question, res));
}

function findNatBridgeExecutable() {
    const isWin = os.platform() === "win32";
    if (isWin) {
        const path = require("path");
        const exePath = path.resolve(__dirname, "nat-bridge.exe");
        if (fs.existsSync(exePath)) return exePath;
    }
    const cmd = isWin ? "where" : "which";
    const result = spawnSync(cmd, [isWin ? "nat-bridge.exe" : "nat-bridge"], { encoding: "utf-8" });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
    return null;
}

function generateRandomID() {
    return Math.random().toString(36).substring(2, 15);
}

function waitForEnterAndExit() {
    const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl2.question(color('Press Enter to exit...', '90'), () => {
        rl2.close();
        process.exit(1);
    });
}

(async () => {
    let exe;
    try {
        exe = findNatBridgeExecutable();
    } catch (e) {
        error('Error while searching for nat-bridge executable: ' + e.message);
        rl.close();
        waitForEnterAndExit();
        return;
    }

    if (!exe) {
        error('nat-bridge executable not found. Make sure it is in the same directory as this launcher.');
        rl.close();
        waitForEnterAndExit();
        return;
    }

    let loadFromFile;
    try {
        loadFromFile = await prompt('Load configuration from file? (yes/no, default is no): ');
        loadFromFile = loadFromFile.trim().toLowerCase() === 'yes';
    } catch (e) {
        error('Error reading input: ' + e.message);
        rl.close();
        waitForEnterAndExit();
        return;
    }
    if (loadFromFile) {
        let configFile;
        try {
            configFile = await prompt('Enter configuration file path: ');
            //configFile = configFile.trim();
        } catch (e) {
            error('Error reading input: ' + e.message);
            rl.close();
            waitForEnterAndExit();
            return;
        }
        if (!configFile) {
            warn('Configuration file path cannot be empty.');
            rl.close();
            waitForEnterAndExit();
            return;
        }
        if (!fs.existsSync(configFile)) {
            error(`Configuration file '${configFile}' not found.`);
            rl.close();
            waitForEnterAndExit();
            return;
        }
        rl.close();
        info('Launching nat-bridge with configuration file...');
        const args = ['config', '"'+configFile+'"'];
        try {
            for (let i = 0; i < 3; i++) {
                process.stdout.write('\x1b[1A');
                process.stdout.write('\r\x1b[2K');
            }
            const child = spawnSync(exe, args, { stdio: 'inherit', shell: true });
            if (child.error) throw child.error;
        } catch (e) {
            error('Failed to launch nat-bridge: ' + e.message);
            waitForEnterAndExit();
        }
        return;
    }

    let mode;
    try {
        mode = await prompt('Enter mode (host/client): ');
        mode = mode.trim().toLowerCase();
        if (mode !== 'host' && mode !== 'client') {
            error("Invalid mode. Please enter 'host' or 'client'.");
            rl.close();
            waitForEnterAndExit();
            return;
        }
    } catch (e) {
        error('Error reading input: ' + e.message);
        rl.close();
        waitForEnterAndExit();
        return;
    }

    let bridgeID;
    try {
        bridgeID = await prompt('Enter bridge ID'+(mode == 'host' ? '(default is a randomly generated ID): ' : ': '));
        if (mode === 'host' && !bridgeID) {
            bridgeID = generateRandomID();
        } else if (mode === 'client' && !bridgeID) {
            error('Bridge ID is required in client mode.');
            rl.close();
            waitForEnterAndExit();
            return;
        }
        bridgeID = bridgeID.trim();
        bridgeID = bridgeID.replaceAll(' ', '-');
        bridgeID = bridgeID.replace(/[^a-zA-Z0-9_-]/g, '');
        if (bridgeID.length < 8 || bridgeID.length > 64) {
            error('Invalid bridge ID. Please enter an ID between 8 and 64 characters.');
            rl.close();
            waitForEnterAndExit();
            return;
        }
    } catch (e) {
        error('Error reading input: ' + e.message);
        rl.close();
        waitForEnterAndExit();
        return;
    }

    let protocol;
    try {
        protocol = await prompt(`Enter protocol [${mode == 'host' ? 'tcp|udp|both' : 'tcp|udp'}] (default is 'tcp'): `);
        protocol = protocol.trim().toLowerCase() || 'tcp';
        if (mode === 'host' && !['tcp', 'udp', 'both'].includes(protocol)) {
            error("Invalid protocol. Please enter 'tcp', 'udp', or 'both'.");
            rl.close();
            waitForEnterAndExit();
            return;
        } else if (mode === 'client' && !['tcp', 'udp'].includes(protocol)) {
            error("Invalid protocol. Please enter 'tcp' or 'udp'.");
            rl.close();
            waitForEnterAndExit();
            return;
        }
    } catch (e) {
        error('Error reading input: ' + e.message);
        rl.close();
        waitForEnterAndExit();
        return;
    }

    let port;
    try {
        port = await prompt('Enter port '+(mode == 'host' ? '(default 8080): ' : '(default 5000): '));
        port = port.trim() || (mode == 'host' ? '8080': '5000');
        if (!/^\d+$/.test(port) || parseInt(port) < 1 || parseInt(port) > 65535) {
            error('Invalid port. Please enter a number between 1 and 65535.');
            rl.close();
            waitForEnterAndExit();
            return;
        }
    } catch (e) {
        error('Error reading input: ' + e.message);
        rl.close();
        waitForEnterAndExit();
        return;
    }

    let verbose;
    try {
        verbose = await prompt('Enable verbose logging? (yes/no, default is no): ');
        verbose = verbose.trim().toLowerCase() === 'yes' ? '--verbose' : '';
    } catch (e) {
        error('Error reading input: ' + e.message);
        rl.close();
        waitForEnterAndExit();
        return;
    }

    rl.close();

    info(`Starting nat-bridge in ${mode} mode with ID '${bridgeID}' on port ${port} using protocol '${protocol}'${verbose ? ' with verbose logging' : ''}.`);

    const args = [mode, bridgeID, '--port', port, '--protocol', protocol, verbose];
    try {
        for (let i = 0; i < 7; i++) {
            process.stdout.write('\x1b[1A');
            process.stdout.write('\r\x1b[2K');
        }
        const child = spawnSync(exe, args, { stdio: 'inherit', shell: true });
        if (child.error) throw child.error;
    } catch (e) {
        error('Failed to launch nat-bridge: ' + e.message);
        waitForEnterAndExit();
    }
})();
