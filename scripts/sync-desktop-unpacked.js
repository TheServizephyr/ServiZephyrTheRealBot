const fs = require('fs');
const path = require('path');

const root = process.cwd();

const candidateTargets = [
  'desktop-dist-build/win-unpacked/resources/app',
  'desktop-dist-installer/win-unpacked/resources/app',
  'desktop-dist-portable/win-unpacked/resources/app',
  'desktop-dist/win-unpacked/resources/app',
];

const existingTargets = candidateTargets
  .map((relativePath) => path.join(root, relativePath))
  .filter((targetPath) => fs.existsSync(targetPath));

if (existingTargets.length === 0) {
  console.error('[desktop-sync] No win-unpacked app resources folders found.');
  process.exit(1);
}

const standaloneSource = path.join(root, '.next', 'standalone');
const staticSource = path.join(root, '.next', 'static');
const desktopSource = path.join(root, 'desktop');
const publicSource = path.join(root, 'public');
const envSource = path.join(root, '.env.local');

if (!fs.existsSync(standaloneSource) || !fs.existsSync(staticSource)) {
  console.error('[desktop-sync] Build output missing. Run `npm run build` first.');
  process.exit(1);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resetDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  ensureDir(dirPath);
}

for (const targetPath of existingTargets) {
  const nextTarget = path.join(targetPath, '.next');
  const desktopTarget = path.join(targetPath, 'desktop');
  const publicTarget = path.join(targetPath, 'public');

  resetDir(nextTarget);
  fs.cpSync(standaloneSource, targetPath, { recursive: true, force: true });
  fs.cpSync(staticSource, path.join(nextTarget, 'static'), { recursive: true, force: true });

  resetDir(desktopTarget);
  fs.cpSync(desktopSource, desktopTarget, { recursive: true, force: true });

  resetDir(publicTarget);
  fs.cpSync(publicSource, publicTarget, { recursive: true, force: true });

  if (fs.existsSync(envSource)) {
    fs.copyFileSync(envSource, path.join(targetPath, '.env.local'));
  }

  console.log(`[desktop-sync] Updated ${path.relative(root, targetPath)}`);
}
