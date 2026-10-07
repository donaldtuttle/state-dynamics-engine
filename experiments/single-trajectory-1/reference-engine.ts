/**
 * State Dynamics Engine: deterministic bounded 12-dimensional state updates.
 * Derived from the pinned source documented in ORIGINS.md.
 * Formulae, seeded random streams, and update order are preserved.
 */

export type Vector = number[];

export type SimulationState = {
  id: string;
  t: number;
  latent: Vector;
  coherence: number;
  inputStrength: number;
  basinId?: number;
};

export type SmoothedState = { latent: Vector; smoothedState: Vector; confidence: number };
export type InputSample = { fieldId: string; data: Vector; timestamp: number; energy: number };
export type StateUpdate = { vec: Vector; magnitude: number; basis: string };
export type CombinedState = { currentState: SimulationState; mix: number; gate: number; clamped: boolean };

export type AdaptiveNoise = {
  amp: number;
  kind: string;
  active: boolean;
  raisedBecauseStuck: boolean;
  noise: Vector;
};

export type DiagnosticFrame = {
  runId: string;
  step: number;
  phase: number;
  coherenceScore: number;
  inputStrength: number;
  updateMagnitude: number;
  smoothingConfidence: number;
  entropy: number;
  drift: number;
  stable: boolean;
  projectionTriggered: boolean;
  tags: string[];
  scalars: Record<string, number>;
};

export type BasinProjectionEvent = {
  step: number;
  reason: string;
  preHash: string;
  postHash: string;
  energyDrop: number;
  basinId: number;
  coherenceScore: number;
};

export type MemorySummary = { id: number; latent: Vector; coherenceScore: number; step: number };
export type RecallPacket = { latent: Vector; similarity: number; nodeId: number };

export type Stimulus = "quiet" | "align" | "disrupt" | "pulse" | "periodic" | "basin";

export type Mechanisms = {
  projection: boolean;
  memory: boolean;
  summaries: boolean;
  noise: boolean;
};

export type EngineConfig = {
  D: number;
  smoothingRate: number;
  updateScale: number;
  projectionThreshold: number;
  dwell: number;
  hold: number;
  hysteresis: number;
  summaryInterval: number;
  memoryCapacity: number;
  noiseAmplitude: number;
  stimulus: Stimulus;
  mechanisms: Mechanisms;
};

export type SimulationContext = {
  runId: string;
  seed: number;
  step: number;
  phase: number;
  config: EngineConfig;
  smoothedState: Vector;
  smoothedStateInitialized: boolean;
  priorCoherence: number;
  priorUpdate: Vector;
  dwellCount: number;
  holdLeft: number;
  memorySummaries: MemorySummary[];
  nextSummaryId: number;
  stateHistory: { latent: Vector; coherenceScore: number; step: number }[];
  trace: DiagnosticFrame[];
};

export const BASINS: { label: string; latent: Vector }[] = [
  { label: "Basin 1", latent: [1.2, 0.4, 0.1, 0, 0.2, 0, 0, 0.1, 0, 0, 0, 0] },
  { label: "Basin 2", latent: [0.3, 1.3, 0.2, 0.4, 0, 0.1, 0, 0, 0.2, 0, 0, 0] },
  { label: "Basin 3", latent: [0.8, 0.8, 1.0, 0.1, 0, 0, 0.2, 0, 0, 0.1, 0, 0] },
  { label: "Basin 4", latent: [-0.9, 0.6, 0.3, 1.1, 0.2, 0, 0, 0.3, 0, 0, 0.1, 0] },
  { label: "Basin 5", latent: [0.2, -0.4, 0.7, 0, 1.0, 0.3, 0.1, 0, 0, 0, 0.2, 0] },
  { label: "Basin 6", latent: [0, 0.2, -0.3, 0.5, 0.1, 1.2, 0.4, 0.1, 0, 0, 0, 0.2] },
];

export const DEFAULT_CONFIG: EngineConfig = {
  D: 12,
  smoothingRate: 0.1,
  updateScale: 0.32,
  projectionThreshold: 0.78,
  dwell: 2,
  hold: 6,
  hysteresis: 0.08,
  summaryInterval: 12,
  memoryCapacity: 48,
  noiseAmplitude: 0.055,
  stimulus: "periodic",
  mechanisms: { projection: true, memory: true, summaries: true, noise: true },
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
function zeros(n: number): Vector { return Array(n).fill(0); }
function add(a: Vector, b: Vector): Vector { return a.map((v, i) => v + b[i]); }
function sub(a: Vector, b: Vector): Vector { return a.map((v, i) => v - b[i]); }
function scale(a: Vector, s: number): Vector { return a.map((v) => v * s); }
function norm(a: Vector): number { return Math.sqrt(a.reduce((s, v) => s + v * v, 0)); }

function boundVec(a: Vector): { v: Vector; clamped: boolean } {
  let clamped = false;
  let v = a.map((x) => {
    const y = clamp(x, -2, 2);
    if (y !== x) clamped = true;
    return y;
  });
  const n = norm(v);
  if (n > 2) { v = scale(v, 2 / n); clamped = true; }
  return { v, clamped };
}

export function hashState(currentState: SimulationState): string {
  const parts = currentState.latent.map((x) => x.toFixed(6)).join(",");
  const basin = currentState.basinId ?? -1;
  const raw = `${currentState.id}|${currentState.t}|${parts}|${currentState.coherence.toFixed(6)}|${currentState.inputStrength.toFixed(6)}|${basin}`;
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function seedToInt(seed: string | number): number {
  if (typeof seed === "number") return seed >>> 0;
  let h = 0;
  const s = seed.replace(/^0x/i, "");
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h || 1;
}

function isInt(n: number): boolean { return Number.isInteger(n); }

function validateConfig(cfg: EngineConfig): void {
  if (cfg.D !== 12) throw new Error(`12D implementation requires D === 12 (got D=${cfg.D}). Basins are fixed at twelve dimensions.`);
  if (!Number.isFinite(cfg.smoothingRate) || cfg.smoothingRate < 0 || cfg.smoothingRate > 1) throw new Error(`smoothingRate must be finite in [0,1], got ${cfg.smoothingRate}`);
  if (!Number.isFinite(cfg.projectionThreshold) || cfg.projectionThreshold < 0 || cfg.projectionThreshold > 1) throw new Error(`projectionThreshold must be finite in [0,1], got ${cfg.projectionThreshold}`);
  if (!Number.isFinite(cfg.dwell) || !isInt(cfg.dwell) || cfg.dwell < 1) throw new Error(`dwell must be integer >= 1, got ${cfg.dwell}`);
  if (!Number.isFinite(cfg.hold) || !isInt(cfg.hold) || cfg.hold < 0) throw new Error(`hold must be integer >= 0, got ${cfg.hold}`);
  if (!Number.isFinite(cfg.hysteresis) || cfg.hysteresis < 0) throw new Error(`hysteresis must be finite >= 0, got ${cfg.hysteresis}`);
  if (!Number.isFinite(cfg.summaryInterval) || !isInt(cfg.summaryInterval) || cfg.summaryInterval < 1) throw new Error(`summaryInterval must be integer >= 1, got ${cfg.summaryInterval}`);
  if (!Number.isFinite(cfg.memoryCapacity) || !isInt(cfg.memoryCapacity) || cfg.memoryCapacity < 1) throw new Error(`memoryCapacity must be integer >= 1, got ${cfg.memoryCapacity}`);
  if (!Number.isFinite(cfg.noiseAmplitude) || cfg.noiseAmplitude < 0) throw new Error(`noiseAmplitude must be non-negative finite, got ${cfg.noiseAmplitude}`);
  if (!Number.isFinite(cfg.updateScale)) throw new Error(`updateScale must be finite`);
}

export function createContext(runId: string, seed: string | number, config: Partial<EngineConfig> = {}): SimulationContext {
  const cfg: EngineConfig = { ...DEFAULT_CONFIG, ...config, mechanisms: { ...DEFAULT_CONFIG.mechanisms, ...(config.mechanisms ?? {}) } };
  validateConfig(cfg);
  return {
    runId, seed: seedToInt(seed), step: 0, phase: 0, config: cfg,
    smoothedState: zeros(cfg.D), smoothedStateInitialized: false, priorCoherence: 0.42, priorUpdate: zeros(cfg.D),
    dwellCount: 0, holdLeft: 0, memorySummaries: [], nextSummaryId: 0, stateHistory: [], trace: [],
  };
}

export function createInitialState(id: string, seed: number, D = 12): SimulationState {
  if (D !== 12) throw new Error(`12D implementation requires D === 12 (got D=${D})`);
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const latent = Array.from({ length: D }, () => (rng() * 2 - 1) * 0.6);
  return { id, t: 0, latent: boundVec(latent).v, coherence: 0.42, inputStrength: 0 };
}

/**
 * Realization-local initial condition for the lagged reflexive cache.
 * This does not invoke Smoothed state or consume a tick; it prevents an absent prior
 * observation from being represented as a twelve-dimensional zero state.
 */
export function initializeSmoothedState(currentState: SimulationState, context: SimulationContext): void {
  if (currentState.latent.length !== context.config.D || currentState.latent.some((value) => !Number.isFinite(value))) {
    throw new Error(`self-model warm start requires ${context.config.D} finite latent components`);
  }
  context.smoothedState = currentState.latent.slice();
  context.smoothedStateInitialized = true;
}

export function updateSmoothedState(currentState: SimulationState, context: SimulationContext): SmoothedState {
  if (!context.smoothedStateInitialized) initializeSmoothedState(currentState, context);
  const b = context.config.smoothingRate;
  context.smoothedState = add(scale(context.smoothedState, 1 - b), scale(currentState.latent, b));
  const conf = Math.exp(-norm(sub(currentState.latent, context.smoothedState)));
  return { latent: context.smoothedState.slice(), smoothedState: context.smoothedState.slice(), confidence: conf };
}

function stimulusVec(stim: Stimulus, t: number, D: number, rng: () => number): Vector {
  const v = zeros(D);
  const w = (t % 64) / 64;
  if (stim === "quiet") return v;
  if (stim === "align") { for (let i = 0; i < D; i++) v[i] = 0.15 * Math.cos((t + i) * 0.11); }
  else if (stim === "disrupt") { for (let i = 0; i < D; i++) v[i] = (rng() * 2 - 1) * 0.55; }
  else if (stim === "pulse") { const p = t % 16 < 2 ? 0.7 : 0.05; for (let i = 0; i < D; i++) v[i] = p * Math.sin(i + t * 0.2); }
  else if (stim === "periodic") { for (let i = 0; i < D; i++) v[i] = 0.22 * Math.sin(t * 0.17 + i * 0.5); }
  else if (stim === "basin") { const b = BASINS[t % BASINS.length].latent; for (let i = 0; i < D; i++) v[i] = 0.35 * (b[i] ?? 0); }
  return scale(v, 0.4 + 0.6 * w);
}

export function sampleAdaptiveNoise(currentState: SimulationState, context: SimulationContext): AdaptiveNoise {
  const rng = mulberry32((context.seed ^ (context.step * 2654435761) ^ 0xa5a5a5a5) >>> 0);
  const stuck = currentState.coherence > 0.85 && norm(context.priorUpdate) < 0.05;
  const raisedBecauseStuck = stuck;
  const amp = context.config.noiseAmplitude * (stuck ? 2.2 : 1);
  const active = context.config.mechanisms.noise && amp > 0;
  if (!active) return { amp: 0, kind: "inactive", active: false, raisedBecauseStuck, noise: zeros(context.config.D) };
  const noise = Array.from({ length: context.config.D }, () => gaussian(rng) * amp);
  return { amp, kind: "gaussian", active: true, raisedBecauseStuck, noise };
}

export function sampleInput(currentState: SimulationState, context: SimulationContext, recall?: RecallPacket, noise?: AdaptiveNoise): InputSample {
  const rng = mulberry32((context.seed ^ (context.step * 2654435761)) >>> 0);
  let data = stimulusVec(context.config.stimulus, context.step, context.config.D, rng);
  const om = noise ?? sampleAdaptiveNoise(currentState, context);
  if (om.active) data = add(data, om.noise);
  if (recall && context.config.mechanisms.memory) data = add(data, scale(recall.latent, 0.25 * recall.similarity));
  return { fieldId: context.config.stimulus, data, timestamp: context.step, energy: norm(data) };
}

export function computeStateUpdate(currentState: SimulationState, input: InputSample, context: SimulationContext): StateUpdate {
  const dPhi = sub(input.data, currentState.latent);
  const g = 0.2 + 0.8 * currentState.coherence;
  let vec = scale(dPhi, context.config.updateScale * g);
  const mag = norm(vec);
  if (mag > 1.4) vec = scale(vec, 1.4 / mag);
  return { vec, magnitude: norm(vec), basis: "dPhi_proxy" };
}

export function combineStateAndUpdate(smoothed: SmoothedState, update: StateUpdate, currentState: SimulationState, context: SimulationContext): CombinedState {
  const coherenceScore = currentState.coherence;
  const mix = clamp(0.35 + 0.5 * coherenceScore, 0.2, 0.9);
  const gate = clamp(0.15 + 0.7 * (1 - 0.45 * coherenceScore), 0.1, 1);
  const raw = add(smoothed.latent, scale(update.vec, gate * (1 - mix)));
  const { v, clamped } = boundVec(raw);
  return { currentState: { ...currentState, t: currentState.t + 1, latent: v }, mix, gate, clamped };
}

function alignment(a: Vector, b: Vector): number {
  const na = norm(a), nb = norm(b);
  if (na < 1e-9 || nb < 1e-9) return 0;
  const dot = a.reduce((s, v, i) => s + v * b[i], 0);
  return clamp((dot / (na * nb) + 1) / 2, 0, 1);
}

export function computeCoherenceScore(currentState: SimulationState, input: InputSample, update: StateUpdate, prior: number): number {
  const align = alignment(currentState.latent, input.data);
  const calm = 1 / (1 + input.energy);
  const focus = 1 / (1 + update.magnitude);
  const raw = 0.5 * align + 0.25 * calm + 0.15 * focus + 0.1 * prior;
  return clamp(0.65 * raw + 0.35 * prior, 0, 1);
}

export function entropyOf(latent: Vector): number {
  const bins = Array(8).fill(1e-9);
  for (const x of latent) {
    const i = clamp(Math.floor(((x + 2) / 4) * 8), 0, 7);
    bins[i] += Math.abs(x) + 0.05;
  }
  const z = bins.reduce((s, v) => s + v, 0);
  let h = 0;
  for (const b of bins) { const p = b / z; h -= p * Math.log2(p); }
  return h / 3;
}

export function shouldProjectToBasin(coherenceScore: number, context: SimulationContext): boolean {
  if (!context.config.mechanisms.projection) return false;
  if (context.holdLeft > 0) return false;
  const floor = context.config.projectionThreshold - context.config.hysteresis;
  if (coherenceScore >= context.config.projectionThreshold) context.dwellCount += 1;
  else if (coherenceScore < floor) context.dwellCount = 0;
  return context.dwellCount >= context.config.dwell;
}

function nearestBasin(latent: Vector): number {
  let best = 0, bestD = Infinity;
  BASINS.forEach((b, i) => {
    const d = norm(sub(latent, b.latent));
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

export function projectTowardBasin(currentState: SimulationState, context: SimulationContext): { currentState: SimulationState; event: BasinProjectionEvent } {
  const pre = hashState(currentState);
  const id = nearestBasin(currentState.latent);
  const target = BASINS[id].latent;
  const mixed = add(scale(currentState.latent, 0.18), scale(target, 0.82));
  const next: SimulationState = { ...currentState, latent: boundVec(mixed).v, basinId: id, coherence: Math.max(currentState.coherence, 0.82) };
  context.holdLeft = context.config.hold + 1;
  context.dwellCount = 0;
  return {
    currentState: next,
    event: {
      step: context.step, reason: `basin:${BASINS[id].label}`,
      preHash: pre, postHash: hashState(next),
      energyDrop: Math.max(0, norm(currentState.latent) - norm(next.latent)),
      basinId: id, coherenceScore: next.coherence,
    },
  };
}

export function storeHistorySummary(context: SimulationContext): MemorySummary | undefined {
  if (!context.config.mechanisms.summaries) return;
  if (context.step === 0 || context.step % context.config.summaryInterval !== 0) return;
  const window = context.stateHistory.slice(-context.config.summaryInterval);
  if (!window.length) return;
  const D = context.config.D;
  const pooled = zeros(D);
  let rhoSum = 0;
  for (const s of window) {
    for (let i = 0; i < D; i++) pooled[i] += s.latent[i];
    rhoSum += s.coherenceScore;
  }
  const n = window.length;
  for (let i = 0; i < D; i++) pooled[i] /= n;
  const node: MemorySummary = { id: context.nextSummaryId++, latent: pooled, coherenceScore: rhoSum / n, step: context.step };
  context.memorySummaries.push(node);
  if (context.memorySummaries.length > context.config.memoryCapacity) context.memorySummaries.shift();
  return node;
}

export function retrieveSimilarMemory(currentState: SimulationState, context: SimulationContext): RecallPacket | undefined {
  if (!context.config.mechanisms.memory || !context.memorySummaries.length) return;
  let best: RecallPacket | undefined;
  for (const n of context.memorySummaries) {
    const sim = alignment(currentState.latent, n.latent);
    if (sim >= 0.15 && (!best || sim > best.similarity)) best = { latent: n.latent, similarity: sim, nodeId: n.id };
  }
  return best;
}

export function stepSimulation(currentState: SimulationState, context: SimulationContext): { nextState: SimulationState; frame: DiagnosticFrame; events: BasinProjectionEvent[] } {
  context.step = currentState.t;
  if (context.holdLeft > 0) context.holdLeft -= 1;

  const smoothed = updateSmoothedState(currentState, context);
  const rec = retrieveSimilarMemory(currentState, context);
  const noise = sampleAdaptiveNoise(currentState, context); // single evaluation per tick
  const input = sampleInput(currentState, context, rec, noise);
  const update = computeStateUpdate(currentState, input, context);
  const fused = combineStateAndUpdate(smoothed, update, currentState, context);
  let next = fused.currentState;
  next.inputStrength = input.energy;
  next.coherence = computeCoherenceScore(next, input, update, context.priorCoherence);

  const drift = norm(sub(update.vec, context.priorUpdate));
  const events: BasinProjectionEvent[] = [];
  let projected = false;

  if (shouldProjectToBasin(next.coherence, context)) {
    const c = projectTowardBasin(next, context);
    next = c.currentState;
    events.push(c.event);
    projected = true;
  }

  const ent = entropyOf(next.latent);
  const tags = ["tick", `phase:${context.phase}`];
  if (projected) tags.push("projection");
  if (noise.active) tags.push("noise");
  if (noise.raisedBecauseStuck) tags.push("noise_raised");

  const frame: DiagnosticFrame = {
    runId: context.runId, step: context.step, phase: context.phase,
    coherenceScore: next.coherence, inputStrength: input.energy, updateMagnitude: update.magnitude,
    smoothingConfidence: smoothed.confidence, entropy: ent, drift,
    stable: next.coherence > 0.7 && drift < 0.12,
    projectionTriggered: projected, tags,
    scalars: {
      mix: fused.mix, gate: fused.gate, updateDrift: drift,
      stateNorm: norm(next.latent), smoothedNorm: norm(smoothed.latent), stateChange: norm(sub(next.latent, currentState.latent)),
      noiseAmplitude: noise.amp, noiseActive: noise.active ? 1 : 0, noiseRaised: noise.raisedBecauseStuck ? 1 : 0,
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

export function run(n: number, seed: string | number, config: Partial<EngineConfig> = {}) {
  const context = createContext("run", seed, config);
  let currentState = createInitialState("state", context.seed, context.config.D);
  initializeSmoothedState(currentState, context);
  const frames: DiagnosticFrame[] = [];
  const events: BasinProjectionEvent[] = [];
  const hashes: string[] = [hashState(currentState)];
  for (let i = 0; i < n; i++) {
    const out = stepSimulation(currentState, context);
    currentState = out.nextState;
    frames.push(out.frame);
    events.push(...out.events);
    hashes.push(hashState(currentState));
  }
  return { currentState, context, frames, events, hashes };
}

export { hashState as hashStateFull };
