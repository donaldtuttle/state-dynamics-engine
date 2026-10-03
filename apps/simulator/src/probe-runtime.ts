/**
 * DOM-free seam for the compact State Dynamics probe.
 *
 * This module never implements a fallback trajectory. Every committed state
 * transition is owned by SimulationSession, which delegates to root stepSimulation.
 */

import {
  createSession,
  SESSION_SCOPE,
  SESSION_PROVENANCE,
  SESSION_ENGINE,
  type SimulationSession,
  type SessionExport,
  type SessionOptions,
  type SessionSnapshot,
} from "./session.ts";
import { evaluateSessionCompliance, type ComplianceReport } from "./compliance.ts";

export const PROBE_EMPTY_DIGEST = "00000000" as const;

export const PROBE_RUNTIME = Object.freeze({
  implementation: SESSION_ENGINE,
  transitionPath: "SimulationSession.step/tick to stepSimulation",
  enginePath: SESSION_PROVENANCE.enginePath,
  engineGitBlob: SESSION_PROVENANCE.engineGitBlob,
  fallback: false,
  claimBoundary: SESSION_SCOPE,
} as const);

export const PROBE_REFERENCE_64 = Object.freeze({
  seed: "0x51e1d",
  ticks: 64,
  stimulus: "periodic",
  expectedFinalHash: "9c7c50e3",
} as const);

function fnvString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Probe-local chained diagnostic. This is not a cryptographic integrity signature. */
export function appendProbeDigest(previous: string, stateHash: string): string {
  if (!/^[0-9a-f]{8}$/.test(previous) || !/^[0-9a-f]{8}$/.test(stateHash)) {
    throw new Error("Probe digests and currentState hashes must be eight lowercase hexadecimal characters");
  }
  return fnvString(previous + stateHash);
}

export function digestProbeHashes(stepHashes: readonly string[]): string {
  return stepHashes.reduce(appendProbeDigest, PROBE_EMPTY_DIGEST);
}

export function digestProbeExport(data: SessionExport): string {
  // hashes[0] is the initialized state. The digest advances once per committed
  // tick, matching the frame/stimulus cardinality of the exported run.
  return digestProbeHashes(data.hashes.slice(1));
}

export function createProbeSession(options: SessionOptions = {}): SimulationSession {
  return createSession({ runId: "state-dynamics-probe", ...options });
}

export function verifyProbeSession(session: SimulationSession): ComplianceReport {
  return evaluateSessionCompliance(session.exportData());
}

/** Remaining full post-projection suppression ticks, derived from public trace data. */
export function probeHoldTicks(snapshot: SessionSnapshot): number {
  const latestEvent = snapshot.eventHistory.events.at(-1);
  if (!latestEvent) return 0;
  const committedAfterProjection = snapshot.frameCount - (latestEvent.step + 1);
  return Math.max(0, snapshot.config.hold - committedAfterProjection);
}

export type ProbeReferenceResult = {
  data: SessionExport;
  digest: string;
  matchesPin: boolean;
  compliance: ComplianceReport;
};

export function runProbeReference64(): ProbeReferenceResult {
  const session = createProbeSession({
    seed: PROBE_REFERENCE_64.seed,
    config: { stimulus: PROBE_REFERENCE_64.stimulus },
  });
  session.stepMany(PROBE_REFERENCE_64.ticks);
  const data = session.exportData();
  const compliance = evaluateSessionCompliance(data);
  return {
    data,
    digest: digestProbeExport(data),
    matchesPin: compliance.compliant && data.stateHash === PROBE_REFERENCE_64.expectedFinalHash,
    compliance,
  };
}
