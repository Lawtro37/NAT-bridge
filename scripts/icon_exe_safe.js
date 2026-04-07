const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const exePath = path.resolve('dist', 'nat-bridge.exe');
const iconPath = path.resolve('icons', 'icon.ico');
const rceditBin = path.resolve('node_modules', 'rcedit', 'bin', 'rcedit.exe');

if (!fs.existsSync(exePath)) {
  console.error('Executable not found at', exePath);
  process.exit(2);
}
if (!fs.existsSync(iconPath)) {
  console.error('Icon not found at', iconPath);
  process.exit(2);
}
if (!fs.existsSync(rceditBin)) {
  console.error('rcedit binary not found at', rceditBin);
  process.exit(2);
}

const backup = exePath + '.bak';
try {
  fs.copyFileSync(exePath, backup);
  console.log('Backup created:', backup);

  const args = [exePath, '--set-icon', iconPath];
  const proc = spawn(rceditBin, args, { stdio: 'inherit' });
  proc.on('error', (err) => {
    console.error('Failed to start rcedit:', err && err.message);
    try { fs.copyFileSync(backup, exePath); } catch (e) {}
    process.exit(1);
  });
  proc.on('exit', (code) => {
    if (code !== 0) {
      console.error('rcedit exited with code', code);
      try { fs.copyFileSync(backup, exePath); } catch (e) {}
      process.exit(1);
    }
    try { fs.unlinkSync(backup); } catch (e) {}
    console.log('Icon applied to', exePath);
  });
} catch (err) {
  console.error('Failed to apply icon:', err && err.message);
  try { if (fs.existsSync(backup)) fs.copyFileSync(backup, exePath); } catch (e) {}
  process.exit(1);
}
