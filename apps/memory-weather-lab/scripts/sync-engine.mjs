#!/usr/bin/env node
"use strict";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siblingSrc = path.resolve(root, "../memory-weather/src");
const vendorDir = path.join(root, "src/vendor");
const checkOnly = process.argv.includes("--check");

const FILES = [
  { name: "math.js", imports: [], args: "" },
  { name: "engine.js", imports: ['import M from "./math.js";'], args: "M" },
  { name: "projection.js", imports: ['import M from "./math.js";'], args: "M" },
  {
    name: "field.js",
    imports: [
      'import M from "./math.js";',
      'import Engine from "./engine.js";',
      'import Projection from "./projection.js";',
    ],
    args: "M, Engine, Projection",
  },
  {
    name: "renderer.js",
    imports: [
      'import M from "./math.js";',
      'import Projection from "./projection.js";',
      'import Field from "./field.js";',
    ],
    args: "M, Projection, Field",
  },
];

function factorySource(text) {
  const marker = ")(typeof globalThis !== \"undefined\" ? globalThis : this, ";
  const index = text.indexOf(marker);
  if (index < 0) throw new Error("UMD factory invocation not found");
  let rest = text.slice(index + marker.length);
  if (rest.endsWith("});\n")) rest = rest.slice(0, -3) + "\n";
  else if (rest.endsWith("});")) rest = rest.slice(0, -2);
  if (!rest.trimStart().startsWith("function")) {
    throw new Error("expected factory function after UMD invocation");
  }
  return rest;
}

function wrap(name, imports, args, factory) {
  const call = args ? `(${factory})(${args});` : `(${factory})();`;
  return [
    "// @ts-nocheck",
    `/* ESM wrapper around apps/memory-weather/src/${name}. Factory body is copied from the sibling file. */`,
    ...imports,
    `const api = ${call}`,
    "export default api;",
    "",
  ].join("\n");
}

let failed = false;
fs.mkdirSync(vendorDir, { recursive: true });
for (const file of FILES) {
  const sourcePath = path.join(siblingSrc, file.name);
  const targetPath = path.join(vendorDir, file.name);
  const factory = factorySource(fs.readFileSync(sourcePath, "utf8"));
  const next = wrap(file.name, file.imports, file.args, factory);
  if (checkOnly) {
    const current = fs.readFileSync(targetPath, "utf8");
    if (current !== next) {
      process.stderr.write(`vendor drift: src/vendor/${file.name} does not match apps/memory-weather/src/${file.name}\n`);
      failed = true;
    }
  } else {
    fs.writeFileSync(targetPath, next);
    process.stdout.write(`wrote src/vendor/${file.name}\n`);
  }
}

if (checkOnly && failed) {
  process.stderr.write("Run `npm run sync-engine` after updating apps/memory-weather/src.\n");
  process.exit(1);
}
if (checkOnly) process.stdout.write("vendor ESM wrappers match sibling factory bodies\n");
