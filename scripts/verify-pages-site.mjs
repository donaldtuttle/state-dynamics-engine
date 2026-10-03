import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../_site/', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'site-manifest.json'), 'utf8'));
let checked = 0;
for (const route of manifest.routes) {
  const rel = route.slice(1), file = path.join(root, rel.endsWith('/') || !rel ? rel+'index.html' : rel);
  const html = fs.readFileSync(file, 'utf8');
  if (/[\u0370-\u03ff\u1d3d\u2295]/u.test(html)) throw new Error(`Research glyph in ${route}`);
  for (const [, link] of html.matchAll(/(?:href|src)=["']([^"']+)["']/g)) {
    if (/^(?:[a-z]+:|#|\/\/)/i.test(link)) continue;
    let dest = path.resolve(path.dirname(file), link.split(/[?#]/)[0]);
    if (!dest.startsWith(root)) throw new Error(`Escaping site root: ${link}`);
    if (fs.existsSync(dest) && fs.statSync(dest).isDirectory()) dest = path.join(dest, 'index.html');
    if (!fs.existsSync(dest)) throw new Error(`Broken asset/link ${route}: ${link}`);
    checked++;
  }
}
console.log(`PASS: ${manifest.routes.length} site routes and ${checked} local links/assets.`);
