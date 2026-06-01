const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const distBinDir = path.join(projectRoot, 'dist-bin');
const distDir = path.join(projectRoot, 'dist');
const distExePath = path.join(distDir, 'nat-bridge.exe');
const distBinExePath = path.join(distBinDir, 'main-win-x64.exe');
const systemRoot = process.env.SystemRoot || 'C:\\Windows';
const cmdExe = path.join(systemRoot, 'System32', 'cmd.exe');
const iconPath = path.join(projectRoot, 'icons', 'icon.ico');
const rceditBin = path.join(projectRoot, 'node_modules', 'rcedit', 'bin', 'rcedit.exe');
const caxaStubPath = path.join(projectRoot, 'node_modules', '@appthreat', 'caxa', 'stubs', `stub--${process.platform}--${process.arch}`);

function fail(msg) { console.error(msg); process.exit(2); }
function run(command, args, opts = {}) {
  const proc = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (proc.error) throw proc.error;
  if (proc.status !== 0) throw new Error(`${command} exited with code ${proc.status}`);
}

if (!fs.existsSync(iconPath)) fail(`Icon not found at ${iconPath}`);
if (!fs.existsSync(rceditBin)) fail(`rcedit binary not found at ${rceditBin}`);
if (!fs.existsSync(caxaStubPath)) fail(`caxa stub not found at ${caxaStubPath}`);

// Read root package.json and pick only runtime deps (exclude electron which is launcher-only)
const rootPkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const prodDeps = Object.assign({}, rootPkg.dependencies || {});
// Exclude electron (launcher) from minimal bundle
delete prodDeps.electron;

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nat-bridge-min-'));
try {
  // Write minimal package.json
  const minimalPkg = { name: rootPkg.name, version: rootPkg.version, main: rootPkg.bin || 'main.js', dependencies: prodDeps };
  fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(minimalPkg, null, 2));

  // Copy runtime entry
  fs.copyFileSync(path.join(projectRoot, 'main.js'), path.join(tempDir, 'main.js'));

  // Install production deps into tempDir
  console.log('Installing production dependencies into temporary build folder...');
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--production', '--prefix', tempDir]);

  // caxa writes its payload next to the output exe, so the target directory must exist first.
  fs.mkdirSync(distBinDir, { recursive: true });
  fs.mkdirSync(distDir, { recursive: true });

  // Prepare a temp stub with the icon applied
  const tempStubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nat-bridge-stub-'));
  const tempStubPath = path.join(tempStubDir, 'caxa-stub.exe');
  fs.copyFileSync(caxaStubPath, tempStubPath);
  run(rceditBin, [tempStubPath, '--set-icon', iconPath], { shell: false });

  // Run caxa to package only the app/runtime files; use system Node at runtime.
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  console.log('Running caxa to create the minimal executable...');
  run(npxCmd, [
    'caxa',
    '--input', tempDir,
    '--output', 'dist-bin/main-win-x64.exe',
    '--stub', tempStubPath,
    '--compression', 'zstd',
    '--no-include-node',
    '--',
    cmdExe,
    '/d', '/s', '/c', 'node', '{{caxa}}/main.js'
  ], { cwd: projectRoot });

  // Mirror the working single-file exe into dist for the release flow.
  fs.copyFileSync(distBinExePath, distExePath);
  console.log('Built minimal main-win-x64.exe with zstd compression and copied it to dist/nat-bridge.exe.');
} catch (err) {
  console.error('Minimal build failed:', err && err.message);
  process.exit(1);
} finally {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
}
