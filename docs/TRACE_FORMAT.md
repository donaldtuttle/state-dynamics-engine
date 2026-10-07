# Trace format

This note describes the reference-engine session export from
`SimulationSession.exportData()` in `apps/simulator/src/session.ts`.
It is the JSON record this repository already writes. It is not a published
standard, a cryptographic format, or a claim of legal protection.

Memory Weather uses a different record, `memory-weather-replay/v2`.
Do not replay one schema with the other loader.

## Identification

| Field | Value |
| --- | --- |
| `schemaVersion` | `state-dynamics-session/v2` |
| `implementation` | `State Dynamics Engine (12D)` |
| `provenance.hashVersion` | `state-dynamics-state/v2` |
| `claimBoundary` | `Experimental bounded 12-dimensional software simulation.` |

`provenance` also pins `src/engine.ts`, the current source git blob, the historical
repository, and commit `1ab947e0cb75afaf0e7ecad11a8aa5e02b510ebc`.
The engine blob identifies the exporting build; the repository and commit
identify the migration source. These pins are not a signature of the
person who exported a particular file.

## What is captured

- `seedInput` and the normalized uint32 `seed`.
- The full engine `config`, including the four mechanism flags. In a committed
  run, `config.stimulus` is the persistent input mode, not a pulse.
- `stimulusSchedule`: one stimulus name per committed tick. A queued pulse
  occupies exactly one of those entries. `pulseSteps` lists those indexes.
- `frames`: one diagnostics frame per tick, including coherence, input strength,
  update magnitude, smoothing confidence, entropy, drift, projection flag,
  tags, and the scalar telemetry (`mix`, `gate`, `updateDrift`,
  `noiseAmplitude`, `noiseActive`, `noiseRaised`).
- `hashes`: one state hash per state, so the length is `frames + 1`.
  `hashes[0]` is the initial state, before any tick.
- `currentState`, `smoothedState`, `priorUpdate`, a capped `stateHistory`
  (256 samples), capped `memorySummaries`, and capped projection `eventHistory`.

JSON numbers are ordinary JavaScript numbers. The export does not re-round
the vectors to the six decimals used by the state hash.

## Basin projection metrics

New `eventHistory.events` entries include two optional, additive numbers:

- `projectionDistance`: `||post.latent - pre.latent||`, displayed as **State
  change**. `pre` is the input to `projectTowardBasin()`, immediately before
  its 82% basin blend; `post` is its final bounded return state. This is
  projection displacement alone, not the whole tick's `scalars.stateChange`.
- `normChange`: `||post.latent|| - ||pre.latent||`, displayed as **Norm change**.
  Positive means magnitude increased; negative means it decreased.

The existing `energyDrop` remains `max(0, ||pre.latent|| - ||post.latent||)`.
It is a clamped **Norm drop**, not state displacement or a physical energy.
A projection can move the state while `energyDrop` is zero. The ledger uses
three decimal places; values that round to zero can still be nonzero in JSON.

Older events can omit either new field. Without `projectionDistance`, the
ledger displays **Norm drop** using `energyDrop`; it never fabricates distance.
Without `normChange`, the signed secondary line is omitted.

## State hash

`hashState()` in `src/engine.ts` is 32-bit FNV-1a, printed as eight lowercase
hex characters. The hashed text is:

```text
id|t|v1,v2,...,v12|coherence|inputStrength|basinId
```

Each latent component, coherence, and input strength is formatted with six
digits after the decimal. A missing basin id is written as `-1`.

The hash includes the state id. The default id is `state`, so a renamed id
changes the hash even when the numbers do not. That is why migration hashes
differ from some historical hashes. See [migration notes](MIGRATION.md).

The hash does not include the seed, the configuration, the stimulus schedule,
the smoothed state, memory summaries, diagnostics frames, or the rest of the
export. Two different runs can therefore share a state hash while their
exports differ. Differences smaller than the sixth decimal can also disappear
from the hash while remaining in the JSON.

## Replay and migration boundaries

`evaluateSessionCompliance()` replays the export from its seed, fixed
configuration, and per-tick stimulus schedule. The replay must reproduce the
export JSON, including every diagnostic hash and each recorded event metric.
The only compatibility normalization retains an accepted historical engine
blob and omits optional metrics that were absent in that recorded event.
Present metrics must be finite and match replay; validation does not mutate
or populate the imported record. That is a reproducibility check
for this implementation.

`state-dynamics-session/v2` does not load a `qoft-simulator-session/v1` file.
`scripts/migrate-session.mjs` is the explicit adapter: it replays the historical
record with the original id, then writes a v2 export. Memory Weather v1
replays are rejected by the v2 loader. There is no automatic conversion.

The compact probe has a separate chained digest. The probe code states that
this digest is a probe-local helper, not a cryptographic integrity signature.

## What the checks detect

For a v2 export, the session checks detect:

- A wrong schema, engine name, claim boundary, or provenance pin.
- An invalid seed or a config the engine rejects.
- Non-finite or unbounded current-state vectors, broken frame counts, or a
  stimulus schedule that does not match the frames.
- Projection events whose post-hash is not the recorded state hash for that tick.
- A final hash that is not the hash of `currentState`.
- A replay that does not reproduce the export.

Those checks catch accidental corruption and incomplete exports. A changed
byte that is not recomputed back into a consistent replay fails.

## What they do not guarantee

The hash is unkeyed. Anyone can change a trace and recompute `hashState()`,
or generate a new consistent export. A passing check does not show who
produced the file, and it does not stop a person who is willing to recompute
the hashes. It is not authentication and it is not tamper-resistance.

A passing replay also does not show that the run was useful on an external
task. It shows that this software reproduced its own recorded run.
