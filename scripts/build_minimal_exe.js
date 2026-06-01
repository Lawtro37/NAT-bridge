const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const distExePath = path.join(distDir, 'nat-bridge.exe');
const iconPath = path.join(projectRoot, 'icons', 'icon.ico');

function fail(msg) { console.error(msg); process.exit(2); }
function run(command, args, opts = {}) {
  const proc = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (proc.error) throw proc.error;
  if (proc.status !== 0) throw new Error(`${command} exited with code ${proc.status}`);
}

if (!fs.existsSync(iconPath)) fail(`Icon not found at ${iconPath}`);

try {
  // Ensure output directory exists
  fs.mkdirSync(distDir, { recursive: true });
  fs.rmSync(distExePath, { force: true });

  // Build a single-file exe using the exact pkg command validated by the user.
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  console.log('Running pkg to create the minimal executable...');
  run(npxCmd, [
    'pkg',
    'main.js',
    '--targets', 'node18-win-x64',
    '--config', 'package.json',
    '--output', distExePath,
  ], { cwd: projectRoot });

  console.log('Built minimal nat-bridge.exe with pkg. (icon not applied to avoid corrupting the executable)');
} catch (err) {
  console.error('Minimal build failed:', err && err.message);
  process.exit(1);
}
