import {
  hashState,
  createContext,
  createInitialState,
  stepSimulation,
  type BasinProjectionEvent,
  type EngineConfig,
  type DiagnosticFrame,
  type Stimulus,
} from "../../../src/engine.ts";
import { assertSessionCompliance } from "../src/compliance.ts";
import {
  PROBE_EMPTY_DIGEST,
  PROBE_REFERENCE_64,
  PROBE_RUNTIME,
  appendProbeDigest,
  createProbeSession,
  digestProbeExport,
  probeHoldTicks,
  runProbeReference64,
} from "../src/probe-runtime.ts";
import { ZERO_BASELINE_RADIUS, radarRadius } from "../src/visualizer.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

function deepEqual(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}: ${a} !== ${b}`);
}

function throws(fn: () => unknown, message: string): void {
  let didThrow = false;
  try { fn(); } catch { didThrow = true; }
  assert(didThrow, message);
}

function test(name: string, fn: () => void): void {
  fn();
  console.log(`ok - ${name}`);
}

test("compact probe declares the real engine seam and no fallback", () => {
  equal(PROBE_RUNTIME.implementation, "State Dynamics Engine (12D)", "implementation identity");
  equal(PROBE_RUNTIME.transitionPath, "SimulationSession.step/tick to stepSimulation", "transition path");
  equal(PROBE_RUNTIME.fallback, false, "fallback disabled");
  equal(PROBE_RUNTIME.engineGitBlob, "7e9deb3bb47f4f615b255b701bf4a4ada41a94df", "engine pin");
});

test("signed radar exposes its zero baseline", () => {
  equal(ZERO_BASELINE_RADIUS, 0.56, "zero baseline radius");
  equal(radarRadius(0), ZERO_BASELINE_RADIUS, "zero maps to the declared baseline");
  assert(radarRadius(-1) < ZERO_BASELINE_RADIUS, "negative components render inward");
  assert(radarRadius(1) > ZERO_BASELINE_RADIUS, "positive components render outward");
});

test("64-tick reference matches the reference-engine pin", () => {
  const first = runProbeReference64();
  const second = runProbeReference64();
  equal(first.data.stateHash, PROBE_REFERENCE_64.expectedFinalHash, "reference terminal hash");
  equal(first.data.frameCount, 64, "reference frame count");
  equal(first.data.eventHistory.total, 1, "default reference projection count");
  equal(first.matchesPin, true, "reference pin status");
  deepEqual(first.data.hashes, second.data.hashes, "reference hash replay");
  equal(first.digest, second.digest, "reference digest replay");
  equal(first.digest, digestProbeExport(first.data), "reference export digest");
  assertSessionCompliance(first.data);
});

test("probe session matches direct stepSimulation over a mixed 64-tick schedule", () => {
  const runId = "probe-parity-v1";
  const stateId = "state";
  const seed = "probe-parity-v1";
  const config = {
    stimulus: "periodic",
    projectionThreshold: 0.68,
    dwell: 2,
    hold: 6,
    hysteresis: 0.08,
    summaryInterval: 4,
    memoryCapacity: 16,
    noiseAmplitude: 0.055,
  } satisfies Partial<EngineConfig>;
  const pulseSteps = new Set([12, 37]);
  const persistentAt = (step: number): Exclude<Stimulus, "pulse"> => {
    if (step < 10) return "periodic";
    if (step < 20) return "align";
    if (step < 30) return "disrupt";
    if (step < 40) return "quiet";
    if (step < 55) return "basin";
    return "periodic";
  };

  const probe = createProbeSession({ runId, stateId, seed, config });
  const directCtx = createContext(runId, seed, config);
  let directState = createInitialState(stateId, directCtx.seed, directCtx.config.D);
  const directHashes = [hashState(directState)];
  const directFrames: DiagnosticFrame[] = [];
  const directEvents: BasinProjectionEvent[] = [];
  const directEventCounts: number[] = [];

  for (let step = 0; step < 64; step += 1) {
    const persistent = persistentAt(step);
    const stimulus: Stimulus = pulseSteps.has(step) ? "pulse" : persistent;

    probe.setInputMode(persistent);
    if (stimulus === "pulse") probe.queuePulse();
    probe.step();

    directCtx.config.stimulus = stimulus;
    const output = stepSimulation(directState, directCtx);
    directState = output.nextState;
    directHashes.push(hashState(directState));
    directFrames.push(output.frame);
    directEvents.push(...output.events);
    directEventCounts.push(output.events.length);
  }
  directCtx.config.stimulus = persistentAt(63);

  const data = probe.exportData();
  deepEqual(data.hashes, directHashes, "direct/session hashes");
  deepEqual(data.frames, directFrames, "direct/session frames");
  deepEqual(data.eventCounts, directEventCounts, "direct/session event counts");
  deepEqual(data.eventHistory.events, directEvents, "direct/session projection events");
  deepEqual(data.currentState, directState, "direct/session final currentState");
  deepEqual(data.smoothedState, directCtx.smoothedState, "direct/session self-model");
  deepEqual(data.priorUpdate, directCtx.priorUpdate, "direct/session StateUpdate");
  deepEqual(data.stateHistory, directCtx.stateHistory, "direct/session state history");
  deepEqual(data.memorySummaries, directCtx.memorySummaries, "direct/session memorySummaries");
  deepEqual(data.pulseSteps, [12, 37], "mixed-schedule pulse ticks");
  equal(data.stateHash, "6cb52b2f", "mixed-schedule terminal pin");
  equal(data.eventHistory.total, 7, "mixed-schedule projection count");
  equal(data.memorySummaries.length, 15, "mixed-schedule memorySummaries count");
  assertSessionCompliance(data);
});

test("probe digest and user-facing hold countdown are deterministic", () => {
  const session = createProbeSession({
    seed: "probe-hold",
    config: { stimulus: "basin", projectionThreshold: 0, dwell: 1, hold: 6, hysteresis: 0, noiseAmplitude: 0 },
  });
  let digest = PROBE_EMPTY_DIGEST as string;
  const projected = session.step();
  digest = appendProbeDigest(digest, projected.stateHash);
  equal(projected.events.length, 1, "forced initial projection");
  equal(probeHoldTicks(session.snapshot()), 6, "six full post-projection ticks remain");

  for (let index = 0; index < 6; index += 1) {
    const step = session.step();
    digest = appendProbeDigest(digest, step.stateHash);
  }
  equal(probeHoldTicks(session.snapshot()), 0, "hold countdown expires after six ticks");
  equal(digest, digestProbeExport(session.exportData()), "incremental/export digest parity");
  throws(() => appendProbeDigest("invalid", projected.stateHash), "invalid previous digest rejected");
  throws(() => appendProbeDigest(PROBE_EMPTY_DIGEST, "DEADBEEF"), "non-lowercase currentState hash rejected");
});

console.log("compact probe tests complete");
