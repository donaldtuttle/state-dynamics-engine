// Only numerical dynamics enter these records. Labels, IDs, schema keys, and
// diagnostic hashes are deliberately compared by separate compatibility tests.
import { createHash } from 'node:crypto';
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function rootRecord(state, context, frame, events, legacy = false) {
  const get = (o, key, old = key) => o[legacy ? old : key];
  return [state.t, state.latent, state.coherence, get(state, 'inputStrength', 'fluxEnergy'), state.basinId ?? null,
    get(context, 'smoothedState', 'selfModel'), get(context, 'priorUpdate', 'priorGamma'),
    get(context, 'priorCoherence', 'priorRho'), context.dwellCount, context.holdLeft, context.phase,
    get(context, 'memorySummaries', 'mesh').map(n => [n.id, n.latent, get(n, 'coherenceScore', 'rho'), n.step]),
    context.stateHistory.map(n => [n.latent, get(n, 'coherenceScore', 'rho'), n.step]),
    [frame.step, frame.phase, get(frame, 'coherenceScore', 'rho'), get(frame, 'inputStrength', 'phiEnergy'),
      get(frame, 'updateMagnitude', 'gammaMag'), get(frame, 'smoothingConfidence', 'reflexConf'),
      frame.entropy, frame.drift, frame.stable, get(frame, 'projectionTriggered', 'collapseTriggered')],
    Object.values(frame.scalars),
    events.map(e => [e.step, e.energyDrop, e.basinId, get(e, 'coherenceScore', 'rho')])];
}
export function weatherRecord(state, result, legacy = false) {
  const get = (o, key, old = key) => o[legacy ? old : key];
  const current = get(state, 'currentState', 'psi'), context = get(state, 'context', 'ctx');
  const update = get(state, 'lastUpdate', 'lastGamma'), input = get(state, 'lastInput', 'lastFlux');
  const noise = get(input, 'noise', 'omega'), frame = result.frame;
  return [current.t, current.latent, current.coherence, get(current, 'inputStrength', 'fluxEnergy'), current.basinId,
    get(state, 'smoothedState', 'selfModel'), update.vec, update.magnitude, input.data, input.energy,
    noise ? [noise.amp, noise.noise, noise.active] : null,
    [context.step, context.phase, get(context, 'projectionDwellCount', 'collapseDwellCount'), context.holdRemaining],
    context.pendingRecall ? [context.pendingRecall.latent, context.pendingRecall.similarity, context.pendingRecall.appliesAtStep] : null,
    state.memories.map(m => [m.latent, m.weight, m.createdStep]),
    get(state, 'memorySummaries', 'mesh').map(m => [m.latent, m.weight, m.createdStep, m.sourceSteps]),
    Object.values(state.counters),
    [frame.step, frame.phase, get(frame, 'coherenceScore', 'rho'), get(frame, 'input_strength', 'phi_energy'),
      get(frame, 'update_magnitude', 'gamma_mag'), get(frame, 'smoothing_confidence', 'reflex_conf'),
      frame.entropy, frame.drift, frame.stable, get(frame, 'projection_triggered', 'collapse_triggered'),
      get(frame, 'projection_eligible', 'collapse_eligible'), get(frame, 'projection_would_trigger', 'collapse_would_trigger')],
    Object.values(frame.scalars),
    result.events.map(e => [e.step, e.energyDrop ?? null, e.basinId ?? null, get(e, 'coherenceScore', 'rho') ?? null,
      e.fromBasinId ?? null, e.toBasinId ?? null])];
}
export const rootKeyMap = { smoothingRate: 'reflexRate', updateScale: 'gammaScale', projectionThreshold: 'tau', summaryInterval: 'summarizeEvery', memoryCapacity: 'meshCap', noiseAmplitude: 'omegaAmp', mechanisms: 'ablations', projection: 'collapse', summaries: 'summarize', noise: 'omega' };
export const weatherKeyMap = { smoothingRate: 'reflexRate', updateScale: 'gammaScale', projectionThreshold: 'collapseThreshold', summaryInterval: 'summarizeEvery', memoryCapacity: 'meshCap', noiseAmplitude: 'omegaAmp', mechanisms: 'ablations', projection: 'collapse', summaries: 'summarize', noise: 'omega', memoryReplay: 'thetaReplay', coherenceGate: 'rhoGate', smoothing: 'reflexAdaptation' };
export function legacyConfig(value, mapping) {
  return Object.fromEntries(Object.entries(value).map(([key, val]) => [mapping[key] ?? key, val && typeof val === 'object' ? legacyConfig(val, mapping) : val]));
}
export function cases() {
  const modes = ['quiet', 'align', 'disrupt', 'pulse', 'periodic', 'basin'];
  const root = [], weather = [];
  for (const seed of [335389, 12062026]) for (const stimulus of modes) {
    for (const off of ['none', 'projection', 'memory', 'summaries', 'noise', 'all']) {
      const mechanisms = Object.fromEntries(['projection', 'memory', 'summaries', 'noise'].map(k => [k, off !== 'all' && k !== off]));
      root.push({ id: `${seed}/${stimulus}/${off}`, seed, ticks: 96, config: { stimulus, projectionThreshold: 0.68, summaryInterval: 4, memoryCapacity: 8, mechanisms } });
    }
    for (const off of ['none', 'projection', 'memoryWrite', 'memoryReplay', 'summaries', 'noise', 'coherenceGate', 'smoothing', 'all']) {
      const mechanisms = Object.fromEntries(['projection', 'memoryWrite', 'memoryReplay', 'summaries', 'noise', 'coherenceGate', 'smoothing', 'coupling'].map(k => [k, off !== 'all' && k !== off]));
      weather.push({ id: `${seed}/${stimulus}/${off}`, ticks: 96, config: { seed, stimulusMode: stimulus, summaryInterval: 4, memoryCapacity: 8, mechanisms } });
    }
  }
  return { root, weather };
}
export function prepareWeather(engine, spec, legacy = false) {
  const state = engine.createState(legacy ? legacyConfig(spec.config, weatherKeyMap) : spec.config);
  engine.inscribeMemory(state, 'test memory alpha', 1.15);
  engine.inscribeMemory(state, 'test memory beta', 0.85);
  return state;
}
export function weatherActions(engine, state, tick, legacy = false) {
  if (tick === 22) engine.queueRecall(state, 'test memory alpha');
  if (tick === 51) engine[legacy ? 'requestCollapse' : 'requestProjection'](state);
}
