const fs = require('fs');
const path = require('path');

function safeRm(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function safeCp(src, dst) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    // Node 16+ has fs.cpSync
    if (fs.cpSync) fs.cpSync(src, dst, { recursive: true });
    else {
      // fallback: simple recursive copy
      const copyRecursive = (s, d) => {
        fs.mkdirSync(d, { recursive: true });
        for (const name of fs.readdirSync(s)) {
          const from = path.join(s, name);
          const to = path.join(d, name);
          const st = fs.statSync(from);
          if (st.isDirectory()) copyRecursive(from, to);
          else fs.copyFileSync(from, to);
        }
      };
      copyRecursive(src, dst);
    }
  } else {
    fs.copyFileSync(src, dst);
  }
  return true;
}

const outBase = path.resolve('release', 'nat-bridge-win32-x64');
try {
  safeRm(outBase);
  fs.mkdirSync(outBase, { recursive: true });
} catch (err) {
  console.warn('Warning: could not remove/create release folder, continuing. Error:', err && err.message);
  fs.mkdirSync(outBase, { recursive: true });
}

// 1) copy the packaged nat-bridge exe (iconed)
const packagedExe = path.resolve('dist', 'nat-bridge.exe');
if (fs.existsSync(packagedExe)) {
  fs.copyFileSync(packagedExe, path.join(outBase, 'nat-bridge.exe'));
  console.log('Copied nat-bridge.exe');
} else console.warn('packaged nat-bridge.exe not found');

// 2) copy example configurations (folder named "configuration examples" or "configuration examples/")
const examplesSrc1 = path.resolve('configuration examples');
const examplesSrc2 = path.resolve('configuration examples');
if (fs.existsSync(examplesSrc1)) {
  safeCp(examplesSrc1, path.join(outBase, 'example-configurations'));
  console.log('Copied example-configurations');
} else if (fs.existsSync(examplesSrc2)) {
  safeCp(examplesSrc2, path.join(outBase, 'example-configurations'));
  console.log('Copied example-configurations');
} else console.warn('Example configurations folder not found');

// 3) copy the packaged launcher produced by electron-packager
const buildTemp = path.resolve('build_temp');
if (fs.existsSync(buildTemp)) {
  const items = fs.readdirSync(buildTemp);
  const pkgDir = items.find((d) => d.includes('win32') && d.includes('x64'));
  if (pkgDir) {
    const src = path.join(buildTemp, pkgDir);
    safeCp(src, path.join(outBase, 'launcher'));
    console.log('Copied launcher package');
  } else console.warn('No electron-packager output found in build_temp');
} else console.warn('build_temp not found; did you run build:launcher?');

console.log('\nRelease folder assembled at:', outBase);
