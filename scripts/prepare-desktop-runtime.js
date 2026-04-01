const fs = require('fs');
const path = require('path');

const sourceNode = process.execPath;
const runtimeDir = path.join(process.cwd(), 'desktop', 'runtime');
const targetNode = path.join(runtimeDir, process.platform === 'win32' ? 'node.exe' : 'node');

fs.mkdirSync(runtimeDir, { recursive: true });
fs.copyFileSync(sourceNode, targetNode);

console.log(`[desktop-runtime] bundled node runtime copied to ${targetNode}`);
