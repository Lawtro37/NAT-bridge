// ------------------------------------------------------------------------------------------------------------
// A simple command-line launcher for the nat-bridge tool with advanced options.
// ------------------------------------------------------------------------------------------------------------

const readline = require("readline");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

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

    // === Option: Load from config file ===
    let loadFromFile = (await prompt('Load configuration from file? (yes/no, default no): ')).trim().toLowerCase() === 'yes';
    if (loadFromFile) {
        let configFile = (await prompt('Enter configuration file path: ')).trim();
        if (!configFile) {
            warn('Configuration file path cannot be empty.');
            rl.close(); waitForEnterAndExit(); return;
        }
        if (!fs.existsSync(configFile)) {
            error(`Configuration file '${configFile}' not found.`);
            rl.close(); waitForEnterAndExit(); return;
        }
        rl.close();
        info('Launching nat-bridge with configuration file...');
        try { spawnSync(exe, ['config', `"${configFile}"`], { stdio: 'inherit', shell: true }); }
        catch (e) { error('Failed to launch nat-bridge: ' + e.message); waitForEnterAndExit(); }
        return;
    }

    // === Interactive mode ===
    let mode = (await prompt('Enter mode (host/client): ')).trim().toLowerCase();
    if (!['host', 'client'].includes(mode)) {
        error("Invalid mode. Must be 'host' or 'client'.");
        rl.close(); waitForEnterAndExit(); return;
    }

    let bridgeID = (await prompt(`Enter bridge ID ${mode === 'host' ? '(default random): ' : ': '}`)).trim();
    if (mode === 'host' && !bridgeID) bridgeID = generateRandomID();
    if (mode === 'client' && !bridgeID) {
        error('Bridge ID required in client mode.');
        rl.close(); waitForEnterAndExit(); return;
    }
    bridgeID = bridgeID.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '');
    if (bridgeID.length < 8 || bridgeID.length > 64) {
        error('Bridge ID must be 8–64 characters.');
        rl.close(); waitForEnterAndExit(); return;
    }

    let protocol = (await prompt(`Enter protocol [${mode === 'host' ? 'tcp|udp|both' : 'tcp|udp'}] (default tcp): `)).trim().toLowerCase() || 'tcp';
    if (mode === 'host' && !['tcp', 'udp', 'both'].includes(protocol)) {
        error("Invalid protocol."); rl.close(); waitForEnterAndExit(); return;
    }
    if (mode === 'client' && !['tcp', 'udp'].includes(protocol)) {
        error("Invalid protocol."); rl.close(); waitForEnterAndExit(); return;
    }

    let port = (await prompt(`Enter port ${mode === 'host' ? '(default 8080): ' : '(default 5000): '}`)).trim() || (mode === 'host' ? '8080' : '5000');
    if (!/^\d+$/.test(port) || +port < 1 || +port > 65535) {
        error('Invalid port. Must be 1–65535.');
        rl.close(); waitForEnterAndExit(); return;
    }

    let verbose = (await prompt('Enable verbose logging? (yes/no, default no): ')).trim().toLowerCase() === 'yes';
    let warnings = (await prompt('Show expected warnings? (yes/no, default no): ')).trim().toLowerCase() === 'yes';

    // === Advanced Options ===
    let useAdvanced = (await prompt('Use advanced options? (yes/no, default no): ')).trim().toLowerCase() === 'yes';
    let secret, status, maxStreams, kbps, tcpRetries, tcpRetryDelay;
    if (useAdvanced) {
        secret = (await prompt('Enter secret passphrase (leave empty to disable): ')).trim();
        status = (await prompt('Enter status server port (leave empty to disable): ')).trim();
        maxStreams = (await prompt('Enter max concurrent streams (default 256): ')).trim() || '256';
        kbps = (await prompt('Enter kbps throttle per stream (0=unlimited): ')).trim() || '0';
        tcpRetries = (await prompt('Enter TCP connect retry attempts (default 5): ')).trim() || '5';
        tcpRetryDelay = (await prompt('Enter TCP retry delay in ms (default 500): ')).trim() || '500';
    }

    rl.close();

    info(`Starting nat-bridge in ${mode} mode with ID '${bridgeID}' on port ${port} using protocol '${protocol}'${verbose ? ' (verbose)' : ''}${warnings ? ' (warnings enabled)' : ''}${useAdvanced ? ' (advanced options enabled)' : ''}.`);

    const args = [
        mode,
        bridgeID,
        mode === 'host' ? '--expose' : '--listen', port,
        '--protocol', protocol,
    ];
    if (verbose) args.push('--verbose');
    if (warnings) args.push('--warnings');

    // Add advanced flags if chosen
    if (useAdvanced) {
        if (secret) args.push('--secret', `"${secret}"`);
        if (status) args.push('--status', status);
        if (maxStreams) args.push('--max-streams', maxStreams);
        if (kbps) args.push('--kbps', kbps);
        if (tcpRetries) args.push('--tcp-retries', tcpRetries);
        if (tcpRetryDelay) args.push('--tcp-retry-delay', tcpRetryDelay);
    }

    try {
        spawnSync(exe, args, { stdio: 'inherit', shell: true });
    } catch (e) {
        error('Failed to launch nat-bridge: ' + e.message);
        waitForEnterAndExit();
    }
})();
