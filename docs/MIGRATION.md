# Migration and compatibility

The successor starts at package version 0.1.0. The historical source is pinned in
ORIGINS.md; it remains independently readable and is not changed by this project.

## Public names

| Historical name | Successor name |
| --- | --- |
| Psi / Ctx | SimulationState / SimulationContext |
| PsiReflex / projectReflex | SmoothedState / updateSmoothedState |
| Gamma / gradient | StateUpdate / computeStateUpdate |
| omegaMu / sampleFlux | sampleAdaptiveNoise / sampleInput |
| fuse / rhoOf | combineStateAndUpdate / computeCoherenceScore |
| collapsePredicate / collapse | shouldProjectToBasin / projectTowardBasin |
| summarize / recall | storeHistorySummary / retrieveSimilarMemory |
| PsiMetaFrame / xiStep | DiagnosticFrame / stepSimulation |
| QosmosSession | SimulationSession |
| ablations | mechanisms (true still enables the mechanism) |

Configuration keys include `smoothingRate`, `updateScale`, `projectionThreshold`,
`summaryInterval`, `memoryCapacity`, and `noiseAmplitude`. Diagnostic keys include
`coherenceScore`, `inputStrength`, `updateMagnitude`, and `smoothingConfidence`.
The broader mechanical crosswalk is in api-name-map.json. Current exported
TypeScript definitions are authoritative for the successor API.

## Schema and hash policy

- Session exports: `state-dynamics-session/v2`.
- Reference-state hash version: `state-dynamics-state/v2`.
- Memory Weather replay: `memory-weather-replay/v2`.
- Site manifest: `state-dynamics-site/v1`.

The reference engine's default state ID changes to `state`. Its existing FNV
diagnostic algorithm includes that ID in the hashed text. Renamed Memory Weather
JSON fields also affect its FNV hashes. These hashes are useful replay diagnostics,
not cryptographic security proofs. SHA-256 is used for source and numerical-fixture
integrity.

| Known replay | Historical hash | Successor hash |
| --- | --- | --- |
| Reference engine, 64 default periodic ticks | fbc08652 | 9c7c50e3 |
| Compact probe, mixed 64-tick test schedule | 0132b0a2 | 6cb52b2f |
| Memory Weather, published 96-tick demo | mw-fnv64:e199888bbf930070 | mw-fnv64:b8869fa460013ef2 |

Numerical equivalence is tested independently of those renamed hash inputs.
Keeping an explicitly supplied original state ID retains the reference engine's
original state hash, because its numerical values and hash arithmetic are unchanged.

## Import a historical session

```bash
node --experimental-strip-types scripts/migrate-session.mjs old-session.json migrated.json
```

The adapter accepts `qoft-simulator-session/v1` exports declaring the pinned
historical engine blob. It translates known field names, validates the recorded
trajectory and original hashes by replaying with the original ID, then replays
with ASCII IDs (`state`, `migrated-run`) to produce a v2 export. It returns the
export under `data` plus a `migration` receipt. The input file is never overwritten.
Changed diagnostics or hashes fail validation. Original files should be retained
as provenance; migration is not a replacement for them.

`migrateLegacyConfig()` translates and validates reference-engine configuration
objects. It is an explicit import helper, not a set of silent aliases on the new API.

Memory Weather v1 replays are deliberately rejected by its v2 loader. No automatic
conversion of their historical hash-linked artifacts is claimed. Use the pinned
historical engine to inspect those files. New v2 replay save/load and continuation
are tested in the successor.

The source contains no literal research glyphs. Historical test inputs and the
original attribution are ASCII-escaped JSON. User-supplied text can naturally
contain Unicode; this is not an input censorship rule.
