# State Dynamics Engine

A deterministic simulator for exploring how a changing state responds to input,
stored history, and controlled noise. Step through each update, disable individual
mechanisms, and export reproducible traces.

The reference engine works with a bounded 12-number state. The accompanying
State Dynamics Lab makes its inputs, memory, basin projections, and diagnostics
visible in the browser. Everything runs locally; no API key is needed.

## Try the simulator

Requirements: Node.js 22.12 or later and npm.

```bash
npm ci
npm run install:apps
npm --prefix apps/simulator run dev
```

Open the localhost address printed by Vite. In State Dynamics Lab:

1. Press **Step** to advance one update, or **Play** to run continuously.
2. Choose **basin** input to make basin projection events easier to observe.
3. Disable one mechanism, reset, and compare the trace with the same seed.
4. Export the run or open **Verification** to check its replay and integrity.

The [Memory Weather standalone file](apps/memory-weather/dist/memory-weather.html)
can also be opened directly from disk without installing dependencies. It runs
a separate experimental engine.

## Run a repeatable example

```bash
npm run run
npm test
```

```typescript
import { run } from './src/engine.ts';

const result = run(64, '0x51e1d', { stimulus: 'basin' });
console.log(result.currentState.latent);
console.log(result.frames.at(-1));
console.log(result.events);
```

For scheduled inputs, queued pulses, validated configuration changes, and JSON
exports, use `createSession()` from `apps/simulator/src/session.ts`.

## Components

| Component | Role |
| --- | --- |
| [State Dynamics Engine](src/engine.ts) | Reference simulation library |
| [State Dynamics Lab](apps/simulator/README.md) | Full interface and compact probe for that engine |
| [Memory Weather](apps/memory-weather/README.md) | Separate experimental simulation |
| [Memory Weather Lab](apps/memory-weather-lab/README.md) | Alternative React interface to Memory Weather |

The two engines have different equations and trajectories. The two Memory Weather
interfaces share one engine; their generated wrappers are checked for exact sync.

## How it works

Each reference-engine step smooths the current state, samples input and optional
memory/noise, computes a bounded update, combines it with the smoothed state,
optionally projects toward a basin, and records diagnostics and history.

The coherence score is a weighted calculation specific to this implementation.
The six basin vectors are called Basin 1 through Basin 6. They have no assigned
psychological meaning. See [the implementation guide](docs/IMPLEMENTATION.md) for
the formulas, update order, and limitations.

## Verify and build

```bash
npm run verify
npm run build:site
python3 -m http.server 8000 --directory _site
```

Open `http://localhost:8000`. The generated site includes all four interfaces.
See [verification](docs/VERIFICATION.md) for the source-pinned numerical migration
checks and [publishing](docs/PUBLISHING.md) for GitHub setup and Pages deployment.

## Origins and compatibility

This project is an independent software successor to the QOFT/QOSMOS reference
implementation at commit `1ab947e0cb75afaf0e7ecad11a8aa5e02b510ebc`.
[ORIGINS.md](ORIGINS.md) records attribution and the exact historical reference.
The original research contracts remain in that repository.

Public names and export schemas have changed. Numerical parity is tested against
records generated from the original source; renamed hashes are versioned
separately. [Migration notes](docs/MIGRATION.md) explain the explicit v1-session
adapter and its limits.

## Status and license

Version 0.1.0 is an experimental software release. Reproducibility establishes
the tested implementation behavior. Usefulness on external tasks requires
separate evaluation.

Mozilla Public License 2.0. Copyright 2026 Donald Tuttle.
See [LICENSE](LICENSE) and [NOTICE](NOTICE).
