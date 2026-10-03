/** Explicit migration of exports from the pinned historical simulator. */
import { createSession, SESSION_SCHEMA_VERSION, SESSION_ENGINE, SESSION_SCOPE, SESSION_PROVENANCE, type SessionExport, type EngineConfigInput } from '../apps/simulator/src/session.ts';
import { assertSessionCompliance } from '../apps/simulator/src/compliance.ts';

const LEGACY_SCHEMA = 'qoft-simulator-session/v1';
const LEGACY_ENGINE_BLOB = 'e492c1d51ff5f8bf4ee1b7a4ff5a1135440ce6d5';
const KEYS: Record<string, string> = {
  psi: 'currentState', psiId: 'stateId', psiHash: 'stateHash', selfModel: 'smoothedState', priorGamma: 'priorUpdate',
  fluxEnergy: 'inputStrength', rho: 'coherenceScore', phiEnergy: 'inputStrength', gammaMag: 'updateMagnitude', reflexConf: 'smoothingConfidence',
  collapseTriggered: 'projectionTriggered', dGamma: 'updateDrift', reflexNorm: 'smoothedNorm', deltaPsi: 'stateChange',
  omegaAmp: 'noiseAmplitude', omegaActive: 'noiseActive', omegaRaised: 'noiseRaised',
  reflexRate: 'smoothingRate', gammaScale: 'updateScale', tau: 'projectionThreshold', summarizeEvery: 'summaryInterval', meshCap: 'memoryCapacity',
  ablations: 'mechanisms', collapse: 'projection', summarize: 'summaries', omega: 'noise', mesh: 'memorySummaries', realization: 'implementation',
};
function rename(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rename);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, val]) => [KEYS[key] ?? key, rename(val)] as const);
    if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Error('Ambiguous legacy and current field names');
    return Object.fromEntries(entries);
  }
  return value;
}
export function migrateLegacyConfig(value: unknown): EngineConfigInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected a legacy configuration object');
  const input = rename(value) as EngineConfigInput;
  // Session construction rejects unknown keys and invalid types/ranges.
  createSession({ config: input });
  return input;
}
export function migrateLegacySession(value: unknown): { data: SessionExport; migration: Record<string, unknown> } {
  if (!value || typeof value !== 'object') throw new TypeError('Expected a legacy session export');
  const legacy = value as { schemaVersion?: string; provenance?: { engineGitBlob?: string }; psiId?: string };
  if (legacy.schemaVersion !== LEGACY_SCHEMA || legacy.provenance?.engineGitBlob !== LEGACY_ENGINE_BLOB) {
    throw new Error('Only exports from the pinned historical v1 engine are supported');
  }
  const converted = rename(value) as SessionExport;
  converted.schemaVersion = SESSION_SCHEMA_VERSION;
  converted.implementation = SESSION_ENGINE;
  converted.claimBoundary = SESSION_SCOPE;
  converted.provenance = { ...SESSION_PROVENANCE };
  const frameLists = [converted.frames, converted.recentFrames, converted.latestFrame ? [converted.latestFrame] : []];
  for (const frames of frameLists) for (const frame of frames) {
    frame.tags = frame.tags.map(tag => ({ collapse: 'projection', omega: 'noise', omega_raised: 'noise_raised' })[tag] ?? tag);
  }
  const oldBasins = ['closure', 'insight', 'identity', 'tension', 'recall', 'threshold'];
  for (const event of converted.eventHistory.events) {
    const index = oldBasins.indexOf(event.reason.replace(/^basin:/, ''));
    if (index >= 0) event.reason = `basin:Basin ${index + 1}`;
  }
  // Validate the entire replay, retaining the original ID while checking v1
  // hashes. The algorithm's bytes are unchanged when the explicit ID is kept.
  assertSessionCompliance(converted);
  const target = createSession({ runId: 'migrated-run', stateId: 'state', seed: converted.seedInput,
    config: converted.config, maxTicks: converted.maxTicks, eventHistoryLimit: converted.eventHistory.limit });
  for (const stimulus of converted.stimulusSchedule) {
    if (stimulus === 'pulse') target.queuePulse(); else target.setInputMode(stimulus);
    target.step();
  }
  target.setInputMode(converted.persistentStimulus);
  if (converted.pulsePending) target.queuePulse();
  if (converted.playing) target.play();
  const data = target.exportData();
  assertSessionCompliance(data);
  return { data, migration: {
    sourceSchema: LEGACY_SCHEMA, sourceEngineGitBlob: LEGACY_ENGINE_BLOB,
    sourceStateIdCodePoints: Array.from(legacy.psiId ?? '').map(c => c.codePointAt(0)),
    targetSchema: SESSION_SCHEMA_VERSION, targetStateId: 'state', targetRunId: 'migrated-run',
    hashPolicy: 'v1 hashes verified with original ID; v2 hashes recomputed with ASCII ID',
  } };
}
