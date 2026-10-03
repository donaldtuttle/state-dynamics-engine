"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourceOrder = ["math.js", "engine.js", "projection.js", "field.js", "renderer.js", "app.js"];
let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
html = html.replace('<link rel="stylesheet" href="styles.css">', `<style>\n${css}\n</style>`);
for (const filename of sourceOrder) {
  html = html.replace(`  <script src="src/${filename}"></script>\n`, "");
}
const javascript = sourceOrder.map((filename) => `/* ${filename} */\n${fs.readFileSync(path.join(root, "src", filename), "utf8")}`).join("\n");
html = html.replace("</body>", `<script>\n${javascript}\n</script>\n</body>`);
html = html.replaceAll('href="docs/', 'href="../docs/');
html = html.replace("<title>Memory Weather</title>", "<title>Memory Weather  /  Standalone</title>");
const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, "memory-weather.html"), html, "utf8");
process.stdout.write(`Built dist/memory-weather.html (${Buffer.byteLength(html)} bytes)\n`);
