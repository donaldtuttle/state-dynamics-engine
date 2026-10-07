/** Session scheduling, replay exports, and controls for State Dynamics Engine. */

import {
  DEFAULT_CONFIG,
  hashState,
  createContext,
  createInitialState,
  initializeSmoothedState,
  stepSimulation,
  type Mechanisms,
  type BasinProjectionEvent,
  type SimulationContext,
  type EngineConfig,
  type MemorySummary,
  type SimulationState,
  type DiagnosticFrame,
  type Stimulus,
} from "../../../src/engine.ts";

export const SESSION_SCHEMA_VERSION = "state-dynamics-session/v2" as const;
export const SESSION_ENGINE = "State Dynamics Engine (12D)" as const;
export const SESSION_SCOPE = "Experimental bounded 12-dimensional software simulation." as const;
export const SESSION_PROVENANCE = {
  enginePath: "src/engine.ts",
  engineGitBlob: "ea4a6f3e66d548879535a3aa8b4182496b9242c7",
  sourceRepository: "https://github.com/donaldtuttle/qoft-calculus",
  sourceCommit: "1ab947e0cb75afaf0e7ecad11a8aa5e02b510ebc",
  hashVersion: "state-dynamics-state/v2",
} as const;
Object.freeze(SESSION_PROVENANCE);
// The previous v2 source differs only in projection-event telemetry.
export const PRE_LEDGER_ENGINE_BLOB = "7e9deb3bb47f4f615b255b701bf4a4ada41a94df" as const;
export type SessionProvenance = Omit<typeof SESSION_PROVENANCE, "engineGitBlob"> & {
  engineGitBlob: typeof SESSION_PROVENANCE.engineGitBlob | typeof PRE_LEDGER_ENGINE_BLOB;
};
export const PERSISTENT_STIMULI = Object.freeze(["quiet", "align", "disrupt", "periodic", "basin"] as const);

export type PersistentStimulus = (typeof PERSISTENT_STIMULI)[number];
export type Seed = string | number;

export type EngineConfigInput = Partial<Omit<EngineConfig, "mechanisms">> & {
  mechanisms?: Partial<Mechanisms>;
};

export type LiveConfigPatch = Partial<Pick<
  EngineConfig,
  | "smoothingRate"
  | "updateScale"
  | "projectionThreshold"
  | "dwell"
  | "hold"
  | "hysteresis"
  | "summaryInterval"
  | "memoryCapacity"
  | "noiseAmplitude"
>>;

export type SessionOptions = {
  runId?: string;
  stateId?: string;
  seed?: Seed;
  config?: EngineConfigInput;
  eventHistoryLimit?: number;
  maxTicks?: number;
  playing?: boolean;
};

export type SessionResetOptions = {
  seed?: Seed;
  playing?: boolean;
};

export type SessionStep = {
  stimulus: Stimulus;
  pulse: boolean;
  currentState: SimulationState;
  stateHash: string;
  frame: DiagnosticFrame;
  events: BasinProjectionEvent[];
};

export type SessionEventHistory = {
  limit: number;
  total: number;
  truncated: boolean;
  events: BasinProjectionEvent[];
};

export type SessionStateSample = {
  latent: number[];
  coherenceScore: number;
  step: number;
};

export type SessionSnapshot = {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  implementation: typeof SESSION_ENGINE;
  runId: string;
  stateId: string;
  seedInput: Seed;
  seed: number;
  playing: boolean;
  maxTicks: number;
  pulsePending: boolean;
  persistentStimulus: PersistentStimulus;
  config: EngineConfig;
  currentState: SimulationState;
  stateHash: string;
  latestFrame: DiagnosticFrame | null;
  recentFrames: DiagnosticFrame[];
  frameCount: number;
  pulseCount: number;
  smoothedState: number[];
  priorUpdate: number[];
  stateHistory: SessionStateSample[];
  memorySummaries: MemorySummary[];
  eventHistory: SessionEventHistory;
};

export type SessionExport = SessionSnapshot & {
  claimBoundary: typeof SESSION_SCOPE;
  provenance: SessionProvenance;
  frames: DiagnosticFrame[];
  hashes: string[];
  stimulusSchedule: Stimulus[];
  eventCounts: number[];
  pulseSteps: number[];
};

const DEFAULT_EVENT_HISTORY_LIMIT = 128;
const MAX_TICKS_LIMIT = 16_384;
const DEFAULT_MAX_TICKS = MAX_TICKS_LIMIT;
const RECENT_FRAME_LIMIT = 256;
const EXPORTED_STATE_HISTORY_LIMIT = 256;
const ABLATION_KEYS = ["projection", "memory", "summaries", "noise"] as const;
const CONFIG_KEYS = [
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
] as const;
const LIVE_CONFIG_KEYS = [
  "smoothingRate",
  "updateScale",
  "projectionThreshold",
  "dwell",
  "hold",
  "hysteresis",
  "summaryInterval",
  "memoryCapacity",
  "noiseAmplitude",
] as const;

function assertPersistentStimulus(value: unknown): asserts value is PersistentStimulus {
  if (!PERSISTENT_STIMULI.includes(value as PersistentStimulus)) {
    throw new Error(
      `Persistent stimulus must be one of ${PERSISTENT_STIMULI.join(", ")}; use queuePulse() for a one-tick pulse.`,
    );
  }
}

function assertEventHistoryLimit(value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new Error(`eventHistoryLimit must be an integer >= 1, got ${value}`);
  }
}

function assertMaxTicks(value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > MAX_TICKS_LIMIT) {
    throw new Error(`maxTicks must be an integer in [1, ${MAX_TICKS_LIMIT}], got ${value}`);
  }
}

function assertSeed(value: Seed): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Numeric seed must be finite, got ${value}`);
    return;
  }
  if (value.length > 128) throw new Error("String seed must be at most 128 characters");
}

function assertIdentifier(name: string, value: string, maxLength: number): void {
  if (value.length < 1 || value.length > maxLength) {
    throw new Error(`${name} must contain 1 to ${maxLength} characters`);
  }
}

function cloneMechanisms(value: Mechanisms): Mechanisms {
  return { ...value };
}

function cloneConfig(value: EngineConfig): EngineConfig {
  return { ...value, mechanisms: cloneMechanisms(value.mechanisms) };
}

function cloneState(value: SimulationState): SimulationState {
  return { ...value, latent: value.latent.slice() };
}

function cloneFrame(value: DiagnosticFrame): DiagnosticFrame {
  return { ...value, tags: value.tags.slice(), scalars: { ...value.scalars } };
}

function cloneEvent(value: BasinProjectionEvent): BasinProjectionEvent {
  return { ...value };
}

function cloneMemorySummary(value: MemorySummary): MemorySummary {
  return { ...value, latent: value.latent.slice() };
}

function normalizeConfig(input: EngineConfigInput = {}): EngineConfig {
  const allowed = new Set<string>(CONFIG_KEYS);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`Unknown engine config key: ${key}`);
  }
  const persistentStimulus = input.stimulus ?? DEFAULT_CONFIG.stimulus;
  assertPersistentStimulus(persistentStimulus);
  validateMechanismPatch(input.mechanisms ?? {});
  return {
    ...DEFAULT_CONFIG,
    ...input,
    stimulus: persistentStimulus,
    mechanisms: { ...DEFAULT_CONFIG.mechanisms, ...(input.mechanisms ?? {}) },
  };
}

function validateFullConfig(seed: Seed, config: EngineConfig): EngineConfig {
  // createContext is the engine-owned validation boundary. The temporary context is
  // discarded; only its normalized, validated configuration is retained.
  return cloneConfig(createContext("session-config-validation", seed, cloneConfig(config)).config);
}

function validateMechanismPatch(patch: Partial<Mechanisms>): void {
  const allowed = new Set<string>(ABLATION_KEYS);
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.has(key)) throw new Error(`Unknown ablation: ${key}`);
    if (typeof value !== "boolean") throw new Error(`Mechanism ${key} must be boolean`);
  }
}

function validateLiveConfigPatch(patch: LiveConfigPatch): void {
  const allowed = new Set<string>(LIVE_CONFIG_KEYS);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) throw new Error(`Config ${key} is not live-editable`);
  }
}

export class SimulationSession {
  private readonly runId: string;
  private readonly stateId: string;
  private readonly eventHistoryLimit: number;
  private readonly maxTicks: number;
  private seedInput: Seed;
  private context: SimulationContext;
  private currentState: SimulationState;
  private playingState: boolean;
  private pulseQueued = false;
  private persistentInput: PersistentStimulus;
  private retainedEvents: BasinProjectionEvent[] = [];
  private totalEvents = 0;
  private hashes: string[] = [];
  private stimulusSchedule: Stimulus[] = [];
  private eventCounts: number[] = [];
  private pulseSteps: number[] = [];

  constructor(options: SessionOptions = {}) {
    this.runId = options.runId ?? "state-dynamics-lab";
    this.stateId = options.stateId ?? "state";
    this.seedInput = options.seed ?? "0x51e1d";
    this.eventHistoryLimit = options.eventHistoryLimit ?? DEFAULT_EVENT_HISTORY_LIMIT;
    this.maxTicks = options.maxTicks ?? DEFAULT_MAX_TICKS;
    this.playingState = options.playing ?? false;

    assertEventHistoryLimit(this.eventHistoryLimit);
    assertMaxTicks(this.maxTicks);
    assertSeed(this.seedInput);
    assertIdentifier("runId", this.runId, 128);
    assertIdentifier("stateId", this.stateId, 64);
    const config = normalizeConfig(options.config);
    this.persistentInput = config.stimulus as PersistentStimulus;
    this.context = createContext(this.runId, this.seedInput, config);
    this.currentState = createInitialState(this.stateId, this.context.seed, this.context.config.D);
    initializeSmoothedState(this.currentState, this.context);
    this.hashes = [hashState(this.currentState)];
  }

  play(): SessionSnapshot {
    this.playingState = this.context.trace.length < this.maxTicks;
    return this.snapshot();
  }

  pause(): SessionSnapshot {
    this.playingState = false;
    return this.snapshot();
  }

  togglePlaying(): SessionSnapshot {
    this.playingState = !this.playingState && this.context.trace.length < this.maxTicks;
    return this.snapshot();
  }

  /** Advance one tick only while the session is playing. */
  tick(): SessionStep | null {
    if (!this.playingState) return null;
    if (this.context.trace.length >= this.maxTicks) {
      this.playingState = false;
      return null;
    }
    return this.step();
  }

  /** Advance exactly one engine tick, even when paused. */
  step(): SessionStep {
    if (this.context.trace.length >= this.maxTicks) {
      this.playingState = false;
      throw new Error(`Session reached its ${this.maxTicks}-tick safety limit; export or reset before continuing.`);
    }
    const pulse = this.pulseQueued;
    const stimulus: Stimulus = pulse ? "pulse" : this.persistentInput;

    this.context.config.stimulus = stimulus;
    let output: ReturnType<typeof stepSimulation>;
    try {
      output = stepSimulation(this.currentState, this.context);
    } finally {
      // Pulse is a session-level one-shot schedule, never a persistent engine
      // configuration. Restoration also occurs if stepSimulation unexpectedly throws.
      this.context.config.stimulus = this.persistentInput;
    }

    this.currentState = output.nextState;
    if (pulse) {
      this.pulseQueued = false;
      this.pulseSteps.push(output.frame.step);
    }

    const stateHash = hashState(this.currentState);
    this.hashes.push(stateHash);
    this.stimulusSchedule.push(stimulus);
    this.eventCounts.push(output.events.length);
    this.totalEvents += output.events.length;
    this.retainedEvents.push(...output.events.map(cloneEvent));
    if (this.retainedEvents.length > this.eventHistoryLimit) {
      this.retainedEvents.splice(0, this.retainedEvents.length - this.eventHistoryLimit);
    }
    if (this.context.trace.length >= this.maxTicks) this.playingState = false;

    return {
      stimulus,
      pulse,
      currentState: cloneState(this.currentState),
      stateHash,
      frame: cloneFrame(output.frame),
      events: output.events.map(cloneEvent),
    };
  }

  stepMany(count: number): SessionStep[] {
    if (!Number.isFinite(count) || !Number.isInteger(count) || count < 0) {
      throw new Error(`step count must be an integer >= 0, got ${count}`);
    }
    const remaining = this.maxTicks - this.context.trace.length;
    if (count > remaining) {
      throw new Error(`step count ${count} exceeds the ${remaining} ticks remaining in this session`);
    }
    return Array.from({ length: count }, () => this.step());
  }

  /** Coalesce clicks until the next actual tick, then apply pulse for one tick. */
  queuePulse(): SessionSnapshot {
    if (this.context.trace.length >= this.maxTicks) {
      throw new Error(`Session reached its ${this.maxTicks}-tick safety limit; reset before queuing another pulse.`);
    }
    this.pulseQueued = true;
    return this.snapshot();
  }

  setInputMode(mode: PersistentStimulus): SessionSnapshot {
    assertPersistentStimulus(mode);
    this.persistentInput = mode;
    this.context.config.stimulus = mode;
    return this.snapshot();
  }

  updateConfig(patch: LiveConfigPatch): SessionSnapshot {
    validateLiveConfigPatch(patch);
    const candidate: EngineConfig = {
      ...this.context.config,
      ...patch,
      stimulus: this.persistentInput,
      mechanisms: cloneMechanisms(this.context.config.mechanisms),
    };
    const validated = validateFullConfig(this.seedInput, candidate);
    const mustRestart = this.context.trace.length > 0;
    this.context.config = validated;

    // The export format records one fixed configuration per run. If any tick
    // has committed, changing that configuration starts a fresh replayable run.
    return mustRestart ? this.reset() : this.snapshot();
  }

  setMechanisms(patch: Partial<Mechanisms>): SessionSnapshot {
    validateMechanismPatch(patch);
    const candidate: EngineConfig = {
      ...this.context.config,
      stimulus: this.persistentInput,
      mechanisms: { ...this.context.config.mechanisms, ...patch },
    };
    const mustRestart = this.context.trace.length > 0;
    this.context.config = validateFullConfig(this.seedInput, candidate);
    return mustRestart ? this.reset() : this.snapshot();
  }

  /**
   * Restart from the seed while preserving the current config and input
   * mode. Pending pulse and all run-local history are cleared.
   */
  reset(options: SessionResetOptions = {}): SessionSnapshot {
    const config = cloneConfig(this.context.config);
    const nextSeed = options.seed ?? this.seedInput;
    assertSeed(nextSeed);
    this.seedInput = nextSeed;
    this.playingState = options.playing ?? this.playingState;
    config.stimulus = this.persistentInput;

    this.context = createContext(this.runId, this.seedInput, config);
    this.currentState = createInitialState(this.stateId, this.context.seed, this.context.config.D);
    initializeSmoothedState(this.currentState, this.context);
    this.pulseQueued = false;
    this.retainedEvents = [];
    this.totalEvents = 0;
    this.hashes = [hashState(this.currentState)];
    this.stimulusSchedule = [];
    this.eventCounts = [];
    this.pulseSteps = [];
    return this.snapshot();
  }

  snapshot(): SessionSnapshot {
    const latest = this.context.trace.at(-1);
    return {
      schemaVersion: SESSION_SCHEMA_VERSION,
      implementation: SESSION_ENGINE,
      runId: this.runId,
      stateId: this.stateId,
      seedInput: this.seedInput,
      seed: this.context.seed,
      playing: this.playingState,
      maxTicks: this.maxTicks,
      pulsePending: this.pulseQueued,
      persistentStimulus: this.persistentInput,
      config: cloneConfig(this.context.config),
      currentState: cloneState(this.currentState),
      stateHash: hashState(this.currentState),
      latestFrame: latest ? cloneFrame(latest) : null,
      recentFrames: this.context.trace.slice(-RECENT_FRAME_LIMIT).map(cloneFrame),
      frameCount: this.context.trace.length,
      pulseCount: this.pulseSteps.length,
      smoothedState: this.context.smoothedState.slice(),
      priorUpdate: this.context.priorUpdate.slice(),
      stateHistory: this.context.stateHistory.slice(-EXPORTED_STATE_HISTORY_LIMIT).map((sample) => ({
        latent: sample.latent.slice(),
        coherenceScore: sample.coherenceScore,
        step: sample.step,
      })),
      memorySummaries: this.context.memorySummaries.map(cloneMemorySummary),
      eventHistory: {
        limit: this.eventHistoryLimit,
        total: this.totalEvents,
        truncated: this.totalEvents > this.retainedEvents.length,
        events: this.retainedEvents.map(cloneEvent),
      },
    };
  }

  exportData(): SessionExport {
    return {
      ...this.snapshot(),
      claimBoundary: SESSION_SCOPE,
      provenance: { ...SESSION_PROVENANCE },
      frames: this.context.trace.map(cloneFrame),
      hashes: this.hashes.slice(),
      stimulusSchedule: this.stimulusSchedule.slice(),
      eventCounts: this.eventCounts.slice(),
      pulseSteps: this.pulseSteps.slice(),
    };
  }
}

export function createSession(options: SessionOptions = {}): SimulationSession {
  return new SimulationSession(options);
}
