#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const targetDir = process.argv[2] || path.join(root, 'dist-bin');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function copyNativeAddons() {
  const nm = path.join(root, 'node_modules');
  if (!fs.existsSync(nm)) {
    console.error('node_modules not found; aborting copy of native addons.');
    process.exit(0);
  }

  ensureDir(targetDir);

  const rootPkgPath = path.join(root, 'package.json');
  if (fs.existsSync(rootPkgPath)) {
    try {
      const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
      const runtimePkg = {
        name: rootPkg.name,
        version: rootPkg.version,
        main: 'main.cjs'
      };
      fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify(runtimePkg, null, 2));
      console.log(`Wrote runtime package.json -> ${path.relative(root, path.join(targetDir, 'package.json'))}`);
    } catch (e) {
      console.error('Failed to write runtime package.json:', e.message);
    }
  }

  let found = 0;
  for (const file of walk(nm)) {
    if (file.endsWith('.node')) {
      found++;
      const base = path.basename(file);
      // copy as-is into targetDir with package-prefixed name to avoid collisions
      const rel = path.relative(nm, file);
      const safeName = rel.replace(/[\\/]/g, '__');
      const dest = path.join(targetDir, safeName);
      ensureDir(path.dirname(dest));
      try {
        fs.copyFileSync(file, dest);
        console.log(`Copied native addon: ${rel} -> ${path.relative(root, dest)}`);
      } catch (e) {
        console.error('Failed to copy', file, e.message);
      }
    }
  }

  if (found === 0) console.log('No .node native addons found.');
  else console.log(`Copied ${found} native addon(s) into ${targetDir}`);
}

copyNativeAddons();
