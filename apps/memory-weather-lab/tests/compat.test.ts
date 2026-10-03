import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import EngineJs from "../src/vendor/engine.js";
import FieldJs from "../src/vendor/field.js";
import ProjectionJs from "../src/vendor/projection.js";
import { routeGlobalKey } from "../src/keyboard.ts";
import { PUBLISHED_DEMO_HASH, sim, useLab } from "../src/store.ts";

const Engine: any = EngineJs;
const Field: any = FieldJs;
const Projection: any = ProjectionJs;
const siblingRequire = createRequire(fileURLToPath(import.meta.url));
const SiblingEngine: any = siblingRequire("../../memory-weather/src/engine.js");

function playDemo(api: any) {
  const state = api.createState({ seed: 12062026 });
  api.inscribeMemory(state, "observer field", 1.15);
  api.inscribeMemory(state, "projection provenance", 0.95);
  api.inscribeMemory(state, "memory front", 0.78);
  for (let tick = 0; tick < 96; tick += 1) {
    if (tick === 22) api.queueRecall(state, "projection provenance");
    if (tick === 51) api.requestProjection(state);
    api.step(state, {
      stimulusMode: tick < 36 ? "periodic" : tick < 70 ? "pulse" : "basin",
      stimulusAmplitude: 0.82,
      selectedBasin: 4,
    });
  }
  return state;
}

test("fixed-seed demonstration matches the published v0.1.1 hash", () => {
  const state = playDemo(Engine);
  assert.equal(state.context.step, 96);
  assert.equal(state.currentHash, "mw-fnv64:b8869fa460013ef2");
  assert.equal(state.events.length, 13);
  assert.equal(state.engineVersion, "0.1.1");
});

test("React lab vendor stays trajectory-equivalent with apps/memory-weather", () => {
  const lab = playDemo(Engine);
  const sibling = playDemo(SiblingEngine);
  assert.equal(lab.currentHash, sibling.currentHash);
  assert.equal(lab.currentHash, "mw-fnv64:b8869fa460013ef2");
  assert.deepEqual(
    lab.events.map((event: { kind: string; step: number }) => [event.kind, event.step]),
    sibling.events.map((event: { kind: string; step: number }) => [event.kind, event.step]),
  );
});

test("Diagnostics assessment is constructed before the projection predicate", () => {
  const state = Engine.createState({ seed: 496 });
  Engine.requestProjection(state);
  const result = Engine.step(state, { stimulusMode: "quiet" });
  assert.equal(state.frames.length, 1);
  assert.equal(result.frame.projection_triggered, true);
  assert.equal(result.frame.state_hash_pre_projection, result.events[0].preHash);
  assert.ok(Engine.extractCombinedState);
});

test("projection provenance catalog covers every scientific feature", () => {
  const state = Engine.createState({ seed: 48 });
  Engine.step(state);
  const projection = Projection.createProjection();
  const catalog = Projection.featureCatalog(projection, state, { size: 45 });
  assert.ok(Object.keys(catalog).length >= 10);
  const field = Field.buildField(state, projection, { size: 21 });
  assert.equal(field.coordinates.length, 21 * 21);
});


test("Load fixed demo restores the pinned configuration after UI mechanisms", () => {
  useLab.getState().setMechanism("noise", false);
  useLab.getState().setMechanism("projection", false);
  useLab.getState().loadDemo();
  const ui = useLab.getState();
  assert.equal(sim.state.currentHash, PUBLISHED_DEMO_HASH);
  assert.equal(sim.state.events.length, 13);
  assert.equal(sim.state.events.filter((event: { kind: string }) => event.kind === "projection").length, 1);
  assert.equal(sim.state.config.mechanisms.noise, true);
  assert.equal(sim.state.config.mechanisms.projection, true);
  assert.equal(ui.mechanisms.noise, true);
  assert.equal(ui.mechanisms.projection, true);
});

test("Global key routing ignores interactive targets and printable keys", () => {
  const neutral = { closest: () => null };
  const interactive = { closest: () => ({}) };
  assert.equal(routeGlobalKey("Space", neutral), "toggle-run");
  assert.equal(routeGlobalKey("Space", interactive), null);
  for (const code of ["Period", "KeyR", "Digit1", "Digit2", "Digit3"]) {
    assert.equal(routeGlobalKey(code, neutral), null);
  }
});

test("UI source preserves focus, keyboard, notation, and contrast contracts", () => {
  const labSource = readFileSync(new URL("../src/lab.tsx", import.meta.url), "utf8");
  const viewportSource = readFileSync(new URL("../src/viewport.tsx", import.meta.url), "utf8");
  const stylesSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(labSource, /aria-label="Viewport forcing coordinates"/);
  assert.match(viewportSource, /tabIndex=\{-1\}/);
  assert.match(viewportSource, /aria-label="Terrain orbit controls"/);
  assert.match(viewportSource, /projection margin/);
  assert.doesNotMatch(viewportSource, /Projection(?!state)/u);

  const dim = stylesSource.match(/--dim:\s*(#[0-9a-f]{6})/i)?.[1];
  assert.equal(dim, "#789091");
  assert.ok(contrastRatio(dim, "#111e2a") >= 4.5);
});

test("clarified UI labels use descriptive names and leave runtime weather IDs untouched", () => {
  const labSource = readFileSync(new URL("../src/lab.tsx", import.meta.url), "utf8");
  const storeSource = readFileSync(new URL("../src/store.ts", import.meta.url), "utf8");
  const siblingEngineSource = readFileSync(
    new URL("../../memory-weather/src/engine.js", import.meta.url),
    "utf8",
  );
  assert.match(labSource, /Step diagnostics/);
  assert.match(labSource, /High-drive regime/);
  assert.match(labSource, /Weather alias:/);
  assert.match(storeSource, /Basin projection/);
  assert.match(storeSource, /Memory replay/);
  assert.match(siblingEngineSource, /id: "shear-front", label: "Shear front"/);
  assert.doesNotMatch(siblingEngineSource, /High-drive regime/);
});

function contrastRatio(foreground: string, background: string) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
