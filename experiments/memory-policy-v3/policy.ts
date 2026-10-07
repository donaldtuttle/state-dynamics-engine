/** Exploratory memory-policy realization, audit revision 3.1. Engine unchanged. */
import {
  updateSmoothedState, retrieveSimilarMemory, sampleAdaptiveNoise, sampleInput,
  computeStateUpdate, combineStateAndUpdate, computeCoherenceScore,
  shouldProjectToBasin, projectTowardBasin, storeHistorySummary, entropyOf,
  type SimulationState, type SimulationContext, type RecallPacket,
  type DiagnosticFrame, type BasinProjectionEvent, type InputSample, type StateUpdate,
} from "../../src/engine.ts";

export const ENGINE_BLOB = "7e9deb3bb47f4f615b255b701bf4a4ada41a94df";
export const POLICIES = ["A_argmax", "B_random", "C_recent", "D_mean", "E_off"] as const;
export type Policy = typeof POLICIES[number];
export const STIMULI = ["quiet", "align", "disrupt", "pulse", "periodic", "basin"] as const;
export const norm = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0));
export const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
export const distance = (a: number[], b: number[]) => norm(sub(a, b));

/** Match the engine's zero-norm guard, clamp, arithmetic order, and tie rule. */
export function similarity(a: number[], b: number[]): number {
  const na = norm(a), nb = norm(b);
  if (na < 1e-9 || nb < 1e-9) return 0;
  const dot = a.reduce((s, v, i) => s + v * b[i], 0);
  return Math.max(0, Math.min(1, (dot / (na * nb) + 1) / 2));
}
export function injection(r: RecallPacket): number[] {
  return r.latent.map(v => v * (0.25 * r.similarity));
}
/** Independent, stateless policy draw. No engine RNG is advanced. */
export function policyRandom(seed: number, step: number): number {
  let a = (seed ^ Math.imul(step + 1, 0x85ebca6b) ^ 0x3c6ef372) >>> 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function eligible(state: SimulationState, context: SimulationContext) {
  return context.memorySummaries.map(node => ({
    latent: node.latent, similarity: similarity(state.latent, node.latent), nodeId: node.id, step: node.step,
  })).filter(packet => packet.similarity >= 0.15);
}
export function selectRecall(policy: Policy, state: SimulationState, context: SimulationContext): RecallPacket | undefined {
  if (!POLICIES.includes(policy)) throw new Error(`Unknown policy: ${policy}`);
  if (policy === "A_argmax") return retrieveSimilarMemory(state, context);
  if (policy === "E_off" || !context.config.mechanisms.memory) return undefined;
  const candidates = eligible(state, context);
  if (!candidates.length) return undefined;
  const packet = (p: typeof candidates[number]): RecallPacket => ({latent: p.latent, similarity: p.similarity, nodeId: p.nodeId});
  if (policy === "B_random") return packet(candidates[Math.floor(policyRandom(context.seed, state.t) * candidates.length)]);
  if (policy === "C_recent") return packet(candidates.reduce((a, b) => b.step > a.step ? b : a));
  // Mean of eligible latent vectors, then recompute gain. This is NOT a mean
  // of injections or a pure ranking ablation. Do not apply a second admission gate.
  const latent = candidates[0].latent.map((_, i) => candidates.reduce((s, p) => s + p.latent[i], 0) / candidates.length);
  return {latent, similarity: similarity(state.latent, latent), nodeId: -1};
}
export function coherenceParts(state: SimulationState, input: InputSample, update: StateUpdate, prior: number) {
  const alignment = 0.325 * similarity(state.latent, input.data);
  const calm = 0.1625 / (1 + input.energy);
  const focus = 0.0975 / (1 + update.magnitude);
  const history = 0.415 * prior;
  const score = computeCoherenceScore(state, input, update, prior);
  return {alignment, calm, focus, prior: history, score,
    expansionResidual: score - (alignment + calm + focus + history)};
}
/** Full feedback context, without repeatedly copying the growing diagnostic log. */
export function feedback(context: SimulationContext) {
  const {trace, ...rest} = context;
  return {...rest, traceLength: trace.length, latestFrame: trace.at(-1)};
}

// Snapshot of the pinned step body. Only recall dispatch is changed; observables
// are added without changing production arithmetic, counters, frames or events.
export function stepWithPolicy(policy: Policy, currentState: SimulationState, context: SimulationContext) {
  context.step = currentState.t;
  if (context.holdLeft > 0) context.holdLeft -= 1;

  const smoothed = updateSmoothedState(currentState, context);
  const rec = selectRecall(policy, currentState, context);
  const noise = sampleAdaptiveNoise(currentState, context); // single evaluation per tick
  const input = sampleInput(currentState, context, rec, noise);
  const update = computeStateUpdate(currentState, input, context);
  const fused = combineStateAndUpdate(smoothed, update, currentState, context);
  let next = fused.currentState;
  next.inputStrength = input.energy;
  next.coherence = computeCoherenceScore(next, input, update, context.priorCoherence);

  const preProjection = { ...next, latent: next.latent.slice() };
  const parts = coherenceParts(preProjection, input, update, context.priorCoherence);
  const held = context.holdLeft > 0;
  const dwellBefore = context.dwellCount;
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
  return { nextState: next, frame, events, observation: { rec, noise, input, update, preProjection, parts, held, dwellBefore } };
}
