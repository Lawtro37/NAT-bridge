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

function prompt(question) {
    return new Promise((res) => rl.question(question, res));
}

function findNatBridgeExecutable() {
    const isWin = os.platform() === "win32";
    const cmd = isWin ? "where" : "which";
    const result = spawnSync(cmd, ["nat-bridge"], { encoding: "utf-8" });
    if (result.status === 0) return result.stdout.trim();
    return null;
}

function generateRandomID() {
    return Math.random().toString(36).substring(2, 15);
}

(async () => {
    let exe = findNatBridgeExecutable();

    if (!exe) {
        console.log("nat-bridge executable not found.");
        rl.close();
        return;
    }

    let mode = await prompt("Enter mode (host/client): ");
    mode = mode.trim().toLowerCase();
    if (mode !== "host" && mode !== "client") {
        console.log("Invalid mode. Please enter 'host' or 'client'.");
        rl.close();
        return;
    }

    let bridgeID = await prompt("Enter bridge ID (default is a randomly generated ID): ");
    bridgeID = bridgeID.trim() || generateRandomID();
    bridgeID = bridgeID.replaceAll(" ", "-");
    bridgeID = bridgeID.replace(/[^a-zA-Z0-9_-]/g, "");

    if (bridgeID.length < 8 || bridgeID.length > 64) {
        console.log("Invalid bridge ID. Please enter an ID between 8 and 64 characters.");
        rl.close();
        return;
    }

    let protocol = await prompt(`Enter protocol [${mode == "host" ? "tcp|udp|both" : "tcp|udp"}] (default is 'tcp'): `);
    protocol = protocol.trim() || "tcp";
    if (mode === "host" && !["tcp", "udp", "both"].includes(protocol)) {
        console.log("Invalid protocol. Please enter 'tcp', 'udp', or 'both'.");
        rl.close();
        return;
    } else if (mode === "client" && !["tcp", "udp"].includes(protocol)) {
        console.log("Invalid protocol. Please enter 'tcp' or 'udp'.");
        rl.close();
        return;
    }

    let port = await prompt("Enter port (default 8080): ");
    port = port.trim() || "8080";

    if (!/^\d+$/.test(port) || parseInt(port) < 1 || parseInt(port) > 65535) {
        console.log("Invalid port. Please enter a number between 1 and 65535.");
        rl.close();
        return; 
    }

    let verbose = await prompt("Enable verbose logging? (yes/no, default is no): ");
    verbose = verbose.trim().toLowerCase() === "yes" ? "--verbose" : "";

    rl.close();

    console.log(`Starting nat-bridge in ${mode} mode with ID '${bridgeID}' on port ${port} using protocol '${protocol}'${verbose ? " with verbose logging" : ""}. \n`);

    const args = [mode, bridgeID, "--port", port, "--protocol", protocol, verbose];
    const child = spawnSync(exe, args, { stdio: "inherit", shell: true });
})();