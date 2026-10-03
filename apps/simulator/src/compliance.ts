/**
 * Browser-safe structural and deterministic replay checks for exported sessions.
 *
 * These checks validate the State Dynamics Engine trace contract. They do
 * not establish a physical claim or promote the DEVELOP Kernel v1.1 profile.
 */

import {
  hashState,
  createContext,
  type BasinProjectionEvent,
  type DiagnosticFrame,
} from "../../../src/engine.ts";
import {
  createSession,
  PERSISTENT_STIMULI,
  SESSION_SCOPE,
  SESSION_PROVENANCE,
  SESSION_ENGINE,
  SESSION_SCHEMA_VERSION,
  type SessionExport,
} from "./session.ts";

export type ComplianceCheck = {
  id: string;
  name: string;
  status: "pass" | "fail" | "not-tested";
  pass: boolean;
  passed: boolean;
  detail: string;
};

export type ComplianceReport = {
  pass: boolean;
  compliant: boolean;
  checks: ComplianceCheck[];
  failures: ComplianceCheck[];
};

const STIMULI = new Set<string>([...PERSISTENT_STIMULI, "pulse"]);
const REQUIRED_SCALARS = ["mix", "gate", "updateDrift", "noiseAmplitude", "noiseActive", "noiseRaised"];
const ENGINE_CONFIG_KEYS = [
  "D",
  "smoothingRate",
  "updateScale",
  "projectionThreshold",
  "dwell",
  "hold",
  "hysteresis",
  "summaryInterval",
  "memoryCapacity",
  "noiseAmplitude",
  "stimulus",
  "mechanisms",
].sort();
const ABLATION_CONFIG_KEYS = ["projection", "memory", "noise", "summaries"].sort();
const CHECK_NAMES: Record<string, string> = {
  identity: "Engine identity",
  seed: "Deterministic seed",
  config: "Engine configuration",
  "state-vectors": "12D state vectors",
  "trace-cardinality": "One frame per tick",
  "trace-order": "Diagnostics trace order",
  telemetry: "Operator telemetry",
  "pulse-schedule": "One-shot pulse schedule",
  "projection-alignment": "Projection alignment",
  "event-history": "Event history integrity",
  "hash-chain": "Diagnostic state hashes",
  "latest-frame": "Latest engine state",
  memorySummaries: "History summaries integrity",
  "replay-consistency": "Full deterministic replay",
};

function sameNumbers(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function vectorNorm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function isFiniteVector(vector: number[], dimension = 12): boolean {
  return vector.length === dimension && vector.every(Number.isFinite);
}

function isBoundedLatent(vector: number[]): boolean {
  return isFiniteVector(vector)
    && vector.every((value) => value >= -2 && value <= 2)
    && vectorNorm(vector) <= 2 + 1e-12;
}

function frameIsFinite(frame: DiagnosticFrame): boolean {
  return [
    frame.step,
    frame.phase,
    frame.coherenceScore,
    frame.inputStrength,
    frame.updateMagnitude,
    frame.smoothingConfidence,
    frame.entropy,
    frame.drift,
  ].every(Number.isFinite);
}

function eventIsIntegral(event: BasinProjectionEvent): boolean {
  return Number.isInteger(event.step)
    && event.step >= 0
    && Number.isInteger(event.basinId)
    && event.basinId >= 0
    && event.basinId < 6
    && Number.isFinite(event.energyDrop)
    && event.energyDrop >= 0
    && Number.isFinite(event.coherenceScore)
    && event.coherenceScore >= 0
    && event.coherenceScore <= 1
    && event.preHash.length > 0
    && event.postHash.length > 0
    && event.preHash !== event.postHash
    && event.reason.startsWith("basin:");
}

export function evaluateSessionCompliance(data: SessionExport): ComplianceReport {
  const checks: ComplianceCheck[] = [].sort();
  const add = (id: string, passed: boolean, detail: string): void => {
    checks.push({
      id,
      name: CHECK_NAMES[id] ?? id,
      status: passed ? "pass" : "fail",
      pass: passed,
      passed,
      detail,
    });
  };

  add(
    "identity",
    data.schemaVersion === SESSION_SCHEMA_VERSION
      && data.implementation === SESSION_ENGINE
      && data.claimBoundary === SESSION_SCOPE
      && typeof data.runId === "string"
      && data.runId.length >= 1
      && data.runId.length <= 128
      && typeof data.stateId === "string"
      && data.stateId.length >= 1
      && data.stateId.length <= 64
      && sameJson(data.provenance, SESSION_PROVENANCE),
    "Export identifies the session schema, State Dynamics Engine, source pins, and claim boundary.",
  );

  add(
    "seed",
    Number.isInteger(data.seed)
      && data.seed >= 0
      && data.seed <= 0xffffffff
      && ((typeof data.seedInput === "number" && Number.isFinite(data.seedInput))
        || (typeof data.seedInput === "string" && data.seedInput.length <= 128)),
    "The source seed is JSON-safe and the normalized deterministic seed is a uint32 value.",
  );

  let configValid = true;
  try {
    createContext("compliance", data.seedInput, data.config);
  } catch {
    configValid = false;
  }
  const ablationsValid = sameJson(Object.keys(data.config.mechanisms).sort(), ABLATION_CONFIG_KEYS)
    && Object.values(data.config.mechanisms).every((value) => typeof value === "boolean");
  const configKeysValid = sameJson(Object.keys(data.config).sort(), ENGINE_CONFIG_KEYS);
  add(
    "config",
    configValid
      && configKeysValid
      && data.config.D === 12
      && ablationsValid
      && Number.isInteger(data.maxTicks)
      && data.maxTicks >= 1
      && data.maxTicks <= 16_384
      && PERSISTENT_STIMULI.includes(data.persistentStimulus)
      && data.config.stimulus === data.persistentStimulus,
    "Engine config is valid, 12D-locked, bounded by maxTicks, and restored to a persistent non-pulse stimulus.",
  );

  const vectors = [
    data.currentState.latent,
    data.smoothedState,
    data.priorUpdate,
    ...data.stateHistory.map((sample) => sample.latent),
    ...data.memorySummaries.map((node) => node.latent),
  ];
  const stateHistoryOrdered = data.stateHistory.every((sample, index) => {
    const previous = data.stateHistory[index - 1];
    return Number.isInteger(sample.step)
      && sample.step >= 0
      && Number.isFinite(sample.coherenceScore)
      && sample.coherenceScore >= 0
      && sample.coherenceScore <= 1
      && (previous === undefined || sample.step === previous.step + 1);
  });
  add(
    "state-vectors",
    vectors.every((vector) => isFiniteVector(vector))
      && isBoundedLatent(data.currentState.latent)
      && data.stateHistory.every((sample) => isBoundedLatent(sample.latent))
      && stateHistoryOrdered
      && data.stateHistory.length <= 256,
    "Current State, self-model, Update, state trail, and memorySummaries vectors are finite 12D values; State samples are bounded.",
  );

  const frameCount = data.frames.length;
  add(
    "trace-cardinality",
    data.frameCount === frameCount
      && frameCount <= data.maxTicks
      && data.currentState.t === frameCount
      && data.hashes.length === frameCount + 1
      && data.stimulusSchedule.length === frameCount
      && data.eventCounts.length === frameCount
      && sameJson(data.recentFrames, data.frames.slice(-256)),
    "There is exactly one Diagnostics frame, stimulus record, and event count per engine tick.",
  );

  const framesOrdered = data.frames.every((frame, index) => {
    const phaseTag = `phase:${frame.phase}`;
    return frame.step === index
      && frame.phase === index % 8
      && frame.runId === data.runId
      && frame.tags.includes("tick")
      && frame.tags.includes(phaseTag)
      && frame.tags.filter((tag) => tag.startsWith("phase:")).length === 1
      && frameIsFinite(frame)
      && frame.coherenceScore >= 0
      && frame.coherenceScore <= 1
      && typeof frame.stable === "boolean"
      && typeof frame.projectionTriggered === "boolean";
  });
  add(
    "trace-order",
    framesOrdered,
    "Diagnostics frames have ordered steps, modulo-eight phases, required tags, and finite diagnostics.",
  );

  const telemetryComplete = data.frames.every((frame) => REQUIRED_SCALARS.every(
    (name) => Object.hasOwn(frame.scalars, name) && Number.isFinite(frame.scalars[name]),
  ));
  add(
    "telemetry",
    telemetryComplete,
    "Every frame logs fusion, Update drift, and Adaptive noise telemetry required by this implementation.",
  );

  const schedulesValid = data.stimulusSchedule.every((stimulus) => STIMULI.has(stimulus));
  const scheduledPulseSteps = data.stimulusSchedule
    .map((stimulus, index) => stimulus === "pulse" ? index : -1)
    .filter((index) => index >= 0);
  add(
    "pulse-schedule",
    schedulesValid
      && sameNumbers(data.pulseSteps, scheduledPulseSteps)
      && data.pulseCount === data.pulseSteps.length
      && new Set(data.pulseSteps).size === data.pulseSteps.length,
    "Each queued one-shot pulse occupies exactly one recorded tick and persistent mode is tracked separately.",
  );

  const eventCountsValid = data.eventCounts.every((count) => Number.isInteger(count) && count >= 0 && count <= 1);
  const eventsAligned = data.frames.every((frame, index) => {
    const projected = (data.eventCounts[index] ?? 0) === 1;
    return frame.projectionTriggered === projected && frame.tags.includes("projection") === projected;
  });
  const collapseSteps = data.eventCounts
    .map((count, index) => count === 1 ? index : -1)
    .filter((index) => index >= 0);
  add(
    "projection-alignment",
    eventCountsValid
      && eventsAligned
      && data.eventHistory.total === data.eventCounts.reduce((sum, count) => sum + count, 0),
    "BasinProjectionEvent counts, projectionTriggered, and projection tags align one-to-one by tick.",
  );

  const history = data.eventHistory;
  const expectedHistorySteps = collapseSteps.slice(-history.limit);
  const actualHistorySteps = history.events.map((event) => event.step);
  const historyValid = Number.isInteger(history.limit)
    && history.limit >= 1
    && history.events.length === Math.min(history.limit, history.total)
    && history.truncated === (history.total > history.events.length)
    && sameNumbers(actualHistorySteps, expectedHistorySteps)
    && history.events.every((event) => eventIsIntegral(event)
      && event.postHash === data.hashes[event.step + 1]);
  add(
    "event-history",
    historyValid,
    "Retained projection history is ordered, capped, and linked to the diagnostic post-state hash for each event tick.",
  );

  const hashesValid = data.hashes.every((value) => /^[0-9a-f]{8}$/.test(value))
    && data.hashes.at(-1) === data.stateHash
    && hashState(data.currentState) === data.stateHash;
  add(
    "hash-chain",
    hashesValid,
    "The non-cryptographic diagnostic hash sequence terminates at the hash of the exported current State state.",
  );

  const latest = data.frames.at(-1);
  const latestMatches = latest === undefined
    ? data.latestFrame === null
    : data.latestFrame !== null
      && JSON.stringify(latest) === JSON.stringify(data.latestFrame);
  add(
    "latest-frame",
    latestMatches
      && (latest === undefined
        ? vectorNorm(data.priorUpdate) === 0
        : Math.abs(vectorNorm(data.priorUpdate) - latest.updateMagnitude) <= 1e-12)
      && (data.stateHistory.length === 0
        ? frameCount === 0
        : data.stateHistory.at(-1)?.step === frameCount - 1),
    "The snapshot latestFrame, actual Update vector, and state trail terminate at the final engine tick.",
  );

  const meshIds = data.memorySummaries.map((node) => node.id);
  add(
    "memorySummaries",
    data.memorySummaries.length <= data.config.memoryCapacity
      && meshIds.every((id) => Number.isInteger(id) && id >= 0)
      && new Set(meshIds).size === meshIds.length
      && data.memorySummaries.every((node) => Number.isFinite(node.coherenceScore) && node.coherenceScore >= 0 && node.coherenceScore <= 1),
    "History summaries capacity, IDs, and coherence values are internally consistent.",
  );

  let replayMatches = false;
  try {
    replayMatches = sameJson(replaySessionExport(data), data);
  } catch {
    replayMatches = false;
  }
  add(
    "replay-consistency",
    replayMatches,
    "Seed, fixed configuration, per-tick stimulus schedule, frames, events, memory, and every diagnostic hash reproduce exactly.",
  );

  const failures = checks.filter((check) => check.status === "fail");
  const compliant = failures.length === 0;
  return { pass: compliant, compliant, checks, failures };
}

export function assertSessionCompliance(data: SessionExport): ComplianceReport {
  const report = evaluateSessionCompliance(data);
  if (!report.compliant) {
    const ids = report.failures.map((failure) => failure.id).join(", ");
    throw new Error(`Session export failed compliance checks: ${ids}`);
  }
  return report;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function replaySessionExport(data: SessionExport): SessionExport {
  const replay = createSession({
    runId: data.runId,
    stateId: data.stateId,
    seed: data.seedInput,
    config: data.config,
    eventHistoryLimit: data.eventHistory.limit,
    maxTicks: data.maxTicks,
  });

  for (const stimulus of data.stimulusSchedule) {
    if (stimulus === "pulse") replay.queuePulse();
    else replay.setInputMode(stimulus);
    replay.step();
  }

  replay.setInputMode(data.persistentStimulus);
  if (data.pulsePending) replay.queuePulse();
  if (data.playing) replay.play();
  else replay.pause();
  return replay.exportData();
}

/**
 * Rerun deterministic implementation checks in either Node or the browser.
 * This is a software-conformance check for the reference engine, not a scientific
 * validation of a physical theory.
 */
export function runImplementationVerification(current: SessionExport): ComplianceReport {
  const checks: ComplianceCheck[] = [];
  const add = (id: string, name: string, outcome: boolean | "not-tested", detail: string): void => {
    const status = outcome === "not-tested" ? outcome : outcome ? "pass" : "fail";
    const passed = status === "pass";
    checks.push({ id, name, status, pass: passed, passed, detail });
  };

  const structural = evaluateSessionCompliance(current);
  add(
    "current-export",
    "Current export replay",
    structural.compliant,
    structural.compliant
      ? `${structural.checks.length} structural and replay checks passed for the current session.`
      : `Failed: ${structural.failures.map((failure) => failure.id).join(", ")}.`,
  );

  const deterministicOptions = {
    seed: "0x51e1d",
    config: { stimulus: "disrupt" as const, projectionThreshold: 0.72, summaryInterval: 4, noiseAmplitude: 0.08 },
  };
  const deterministicA = createSession(deterministicOptions);
  const deterministicB = createSession(deterministicOptions);
  deterministicA.stepMany(128);
  deterministicB.stepMany(128);
  const da = deterministicA.exportData();
  const db = deterministicB.exportData();
  const deterministic = sameJson(da.hashes, db.hashes)
    && sameJson(da.frames, db.frames)
    && sameJson(da.eventCounts, db.eventCounts);
  add(
    "determinism",
    "Same-seed determinism",
    deterministic,
    deterministic
      ? `128 ticks matched hash-for-hash; final ${da.stateHash}.`
      : "Equal seed, config, and schedule produced unequal traces.",
  );

  const differentSeed = createSession({ ...deterministicOptions, seed: "0xdead" });
  differentSeed.stepMany(128);
  const diverges = differentSeed.exportData().hashes.some((hash, index) => hash !== da.hashes[index]);
  add(
    "seed-divergence",
    "Different-seed divergence",
    diverges,
    diverges ? "A changed seed altered the trajectory." : "The changed seed did not alter any tested hash.",
  );

  const pulseExercise = () => {
    const session = createSession({ seed: "pulse-check", config: { stimulus: "align" } });
    session.stepMany(2);
    session.queuePulse();
    session.step();
    session.step();
    session.queuePulse();
    session.stepMany(3);
    return session.exportData();
  };
  const pa = pulseExercise();
  const pb = pulseExercise();
  const pulsePass = sameJson(pa.hashes, pb.hashes)
    && sameJson(pa.stimulusSchedule, ["align", "align", "pulse", "align", "pulse", "align", "align"])
    && sameJson(pa.pulseSteps, [2, 4]);
  add(
    "pulse-replay",
    "One-shot Input replay",
    pulsePass,
    pulsePass ? "Two queued pulses occupied exactly ticks 2 and 4 and replayed identically." : "Pulse timing or replay diverged.",
  );

  const projection = createSession({
    seed: "projection-check",
    config: { stimulus: "basin", projectionThreshold: 0, dwell: 1, hold: 0, hysteresis: 0, noiseAmplitude: 0 },
  });
  projection.stepMany(16);
  const ce = projection.exportData();
  const collapsePass = ce.eventHistory.total === 16
    && ce.frames.every((frame) => frame.projectionTriggered && frame.tags.includes("projection"))
    && ce.eventHistory.events.every((event) => event.preHash !== event.postHash);
  add(
    "projection-integrity",
    "Basin projection event integrity",
    collapsePass,
    collapsePass ? "Forced reachability produced one valid pre/post-hash event per tick." : "Forced projection did not align with frames and events.",
  );

  const ablated = createSession({
    seed: "ablation-check",
    config: {
      stimulus: "basin",
      projectionThreshold: 0,
      dwell: 1,
      hold: 0,
      summaryInterval: 2,
      noiseAmplitude: 0.2,
      mechanisms: { projection: false, memory: false, summaries: false, noise: false },
    },
  });
  ablated.stepMany(20);
  const ae = ablated.exportData();
  const ablationPass = ae.eventHistory.total === 0
    && ae.memorySummaries.length === 0
    && ae.frames.every((frame) => frame.scalars.noiseActive === 0 && !frame.tags.includes("noise"));
  add(
    "mechanisms",
    "Mechanism silence checks",
    ablationPass,
    ablationPass ? "Basin projection, History summary, and Adaptive noise stayed silent while ablated; Memory influence had no memorySummaries to recall." : "At least one disabled path remained active.",
  );

  const memoryBase = {
    seed: "memory-check",
    config: {
      stimulus: "basin" as const,
      summaryInterval: 2,
      noiseAmplitude: 0,
      mechanisms: { projection: false, summaries: true, noise: false },
    },
  };
  const memoryOn = createSession({
    ...memoryBase,
    config: { ...memoryBase.config, mechanisms: { ...memoryBase.config.mechanisms, memory: true } },
  });
  const memoryOff = createSession({
    ...memoryBase,
    config: { ...memoryBase.config, mechanisms: { ...memoryBase.config.mechanisms, memory: false } },
  });
  memoryOn.stepMany(24);
  memoryOff.stepMany(24);
  const memoryA = memoryOn.exportData();
  const memoryB = memoryOff.exportData();
  const memoryActive = memoryA.memorySummaries.length > 0
    && memoryB.memorySummaries.length > 0
    && memoryA.hashes.some((hash, index) => hash !== memoryB.hashes[index]);
  add(
    "memory-ablation",
    "Memory influence activation contrast",
    memoryActive ? true : "not-tested",
    memoryActive ? "Seed-matched runs diverged after memorySummaries recall became available." : "Recall did not activate; classify this condition MECHANISM_NOT_TESTED.",
  );

  let invalidRejected = false;
  try {
    createSession({ config: { D: 13 } });
  } catch {
    invalidRejected = true;
  }
  add(
    "invalid-config",
    "12D configuration guard",
    invalidRejected,
    invalidRejected ? "D = 13 was rejected before execution." : "The engine accepted a non-12D configuration.",
  );

  const failures = checks.filter((check) => check.status === "fail");
  const compliant = failures.length === 0;
  return { pass: compliant, compliant, checks, failures };
}
