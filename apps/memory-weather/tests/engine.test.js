"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../src/engine.js");
const M = require("../src/math.js");

function runScenario(seed, ticks = 180) {
  const state = Engine.createState({ seed, summaryInterval: 8 });
  const digests = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    if (tick === 7) Engine.inscribeMemory(state, "observer field", 1.15);
    if (tick === 19) Engine.inscribeMemory(state, "memory front", 0.8);
    if (tick === 28) Engine.queueRecall(state, "observer field");
    if (tick === 51) Engine.requestProjection(state);
    Engine.step(state, { stimulusMode: tick < 60 ? "periodic" : "pulse", stimulusAmplitude: 0.82 });
    digests.push(Engine.stateDigest(state));
  }
  return { state, digests };
}

test("same seed, config, and input sequence is deterministic", () => {
  const a = runScenario(4276993775, 256);
  const b = runScenario(4276993775, 256);
  assert.deepEqual(a.digests, b.digests);
  assert.deepEqual(a.state.events, b.state.events);
  assert.deepEqual(a.state.frames, b.state.frames);
  assert.equal(a.state.currentHash, b.state.currentHash);
});

test("different seeds diverge", () => {
  const a = runScenario(101, 32);
  const b = runScenario(102, 32);
  assert.notEqual(a.state.currentHash, b.state.currentHash);
});

test("one Diagnostics frame is committed per tick with required fields and tags", () => {
  const state = Engine.createState({ seed: 44 });
  const returnedFrames = [];
  for (let i = 0; i < 80; i += 1) returnedFrames.push(Engine.step(state).frame);
  assert.equal(state.frames.length, 80);
  for (let i = 0; i < state.frames.length; i += 1) {
    const frame = state.frames[i];
    for (const key of ["run_id", "step", "phase", "coherenceScore", "update_magnitude", "smoothing_confidence", "entropy", "drift", "stable", "projection_would_trigger", "projection_eligible", "projection_triggered", "projection_reason", "tags"]) {
      assert.ok(Object.hasOwn(frame, key), `missing ${key}`);
    }
    assert.strictEqual(frame, returnedFrames[i]);
    assert.equal(frame.step, i);
    assert.ok(frame.tags.includes("tick"));
    assert.ok(frame.tags.includes(`phase:${frame.phase}`));
    assert.equal(frame.tags.filter((tag) => tag === "projection").length, frame.projection_triggered ? 1 : 0);
  }
});

test("every Basin projection invocation emits a matching pre/post integrity event", () => {
  const state = Engine.createState({ seed: 9 });
  Engine.requestProjection(state);
  const result = Engine.step(state);
  const events = result.events.filter((event) => event.kind === "projection");
  assert.equal(events.length, 1);
  assert.equal(result.frame.projection_triggered, true);
  assert.equal(events[0].preHash, result.frame.state_hash_pre_projection);
  assert.equal(events[0].postHash, Engine.stateHash(state.currentState));
  assert.notEqual(events[0].preHash, events[0].postHash);
  assert.ok(result.frame.tags.includes("projection"));
});

test("checkpoint hydration reproduces uninterrupted continuation", () => {
  const original = Engine.createState({ seed: 2303, summaryInterval: 5 });
  for (let i = 0; i < 64; i += 1) {
    if (i === 12) Engine.inscribeMemory(original, "restart continuity", 1);
    if (i === 24) Engine.queueRecall(original, "restart continuity");
    Engine.step(original, { stimulusMode: "pulse" });
  }
  const resumed = Engine.hydrate(Engine.serialize(original));
  for (let i = 0; i < 90; i += 1) {
    Engine.step(original, { stimulusMode: "basin", selectedBasin: 4 });
    Engine.step(resumed, { stimulusMode: "basin", selectedBasin: 4 });
    assert.equal(Engine.stateDigest(original), Engine.stateDigest(resumed));
  }
});

test("ablation substitutions are explicit and isolated", () => {
  const state = Engine.createState({
    seed: 77,
    summaryInterval: 2,
    mechanisms: { projection: false, memoryWrite: false, memoryReplay: false, summaries: false, noise: false, smoothing: false }
  });
  const smoothedState = [...state.smoothedState];
  const write = Engine.inscribeMemory(state, "blocked", 1);
  assert.equal(write.status, "ablated");
  Engine.requestProjection(state);
  for (let i = 0; i < 24; i += 1) Engine.step(state);
  assert.equal(state.lastInput.noise.amp, 0);
  assert.equal(state.counters.projection, 0);
  assert.equal(state.frames[0].projection_would_trigger, true);
  assert.equal(state.memorySummaries.length, 0);
  assert.equal(state.memories.length, 0);
  assert.equal(state.context.pendingRecall, null);
  assert.deepEqual(state.smoothedState, smoothedState);
});

test("History summaries is deterministic and bounded by memoryCapacity", () => {
  const state = Engine.createState({ seed: 11, summaryInterval: 2, memoryCapacity: 3 });
  for (let i = 0; i < 20; i += 1) Engine.step(state);
  assert.equal(state.memorySummaries.length, 3);
  assert.equal(state.counters.summaries, 10);
  for (const node of state.memorySummaries) {
    assert.equal(node.latent.length, 12);
    assert.ok(node.sourceHash.startsWith("mw-fnv64:"));
  }
});

test("manual inscription and Memory influence replay remain distinct mechanisms", () => {
  const state = Engine.createState({ seed: 121, recallThreshold: -1 });
  const write = Engine.inscribeMemory(state, "projection provenance", 1.2);
  assert.equal(write.event.kind, "memory-write");
  assert.equal(write.event.operator, undefined);
  assert.match(write.event.note, /not an alias for History summary/);
  const packet = Engine.queueRecall(state, "projection provenance");
  assert.equal(packet.operator, "Memory influence");
  Engine.step(state);
  assert.equal(state.lastInput.recall.packetId, packet.packetId);
  assert.equal(state.counters.recallApplied, 1);
});

test("Memory influence, nonzero Adaptive noise, and observer coupling compose in the same tick", () => {
  const state = Engine.createState({ seed: 491, recallThreshold: -1, noiseAmplitude: 0.055 });
  Engine.inscribeMemory(state, "composite influence packet", 1);
  const packet = Engine.queueRecall(state, "composite influence packet");
  const couplingVector = Array.from({ length: Engine.DIMENSION }, (_, i) => (i % 2 === 0 ? 0.04 : -0.025));
  const result = Engine.step(state, {
    stimulusMode: "quiet",
    couplingVector,
    couplingSourceHash: "mw-fnv64:frozen-observer-b"
  });

  assert.ok(packet);
  assert.equal(state.lastInput.recall.applied, true);
  assert.equal(state.lastInput.recall.packetId, packet.packetId);
  assert.equal(state.lastInput.noise.enabled, true);
  assert.ok(state.lastInput.noise.amp > 0);
  assert.ok(M.norm(state.lastInput.noise.vec) > 0);
  assert.equal(state.lastInput.coupling.applied, true);
  assert.ok(state.lastInput.coupling.magnitude > 0);
  assert.equal(result.frame.scalars.recallSimilarity, packet.similarity);
  assert.equal(result.frame.scalars.noiseAmplitude, state.lastInput.noise.amp);
  assert.equal(result.frame.scalars.couplingMagnitude, state.lastInput.coupling.magnitude);
});

test("Update coherenceScore gate uses the prior committed coherence", () => {
  const state = Engine.createState({ seed: 492, projectionThreshold: 1 });
  const priorCoherence = state.currentState.coherence;
  const result = Engine.step(state, { stimulusMode: "disrupt", stimulusAmplitude: 1.1 });

  assert.equal(state.lastUpdate.coherenceGate, 0.2 + 0.8 * priorCoherence);
  assert.equal(state.currentState.coherence, result.frame.coherenceScore);
  assert.notEqual(result.frame.coherenceScore, priorCoherence);
});

test("scheduled History summary summarizes committed state with and without Basin projection", () => {
  const ordinary = Engine.createState({
    seed: 493,
    summaryInterval: 1,
    mechanisms: { projection: false }
  });
  const ordinaryResult = Engine.step(ordinary, { stimulusMode: "quiet" });
  assert.deepEqual(ordinaryResult.events.map((event) => event.kind), ["summary"]);
  assert.equal(ordinary.memorySummaries.length, 1);
  assert.ok(M.distance(ordinary.memorySummaries[0].latent, ordinary.currentState.latent) < 1e-12);
  assert.equal(ordinary.memorySummaries[0].sourceHash, M.contentHash([ordinary.trace[0].stateHash]));
  assert.deepEqual(ordinary.memorySummaries[0].sourceSteps, [0, 0]);

  const projected = Engine.createState({ seed: 494, summaryInterval: 1 });
  Engine.requestProjection(projected);
  const collapsedResult = Engine.step(projected, { stimulusMode: "quiet" });
  assert.deepEqual(collapsedResult.events.slice(0, 2).map((event) => event.kind), ["projection", "summary"]);
  assert.equal(projected.memorySummaries.length, 1);
  assert.equal(projected.trace[0].projection, true);
  assert.equal(projected.trace[0].stateHash, Engine.stateHash(projected.currentState));
  assert.ok(M.distance(projected.memorySummaries[0].latent, projected.currentState.latent) < 1e-12);
  assert.equal(projected.memorySummaries[0].sourceHash, M.contentHash([projected.trace[0].stateHash]));
  assert.deepEqual(projected.memorySummaries[0].sourceSteps, [0, 0]);
});

test("fusion factorization projects the same SimulationState as combineStateAndUpdate", () => {
  const state = Engine.createState({ seed: 495 });
  const noise = Engine.sampleAdaptiveNoise(state);
  const input = Engine.sampleInput(state, noise);
  const update = Engine.computeStateUpdate(state, input);
  const smoothed = { latent: [...state.smoothedState] };
  const directFusion = Engine.combineStateAndUpdate(state, smoothed, update, input);
  const factoredFusion = Engine.decode(
    Engine.mergeR(Engine.representSmoothedState(smoothed), Engine.representUpdate(update), state.currentState.coherence),
    state,
    input
  );

  assert.deepEqual(factoredFusion, directFusion);
  assert.strictEqual(Engine.extractCombinedState(directFusion), directFusion.currentState);
  assert.deepEqual(Engine.extractCombinedState(factoredFusion), directFusion.currentState);
  assert.throws(() => Engine.extractCombinedState({}), /CombinedState record/);
});

test("pre-predicate Diagnostics assessment is finalized and committed once", () => {
  const state = Engine.createState({ seed: 496 });
  Engine.requestProjection(state);
  const result = Engine.step(state, { stimulusMode: "quiet" });

  assert.equal(state.frames.length, 1);
  assert.strictEqual(state.frames[0], result.frame);
  assert.equal(result.frame.projection_would_trigger, true);
  assert.equal(result.frame.projection_eligible, true);
  assert.equal(result.frame.projection_triggered, true);
  assert.equal(result.frame.projection_reason, "manual-request");
  assert.equal(result.frame.scalars.dwell, state.config.projectionDwell);
  assert.equal(result.frame.tags.filter((tag) => tag === "projection").length, 1);
});

test("R12 bounds and configuration validation reject invalid state", () => {
  assert.throws(() => Engine.createState({ seed: -1 }), /seed/);
  assert.throws(() => Engine.createState({ dimension: 11 }), /dimension/);
  assert.throws(() => Engine.createState({ projectionThreshold: Number.NaN }), /finite/);
  assert.throws(() => Engine.createState({ projectionDwell: 1.2 }), /integer/);
  const state = Engine.createState({ seed: 2, stimulusAmplitude: 4 });
  for (let i = 0; i < 200; i += 1) Engine.step(state, { stimulusMode: "disrupt" });
  assert.ok(M.norm(state.currentState.latent) <= state.config.radialLimit + 1e-10);
  assert.ok(state.currentState.latent.every((value) => Math.abs(value) <= state.config.componentLimit + 1e-10));
});

test("multi-observer coupling uses frozen inputs and is processing-order invariant", () => {
  const makePair = () => [
    Engine.createState({ config: { seed: 601, summaryInterval: 4 }, observerId: "observer-a" }),
    Engine.createState({ config: { seed: 602, summaryInterval: 4 }, observerId: "observer-b" })
  ];
  const ab = makePair();
  const ba = makePair();
  for (let i = 0; i < 96; i += 1) {
    const observation = { stimulusMode: i % 2 ? "pulse" : "periodic", selectedBasin: i % 6 };
    const resultAB = Engine.stepCoupledPair(ab[0], ab[1], observation, observation, { strength: 0.17, order: "ab" });
    const resultBA = Engine.stepCoupledPair(ba[0], ba[1], observation, observation, { strength: 0.17, order: "ba" });
    assert.equal(resultAB.coupling.updatePolicy, "frozen snapshot; simultaneous double-buffered inputs");
    assert.equal(Engine.stateDigest(ab[0]), Engine.stateDigest(ba[0]));
    assert.equal(Engine.stateDigest(ab[1]), Engine.stateDigest(ba[1]));
  }
});

test("replay hydration rejects malformed, out-of-bounds, or mismatched runtime data", () => {
  const state = Engine.createState({ seed: 811 });
  Engine.step(state);
  const replay = Engine.serialize(state);

  const badLatent = structuredClone(replay);
  badLatent.state.currentState.latent[0] = 99;
  badLatent.state.currentHash = Engine.stateHash(badLatent.state.currentState);
  assert.throws(() => Engine.hydrate(badLatent), /component bounds/);

  const badTrace = structuredClone(replay);
  badTrace.state.trace[0].update = [1, 2];
  assert.throws(() => Engine.hydrate(badTrace), /length 12/);

  const badIdentity = structuredClone(replay);
  badIdentity.state.engineId = "untrusted-engine";
  assert.throws(() => Engine.hydrate(badIdentity), /identity mismatch/);
});
