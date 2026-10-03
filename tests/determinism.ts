import {
  run,
  createContext,
  createInitialState,
  hashState,
  sampleAdaptiveNoise,
  entropyOf,
  updateSmoothedState,
  stepSimulation,
  DEFAULT_CONFIG,
  type SimulationContext,
  type SimulationState,
} from "../src/engine.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function vecClose(a: number[], b: number[], eps = 1e-9): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => Math.abs(v - b[i]) < eps);
}

function vecNorm(a: number[]): number {
  return Math.sqrt(a.reduce((sum, value) => sum + value * value, 0));
}

// --- Core determinism ---
const A = run(64, "0x51e1d");
const B = run(64, "0x51e1d");
assert(A.hashes.length === 65, "hash count");
assert(A.hashes.every((h, i) => h === B.hashes[i]), "determinism: same seed => identical hashes");
assert(A.frames.length === 64, "one Diagnostics per tick");
assert(A.frames.every((f, i) => f.step === i && f.tags.includes("tick")), "tick tags");

// Different seed must diverge
const D = run(32, "0xdead");
assert(D.hashes.some((h, i) => h !== A.hashes[i]), "different seeds diverge");

// --- Default periodic trajectory pin (Realization A) ---
assert(A.events.length === 1, "warm-started periodic 0x51e1d produces one projection");

// --- Cold-start continuity ---
const initial = run(0, "0x51e1d");
assert(vecClose(initial.context.smoothedState, initial.currentState.latent), "run warm-starts smoothedState from state0");
const first = run(1, "0x51e1d");
const firstRatio = vecNorm(first.currentState.latent) / vecNorm(initial.currentState.latent);
assert(firstRatio > 0.8, `first tick must preserve state scale, got ratio ${firstRatio}`);
assert(first.frames[0]?.smoothingConfidence === 1, "first reflexive projection begins at state0");
assert(Math.abs((first.frames[0]?.scalars.stateNorm ?? NaN) - vecNorm(first.currentState.latent)) < 1e-12, "stateNorm telemetry matches state1");
assert(Number.isFinite(first.frames[0]?.scalars.smoothedNorm), "smoothedNorm telemetry finite");
assert(Number.isFinite(first.frames[0]?.scalars.stateChange), "stateChange telemetry finite");

// --- 12D enforcement ---
let rejected = false;
try {
  run(4, "0x51e1d", { D: 13 });
} catch (e: any) {
  rejected = /D === 12/.test(String(e.message));
}
assert(rejected, "D=13 must be rejected before execution");

// --- Projection under basin drive ---
const C = run(64, "0x51e1d", { stimulus: "basin" });
assert(C.events.length > 0, "projection reachability: basin drive must fire Basin projection");
assert(
  C.events.every((e) => e.preHash && e.postHash && e.preHash !== e.postHash),
  "projection event integrity",
);
assert(
  C.frames.filter((f) => f.projectionTriggered).length === C.events.length,
  "one BasinProjectionEvent per projection tick",
);

// --- Mechanisms (individual) ---
const noProjection = run(32, "0x51e1d", {
  stimulus: "basin",
  mechanisms: { projection: false, memory: true, summaries: true, noise: true },
});
assert(noProjection.events.length === 0, "projection ablation alone");

const noNoise = run(16, "0x51e1d", {
  stimulus: "quiet",
  noiseAmplitude: 0.2,
  mechanisms: { projection: true, memory: true, summaries: true, noise: false },
});
assert(noNoise.frames.every((f) => f.scalars.noiseActive === 0), "noise ablation telemetry");
assert(noNoise.frames.every((f) => !f.tags.includes("noise")), "noise ablation tags");

const noSum = run(40, "0x51e1d", {
  summaryInterval: 4,
  memoryCapacity: 10,
  mechanisms: { projection: true, memory: true, summaries: false, noise: true },
});
assert(noSum.context.memorySummaries.length === 0, "storeHistorySummary ablation leaves memorySummaries empty");

const noMem = run(40, "0x51e1d", {
  summaryInterval: 4,
  memoryCapacity: 10,
  stimulus: "basin",
  mechanisms: { projection: true, memory: false, summaries: true, noise: true },
});
assert(noMem.context.memorySummaries.length > 0, "storeHistorySummary still runs when memory ablated");

// --- Adaptive noise Gaussian + telemetry + determinism of samples ---
const omegaRun = run(8, "0x51e1d", { stimulus: "quiet", noiseAmplitude: 0.1 });
assert(omegaRun.frames.every((f) => "noiseAmplitude" in f.scalars), "noiseAmplitude in scalars");
assert(omegaRun.frames.some((f) => f.scalars.noiseActive === 1), "noise active under default");

const ctx0 = createContext("pin", "0x51e1d", { stimulus: "quiet", noiseAmplitude: 0.1 });
const psi0 = createInitialState("state", ctx0.seed, 12);
const om0 = sampleAdaptiveNoise(psi0, ctx0);
assert(om0.active && om0.kind === "gaussian", "noise kind gaussian");
assert(om0.noise.length === 12, "noise noise dim");
const om0b = sampleAdaptiveNoise(psi0, ctx0);
assert(vecClose(om0.noise, om0b.noise), "sampleAdaptiveNoise deterministic for same seed/step");

// --- History summary mean-pool + unique memorySummaries IDs ---
const meshRun = run(80, "0x51e1d", { summaryInterval: 4, memoryCapacity: 3, stimulus: "basin" });
const ids = meshRun.context.memorySummaries.map((n) => n.id);
assert(ids.length <= 3, "memoryCapacity respected");
assert(new Set(ids).size === ids.length, "memorySummaries IDs unique after capacity");
assert(meshRun.context.nextSummaryId > 3, "nextSummaryId advanced past capacity");
const node = meshRun.context.memorySummaries[0];
assert(node && node.latent.every((x) => Number.isFinite(x)), "History summary node latent finite");
assert(Number.isFinite(node.coherenceScore), "History summary node coherenceScore finite");

// --- Post-projection entropy ---
for (const f of C.frames.filter((x) => x.projectionTriggered)) {
  assert(Number.isFinite(f.entropy), "post-projection entropy finite");
  assert(f.projectionTriggered, "projectionTriggered true");
}

// --- Hold semantics ---
const holdRun = run(30, "0x51e1d", {
  stimulus: "basin",
  projectionThreshold: 0,
  dwell: 1,
  hold: 6,
  hysteresis: 0,
});
const steps = holdRun.events.map((e) => e.step);
if (steps.length >= 2) {
  const gaps = steps.slice(1).map((s, i) => s - steps[i]);
  assert(gaps.every((g) => g === 7), `hold gaps should be 7 (six post-snap), got ${gaps}`);
}

// --- Hysteresis boundary ---
const hyst = run(20, "0x51e1d", {
  stimulus: "quiet",
  projectionThreshold: 0.99,
  dwell: 2,
  hysteresis: 0.1,
});
assert(hyst.events.length === 0, "high-projectionThreshold quiet does not projection");

// --- Basin projection does not write smoothedState ---
const ownCtx = createContext("own", "0x51e1d", { stimulus: "basin", projectionThreshold: 0, dwell: 1, hold: 0 });
const ownState = createInitialState("state", ownCtx.seed, 12);
const out1 = stepSimulation(ownState, ownCtx);
assert(out1.events.length === 1, "ownership test produced a projection");
assert(
  !vecClose(ownCtx.smoothedState, out1.nextState.latent),
  "smoothedState is not equal to projected latent (Basin projection did not write it)",
);

// --- Config validation: NaN / non-integer rejection ---
const badCases: any[] = [
  { smoothingRate: 1.5 },
  { projectionThreshold: -0.1 },
  { dwell: 0 },
  { dwell: NaN },
  { dwell: 1.5 },
  { hold: -1 },
  { hold: NaN },
  { hysteresis: NaN },
  { summaryInterval: 0 },
  { summaryInterval: NaN },
  { memoryCapacity: 0 },
  { memoryCapacity: NaN },
  { noiseAmplitude: -1 },
  { noiseAmplitude: NaN },
];
for (const bad of badCases) {
  let threw = false;
  try {
    run(2, "0x51e1d", bad);
  } catch {
    threw = true;
  }
  assert(threw, `invalid config should reject: ${JSON.stringify(bad)}`);
}

console.log("ok", {
  ticks: A.frames.length,
  projections: C.events.length,
  meshIds: ids,
  holdSteps: steps.slice(0, 4),
  lastCoherence: A.frames.at(-1)?.coherenceScore,
  lastEntropy: A.frames.at(-1)?.entropy,
  lastHash: A.hashes.at(-1),
  omegaNoise0: om0.noise[0].toFixed(6),
});
