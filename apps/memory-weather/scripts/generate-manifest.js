"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const excluded = new Set(["MANIFEST.sha256"]);

function walk(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else files.push(absolute);
  }
  return files;
}

const lines = walk(root)
  .filter((absolute) => !excluded.has(path.relative(root, absolute).replaceAll(path.sep, "/")))
  .sort((a, b) => a.localeCompare(b))
  .map((absolute) => {
    const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
    const hash = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
    return `${hash}  ${relative}`;
  });

fs.writeFileSync(path.join(root, "MANIFEST.sha256"), `${lines.join("\n")}\n`, "utf8");
process.stdout.write(`Wrote MANIFEST.sha256 (${lines.length} files)\n`);
