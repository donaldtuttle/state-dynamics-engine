(function (root, factory) {
  const math = typeof module === "object" && module.exports ? require("./math.js") : root.MWMath;
  const engine = typeof module === "object" && module.exports ? require("./engine.js") : root.MemoryWeatherEngine;
  const projectionApi = typeof module === "object" && module.exports ? require("./projection.js") : root.MemoryWeatherProjection;
  const api = factory(math, engine, projectionApi);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MemoryWeatherField = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (M, Engine, Projection) {
  "use strict";

  const DEFAULT_FIELD_SPEC = Object.freeze({
    size: 45,
    extent: 2.25,
    basinSigma: 0.46,
    memorySigma: 0.34,
    meshSigma: 0.52,
    observerSigma: 0.28,
    vectorCap: 2.2
  });

  function createFieldSpec(overrides = {}) {
    const spec = { ...DEFAULT_FIELD_SPEC, ...overrides };
    if (!Number.isInteger(spec.size) || spec.size < 17 || spec.size > 129) throw new RangeError("field size must be an integer in [17,129]");
    for (const key of ["extent", "basinSigma", "memorySigma", "meshSigma", "observerSigma", "vectorCap"]) {
      if (!Number.isFinite(spec[key]) || spec[key] <= 0) throw new RangeError(`${key} must be positive and finite`);
    }
    return spec;
  }

  function gaussian(dx, dy, sigma) {
    return Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
  }

  function collectAttractors(state, projection, spec) {
    const basins = Engine.BASINS.map((basin) => ({
      id: `basin:${basin.id}`,
      label: basin.label,
      kind: "basin",
      xy: Projection.project(projection, basin.latent, 2),
      latent: basin.latent,
      weight: 0.34,
      sigma: spec.basinSigma,
      sourceStatus: "implementation-local"
    }));
    const memories = state.memories.map((memory) => ({
      id: memory.memoryId,
      label: memory.label,
      kind: "memory",
      xy: Projection.project(projection, memory.latent, 2),
      latent: memory.latent,
      weight: 0.72 * memory.weight,
      sigma: spec.memorySigma,
      sourceStatus: "direct-artifact"
    }));
    const memorySummaries = state.memorySummaries.map((node) => ({
      id: node.nodeId,
      label: node.nodeId,
      kind: "memorySummaries",
      xy: Projection.project(projection, node.latent, 2),
      latent: node.latent,
      weight: 0.36 * node.weight,
      sigma: spec.meshSigma,
      sourceStatus: "direct-artifact"
    }));
    const observer = [{
      id: `observer:${state.currentState.observerId}`,
      label: "state",
      kind: "observer",
      xy: Projection.project(projection, state.currentState.latent, 2),
      latent: state.currentState.latent,
      weight: 0.48 + 0.3 * state.currentState.coherence,
      sigma: spec.observerSigma,
      sourceStatus: "direct-telemetry"
    }];
    return basins.concat(memories, memorySummaries, observer);
  }

  function evaluatePotential(x, y, attractors) {
    let potential = 0;
    let vx = 0;
    let vy = 0;
    for (const attractor of attractors) {
      const dx = attractor.xy[0] - x;
      const dy = attractor.xy[1] - y;
      const kernel = gaussian(dx, dy, attractor.sigma);
      potential += attractor.weight * kernel;
      const derivativeScale = attractor.weight * kernel / (attractor.sigma * attractor.sigma);
      vx += derivativeScale * dx;
      vy += derivativeScale * dy;
    }
    return { potential, vx, vy };
  }

  function evaluateProbe(state, projection, x, y, baseVector, attractors, spec) {
    const probe = Projection.viewportToLatent(projection, x, y, state.config.radialLimit);
    const potential = evaluatePotential(x, y, attractors);
    let vx = potential.vx + baseVector[0];
    let vy = potential.vy + baseVector[1];
    const vectorMagnitude = Math.hypot(vx, vy);
    if (vectorMagnitude > spec.vectorCap) {
      const ratio = spec.vectorCap / vectorMagnitude;
      vx *= ratio;
      vy *= ratio;
    }
    const alignment = (M.cosine(probe, state.lastInput.data) + 1) / 2;
    const calm = Math.exp(-0.7 * state.lastInput.energy);
    const focus = Math.exp(-0.55 * Math.hypot(vx, vy));
    const rawCoherence = 0.5 * alignment + 0.25 * calm + 0.15 * focus + 0.1 * state.currentState.coherence;
    const coherence = M.clamp((1 - state.config.coherenceEma) * state.currentState.coherence + state.config.coherenceEma * rawCoherence, 0, 1);
    const separation = M.distance(probe, state.smoothedState);
    const projectionMargin = state.context.holdRemaining > 0 ? -1 : coherence - state.config.projectionThreshold;
    let memoryInfluence = 0;
    if (state.lastInput.recall) {
      const source = attractors.find((item) => item.id === state.lastInput.recall.memoryId);
      if (source) memoryInfluence = state.lastInput.recall.similarity * gaussian(source.xy[0] - x, source.xy[1] - y, source.sigma * 1.25);
    }
    const front = Math.hypot(potential.vx, potential.vy);
    const weather = 0.44 * potential.potential + 0.24 * coherence + 0.18 * front + 0.14 * memoryInfluence;
    return {
      potential: potential.potential,
      vx,
      vy,
      vectorMagnitude: Math.hypot(vx, vy),
      coherence,
      separation,
      projectionMargin,
      memoryInfluence,
      front,
      weather
    };
  }

  function minMax(values) {
    let min = Infinity;
    let max = -Infinity;
    for (const value of values) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
    return { min, max, span: Math.max(1e-12, max - min) };
  }

  function normalizeArray(values, range = minMax(values)) {
    return values.map((value) => (value - range.min) / range.span);
  }

  function buildField(state, projection, options = {}) {
    Engine.validateStateShape(state);
    const spec = createFieldSpec(options);
    const attractors = collectAttractors(state, projection, spec);
    const update2 = Projection.projectVector(projection, state.lastUpdate.vec, 2);
    const input2 = Projection.projectVector(projection, state.lastInput.data, 2);
    const baseVector = [
      0.38 * update2[0] + 0.1 * input2[0],
      0.38 * update2[1] + 0.1 * input2[1]
    ];
    const fields = {
      potential: [],
      vectorX: [],
      vectorY: [],
      vectorMagnitude: [],
      coherence: [],
      separation: [],
      projectionMargin: [],
      memoryInfluence: [],
      front: [],
      weather: []
    };
    const coordinates = [];
    const spacing = (2 * spec.extent) / (spec.size - 1);
    for (let row = 0; row < spec.size; row += 1) {
      const y = spec.extent - row * spacing;
      for (let col = 0; col < spec.size; col += 1) {
        const x = -spec.extent + col * spacing;
        const sample = evaluateProbe(state, projection, x, y, baseVector, attractors, spec);
        coordinates.push([x, y]);
        fields.potential.push(sample.potential);
        fields.vectorX.push(sample.vx);
        fields.vectorY.push(sample.vy);
        fields.vectorMagnitude.push(sample.vectorMagnitude);
        fields.coherence.push(sample.coherence);
        fields.separation.push(sample.separation);
        fields.projectionMargin.push(sample.projectionMargin);
        fields.memoryInfluence.push(sample.memoryInfluence);
        fields.front.push(sample.front);
        fields.weather.push(sample.weather);
      }
    }
    const ranges = {};
    const normalized = {};
    for (const [key, values] of Object.entries(fields)) {
      ranges[key] = minMax(values);
      normalized[key] = normalizeArray(values, ranges[key]);
    }
    const gridSpecHash = M.contentHash({ spec, projectionHash: projection.matrixHash, stateHash: state.currentHash });
    const dataHash = M.contentHash({
      potential: fields.potential,
      vectorX: fields.vectorX,
      vectorY: fields.vectorY,
      coherence: fields.coherence,
      projectionMargin: fields.projectionMargin,
      memoryInfluence: fields.memoryInfluence
    }, 7);
    return {
      schema: "mw-field/0.1",
      spec,
      gridSpecHash,
      dataHash,
      sourceStateHash: state.currentHash,
      projectionHash: projection.matrixHash,
      coordinates,
      fields,
      normalized,
      ranges,
      attractors,
      live: {
        currentState: Projection.project(projection, state.currentState.latent, 2),
        psi3: Projection.project(projection, state.currentState.latent, 3),
        smoothed: Projection.project(projection, state.smoothedState, 2),
        update: update2,
        input: input2,
        appliedRecall: state.lastInput.recall
      }
    };
  }

  function scalarValues(field, mode) {
    const key = mode === "coherenceScore" ? "coherence"
      : mode === "memoryInfluence" ? "memoryInfluence"
        : mode === "projectionReadiness" ? "projectionMargin"
          : mode === "fronts" ? "front"
            : mode;
    return field.fields[key] || field.fields.weather;
  }

  function normalizedValues(field, mode) {
    const key = mode === "coherenceScore" ? "coherence"
      : mode === "memoryInfluence" ? "memoryInfluence"
        : mode === "projectionReadiness" ? "projectionMargin"
          : mode === "fronts" ? "front"
            : mode;
    return field.normalized[key] || field.normalized.weather;
  }

  function sampleAt(field, x, y) {
    const size = field.spec.size;
    const u = M.clamp((x + field.spec.extent) / (2 * field.spec.extent), 0, 1);
    const v = M.clamp((field.spec.extent - y) / (2 * field.spec.extent), 0, 1);
    const col = Math.round(u * (size - 1));
    const row = Math.round(v * (size - 1));
    const index = row * size + col;
    return {
      index,
      row,
      col,
      x: field.coordinates[index][0],
      y: field.coordinates[index][1],
      potential: field.fields.potential[index],
      coherence: field.fields.coherence[index],
      vector: [field.fields.vectorX[index], field.fields.vectorY[index]],
      projectionMargin: field.fields.projectionMargin[index],
      memoryInfluence: field.fields.memoryInfluence[index],
      weather: field.fields.weather[index]
    };
  }

  return {
    DEFAULT_FIELD_SPEC,
    buildField,
    collectAttractors,
    createFieldSpec,
    evaluatePotential,
    normalizedValues,
    sampleAt,
    scalarValues
  };
});
