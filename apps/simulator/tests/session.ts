import {
  createSession,
  PERSISTENT_STIMULI,
  SESSION_PROVENANCE,
  type LiveConfigPatch,
} from "../src/session.ts";
import {
  assertSessionCompliance,
  evaluateSessionCompliance,
} from "../src/compliance.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function deepEqual(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}: ${a} !== ${b}`);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function vecNorm(values: number[]): number {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
}

function throws(fn: () => unknown, message: string): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

function test(name: string, fn: () => void): void {
  fn();
  console.log(`ok - ${name}`);
}

test("reflexive state warm-starts from state0 without a zero-prior implosion", () => {
  const session = createSession({ seed: "0x51e1d", config: { stimulus: "periodic" } });
  const initial = session.snapshot();
  deepEqual(initial.smoothedState, initial.currentState.latent, "initial smoothedState equals state0");
  const initialNorm = vecNorm(initial.currentState.latent);

  const first = session.step();
  const firstNorm = vecNorm(first.currentState.latent);
  assert(firstNorm / initialNorm > 0.8, `first tick preserves state scale: ${firstNorm / initialNorm}`);
  equal(first.frame.smoothingConfidence, 1, "first reflexive confidence");
  assert(Math.abs(first.frame.scalars.stateNorm - firstNorm) < 1e-12, "stateNorm telemetry");
  assert(Number.isFinite(first.frame.scalars.smoothedNorm), "smoothedNorm telemetry");
  assert(Number.isFinite(first.frame.scalars.stateChange), "stateChange telemetry");

  session.reset({ playing: false });
  const reset = session.snapshot();
  deepEqual(reset.smoothedState, reset.currentState.latent, "reset warm-starts smoothedState");
});

test("same seed and schedule replay exactly", () => {
  const options = {
    seed: "0x51e1d",
    eventHistoryLimit: 8,
    config: {
      stimulus: "disrupt" as const,
      projectionThreshold: 0.74,
      noiseAmplitude: 0.08,
      summaryInterval: 4,
    },
  };
  const a = createSession(options);
  const b = createSession(options);
  a.stepMany(48);
  b.stepMany(48);

  const ae = a.exportData();
  const be = b.exportData();
  deepEqual(ae.hashes, be.hashes, "same-seed hashes");
  deepEqual(ae.frames, be.frames, "same-seed Diagnostics frames");
  deepEqual(ae.eventCounts, be.eventCounts, "same-seed event schedule");
  assertSessionCompliance(ae);
  assertSessionCompliance(be);
});

test("one-shot pulse consumes exactly one future tick", () => {
  const exercise = () => {
    const session = createSession({ seed: "pulse-seed", config: { stimulus: "align" } });
    session.stepMany(2);
    session.queuePulse();
    session.queuePulse(); // click coalescing while one pulse is already pending
    session.step();
    session.step();
    session.queuePulse();
    session.step();
    return session.exportData();
  };

  const a = exercise();
  const b = exercise();
  deepEqual(a.stimulusSchedule, ["align", "align", "pulse", "align", "pulse"], "pulse schedule");
  deepEqual(a.pulseSteps, [2, 4], "pulse step indices");
  deepEqual(a.hashes, b.hashes, "pulse schedule determinism");
  equal(a.persistentStimulus, "align", "persistent mode survives pulse");
  equal(a.config.stimulus, "align", "engine config restored after pulse");
  equal(a.pulsePending, false, "pulse consumed");
  assertSessionCompliance(a);
});

test("pause prevents advancement and does not consume a queued pulse", () => {
  const session = createSession({ seed: 17, config: { stimulus: "quiet" } });
  session.queuePulse();
  const before = session.snapshot();
  equal(session.tick(), null, "paused tick result");
  const paused = session.snapshot();
  equal(paused.frameCount, before.frameCount, "paused frame count");
  equal(paused.stateHash, before.stateHash, "paused state hash");
  equal(paused.pulsePending, true, "paused pulse remains pending");

  session.play();
  const advanced = session.tick();
  assert(advanced !== null && advanced.pulse, "playing tick consumes queued pulse");
  session.pause();
  const afterPause = session.snapshot();
  equal(session.tick(), null, "re-paused tick result");
  equal(session.snapshot().stateHash, afterPause.stateHash, "re-paused state hash");
});

test("reset reproduces the trajectory with current settings", () => {
  const session = createSession({
    seed: "reset-seed",
    config: { stimulus: "disrupt", noiseAmplitude: 0.12, summaryInterval: 3 },
  });
  session.updateConfig({ updateScale: 0.41, projectionThreshold: 0.71 });

  const exercise = () => {
    session.step();
    session.queuePulse();
    session.step();
    session.stepMany(10);
    return session.exportData();
  };

  const first = exercise();
  session.reset({ playing: false });
  const second = exercise();
  deepEqual(second.hashes, first.hashes, "reset hashes");
  deepEqual(second.frames, first.frames, "reset frames");
  deepEqual(second.stimulusSchedule, first.stimulusSchedule, "reset stimulus schedule");
  deepEqual(second.eventCounts, first.eventCounts, "reset event schedule");
  equal(second.config.updateScale, 0.41, "config preserved by reset");
  assertSessionCompliance(second);
});

test("projection events align with frames and retained history is capped", () => {
  const session = createSession({
    seed: "projection-seed",
    eventHistoryLimit: 3,
    config: {
      stimulus: "basin",
      projectionThreshold: 0,
      dwell: 1,
      hold: 0,
      hysteresis: 0,
      noiseAmplitude: 0,
    },
  });
  session.stepMany(12);
  const data = session.exportData();

  equal(data.eventHistory.total, 12, "total projection events");
  equal(data.eventHistory.events.length, 3, "retained projection events");
  deepEqual(data.eventHistory.events.map((event) => event.step), [9, 10, 11], "newest projection events retained");
  assert(data.frames.every((frame) => frame.projectionTriggered), "every forced-projection frame is marked");
  assert(data.eventCounts.every((count) => count === 1), "one event per forced-projection frame");
  assert(data.eventHistory.events.every((event) => event.preHash !== event.postHash), "projection hashes differ");
  assertSessionCompliance(data);
});

test("invalid construction and config patches reject atomically", () => {
  throws(() => createSession({ config: { D: 13 } }), "D=13 rejected");
  throws(() => createSession({ config: { projectionThreshold: Number.NaN } }), "NaN projectionThreshold rejected");
  throws(() => createSession({ config: { stimulus: "pulse" } }), "persistent pulse rejected");
  throws(
    () => createSession({ config: { mechanisms: { noise: "yes" } as unknown as { noise: boolean } } }),
    "invalid initial ablation rejected",
  );
  throws(() => createSession({ eventHistoryLimit: 0 }), "zero event cap rejected");
  throws(() => createSession({ maxTicks: 0 }), "zero tick cap rejected");
  throws(() => createSession({ maxTicks: 16_385 }), "oversized tick cap rejected");
  throws(() => createSession({ seed: Number.NaN }), "NaN seed rejected");
  throws(() => createSession({ seed: Number.POSITIVE_INFINITY }), "infinite seed rejected");
  throws(() => createSession({ seed: "x".repeat(129) }), "oversized seed rejected");
  throws(() => createSession({ runId: "" }), "empty run ID rejected");
  throws(() => createSession({ stateId: "x".repeat(65) }), "oversized currentState ID rejected");
  throws(
    () => createSession({ config: { extraClaim: "quantum" } as unknown as LiveConfigPatch }),
    "unknown initial config key rejected",
  );

  const session = createSession();
  const before = session.snapshot().config;
  throws(() => session.updateConfig({ dwell: 1.5 }), "fractional dwell rejected");
  throws(
    () => session.updateConfig({ stimulus: "quiet" } as unknown as LiveConfigPatch),
    "non-live stimulus patch rejected",
  );
  throws(
    () => session.setMechanisms({ noise: "yes" } as unknown as { noise: boolean }),
    "non-boolean ablation rejected",
  );
  throws(() => session.stepMany(Number.NaN), "NaN step count rejected");
  deepEqual(session.snapshot().config, before, "invalid patches leave config unchanged");
});

test("config and ablation changes restart into a fixed replayable run", () => {
  const session = createSession({
    seed: "ablation-seed",
    config: {
      stimulus: "basin",
      projectionThreshold: 0,
      dwell: 1,
      hold: 0,
      noiseAmplitude: 0.2,
      summaryInterval: 2,
      memoryCapacity: 4,
      mechanisms: { projection: false, memory: false, summaries: false, noise: false },
    },
  });
  session.stepMany(8);
  let data = session.exportData();
  equal(data.eventHistory.total, 0, "projection ablation");
  assert(data.frames.every((frame) => frame.scalars.noiseActive === 0), "noise ablation telemetry");
  equal(data.memorySummaries.length, 0, "storeHistorySummary ablation");

  const restarted = session.setMechanisms({ projection: true, summaries: true, noise: true });
  equal(restarted.frameCount, 0, "ablation change resets committed trace");
  equal(restarted.eventHistory.total, 0, "ablation change resets events");
  session.stepMany(5);
  data = session.exportData();
  equal(data.frameCount, 5, "new fixed-config trace length");
  assert(data.eventHistory.total > 0, "projection enabled after restart");
  assert(data.frames.some((frame) => frame.scalars.noiseActive === 1), "noise enabled after restart");
  assert(data.memorySummaries.length > 0, "storeHistorySummary enabled after restart while memory remains ablated");
  equal(data.config.mechanisms.memory, false, "memory remains independently ablated");

  const afterConfigRestart = session.updateConfig({ projectionThreshold: 0.5 });
  equal(afterConfigRestart.frameCount, 0, "numeric config change resets committed trace");
  equal(afterConfigRestart.config.projectionThreshold, 0.5, "numeric config retained for the new run");
  assertSessionCompliance(data);
  assertSessionCompliance(session.exportData());
});

test("maxTicks bounds retained traces and advancement", () => {
  const session = createSession({ seed: "bounded", maxTicks: 3, playing: true });
  assert(session.tick() !== null, "tick one advances");
  assert(session.tick() !== null, "tick two advances");
  assert(session.tick() !== null, "tick three advances");
  equal(session.snapshot().playing, false, "session pauses at cap");
  equal(session.tick(), null, "timer tick does not advance past cap");
  throws(() => session.step(), "manual step rejects past cap");
  throws(() => session.queuePulse(), "orphan pulse rejects past cap");
  equal(session.snapshot().pulsePending, false, "no orphan pulse remains pending");
  equal(session.snapshot().frameCount, 3, "trace remains at cap");
  assertSessionCompliance(session.exportData());

  const atomic = createSession({ maxTicks: 2 });
  throws(() => atomic.stepMany(3), "oversized batch rejects before advancement");
  equal(atomic.snapshot().frameCount, 0, "rejected batch is atomic");

  const windowed = createSession({ maxTicks: 300 });
  windowed.stepMany(300);
  equal(windowed.snapshot().recentFrames.length, 256, "render snapshot keeps a bounded frame window");
  equal(windowed.exportData().frames.length, 300, "explicit export retains the complete bounded trace");
});

test("memory ablation changes the post-summary trajectory", () => {
  const base = {
    seed: "memory-seed",
    config: {
      stimulus: "basin" as const,
      summaryInterval: 2,
      noiseAmplitude: 0,
      mechanisms: { projection: false, summaries: true, noise: false },
    },
  };
  const withMemory = createSession({
    ...base,
    config: { ...base.config, mechanisms: { ...base.config.mechanisms, memory: true } },
  });
  const withoutMemory = createSession({
    ...base,
    config: { ...base.config, mechanisms: { ...base.config.mechanisms, memory: false } },
  });
  withMemory.stepMany(16);
  withoutMemory.stepMany(16);
  const a = withMemory.exportData();
  const b = withoutMemory.exportData();
  assert(a.hashes.some((hash, index) => hash !== b.hashes[index]), "memory ablation changes Update-driven trajectory");
  assertSessionCompliance(a);
  assertSessionCompliance(b);
});

test("compliance rejects tampered hashes, frames, schedules, and events", () => {
  const session = createSession();
  session.stepMany(4);
  const base = session.exportData();

  const currentHash = cloneJson(base);
  currentHash.stateHash = "deadbeef";
  let report = evaluateSessionCompliance(currentHash);
  assert(!report.compliant, "tampered current hash rejected");
  assert(report.failures.some((failure) => failure.id === "hash-chain"), "terminal hash failure identified");

  const intermediateHash = cloneJson(base);
  intermediateHash.hashes[2] = "deadbeef";
  report = evaluateSessionCompliance(intermediateHash);
  assert(!report.compliant, "tampered intermediate hash rejected");
  assert(report.failures.some((failure) => failure.id === "replay-consistency"), "intermediate replay failure identified");

  const frame = cloneJson(base);
  frame.frames[1]!.coherenceScore += 0.01;
  report = evaluateSessionCompliance(frame);
  assert(!report.compliant, "tampered frame rejected");
  assert(report.failures.some((failure) => failure.id === "replay-consistency"), "frame replay failure identified");

  const schedule = cloneJson(base);
  schedule.stimulusSchedule[1] = schedule.stimulusSchedule[1] === "quiet" ? "align" : "quiet";
  report = evaluateSessionCompliance(schedule);
  assert(!report.compliant, "tampered valid stimulus rejected");
  assert(report.failures.some((failure) => failure.id === "replay-consistency"), "schedule replay failure identified");

  const config = cloneJson(base) as typeof base & { config: typeof base.config & { extraClaim: string } };
  config.config.extraClaim = "quantum";
  report = evaluateSessionCompliance(config);
  assert(!report.compliant, "unknown config key rejected");
  assert(report.failures.some((failure) => failure.id === "config"), "config schema failure identified");

  const ablation = cloneJson(base) as typeof base & { config: typeof base.config & { mechanisms: typeof base.config.mechanisms & { extra: boolean } } };
  ablation.config.mechanisms.extra = true;
  report = evaluateSessionCompliance(ablation);
  assert(!report.compliant, "unknown ablation key rejected");
  assert(report.failures.some((failure) => failure.id === "config"), "ablation schema failure identified");

  const collapsing = createSession({
    seed: "event-tamper",
    config: { stimulus: "basin", projectionThreshold: 0, dwell: 1, hold: 0, hysteresis: 0, noiseAmplitude: 0 },
  });
  collapsing.stepMany(3);
  const event = collapsing.exportData();
  event.eventHistory.events[0]!.postHash = "deadbeef";
  report = evaluateSessionCompliance(event);
  assert(!report.compliant, "tampered event hash rejected");
  assert(report.failures.some((failure) => failure.id === "event-history"), "event linkage failure identified");
});

test("exported provenance and accepted stimuli cannot mutate validator baselines", () => {
  const session = createSession();
  session.step();
  const data = session.exportData();
  const forged = "0".repeat(40);
  (data.provenance as { engineGitBlob: string }).engineGitBlob = forged;

  equal(SESSION_PROVENANCE.engineGitBlob, "7e9deb3bb47f4f615b255b701bf4a4ada41a94df", "module provenance remains pinned");
  assert(!evaluateSessionCompliance(data).compliant, "forged per-export provenance rejected");
  equal(session.exportData().provenance.engineGitBlob, SESSION_PROVENANCE.engineGitBlob, "future exports remain authentic to the build pin");
  throws(
    () => (PERSISTENT_STIMULI as unknown as string[]).push("forged-mode"),
    "accepted persistent stimulus set is frozen",
  );
});

console.log("session adapter tests complete");
