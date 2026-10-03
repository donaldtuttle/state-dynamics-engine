import { create } from "zustand";
import EngineJs from "./vendor/engine.js";
import FieldJs from "./vendor/field.js";
import ProjectionJs from "./vendor/projection.js";

const Engine: any = EngineJs;
const Field: any = FieldJs;
const Projection: any = ProjectionJs;

export type ViewMode = "weather" | "field" | "terrain";
export type ScalarMode =
  | "weather"
  | "potential"
  | "coherenceScore"
  | "fronts"
  | "memoryInfluence"
  | "projectionReadiness"
  | "separation";

export type Layers = {
  scalar: boolean;
  vectors: boolean;
  streamlines: boolean;
  trace: boolean;
  smoothed: boolean;
  basins: boolean;
  projection: boolean;
  memory: boolean;
  events: boolean;
  grid: boolean;
};

export const DEFAULT_LAYERS: Layers = {
  scalar: true,
  vectors: true,
  streamlines: true,
  trace: true,
  smoothed: true,
  basins: true,
  projection: true,
  memory: true,
  events: true,
  grid: true,
};

export const STIMULUS_MODES = [
  "quiet",
  "align",
  "disrupt",
  "pulse",
  "periodic",
  "basin",
] as const;

export const ABLATION_KEYS = [
  ["projection", "Basin projection"],
  ["memoryWrite", "Memory writing"],
  ["memoryReplay", "Memory replay"],
  ["summaries", "History summaries"],
  ["noise", "Adaptive noise"],
  ["coherenceGate", "Coherence gate"],
  ["smoothing", "State smoothing"],
] as const;

export const PUBLISHED_DEMO_HASH = "mw-fnv64:b8869fa460013ef2";

export const SCALAR_OPTIONS: { value: ScalarMode; label: string }[] = [
  { value: "weather", label: "Regime composite" },
  { value: "potential", label: "Attractor potential" },
  { value: "coherenceScore", label: "Coherence score" },
  { value: "fronts", label: "Update fronts" },
  { value: "memoryInfluence", label: "Memory influence" },
  { value: "projectionReadiness", label: "Basin projection readiness" },
  { value: "separation", label: "State-to-smoothed distance" },
];

type Forcing = { latent: number[]; label: string };

export type Sim = {
  state: any;
  peerState: any;
  projection: any;
  field: any;
  catalog: any;
  currentForcing: Forcing | null;
  selectedEvent: any;
  dirty: boolean;
};

function fieldSize() {
  if (typeof window === "undefined") return 45;
  if (window.innerWidth < 560) return 35;
  if (window.innerWidth > 1800) return 57;
  return 45;
}

function buildField(state: any, projection: any) {
  return Field.buildField(state, projection, { size: fieldSize() });
}

function cloneConfig(seed: number, ui: LabState) {
  const mechanisms: Record<string, boolean> = {};
  for (const [key] of ABLATION_KEYS) mechanisms[key] = ui.mechanisms[key];
  mechanisms.coupling = true;
  return {
    seed,
    stimulusMode: ui.stimulusMode,
    stimulusAmplitude: ui.amplitude,
    selectedBasin: ui.selectedBasin,
    mechanisms,
    couplingStrength: ui.coupling,
  };
}

function uiMechanismsFromState(state: any) {
  return Object.fromEntries(
    ABLATION_KEYS.map(([key]) => [key, Boolean(state.config.mechanisms[key])]),
  );
}

function playDemo(config: Record<string, unknown>) {
  const state = Engine.createState(config);
  Engine.inscribeMemory(state, "observer field", 1.15);
  Engine.inscribeMemory(state, "projection provenance", 0.95);
  Engine.inscribeMemory(state, "memory front", 0.78);
  for (let tick = 0; tick < 96; tick += 1) {
    if (tick === 22) Engine.queueRecall(state, "projection provenance");
    if (tick === 51) Engine.requestProjection(state);
    Engine.step(state, {
      stimulusMode: tick < 36 ? "periodic" : tick < 70 ? "pulse" : "basin",
      stimulusAmplitude: 0.82,
      selectedBasin: 4,
    });
  }
  return state;
}

export function createPublishedDemo() {
  const state = playDemo({ seed: 12062026 });
  if (state.currentHash !== PUBLISHED_DEMO_HASH) {
    throw new Error(
      `Published demo drift: expected ${PUBLISHED_DEMO_HASH}, received ${state.currentHash}`,
    );
  }
  return state;
}

const initialProjection = Projection.createProjection();
const initialState = createPublishedDemo();
const initialField = Field.buildField(initialState, initialProjection, { size: 45 });


export const sim: Sim = {
  state: initialState,
  peerState: null,
  projection: initialProjection,
  field: initialField,
  catalog: Projection.featureCatalog(initialProjection, initialState, initialField.spec),
  currentForcing: null,
  selectedEvent: null,
  dirty: true,
};

function rebuildField() {
  sim.field = buildField(sim.state, sim.projection);
  sim.catalog = Projection.featureCatalog(sim.projection, sim.state, sim.field.spec);
  sim.dirty = true;
}

type LabState = {
  rev: number;
  running: boolean;
  speed: number;
  view: ViewMode;
  scalarMode: ScalarMode;
  layers: Layers;
  seed: number;
  stimulusMode: string;
  amplitude: number;
  selectedBasin: number;
  coupling: number;
  peerEnabled: boolean;
  memoryLabel: string;
  memoryWeight: number;
  featureId: string;
  toast: string | null;
  liveMessage: string;
  fps: number;
  yaw: number;
  pitch: number;
  selectedPoint: { x: number; y: number } | null;
  mechanisms: Record<string, boolean>;
  bump: () => void;
  setRunning: (value: boolean) => void;
  setSpeed: (value: number) => void;
  setView: (view: ViewMode) => void;
  setScalarMode: (mode: ScalarMode) => void;
  setLayer: (layer: keyof Layers, enabled: boolean) => void;
  setSeed: (seed: number) => void;
  setStimulusMode: (mode: string) => void;
  setAmplitude: (value: number) => void;
  setSelectedBasin: (id: number) => void;
  setCoupling: (value: number) => void;
  setPeerEnabled: (value: boolean) => void;
  setMemoryLabel: (value: string) => void;
  setMemoryWeight: (value: number) => void;
  setFeatureId: (id: string) => void;
  setMechanism: (key: string, enabled: boolean) => void;
  setFps: (fps: number) => void;
  setOrbit: (yaw: number, pitch: number) => void;
  toastMessage: (message: string) => void;
  announce: (message: string) => void;
  stepOnce: () => any;
  resetEngine: () => void;
  loadDemo: () => void;
  inscribe: () => void;
  recall: () => void;
  requestProjection: () => void;
  pickPoint: (point: { x: number; y: number }, sample: any) => void;
  selectEvent: (event: any) => void;
  exportReplay: () => void;
  exportCsv: () => void;
  importReplay: (file: File) => Promise<void>;
};

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function observationFrom(ui: LabState) {
  return {
    stimulusMode: ui.stimulusMode,
    stimulusAmplitude: ui.amplitude,
    selectedBasin: ui.selectedBasin,
    forcingVector: sim.currentForcing ? sim.currentForcing.latent : null,
    forcingLabel: sim.currentForcing ? sim.currentForcing.label : null,
  };
}

function downloadFile(name: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function scalarFeatureId(mode: ScalarMode) {
  return mode === "potential"
    ? "attractor-potential"
    : mode === "coherenceScore"
      ? "coherenceScore-field"
      : mode === "memoryInfluence"
        ? "memory-influence"
        : mode === "projectionReadiness"
          ? "projection-surface"
          : mode === "separation"
            ? "currentState-smoothed"
            : mode === "fronts"
              ? "update-vectors"
              : "weather-composite";
}

export const useLab = create<LabState>((set, get) => ({
  rev: 0,
  running: false,
  speed: 80,
  view: "weather",
  scalarMode: "weather",
  layers: { ...DEFAULT_LAYERS },
  seed: 12062026,
  stimulusMode: "periodic",
  amplitude: 0.82,
  selectedBasin: 4,
  coupling: 0.14,
  peerEnabled: false,
  memoryLabel: "observer field",
  memoryWeight: 1,
  featureId: "weather-composite",
  toast: "Loaded the deterministic 96-tick demonstration run.",
  liveMessage: "Memory Weather v0.1.1 state-dynamics instrument ready.",
  fps: 0,
  yaw: -0.52,
  pitch: 0.92,
  selectedPoint: null,
  mechanisms: {
    projection: true,
    memoryWrite: true,
    memoryReplay: true,
    summaries: true,
    noise: true,
    coherenceGate: true,
    smoothing: true,
  },
  bump: () => set((s) => ({ rev: s.rev + 1 })),
  setRunning: (value) => set({ running: value }),
  setSpeed: (value) => set({ speed: value }),
  setView: (view) => {
    sim.dirty = true;
    set((s) => ({ view, rev: s.rev + 1 }));
  },
  setScalarMode: (mode) => {
    sim.dirty = true;
    set((s) => ({
      scalarMode: mode,
      featureId: scalarFeatureId(mode),
      rev: s.rev + 1,
    }));
  },
  setLayer: (layer, enabled) => {
    sim.dirty = true;
    set((s) => ({
      layers: { ...s.layers, [layer]: enabled },
      rev: s.rev + 1,
    }));
  },
  setSeed: (seed) => set({ seed }),
  setStimulusMode: (mode) => {
    sim.currentForcing = null;
    sim.dirty = true;
    set((s) => ({
      stimulusMode: mode,
      selectedPoint: null,
      toast: "Preset selected; explicit viewport forcing cleared.",
      rev: s.rev + 1,
    }));
  },
  setAmplitude: (value) => set({ amplitude: value }),
  setSelectedBasin: (id) => set({ selectedBasin: id }),
  setCoupling: (value) => set({ coupling: value }),
  setPeerEnabled: (value) => {
    const ui = get();
    if (value) {
      const peerSeed = (sim.state.config.seed + 1) >>> 0;
      sim.peerState = Engine.createState({
        config: cloneConfig(peerSeed, ui),
        observerId: "observer-b",
      });
      const observation = observationFrom(ui);
      for (let i = 0; i < sim.state.context.step; i += 1) {
        Engine.step(sim.peerState, observation);
      }
      rebuildField();
      set((s) => ({
        peerEnabled: true,
        featureId: "multi-observer-coupling",
        toast: "Observer B enabled with an independent seed and frozen-snapshot coupling.",
        rev: s.rev + 1,
      }));
    } else {
      sim.peerState = null;
      rebuildField();
      set((s) => ({
        peerEnabled: false,
        toast: "Instance B disabled; instance A state is unchanged.",
        rev: s.rev + 1,
      }));
    }
  },
  setMemoryLabel: (value) => set({ memoryLabel: value }),
  setMemoryWeight: (value) => set({ memoryWeight: value }),
  setFeatureId: (id) => {
    sim.selectedEvent = null;
    set({ featureId: id });
  },
  setMechanism: (key, enabled) => {
    Engine.setMechanism(sim.state, key, enabled);
    rebuildField();
    set((s) => ({
      mechanisms: { ...s.mechanisms, [key]: enabled },
      rev: s.rev + 1,
    }));
  },
  setFps: (fps) => set({ fps }),
  setOrbit: (yaw, pitch) => {
    sim.dirty = true;
    set((s) => ({ yaw, pitch, rev: s.rev + 1 }));
  },
  toastMessage: (message) => {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 3200);
    set({ toast: message });
  },
  announce: (message) => set({ liveMessage: message }),
  stepOnce: () => {
    const ui = get();
    const observation = observationFrom(ui);
    const result = sim.peerState
      ? Engine.stepCoupledPair(sim.state, sim.peerState, observation, observation, {
          strength: ui.coupling,
          enabled: true,
        }).results[0]
      : Engine.step(sim.state, observation);
    rebuildField();
    if (result.frame.projection_triggered) {
      const event = result.events.find((item: any) => item.kind === "projection");
      const message = `Basin projection registered at tick ${result.frame.step}, attractor region ${event ? event.basinLabel : "unknown"}.`;
      get().announce(message);
      get().toastMessage(message);
    }
    set((s) => ({ rev: s.rev + 1 }));
    return result;
  },
  resetEngine: () => {
    const ui = get();
    const seed = ui.seed;
    try {
      sim.state = Engine.createState(cloneConfig(seed, ui));
      sim.peerState = ui.peerEnabled
        ? Engine.createState({
            config: cloneConfig((seed + 1) >>> 0, ui),
            observerId: "observer-b",
          })
        : null;
      sim.currentForcing = null;
      sim.selectedEvent = null;
      rebuildField();
      set((s) => ({
        running: false,
        selectedPoint: null,
        toast: `Reset with seed ${seed}.`,
        rev: s.rev + 1,
      }));
    } catch (error) {
      set({ toast: error instanceof Error ? error.message : "Reset failed." });
    }
  },
  loadDemo: () => {
    sim.state = createPublishedDemo();
    sim.peerState = null;
    sim.currentForcing = null;
    sim.selectedEvent = null;
    rebuildField();
    set((s) => ({
      running: false,
      peerEnabled: false,
      seed: 12062026,
      stimulusMode: sim.state.context.stimulusMode,
      amplitude: sim.state.context.stimulusAmplitude,
      selectedBasin: sim.state.context.selectedBasin,
      coupling: sim.state.config.couplingStrength,
      mechanisms: uiMechanismsFromState(sim.state),
      selectedPoint: null,
      toast: "Loaded the pinned deterministic 96-tick demonstration run.",
      rev: s.rev + 1,
    }));
  },
  inscribe: () => {
    try {
      const ui = get();
      const result = Engine.inscribeMemory(sim.state, ui.memoryLabel, ui.memoryWeight);
      if (!result.memory) {
        get().toastMessage("Memory writing is currently ablated.");
        return;
      }
      rebuildField();
      set((s) => ({
        toast: `Recorded "${result.memory.label}" as a local memory artifact.`,
        rev: s.rev + 1,
      }));
    } catch (error) {
      get().toastMessage(error instanceof Error ? error.message : "Inscribe failed.");
    }
  },
  recall: () => {
    const packet = Engine.queueRecall(sim.state, get().memoryLabel);
    rebuildField();
    set((s) => ({
      toast: packet
        ? `Memory replay queued "${packet.label}" at similarity ${packet.similarity.toFixed(3)}.`
        : "No eligible memory replay Memory influence packet.",
      rev: s.rev + 1,
    }));
  },
  requestProjection: () => {
    Engine.requestProjection(sim.state);
    get().toastMessage("Basin projection requested. The next state-transition tick Step will assess and, if eligible, register it.");
  },
  pickPoint: (point, _sample) => {
    const latent = Projection.viewportToLatent(
      sim.projection,
      point.x,
      point.y,
      sim.state.config.radialLimit,
    );
    sim.currentForcing = {
      latent,
      label: `viewport(${point.x.toFixed(2)},${point.y.toFixed(2)})`,
    };
    sim.dirty = true;
    set((s) => ({ selectedPoint: point, rev: s.rev + 1 }));
  },
  selectEvent: (event) => {
    sim.selectedEvent = event;
    set((s) => ({ featureId: "event-markers", rev: s.rev + 1 }));
  },
  exportReplay: () => {
    const replay = Engine.serialize(sim.state, {
      projection: {
        ...Projection.projectionRecord(sim.projection, sim.state.currentState.latent),
        seed: sim.projection.seed,
        matrix3: sim.projection.matrix3,
        anchor: sim.projection.anchor,
      },
      field: {
        spec: sim.field.spec,
        gridSpecHash: sim.field.gridSpecHash,
        dataHash: sim.field.dataHash,
      },
      provenance: Object.values(sim.catalog),
      viewport: {
        view: get().view,
        scalarMode: get().scalarMode,
        layers: get().layers,
      },
      ensemble: sim.peerState
        ? {
            peerState: Engine.serialize(sim.peerState).state,
            couplingStrength: get().coupling,
            policy: "frozen snapshot; symmetric double-buffered input",
          }
        : null,
    });
    downloadFile(
      `memory-weather-${sim.state.runId}-t${sim.state.context.step}.json`,
      "application/json",
      `${JSON.stringify(replay, null, 2)}\n`,
    );
    get().toastMessage("Replay JSON exported.");
  },
  exportCsv: () => {
    const columns = [
      "run_id",
      "observer_id",
      "step",
      "phase",
      "coherenceScore",
      "input_strength",
      "update_magnitude",
      "smoothing_confidence",
      "entropy",
      "drift",
      "stable",
      "projection_triggered",
      "state_hash",
      "tags",
    ];
    const lines = [columns.join(",")];
    for (const frame of sim.state.frames) {
      lines.push(
        columns
          .map((column) => csvEscape(column === "tags" ? frame.tags.join("|") : frame[column]))
          .join(","),
      );
    }
    downloadFile(
      `memory-weather-${sim.state.runId}-telemetry.csv`,
      "text/csv",
      `${lines.join("\n")}\n`,
    );
    get().toastMessage("Telemetry CSV exported.");
  },
  importReplay: async (file) => {
    if (file.size > 10 * 1024 * 1024) throw new RangeError("Replay exceeds the 10 MiB local import limit.");
    const text = await file.text();
    const replay = JSON.parse(text);
    const nextState = Engine.hydrate(replay);
    let nextProjection = Projection.createProjection();
    if (replay.projection) {
      nextProjection = Projection.createProjection({
        seed: replay.projection.seed,
        matrix3: replay.projection.matrix3,
        anchor: replay.projection.anchor,
      });
      if (
        replay.projection.matrix_hash &&
        replay.projection.matrix_hash !== nextProjection.matrixHash
      ) {
        throw new Error("projection hash mismatch");
      }
    }
    sim.state = nextState;
    sim.peerState =
      replay.ensemble && replay.ensemble.peerState
        ? Engine.hydrate({ schemaVersion: Engine.SCHEMA_VERSION, state: replay.ensemble.peerState })
        : null;
    sim.projection = nextProjection;
    sim.currentForcing = sim.state.context.forcingVector
      ? { latent: [...sim.state.context.forcingVector], label: sim.state.context.forcingLabel || "imported" }
      : null;
    sim.selectedEvent = null;
    rebuildField();
    const mechanisms = { ...get().mechanisms, ...sim.state.config.mechanisms };
    set((s) => ({
      running: false,
      seed: sim.state.config.seed,
      stimulusMode: sim.state.context.stimulusMode,
      amplitude: sim.state.context.stimulusAmplitude,
      selectedBasin: sim.state.context.selectedBasin,
      peerEnabled: Boolean(sim.peerState),
      coupling:
        replay.ensemble && Number.isFinite(replay.ensemble.couplingStrength)
          ? Number(replay.ensemble.couplingStrength)
          : s.coupling,
      mechanisms,
      toast: `Imported ${sim.state.runId} at tick ${sim.state.context.step}.`,
      rev: s.rev + 1,
    }));
  },
}));

export function latestFrame() {
  return sim.state.frames[sim.state.frames.length - 1] || null;
}

export function shortHash(hash: string | null | undefined) {
  if (!hash) return " - ";
  return hash.replace("mw-fnv64:", "").slice(-10);
}

export function format(value: number, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : " - ";
}

export function rebuildSimField() {
  rebuildField();
  useLab.getState().bump();
}

export { Engine, Field, Projection };
