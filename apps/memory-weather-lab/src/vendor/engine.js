// @ts-nocheck
/* ESM wrapper around apps/memory-weather/src/engine.js. Factory body is copied from the sibling file. */
import M from "./math.js";
const api = (function (M) {
  "use strict";

  const DIMENSION = 12;
  const ENGINE_ID = "state-dynamics-memory-weather/mw-r12";
  const ENGINE_VERSION = "0.1.1";
  const SCHEMA_VERSION = "memory-weather-replay/v2";
  const ZERO = Object.freeze(Array(DIMENSION).fill(0));

  const BASIN_SOURCE = [
    [1.0, 0.7, 0.2, -0.1, 0.4, -0.2, 0.8, 0.1, -0.3, 0.5, 0.2, -0.4],
    [-0.3, 1.0, 0.5, 0.4, -0.6, 0.1, -0.2, 0.8, 0.2, -0.5, 0.3, 0.6],
    [0.2, -0.4, 1.0, 0.6, 0.1, 0.7, -0.5, -0.2, 0.8, 0.2, -0.6, 0.1],
    [-0.8, 0.1, -0.2, 1.0, 0.5, -0.4, 0.3, -0.6, 0.1, 0.7, 0.4, -0.2],
    [0.6, -0.5, 0.3, -0.2, 1.0, 0.4, 0.1, 0.7, -0.6, 0.2, 0.5, -0.3],
    [-0.2, 0.6, -0.7, 0.3, -0.1, 1.0, 0.5, 0.2, 0.4, -0.6, 0.1, 0.8]
  ];
  const BASIN_LABELS = ["Basin 1", "Basin 2", "Basin 3", "Basin 4", "Basin 5", "Basin 6"];
  const BASINS = Object.freeze(BASIN_SOURCE.map((latent, id) => Object.freeze({
    id,
    label: BASIN_LABELS[id],
    latent: Object.freeze(M.normalize(latent, 1.55))
  })));

  const DEFAULT_CONFIG = Object.freeze({
    seed: 12062026,
    dimension: DIMENSION,
    componentLimit: 2,
    radialLimit: 2,
    smoothingRate: 0.1,
    updateScale: 0.92,
    updateLimit: 1.4,
    coherenceEma: 0.24,
    projectionThreshold: 0.78,
    projectionDwell: 2,
    projectionHold: 6,
    projectionMix: 0.82,
    summaryInterval: 12,
    memoryCapacity: 48,
    traceCap: 720,
    frameCap: 720,
    eventCap: 360,
    noiseAmplitude: 0.055,
    memoryBias: 0.18,
    recallThreshold: 0.15,
    couplingStrength: 0.14,
    stimulusMode: "periodic",
    stimulusAmplitude: 0.82,
    selectedBasin: 1,
    mechanisms: Object.freeze({
      projection: true,
      memoryWrite: true,
      memoryReplay: true,
      summaries: true,
      noise: true,
      coherenceGate: true,
      smoothing: true,
      coupling: true
    })
  });

  const NUMERIC_RANGES = {
    componentLimit: [0.1, 20],
    radialLimit: [0.1, 20],
    smoothingRate: [0, 1],
    updateScale: [0, 10],
    updateLimit: [0.01, 20],
    coherenceEma: [0, 1],
    projectionThreshold: [0, 1],
    projectionMix: [0, 1],
    noiseAmplitude: [0, 1],
    memoryBias: [0, 2],
    recallThreshold: [-1, 1],
    couplingStrength: [0, 1],
    stimulusAmplitude: [0, 4]
  };
  const INTEGER_RANGES = {
    projectionDwell: [1, 1000],
    projectionHold: [0, 10000],
    summaryInterval: [1, 10000],
    memoryCapacity: [1, 10000],
    traceCap: [24, 100000],
    frameCap: [24, 100000],
    eventCap: [24, 100000],
    selectedBasin: [0, BASINS.length - 1]
  };
  const STIMULUS_MODES = new Set(["quiet", "align", "disrupt", "pulse", "periodic", "basin"]);

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createConfig(overrides = {}) {
    const config = {
      ...clone(DEFAULT_CONFIG),
      ...clone(overrides),
      mechanisms: { ...DEFAULT_CONFIG.mechanisms, ...(overrides.mechanisms || {}) }
    };
    if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff) {
      throw new RangeError("seed must be an unsigned 32-bit integer");
    }
    if (config.dimension !== DIMENSION) throw new RangeError(`dimension must remain ${DIMENSION}`);
    for (const [key, [lo, hi]] of Object.entries(NUMERIC_RANGES)) {
      const value = M.assertFinite(config[key], key);
      if (value < lo || value > hi) throw new RangeError(`${key} must be in [${lo}, ${hi}]`);
    }
    for (const [key, [lo, hi]] of Object.entries(INTEGER_RANGES)) {
      const value = config[key];
      if (!Number.isInteger(value) || value < lo || value > hi) {
        throw new RangeError(`${key} must be an integer in [${lo}, ${hi}]`);
      }
    }
    if (!STIMULUS_MODES.has(config.stimulusMode)) throw new RangeError("unsupported stimulusMode");
    for (const [key, value] of Object.entries(config.mechanisms)) {
      if (typeof value !== "boolean") throw new TypeError(`mechanisms.${key} must be boolean`);
    }
    return config;
  }

  function runIdFor(config, observerId = "observer-a") {
    const digest = M.contentHash({ seed: config.seed, observerId, engine: ENGINE_VERSION }).split(":")[1];
    return `mw-${digest.slice(0, 10)}`;
  }

  function initialLatent(config, observerId) {
    const observerOffset = M.fnv1a32(observerId);
    const vector = Array.from({ length: DIMENSION }, (_, i) =>
      0.18 * M.keyedGaussian(config.seed ^ observerOffset, "initial-state", 0, i)
    );
    return M.boundVector(vector, config.componentLimit, Math.min(0.72, config.radialLimit));
  }

  function stateHash(currentState) {
    return M.contentHash({
      id: currentState.id,
      t: currentState.t,
      latent: currentState.latent,
      coherence: currentState.coherence,
      inputStrength: currentState.inputStrength,
      basinId: currentState.basinId == null ? null : currentState.basinId
    });
  }

  function createState(overrides = {}) {
    const config = createConfig(overrides.config || overrides);
    const observerId = overrides.observerId || "observer-a";
    const latent = initialLatent(config, observerId);
    const runId = runIdFor(config, observerId);
    const currentState = {
      id: `${observerId}:0`,
      observerId,
      t: 0,
      latent,
      coherence: 0.42,
      inputStrength: 0,
      basinId: null
    };
    return {
      schemaVersion: SCHEMA_VERSION,
      engineId: ENGINE_ID,
      engineVersion: ENGINE_VERSION,
      runId,
      config,
      currentState,
      smoothedState: latent.map((value) => value * 0.88),
      lastSmoothed: null,
      lastUpdate: { vec: [...ZERO], magnitude: 0, basis: "bounded-input-difference" },
      lastInput: { fieldId: "initial", data: [...ZERO], timestamp: 0, energy: 0, noise: null, recall: null },
      context: {
        step: 0,
        phase: 0,
        projectionDwellCount: 0,
        holdRemaining: 0,
        forceProjection: false,
        forcingVector: null,
        forcingLabel: null,
        couplingVector: null,
        couplingSourceHash: null,
        pendingRecall: null,
        recallQuery: "",
        selectedBasin: config.selectedBasin,
        stimulusMode: config.stimulusMode,
        stimulusAmplitude: config.stimulusAmplitude
      },
      frames: [],
      trace: [],
      events: [],
      memorySummaries: [],
      memories: [],
      counters: {
        projection: 0,
        summaries: 0,
        memoryWrites: 0,
        recallApplied: 0,
        recallEligible: 0,
        wouldProject: 0
      },
      currentHash: stateHash(currentState)
    };
  }

  function appendBounded(target, value, cap) {
    target.push(value);
    if (target.length > cap) target.splice(0, target.length - cap);
  }

  function nearestBasin(latent) {
    let best = BASINS[0];
    let bestDistance = Infinity;
    for (const basin of BASINS) {
      const distance = M.distance(latent, basin.latent);
      if (distance < bestDistance) {
        best = basin;
        bestDistance = distance;
      }
    }
    return { basin: best, distance: bestDistance };
  }

  function sampleAdaptiveNoise(state) {
    const enabled = state.config.mechanisms.noise;
    const lastFrame = state.frames[state.frames.length - 1];
    const stuckBoost = lastFrame && lastFrame.coherenceScore > 0.84 && lastFrame.drift < 0.012 ? 1.55 : 1;
    const amp = enabled ? state.config.noiseAmplitude * stuckBoost : 0;
    const vec = Array.from({ length: DIMENSION }, (_, i) =>
      amp * M.keyedGaussian(state.config.seed, `${state.currentState.observerId}:omega`, state.context.step, i)
    );
    return {
      enabled,
      stream: `${state.currentState.observerId}:omega`,
      seed: state.config.seed,
      step: state.context.step,
      amp,
      kind: enabled ? (stuckBoost > 1 ? "stuck-boost" : "bounded-gaussian") : "ablated-zero",
      vec
    };
  }

  function updateSmoothedState(state) {
    const beta = state.config.mechanisms.smoothing ? state.config.smoothingRate : 0;
    const proposedSmoothedState = M.boundVector(
      M.mix(state.smoothedState, state.currentState.latent, beta),
      state.config.componentLimit,
      state.config.radialLimit
    );
    return {
      latent: [...proposedSmoothedState],
      smoothedState: [...proposedSmoothedState],
      proposedSmoothedState,
      confidence: Math.exp(-M.distance(state.currentState.latent, proposedSmoothedState)),
      basis: "StateSmoothedR12"
    };
  }

  function stimulusVector(state) {
    const { seed } = state.config;
    const { step, stimulusMode: mode, stimulusAmplitude: amplitude } = state.context;
    if (state.context.forcingVector) return M.scale(state.context.forcingVector, amplitude);
    if (mode === "quiet") return [...ZERO];
    if (mode === "align") {
      const target = nearestBasin(state.currentState.latent).basin.latent;
      return M.scale(target, amplitude);
    }
    if (mode === "basin") return M.scale(BASINS[state.context.selectedBasin].latent, amplitude);
    if (mode === "disrupt") {
      return M.normalize(Array.from({ length: DIMENSION }, (_, i) =>
        M.keyedGaussian(seed, `${state.currentState.observerId}:disrupt`, step, i)
      ), amplitude);
    }
    if (mode === "pulse") {
      const out = Array(DIMENSION).fill(0);
      const axis = Math.floor(step / 18) % DIMENSION;
      out[axis] = amplitude * (Math.sin(step * 0.33) >= 0 ? 1 : -1);
      out[(axis + 5) % DIMENSION] = 0.35 * amplitude * Math.cos(step * 0.21);
      return out;
    }
    return Array.from({ length: DIMENSION }, (_, i) =>
      amplitude * (0.54 * Math.sin(step * 0.071 + i * 0.63) + 0.24 * Math.cos(step * 0.043 - i * 0.37))
    );
  }

  function sampleInput(state, noise) {
    const base = stimulusVector(state);
    const recall = state.config.mechanisms.memoryReplay ? state.context.pendingRecall : null;
    const recallBias = recall ? M.scale(recall.latent, state.config.memoryBias * recall.similarity) : [...ZERO];
    const coupling = state.config.mechanisms.coupling && state.context.couplingVector ? state.context.couplingVector : ZERO;
    const data = M.boundVector(
      M.add(M.add(M.add(base, noise.vec), recallBias), coupling),
      state.config.componentLimit,
      state.config.radialLimit
    );
    const energy = M.norm(data);
    return {
      fieldId: `${state.runId}:phi:${state.context.step}`,
      data,
      timestamp: state.context.step,
      energy,
      source: state.context.forcingVector ? "explicit-projected-forcing" : `preset:${state.context.stimulusMode}`,
      noise,
      recall: recall ? {
        packetId: recall.packetId,
        memoryId: recall.memoryId,
        similarity: recall.similarity,
        applied: true
      } : null,
      coupling: state.config.mechanisms.coupling && state.context.couplingVector ? {
        sourceHash: state.context.couplingSourceHash,
        magnitude: M.norm(state.context.couplingVector),
        applied: true,
        classification: "DEVELOP multi-observer coupling"
      } : null
    };
  }

  function computeStateUpdate(state, input) {
    const gate = state.config.mechanisms.coherenceGate ? 0.2 + 0.8 * state.currentState.coherence : 0.6;
    let vec = M.scale(M.sub(input.data, state.currentState.latent), state.config.updateScale * gate);
    const magnitude = M.norm(vec);
    if (magnitude > state.config.updateLimit) vec = M.scale(vec, state.config.updateLimit / magnitude);
    return {
      vec,
      magnitude: M.norm(vec),
      basis: "bounded-input-difference",
      proxy: "Phi.data - SimulationState.latent",
      coherenceGate: gate
    };
  }

  // Declared combine implementation: external typed fusion is implemented only through
  // rep, repG, mergeR, decode, and extractCombinedState. Arithmetic occurs inside mergeR.
  function representSmoothedState(smoothed) {
    return { kind: "FusionCarrierR12/smoothed", vec: [...smoothed.latent] };
  }

  function representUpdate(update) {
    return { kind: "FusionCarrierR12/computeStateUpdate", vec: [...update.vec] };
  }

  function mergeR(smoothedCarrier, updateCarrier, coherenceScore) {
    const mix = M.clamp(0.35 + 0.5 * coherenceScore, 0.2, 0.9);
    const gate = M.clamp(0.15 + 0.7 * (1 - 0.45 * coherenceScore), 0.1, 1);
    return {
      kind: "FusionCarrierR12/merged",
      vec: smoothedCarrier.vec.map((value, i) => value + gate * (1 - mix) * updateCarrier.vec[i]),
      mix,
      gate
    };
  }

  function decode(merged, state, input) {
    const raw = merged.vec;
    const latent = M.boundVector(raw, state.config.componentLimit, state.config.radialLimit);
    return {
      currentState: {
        id: `${state.currentState.observerId}:${state.context.step + 1}`,
        observerId: state.currentState.observerId,
        t: state.context.step + 1,
        latent,
        coherence: state.currentState.coherence,
        inputStrength: input.energy,
        basinId: state.currentState.basinId
      },
      mix: merged.mix,
      gate: merged.gate,
      clamped: M.distance(raw, latent) > 1e-10
    };
  }

  // decode returns the implementation-local CombinedState record. This explicit projection
  // is the final CombinedState -> State_sim leg of the environment-indexed factorization.
  function extractCombinedState(fusion) {
    if (!fusion || !fusion.currentState || !Array.isArray(fusion.currentState.latent)) {
      throw new TypeError("extractCombinedState expects a CombinedState record with currentState");
    }
    return fusion.currentState;
  }

  function combineStateAndUpdate(state, smoothed, update, input) {
    return decode(mergeR(representSmoothedState(smoothed), representUpdate(update), state.currentState.coherence), state, input);
  }

  function coherenceOf(state, candidate, input, update) {
    const alignment = (M.cosine(candidate.latent, input.data) + 1) / 2;
    const calm = Math.exp(-0.7 * input.energy);
    const focus = Math.exp(-0.9 * update.magnitude);
    const raw = 0.5 * alignment + 0.25 * calm + 0.15 * focus + 0.1 * state.currentState.coherence;
    return M.clamp((1 - state.config.coherenceEma) * state.currentState.coherence + state.config.coherenceEma * raw, 0, 1);
  }

  function shouldProjectToBasin(state, assessment, forced) {
    if (
      !assessment ||
      assessment.run_id !== state.runId ||
      assessment.observer_id !== state.currentState.observerId ||
      assessment.step !== state.context.step ||
      assessment.phase !== state.context.phase
    ) {
      throw new TypeError("shouldProjectToBasin expects the current StateMeta assessment");
    }
    const coherenceScore = M.assertFinite(assessment.coherenceScore, "assessment.coherenceScore");
    const wouldTrigger = forced || coherenceScore >= state.config.projectionThreshold;
    let dwell = wouldTrigger ? state.context.projectionDwellCount + 1 : 0;
    if (forced) dwell = state.config.projectionDwell;
    const eligible = state.context.holdRemaining === 0 && dwell >= state.config.projectionDwell;
    return {
      wouldTrigger,
      eligible,
      triggered: state.config.mechanisms.projection && eligible,
      dwell,
      holdRemaining: state.context.holdRemaining,
      reason: forced ? "manual-request" : "coherenceScore-dwell"
    };
  }

  function projectTowardBasin(state, candidate, coherenceScore, reason) {
    const preHash = stateHash(candidate);
    const nearest = nearestBasin(candidate.latent);
    const beforeEnergy = M.norm(candidate.latent);
    const latent = M.boundVector(
      M.mix(candidate.latent, nearest.basin.latent, state.config.projectionMix),
      state.config.componentLimit,
      state.config.radialLimit
    );
    const currentState = { ...candidate, latent, basinId: nearest.basin.id };
    const postHash = stateHash(currentState);
    const event = {
      eventId: `${state.runId}:projection:${state.context.step}:${state.counters.projection}`,
      kind: "projection",
      operator: "Basin projection",
      step: state.context.step,
      reason,
      preHash,
      postHash,
      energyDrop: beforeEnergy - M.norm(latent),
      basinId: nearest.basin.id,
      basinLabel: nearest.basin.label,
      coherenceScore,
      sourceStatus: "direct-event"
    };
    return { currentState, event };
  }

  function makeDiagnosticFrame(state, smoothed, input, update, fusion, coherenceScore) {
    const candidateState = extractCombinedState(fusion);
    const drift = M.distance(candidateState.latent, state.currentState.latent);
    const updateDrift = M.distance(update.vec, state.lastUpdate.vec);
    return {
      run_id: state.runId,
      observer_id: state.currentState.observerId,
      step: state.context.step,
      phase: state.context.phase,
      coherenceScore,
      input_strength: input.energy,
      update_magnitude: update.magnitude,
      smoothing_confidence: smoothed.confidence,
      entropy: M.entropyProxy(candidateState.latent),
      drift,
      stable: drift < 0.025 && update.magnitude < 0.08,
      tags: ["tick", `phase:${state.context.phase}`],
      scalars: {
        updateDrift,
        mix: fusion.mix,
        gate: fusion.gate,
        noiseAmplitude: input.noise.amp,
        recallSimilarity: input.recall ? input.recall.similarity : 0,
        couplingMagnitude: input.coupling ? input.coupling.magnitude : 0
      },
      state_hash_pre_projection: stateHash({ ...candidateState, coherence: coherenceScore }),
      sourceStatus: "direct-telemetry"
    };
  }

  function finalizeDiagnosticFrame(frame, predicate) {
    frame.projection_would_trigger = predicate.wouldTrigger;
    frame.projection_eligible = predicate.eligible;
    frame.projection_triggered = predicate.triggered;
    frame.projection_reason = predicate.reason;
    frame.scalars.dwell = predicate.dwell;
    frame.scalars.holdRemaining = predicate.holdRemaining;
    if (predicate.triggered) frame.tags.push("projection");
    return frame;
  }

  function storeHistorySummary(state) {
    const window = state.trace.slice(-state.config.summaryInterval);
    if (!window.length) return null;
    const latent = M.boundVector(
      M.mean(window.map((frame) => frame.latent), DIMENSION),
      state.config.componentLimit,
      state.config.radialLimit
    );
    const node = {
      nodeId: `${state.runId}:memorySummaries:${state.counters.summaries}`,
      operator: "History summary",
      createdStep: state.context.step,
      sourceSteps: [window[0].step, window[window.length - 1].step],
      latent,
      weight: window.reduce((sum, frame) => sum + frame.coherenceScore, 0) / window.length,
      sourceHash: M.contentHash(window.map((frame) => frame.stateHash)),
      sourceStatus: "direct-artifact"
    };
    state.counters.summaries += 1;
    appendBounded(state.memorySummaries, node, state.config.memoryCapacity);
    return node;
  }

  function recallCandidates(state) {
    const memory = state.memories.map((item) => ({
      memoryId: item.memoryId,
      label: item.label,
      latent: item.latent,
      weight: item.weight,
      kind: "inscription"
    }));
    const memorySummaries = state.memorySummaries.map((item) => ({
      memoryId: item.nodeId,
      label: `History summary ${item.sourceSteps[0]}-${item.sourceSteps[1]}`,
      latent: item.latent,
      weight: item.weight,
      kind: "memorySummaries"
    }));
    return memory.concat(memorySummaries);
  }

  function selectRecall(state) {
    if (!state.config.mechanisms.memoryReplay) return null;
    const candidates = recallCandidates(state);
    if (!candidates.length) return null;
    const query = state.context.recallQuery
      ? M.textVector(state.context.recallQuery, DIMENSION, 1.2)
      : state.currentState.latent;
    let best = null;
    for (const candidate of candidates) {
      const similarity = M.cosine(query, candidate.latent);
      if (!best || similarity > best.similarity) best = { ...candidate, similarity };
    }
    if (!best || best.similarity < state.config.recallThreshold) return null;
    state.counters.recallEligible += 1;
    return {
      packetId: `${state.runId}:recall:${state.context.step}:${best.memoryId}`,
      operator: "Memory influence",
      memoryId: best.memoryId,
      label: best.label,
      kind: best.kind,
      similarity: best.similarity,
      latent: [...best.latent],
      query: state.context.recallQuery || null,
      appliesAtStep: state.context.step + 1,
      sourceStatus: "direct-artifact"
    };
  }

  function weatherClass(frame) {
    if (!frame) return { id: "initial", label: "Unformed field", rationale: "No committed tick yet" };
    if (frame.projection_triggered) return { id: "projection-clearing", label: "Projection clearing", rationale: "Basin projection event committed this tick" };
    if (frame.coherenceScore >= 0.72 && frame.update_magnitude < 0.18) return { id: "stable-high", label: "Stable high", rationale: "High Coherence with low Update magnitude" };
    if (frame.input_strength > 1.15 && frame.update_magnitude > 0.42) return { id: "shear-front", label: "Shear front", rationale: "High Input energy and Update magnitude" };
    if (frame.projection_would_trigger) return { id: "projection-watch", label: "Projection watch", rationale: "Readiness predicate is active" };
    if (frame.scalars.recallSimilarity > 0) return { id: "memory-front", label: "Memory front", rationale: "Applied Memory influence packet contributes to Input" };
    return { id: "variable", label: "Variable field", rationale: "No specialized deterministic rule matched" };
  }

  function addEvent(state, event) {
    appendBounded(state.events, event, state.config.eventCap);
  }

  function step(state, observation = {}) {
    validateStateShape(state);
    if (observation.stimulusMode != null) {
      if (!STIMULUS_MODES.has(observation.stimulusMode)) throw new RangeError("unsupported stimulusMode");
      state.context.stimulusMode = observation.stimulusMode;
    }
    if (observation.stimulusAmplitude != null) {
      const value = M.assertFinite(observation.stimulusAmplitude, "stimulusAmplitude");
      state.context.stimulusAmplitude = M.clamp(value, 0, 4);
    }
    if (observation.selectedBasin != null) {
      if (!Number.isInteger(observation.selectedBasin) || observation.selectedBasin < 0 || observation.selectedBasin >= BASINS.length) {
        throw new RangeError("selectedBasin is invalid");
      }
      state.context.selectedBasin = observation.selectedBasin;
    }
    if (observation.forcingVector !== undefined) {
      state.context.forcingVector = observation.forcingVector == null
        ? null
        : [...M.assertVec(observation.forcingVector, DIMENSION, "forcingVector")];
      state.context.forcingLabel = observation.forcingLabel || null;
    }
    if (observation.couplingVector !== undefined) {
      state.context.couplingVector = observation.couplingVector == null
        ? null
        : [...M.assertVec(observation.couplingVector, DIMENSION, "couplingVector")];
      state.context.couplingSourceHash = observation.couplingSourceHash || null;
    }

    const previousBasinId = state.currentState.basinId;
    const forced = state.context.forceProjection;
    state.context.forceProjection = false;
    const noise = sampleAdaptiveNoise(state);
    const smoothed = updateSmoothedState(state);
    const input = sampleInput(state, noise);
    const update = computeStateUpdate(state, input);
    const fusion = combineStateAndUpdate(state, smoothed, update, input);
    const candidateState = extractCombinedState(fusion);
    const coherenceScore = coherenceOf(state, candidateState, input, update);
    candidateState.coherence = coherenceScore;
    const frame = makeDiagnosticFrame(state, smoothed, input, update, fusion, coherenceScore);
    const predicate = shouldProjectToBasin(state, frame, forced);
    finalizeDiagnosticFrame(frame, predicate);
    const tickEvents = [];
    let committedState = candidateState;

    if (predicate.wouldTrigger) state.counters.wouldProject += 1;
    if (predicate.triggered) {
      const result = projectTowardBasin(state, candidateState, coherenceScore, predicate.reason);
      committedState = result.currentState;
      tickEvents.push(result.event);
      state.counters.projection += 1;
      state.context.holdRemaining = state.config.projectionHold;
      state.context.projectionDwellCount = 0;
    } else {
      state.context.projectionDwellCount = predicate.dwell;
      state.context.holdRemaining = Math.max(0, state.context.holdRemaining - 1);
    }

    state.currentState = committedState;
    state.smoothedState = [...smoothed.proposedSmoothedState];
    state.lastSmoothed = smoothed;
    state.lastUpdate = update;
    state.lastInput = input;
    state.currentHash = stateHash(state.currentState);
    frame.state_hash = state.currentHash;
    frame.weather = weatherClass(frame);
    frame.applied_recall = input.recall;
    appendBounded(state.frames, frame, state.config.frameCap);
    appendBounded(state.trace, {
      step: frame.step,
      phase: frame.phase,
      latent: [...state.currentState.latent],
      smoothedLatent: [...smoothed.latent],
      update: [...update.vec],
      input: [...input.data],
      coherenceScore,
      stateHash: state.currentHash,
      projection: frame.projection_triggered,
      basinId: state.currentState.basinId,
      recallPacketId: input.recall ? input.recall.packetId : null
    }, state.config.traceCap);

    if (input.recall) state.counters.recallApplied += 1;
    if (state.config.mechanisms.summaries && (state.context.step + 1) % state.config.summaryInterval === 0) {
      const node = storeHistorySummary(state);
      if (node) tickEvents.push({
        eventId: `${state.runId}:summary:${state.context.step}:${node.nodeId}`,
        kind: "summary",
        operator: "History summary",
        step: state.context.step,
        nodeId: node.nodeId,
        sourceHash: node.sourceHash,
        sourceStatus: "direct-event"
      });
    }

    state.context.pendingRecall = selectRecall(state);
    if (state.currentState.basinId != null && state.currentState.basinId !== previousBasinId) {
      tickEvents.push({
        eventId: `${state.runId}:basin:${state.context.step}:${state.currentState.basinId}`,
        kind: "basin-transition",
        step: state.context.step,
        fromBasinId: previousBasinId,
        toBasinId: state.currentState.basinId,
        toBasinLabel: BASINS[state.currentState.basinId].label,
        sourceHash: state.currentHash,
        sourceStatus: "direct-event"
      });
    }
    for (const event of tickEvents) addEvent(state, event);
    state.context.phase = (state.context.phase + 1) % 8;
    state.context.step += 1;
    return { state, nextState: state.currentState, frame, events: tickEvents };
  }

  function inscribeMemory(state, label, weight = 1) {
    validateStateShape(state);
    const cleanLabel = String(label || "").trim().slice(0, 120);
    if (!cleanLabel) throw new RangeError("memory label cannot be empty");
    const cleanWeight = M.clamp(M.assertFinite(Number(weight), "memory weight"), 0.1, 2);
    if (!state.config.mechanisms.memoryWrite) {
      return { state, memory: null, event: null, status: "ablated" };
    }
    const encoded = M.textVector(cleanLabel, DIMENSION, 1.2);
    const latent = M.boundVector(M.mix(state.currentState.latent, encoded, 0.35), state.config.componentLimit, state.config.radialLimit);
    const memory = {
      memoryId: `${state.runId}:memory:${state.counters.memoryWrites}`,
      label: cleanLabel,
      latent,
      weight: cleanWeight,
      createdStep: state.context.step,
      sourceStateHash: state.currentHash,
      encoder: "fnv1a32-keyed-r12/v1",
      sourceStatus: "implementation-local-artifact"
    };
    const event = {
      eventId: `${state.runId}:memory-write:${state.context.step}:${state.counters.memoryWrites}`,
      kind: "memory-write",
      step: state.context.step,
      memoryId: memory.memoryId,
      label: cleanLabel,
      sourceStateHash: state.currentHash,
      sourceStatus: "direct-event",
      note: "Manual inscription is a implementation-local action; it is not an alias for History summary."
    };
    state.counters.memoryWrites += 1;
    state.memories.push(memory);
    addEvent(state, event);
    return { state, memory, event, status: "written" };
  }

  function queueRecall(state, query) {
    validateStateShape(state);
    state.context.recallQuery = String(query || "").trim().slice(0, 120);
    state.context.pendingRecall = selectRecall(state);
    return state.context.pendingRecall;
  }

  function requestProjection(state) {
    validateStateShape(state);
    state.context.forceProjection = true;
  }

  function setMechanism(state, key, enabled) {
    if (!(key in state.config.mechanisms)) throw new RangeError(`unknown ablation: ${key}`);
    state.config.mechanisms[key] = Boolean(enabled);
    if (key === "memoryReplay" && !enabled) state.context.pendingRecall = null;
  }

  function serialize(state, extra = {}) {
    validateStateShape(state);
    return {
      schemaVersion: SCHEMA_VERSION,
      engine: { id: ENGINE_ID, version: ENGINE_VERSION },
      exportedAt: null,
      determinism: {
        seed: state.config.seed,
        quantizationDigits: 8,
        stateHashAlgorithm: "FNV-1a-64 over canonical quantized JSON",
        hashVersion: "memory-weather-state/v2",
        currentStateHash: state.currentHash,
        configHash: M.contentHash(state.config)
      },
      state: clone(state),
      ...clone(extra)
    };
  }

  function hydrate(replay) {
    if (!replay || replay.schemaVersion !== SCHEMA_VERSION || !replay.state) {
      throw new TypeError(`expected ${SCHEMA_VERSION} replay`);
    }
    const incoming = clone(replay.state);
    incoming.config = createConfig(incoming.config);
    validateStateShape(incoming);
    const actualHash = stateHash(incoming.currentState);
    if (incoming.currentHash !== actualHash) throw new Error("replay current currentState hash mismatch");
    return incoming;
  }

  function validateStateShape(state) {
    if (!state || state.schemaVersion !== SCHEMA_VERSION) throw new TypeError("invalid runtime state schema");
    if (state.engineId !== ENGINE_ID || state.engineVersion !== ENGINE_VERSION) throw new TypeError("runtime engine identity mismatch");
    const assertLatent = (vector, label) => {
      M.assertVec(vector, DIMENSION, label);
      if (vector.some((value) => Math.abs(value) > state.config.componentLimit + 1e-8)) throw new RangeError(`${label} exceeds component bounds`);
      if (M.norm(vector) > state.config.radialLimit + 1e-8) throw new RangeError(`${label} exceeds radial bounds`);
    };
    assertLatent(state.currentState.latent, "currentState.latent");
    assertLatent(state.smoothedState, "smoothedState");
    if (!Number.isInteger(state.context.step) || state.context.step < 0) throw new TypeError("context.step must be a non-negative integer");
    if (!Number.isInteger(state.currentState.t) || state.currentState.t !== state.context.step) throw new TypeError("currentState.t must equal context.step");
    if (!Number.isInteger(state.context.phase) || state.context.phase < 0 || state.context.phase > 7) throw new TypeError("context.phase must be an integer in [0,7]");
    M.assertFinite(state.currentState.coherence, "currentState.coherence");
    if (state.currentState.coherence < 0 || state.currentState.coherence > 1) throw new RangeError("currentState.coherence must be in [0,1]");
    M.assertVec(state.lastUpdate.vec, DIMENSION, "lastUpdate.vec");
    M.assertVec(state.lastInput.data, DIMENSION, "lastInput.data");
    if (state.context.forcingVector) M.assertVec(state.context.forcingVector, DIMENSION, "context.forcingVector");
    if (state.context.couplingVector) M.assertVec(state.context.couplingVector, DIMENSION, "context.couplingVector");
    if (state.context.pendingRecall) M.assertVec(state.context.pendingRecall.latent, DIMENSION, "context.pendingRecall.latent");
    for (const [name, cap] of [["frames", state.config.frameCap], ["trace", state.config.traceCap], ["events", state.config.eventCap], ["memorySummaries", state.config.memoryCapacity]]) {
      if (!Array.isArray(state[name]) || state[name].length > cap) throw new RangeError(`${name} must be a bounded array`);
    }
    if (!Array.isArray(state.memories) || state.memories.length > 10000) throw new RangeError("memories must be a bounded array");
    for (const memory of state.memories) {
      assertLatent(memory.latent, `memory ${memory.memoryId || "unknown"}.latent`);
      M.assertFinite(memory.weight, "memory.weight");
    }
    for (const node of state.memorySummaries) assertLatent(node.latent, `memorySummaries ${node.nodeId || "unknown"}.latent`);
    for (const sample of state.trace) {
      assertLatent(sample.latent, "trace.latent");
      M.assertVec(sample.smoothedLatent, DIMENSION, "trace.smoothedLatent");
      M.assertVec(sample.update, DIMENSION, "trace.update");
      M.assertVec(sample.input, DIMENSION, "trace.input");
    }
    for (const frame of state.frames) {
      for (const key of ["step", "phase", "coherenceScore", "input_strength", "update_magnitude", "smoothing_confidence", "entropy", "drift"]) M.assertFinite(frame[key], `frame.${key}`);
      if (!Array.isArray(frame.tags) || !frame.tags.includes("tick")) throw new TypeError("frame.tags must contain tick");
    }
    if (!state.counters || Object.values(state.counters).some((value) => !Number.isInteger(value) || value < 0)) {
      throw new TypeError("counters must be non-negative integers");
    }
    return state;
  }

  function stateDigest(state) {
    return M.contentHash({
      currentState: state.currentState,
      smoothedState: state.smoothedState,
      context: state.context,
      memories: state.memories,
      memorySummaries: state.memorySummaries,
      counters: state.counters,
      lastUpdate: state.lastUpdate,
      lastInput: state.lastInput
    });
  }

  function stepCoupledPair(stateA, stateB, observationA = {}, observationB = {}, options = {}) {
    validateStateShape(stateA);
    validateStateShape(stateB);
    const requestedStrength = options.strength == null
      ? Math.min(stateA.config.couplingStrength, stateB.config.couplingStrength)
      : M.assertFinite(options.strength, "coupling strength");
    const enabled = options.enabled !== false && stateA.config.mechanisms.coupling && stateB.config.mechanisms.coupling;
    const strength = enabled ? M.clamp(requestedStrength, 0, 1) : 0;
    const frozenA = { latent: [...stateA.currentState.latent], hash: stateA.currentHash };
    const frozenB = { latent: [...stateB.currentState.latent], hash: stateB.currentHash };
    const couplingA = M.scale(M.sub(frozenB.latent, frozenA.latent), strength);
    const couplingB = M.scale(M.sub(frozenA.latent, frozenB.latent), strength);
    const inputA = { ...observationA, couplingVector: couplingA, couplingSourceHash: frozenB.hash };
    const inputB = { ...observationB, couplingVector: couplingB, couplingSourceHash: frozenA.hash };
    let resultA;
    let resultB;
    if (options.order === "ba") {
      resultB = step(stateB, inputB);
      resultA = step(stateA, inputA);
    } else {
      resultA = step(stateA, inputA);
      resultB = step(stateB, inputB);
    }
    return {
      observers: [stateA, stateB],
      results: [resultA, resultB],
      coupling: {
        enabled,
        strength,
        sourceHashes: [frozenA.hash, frozenB.hash],
        magnitudes: [M.norm(couplingA), M.norm(couplingB)],
        updatePolicy: "frozen snapshot; simultaneous double-buffered inputs",
        classification: "DEVELOP"
      }
    };
  }

  return {
    BASINS,
    DEFAULT_CONFIG,
    DIMENSION,
    ENGINE_ID,
    ENGINE_VERSION,
    SCHEMA_VERSION,
    coherenceOf,
    createConfig,
    createState,
    decode,
    combineStateAndUpdate,
    computeStateUpdate,
    hydrate,
    inscribeMemory,
    mergeR,
    nearestBasin,
    sampleAdaptiveNoise,
    stateHash,
    extractCombinedState,
    queueRecall,
    recallCandidates,
    representUpdate,
    representSmoothedState,
    requestProjection,
    sampleInput,
    serialize,
    setMechanism,
    stateDigest,
    step,
    stepCoupledPair,
    storeHistorySummary,
    validateStateShape,
    weatherClass
  };
}
)(M);
export default api;
