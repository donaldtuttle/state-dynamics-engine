/**
 * Exploratory checks on validation seeds 1030-1039 only.
 * Does not load test seeds and does not change the closed verdict.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createContext,
  createInitialState,
  initializeSmoothedState,
  run,
  sampleAdaptiveNoise,
  sampleInput,
  stepSimulation,
} from "../src/engine.ts";

const OFF = { projection: false, memory: false, summaries: false, noise: false };
const MODES = ["quiet", "align", "periodic", "basin"];
const TRAIN = range(1000, 1029);
const VAL = range(1030, 1039);
for (const seed of [...TRAIN, ...VAL]) {
  if (seed >= 1040) throw new Error("test seed requested");
}

function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}
function norm(v) {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}
function bound(a) {
  let v = a.map((x) => Math.max(-2, Math.min(2, x)));
  const n = norm(v);
  if (n > 2) v = v.map((x) => x * (2 / n));
  return v;
}
function integrate(inputs, a, h) {
  let x = Array(12).fill(0);
  for (let t = 0; t < h; t++) x = bound(x.map((v, i) => (1 - a) * v + a * inputs[t][i]));
  return x;
}
function capture(seed, mode) {
  const config = { stimulus: mode, mechanisms: OFF };
  const context = createContext("exploratory", seed, config);
  const initial = createInitialState("state", context.seed, 12);
  let state = { ...initial, latent: initial.latent.slice() };
  initializeSmoothedState(state, context);
  const inputs = [];
  const latents = { 0: initial.latent.slice() };
  for (let t = 0; t < 64; t++) {
    context.step = state.t;
    const noise = sampleAdaptiveNoise(state, context);
    const input = sampleInput(state, context, undefined, noise);
    inputs.push(input.data.slice());
    state = stepSimulation(state, context).nextState;
    if (t + 1 === 16 || t + 1 === 32 || t + 1 === 64) latents[t + 1] = state.latent.slice();
  }
  const normal = run(64, seed, config);
  for (let i = 0; i < 12; i++) {
    if (normal.currentState.latent[i] !== latents[64][i]) throw new Error("latent diverge");
  }
  return { inputs, latents };
}

const records = new Map();
for (const seed of [...TRAIN, ...VAL]) {
  for (const mode of MODES) records.set(`${seed}:${mode}`, capture(seed, mode));
}

function block(seeds, h, pick) {
  const x = [];
  const y = [];
  const seedList = [];
  for (const seed of seeds) {
    MODES.forEach((mode, k) => {
      x.push(pick(records.get(`${seed}:${mode}`), h));
      y.push(k);
      seedList.push(seed);
    });
  }
  return { x, y, seeds: seedList };
}

const payload = { horizons: [] };
for (const h of [64, 32, 16]) {
  const engine = (split, seeds) => ({ ...block(seeds, h, (rec) => rec.latents[h]), split, a: "engine" });
  const integA = h === 64 ? "0.32" : "1.0";
  const integrator = (split, seeds) => ({ ...block(seeds, h, (rec, hh) => integrate(rec.inputs, Number(integA), hh)), split, a: integA });
  payload.horizons.push({
    H: h,
    integratorA: integA,
    engineTrain: engine("train", TRAIN),
    engineVal: engine("validation", VAL),
    integTrain: integrator("train", TRAIN),
    integVal: integrator("validation", VAL),
    initialVal: block(VAL, h, (rec) => rec.latents[0]),
  });
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const res = spawnSync("python3", ["scripts/baseline-exploratory.py"], {
  cwd: root,
  input: JSON.stringify(payload),
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
if (res.status !== 0) {
  process.stderr.write(res.stderr || "");
  process.stderr.write(res.stdout || "");
  process.exit(res.status ?? 1);
}
process.stdout.write(res.stdout);
