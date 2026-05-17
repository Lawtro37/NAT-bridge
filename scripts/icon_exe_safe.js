const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const exePath = path.join(projectRoot, 'nat-bridge.exe');
const distExePath = path.join(projectRoot, 'dist', 'nat-bridge.exe');
const iconPath = path.join(projectRoot, 'icons', 'icon.ico');
const rceditBin = path.join(projectRoot, 'node_modules', 'rcedit', 'bin', 'rcedit.exe');
const caxaStubPath = path.join(projectRoot, 'node_modules', '@appthreat', 'caxa', 'stubs', `stub--${process.platform}--${process.arch}`);

function fail(message) {
  console.error(message);
  process.exit(2);
}

function runCommand(command, args, options = {}) {
  const proc = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });

  if (proc.error) {
    throw proc.error;
  }
  if (proc.status !== 0) {
    throw new Error(`${command} exited with code ${proc.status}`);
  }
}

if (!fs.existsSync(iconPath)) fail(`Icon not found at ${iconPath}`);
if (!fs.existsSync(rceditBin)) fail(`rcedit binary not found at ${rceditBin}`);
if (!fs.existsSync(caxaStubPath)) fail(`caxa stub not found at ${caxaStubPath}`);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nat-bridge-caxa-'));
const tempStubPath = path.join(tempDir, 'caxa-stub.exe');

try {
  fs.copyFileSync(caxaStubPath, tempStubPath);
  runCommand(rceditBin, [tempStubPath, '--set-icon', iconPath], { shell: false });

  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  runCommand(npxCmd, [
    'caxa',
    '--input', '.',
    '--output', 'nat-bridge.exe',
    '--stub', tempStubPath,
    '--',
    '{{caxa}}/node_modules/.bin/node',
    '{{caxa}}/main.js'
  ]);

  fs.mkdirSync(path.dirname(distExePath), { recursive: true });
  fs.copyFileSync(exePath, distExePath);
  console.log('Copied nat-bridge.exe to dist/nat-bridge.exe');
  console.log('Built nat-bridge.exe with the icon applied to the caxa stub.');
} catch (err) {
  console.error('Failed to build iconed EXE safely:', err && err.message);
  process.exit(1);
} finally {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (err) {}
}
