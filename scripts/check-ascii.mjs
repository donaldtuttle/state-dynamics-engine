import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const skip = new Set(['.git', 'node_modules', '_site', 'dist', '__pycache__']);
const imageExt = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico']);
let count = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name) || entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (imageExt.has(path.extname(entry.name).toLowerCase())) continue;
    const bytes = fs.readFileSync(full); count++;
    if (bytes.some(b => b > 127)) throw new Error(`Non-ASCII source text: ${path.relative(root, full)}`);
  }
}
walk(root);
// The dependency-free generated deliverable is repository-owned, too.
const standalone = fs.readFileSync(path.join(root, 'apps/memory-weather/dist/memory-weather.html'));
if (standalone.some(b => b > 127)) throw new Error('Non-ASCII standalone app');
console.log(`PASS: ${count} repository source files and standalone HTML are ASCII. Image files and dependency bundles are excluded.`);
