"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "app.js"), "utf8");
const engine = fs.readFileSync(path.join(root, "src", "engine.js"), "utf8");

test("every app DOM reference resolves to a static element", () => {
  const ids = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]));
  const references = new Set(Array.from(app.matchAll(/byId\("([^"]+)"\)/g), (match) => match[1]));
  const missing = [...references].filter((id) => !ids.has(id));
  assert.deepEqual(missing, []);
});

test("source mode has no external runtime dependency", () => {
  const runtimeTags = Array.from(html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)="([^"]+)"/g), (match) => match[1]);
  assert.ok(runtimeTags.length >= 6);
  assert.ok(runtimeTags.every((url) => !/^https?:/i.test(url)));
  assert.doesNotMatch(app, /Math\.random\s*\(/);
  assert.doesNotMatch(engine, /Math\.random\s*\(/);
});

test("typed fusion bridge is explicit in executable source", () => {
  for (const name of ["representSmoothedState", "representUpdate", "mergeR", "decode", "extractCombinedState", "combineStateAndUpdate"]) assert.match(engine, new RegExp(`function ${name}\\b`));
  assert.match(engine, /external typed fusion/);
});

test("Diagnostics assessment precedes predicate and same-frame finalization in step", () => {
  const stepStart = engine.indexOf("function step(state, observation = {})");
  const stepEnd = engine.indexOf("function inscribeMemory", stepStart);
  const stepSource = engine.slice(stepStart, stepEnd);
  const assessmentAt = stepSource.indexOf("const frame = makeDiagnosticFrame(");
  const predicateAt = stepSource.indexOf("const predicate = shouldProjectToBasin(state, frame, forced)");
  const finalizeAt = stepSource.indexOf("finalizeDiagnosticFrame(frame, predicate)");
  const commitAt = stepSource.indexOf("appendBounded(state.frames, frame");

  assert.ok(stepStart >= 0 && stepEnd > stepStart);
  assert.ok(assessmentAt >= 0);
  assert.ok(predicateAt > assessmentAt);
  assert.ok(finalizeAt > predicateAt);
  assert.ok(commitAt > finalizeAt);
  assert.equal(stepSource.match(/makeDiagnosticFrame\(/g).length, 1);
  assert.equal(stepSource.match(/appendBounded\(state\.frames, frame/g).length, 1);
});

test("all static buttons declare their button type", () => {
  const buttons = Array.from(html.matchAll(/<button\b[^>]*>/g), (match) => match[0]);
  assert.ok(buttons.length >= 12);
  for (const button of buttons) assert.match(button, /\btype="button"/);
});

test("presentation labels explain labels without rewriting runtime weather records", () => {
  assert.match(html, /Step diagnostics/);
  assert.match(html, /Input strength/);
  assert.match(html, /Weather alias: Unformed field/);
  assert.match(html, /Basin projection/);
  assert.match(app, /const WEATHER_PRESENTATION/);
  assert.match(app, /High-drive regime/);
  assert.match(engine, /id: "shear-front", label: "Shear front"/);
  assert.doesNotMatch(engine, /High-drive regime/);
});
