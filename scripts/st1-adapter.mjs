/**
 * SINGLE-TRAJECTORY-1 input adapter.
 *
 * stepDelivered follows stepSimulation and changes only the delivered
 * data vector and its energy. Equations and update order stay put.
 * Seeds 1040-1059 are rejected. This file does not score the test split.
 */
import {
  computeCoherenceScore,
  computeStateUpdate,
  combineStateAndUpdate,
  createContext,
  createInitialState,
  entropyOf,
  initializeSmoothedState,
  projectTowardBasin,
  retrieveSimilarMemory,
  sampleAdaptiveNoise,
  sampleInput,
  shouldProjectToBasin,
  stepSimulation,
  storeHistorySummary,
  updateSmoothedState,
} from "../src/engine.ts";

export const OFF = { projection: false, memory: false, summaries: false, noise: false };
export const HORIZON = 64;
export const RATES = [
  "0.003125", "0.00625", "0.0125", "0.025", "0.05", "0.1",
  "0.2", "0.32", "0.5", "0.75", "1.0",
];
export const SIGNS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
export const DEV_SEEDS = [7, 11, 335389];
export const DEV_STRING_SEED = "0x51e1d";

const PROHIBITED_LO = 1040;
const PROHIBITED_HI = 1059;

export function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

export const SPLITS = {
  train: range(2000, 2031),
  validation: range(2032, 2047),
  test: range(2048, 2111),
};

export function isProhibited(seed) {
  return Number.isInteger(seed) && seed >= PROHIBITED_LO && seed <= PROHIBITED_HI;
}

export function assertNotProhibited(seed) {
  if (isProhibited(seed)) throw new Error(`prohibited seed ${seed}`);
}

function zeros(n) { return Array(n).fill(0); }
function sub(a, b) { return a.map((v, i) => v - b[i]); }
function scale(a, s) { return a.map((v) => v * s); }
export function norm(a) { return Math.sqrt(a.reduce((s, v) => s + v * v, 0)); }

export function bound(a) {
  let clamped = false;
  let v = a.map((x) => {
    const y = Math.max(-2, Math.min(2, x));
    if (y !== x) clamped = true;
    return y;
  });
  const n = norm(v);
  if (n > 2) { v = scale(v, 2 / n); clamped = true; }
  return v;
}

export function encodeVec(v) {
  const buf = Buffer.alloc(v.length * 8);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 0; i < v.length; i++) view.setFloat64(i * 8, v[i], true);
  return buf.toString("hex");
}

export function sameVec(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Copy of stepSimulation. If delivered is omitted, the sampled stimulus
 * is left unchanged. If delivered is a 12-vector, only data and energy change.
 */
export function stepDelivered(currentState, context, delivered) {
  context.step = currentState.t;
  if (context.holdLeft > 0) context.holdLeft -= 1;

  const smoothed = updateSmoothedState(currentState, context);
  const rec = retrieveSimilarMemory(currentState, context);
  const noise = sampleAdaptiveNoise(currentState, context);
  const input = sampleInput(currentState, context, rec, noise);
  if (delivered) {
    if (delivered.length !== 12 || delivered.some((v) => !Number.isFinite(v))) {
      throw new Error("delivered input must be 12 finite numbers");
    }
    input.data = delivered.slice();
    input.energy = norm(delivered);
  }
  const update = computeStateUpdate(currentState, input, context);
  const fused = combineStateAndUpdate(smoothed, update, currentState, context);
  let next = fused.currentState;
  next.inputStrength = input.energy;
  next.coherence = computeCoherenceScore(next, input, update, context.priorCoherence);

  const drift = norm(sub(update.vec, context.priorUpdate));
  const events = [];
  let projected = false;
  if (shouldProjectToBasin(next.coherence, context)) {
    const projectedState = projectTowardBasin(next, context);
    next = projectedState.currentState;
    events.push(projectedState.event);
    projected = true;
  }

  const tags = ["tick", `phase:${context.phase}`];
  if (projected) tags.push("projection");
  if (noise.active) tags.push("noise");
  if (noise.raisedBecauseStuck) tags.push("noise_raised");

  const frame = {
    runId: context.runId,
    step: context.step,
    phase: context.phase,
    coherenceScore: next.coherence,
    inputStrength: input.energy,
    updateMagnitude: update.magnitude,
    smoothingConfidence: smoothed.confidence,
    entropy: entropyOf(next.latent),
    drift,
    stable: next.coherence > 0.7 && drift < 0.12,
    projectionTriggered: projected,
    tags,
    scalars: {
      mix: fused.mix,
      gate: fused.gate,
      updateDrift: drift,
      stateNorm: norm(next.latent),
      smoothedNorm: norm(smoothed.latent),
      stateChange: norm(sub(next.latent, currentState.latent)),
      noiseAmplitude: noise.amp,
      noiseActive: noise.active ? 1 : 0,
      noiseRaised: noise.raisedBecauseStuck ? 1 : 0,
    },
  };

  context.trace.push(frame);
  context.stateHistory.push({ latent: next.latent.slice(), coherenceScore: next.coherence, step: context.step });
  if (context.stateHistory.length > Math.max(context.config.summaryInterval * 2, 64)) context.stateHistory.shift();
  storeHistorySummary(context);
  context.priorCoherence = next.coherence;
  context.priorUpdate = update.vec.slice();
  context.phase = (context.phase + 1) % 8;
  return { nextState: next, frame, events };
}

export function schedule(b1, b2) {
  if (!(b1 === 1 || b1 === -1) || !(b2 === 1 || b2 === -1)) throw new Error("bits must be -1 or +1");
  const inputs = [];
  for (let t = 0; t < HORIZON; t++) {
    const u = zeros(12);
    if (t <= 7) u[0] = 0.5 * b1;
    else if (t >= 24 && t <= 31) u[1] = 0.5 * b2;
    inputs.push(u);
  }
  return inputs;
}

export function integrate(initial, inputs, a) {
  let x = initial.slice();
  for (let t = 0; t < inputs.length; t++) {
    const u = inputs[t];
    x = bound(x.map((v, i) => (1 - a) * v + a * u[i]));
  }
  return x;
}

export function simulateEpisode(seed, b1, b2) {
  assertNotProhibited(seed);
  if (!Number.isInteger(seed)) throw new Error(`experiment seed must be an integer, got ${seed}`);
  const inputs = schedule(b1, b2);
  const config = { stimulus: "quiet", mechanisms: OFF };
  const context = createContext("st1", seed, config);
  if (context.seed !== (seed >>> 0)) throw new Error("seed mixing changed the integer seed");
  let state = createInitialState("state", context.seed, 12);
  const initial = state.latent.slice();
  initializeSmoothedState(state, context);
  for (let t = 0; t < HORIZON; t++) {
    const out = stepDelivered(state, context, inputs[t]);
    if (out.events.length || out.frame.projectionTriggered) throw new Error(`projection at ${seed} ${t}`);
    if (out.frame.tags.includes("noise")) throw new Error(`noise tag at ${seed} ${t}`);
    if (out.frame.inputStrength !== norm(inputs[t])) throw new Error(`energy mismatch at ${seed} ${t}`);
    state = out.nextState;
  }
  if (state.t !== HORIZON) throw new Error("horizon drifted");
  const integrator = {};
  for (const rate of RATES) integrator[rate] = integrate(initial, inputs, Number(rate));
  return {
    seed,
    b1,
    b2,
    y: b1 === b2 ? 1 : 0,
    initial,
    engine: state.latent.slice(),
    integrator,
    finalInput: inputs[63].slice(),
  };
}

export function simulateSplit(name) {
  const seeds = SPLITS[name];
  if (!seeds) throw new Error(`unknown split ${name}`);
  const episodes = [];
  for (const seed of seeds) {
    assertNotProhibited(seed);
    for (const [b1, b2] of SIGNS) episodes.push(simulateEpisode(seed, b1, b2));
  }
  return episodes;
}

function assert(cond, message) {
  if (!cond) throw new Error(`st1 parity: ${message}`);
}

function compareStep(native, other, label) {
  assert(sameVec(native.nextState.latent, other.nextState.latent), `${label} latent`);
  assert(native.nextState.coherence === other.nextState.coherence, `${label} coherence`);
  assert(native.nextState.inputStrength === other.nextState.inputStrength, `${label} energy`);
  assert(native.nextState.t === other.nextState.t, `${label} t`);
  assert(native.frame.updateMagnitude === other.frame.updateMagnitude, `${label} update`);
  assert(native.frame.projectionTriggered === other.frame.projectionTriggered, `${label} projection`);
  assert(native.frame.scalars.mix === other.frame.scalars.mix, `${label} mix`);
  assert(native.frame.scalars.gate === other.frame.scalars.gate, `${label} gate`);
  assert(native.events.length === other.events.length, `${label} events`);
}

export function assertParity() {
  for (const seed of [...DEV_SEEDS, DEV_STRING_SEED]) {
    if (typeof seed === "number") assertNotProhibited(seed);
  }
  const numericDemo = createContext("parity", DEV_STRING_SEED, { mechanisms: OFF }).seed;
  assertNotProhibited(numericDemo);
  assert(!SPLITS.train.includes(numericDemo) && !SPLITS.validation.includes(numericDemo) && !SPLITS.test.includes(numericDemo), "demo seed collides with the experiment");

  for (const seed of [...DEV_SEEDS, DEV_STRING_SEED]) {
    for (const stimulus of ["quiet", "align", "periodic", "basin"]) {
      const config = { stimulus, mechanisms: OFF };
      const nativeCtx = createContext("parity", seed, config);
      const plainCtx = createContext("parity", seed, config);
      const deliveredCtx = createContext("parity", seed, config);
      let native = createInitialState("state", nativeCtx.seed, 12);
      let plain = createInitialState("state", plainCtx.seed, 12);
      let delivered = createInitialState("state", deliveredCtx.seed, 12);
      initializeSmoothedState(native, nativeCtx);
      initializeSmoothedState(plain, plainCtx);
      initializeSmoothedState(delivered, deliveredCtx);
      assert(sameVec(native.latent, plain.latent) && sameVec(native.latent, delivered.latent), "initial state");
      for (let t = 0; t < 16; t++) {
        nativeCtx.step = native.t;
        const captured = sampleInput(native, nativeCtx);
        const nativeOut = stepSimulation(native, nativeCtx);
        const plainOut = stepDelivered(plain, plainCtx);
        const deliveredOut = stepDelivered(delivered, deliveredCtx, captured.data.slice());
        compareStep(nativeOut, plainOut, `${seed} ${stimulus} plain ${t}`);
        compareStep(nativeOut, deliveredOut, `${seed} ${stimulus} delivered ${t}`);
        native = nativeOut.nextState;
        plain = plainOut.nextState;
        delivered = deliveredOut.nextState;
      }
    }
  }

  // Custom delivery must move a development trajectory off the quiet path.
  const quiet = createContext("parity", 7, { stimulus: "quiet", mechanisms: OFF });
  const custom = createContext("parity", 7, { stimulus: "quiet", mechanisms: OFF });
  let qs = createInitialState("state", quiet.seed, 12);
  let cs = createInitialState("state", custom.seed, 12);
  initializeSmoothedState(qs, quiet);
  initializeSmoothedState(cs, custom);
  const pulse = zeros(12);
  pulse[0] = 0.5;
  let moved = false;
  for (let t = 0; t < 8; t++) {
    qs = stepDelivered(qs, quiet).nextState;
    cs = stepDelivered(cs, custom, pulse).nextState;
    if (!sameVec(qs.latent, cs.latent)) moved = true;
  }
  assert(moved, "custom input did not change the trajectory");

  // Schedule, labels, shared starts, fresh contexts.
  const eps = SIGNS.map(([b1, b2]) => simulateEpisode(7, b1, b2));
  assert(sameVec(eps[0].initial, eps[1].initial) && sameVec(eps[0].initial, eps[2].initial) && sameVec(eps[0].initial, eps[3].initial), "shared start");
  const again = simulateEpisode(7, 1, -1);
  assert(sameVec(again.engine, eps[1].engine), "reset");
  assert(sameVec(again.integrator["0.2"], eps[1].integrator["0.2"]), "integrator reset");
  for (const ep of eps) {
    const inputs = schedule(ep.b1, ep.b2);
    assert(ep.y === (ep.b1 === ep.b2 ? 1 : 0), "label");
    for (let t = 0; t < 64; t++) {
      const u = inputs[t];
      if (t <= 7) assert(u[0] === 0.5 * ep.b1 && u.slice(1).every((v) => v === 0), "cue 1");
      else if (t >= 24 && t <= 31) assert(u[1] === 0.5 * ep.b2 && u[0] === 0 && u.slice(2).every((v) => v === 0), "cue 2");
      else assert(u.every((v) => v === 0), "gap");
    }
    assert(ep.finalInput.every((v) => v === 0), "final input");
  }
  assert(eps.filter((ep) => ep.y === 1).length === 2, "block balance");

  // Bound matches the declared clamp-then-norm rule, including a no-op.
  const inside = [0.1, -0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  assert(sameVec(bound(inside), inside), "bound interior");
  const clipped = bound([5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert(clipped[0] === 2 && clipped.slice(1).every((v) => v === 0), "bound clamp");
  const wide = bound(Array(12).fill(1));
  assert(Math.abs(norm(wide) - 2) < 1e-12, "bound norm");

  let threw = false;
  try { simulateEpisode(1040, 1, 1); } catch (err) { threw = String(err.message).includes("prohibited"); }
  assert(threw, "prohibited seed was accepted");

  // a = 1 forgets the start after the first update. A slower rate must not.
  const started = simulateEpisode(11, 1, 1);
  assert(norm(started.initial) > 0, "engine start is zero");
  const zeroStart = integrate(zeros(12), schedule(1, 1), 0.05);
  assert(!sameVec(zeroStart, started.integrator["0.05"]), "integrator ignored the matched start");
  const full = integrate(started.initial, schedule(1, 1), 1);
  assert(sameVec(full, started.integrator["1.0"]), "a=1 integrator diverged");
}
