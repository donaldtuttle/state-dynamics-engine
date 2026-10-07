# Memory policy audit: executed development record

Status: DEVELOP / exploratory. Date: 2026-10-07 UTC (October 6 in Pacific time).
No production numerical changes. No task-utility or equivalence claim.

## Source and executions

Implementation commit: `297d9569f627f83ea7fc182fd45b56e43d9bb244`.
The documentation/lockfile follow-up does not change these executable sources.

A GitHub runner cloned the published repository and checked out that exact
commit. A second working copy was cloned locally from the runner's Git bundle;
its HEAD was checked before testing. Direct GitHub DNS access was unavailable
in the local sandbox, so the bundle was the source transfer, not a claimed
successful local HTTPS clone. Both executions reported a clean source tree.

* Runner: Node 22.12.0, V8 12.4.254.21-node.21, Linux x64.
* Local clone: Node 22.16.0, V8 12.4.254.21-node.26, Linux x64.
* Both ran the full diagnostic. Their complete numerical data objects matched.
* Both passed `npm run verify` and `npm run build:site`, including the preserved
  17,792-step migration fixture and 13 new diagnostic regression tests.
* Local dependencies were transferred from the runner's pinned `npm ci`
  installation in a separately hashed archive, not fetched by local npm.

Execution artifacts and command logs:
[GitHub Actions run 37551545260](https://github.com/donaldtuttle/state-dynamics-engine/actions/runs/37551545260).
Artifacts contain full per-seed rows, projection schedules, source hashes,
platform versions, logs, and browser mismatch details. Actions artifact retention
is finite; the source, commands, numerical digest and key results are preserved
here. This record is a development reproduction, not an independent confirmatory
replication: the seeds and approximate outcomes had already been inspected.

Numerical data SHA-256, excluding machine/provenance metadata:

```text
f3616414ef94df81e0223d44cff53090cfd239f02b25cf4e7befbddd6e60fc79
```

Preserved engine Git blob: `7e9deb3bb47f4f615b255b701bf4a4ada41a94df`.

| Artifact | SHA-256 |
| --- | --- |
| `src/engine.ts` | `db7c664d2fc14b8560ef2e6975f69aca3f640a89d994881baa140dbb7ae6804f` |
| `scripts/memory-policy-probe-v3.ts` | `333b8d1eb3e8350b5022305997687de7665b42eeb8109154eec6ff381f956154` |
| `scripts/lib/memory-policy-cli.mjs` | `e9d29d36569204cd20989621704b7cd6518f51b1f9c55e26691c69810df1314b` |
| `experiments/memory-policy-v3/policy.ts` | `5bd39379f89c287ef874a9eb524703073ee561e380228ca9568a0329ba3b8bf0` |
| `tests/fixtures/upstream-numerical.json` | `f641b96687a5b4bf3a19dea787838906244a0be6747bc63e59d40954b80d1094` |
| Browser checker | `46393d5914e56a1eac91e59e6566dfb9b5bacd8a24d34589e1a4bcc11505dc6e` |

## Design and exact controls

Numeric seeds 1 through 24, 1,024 ticks, six stimuli, five policies: 720 policy
runs. `pulse` is a persistent raw-engine stress condition, not a normal session
stimulus. A and E each passed 144 exact control runs against the actual engine,
comparing unrounded states, frames, events and feedback context. A also matched
`run()` with the complete final context and hash sequence.

A = argmax similarity; B = random eligible; C = most recent eligible;
D = mean eligible latent with recomputed similarity; E = memory off, summaries on.
Each arm evolves its own state and memory. D changes aggregation and gain as
well as selection. B has one deterministic policy draw schedule per seed.

## Policy results

Mean Euclidean distance from A's trajectory, averaged over ticks and then seeds:

| Stimulus | B random | C recent | D mean | E off |
| --- | ---: | ---: | ---: | ---: |
| quiet | 0.067212 | 0.000097 | 0.044197 | 0.964746 |
| align | 0.083267 | 0.013871 | 0.081819 | 0.833692 |
| disrupt | 0.046775 | 0.013372 | 0.047618 | 0.103677 |
| pulse | 0.072977 | 0.003613 | 0.058065 | 0.932823 |
| periodic | 0.069757 | 0.032329 | 0.069337 | 0.551600 |
| basin | 0.083936 | 0.009259 | 0.077616 | 0.749587 |

Mean projections per run:

| Stimulus | A | B | C | D | E |
| --- | ---: | ---: | ---: | ---: | ---: |
| quiet | 126.958 | 124.667 | 126.958 | 126.292 | 4.583 |
| align | 92.958 | 85.167 | 93.750 | 85.458 | 10.583 |
| disrupt | 0.500 | 0.375 | 0.542 | 0.458 | 1.292 |
| pulse | 126.333 | 120.542 | 126.375 | 123.292 | 5.708 |
| periodic | 40.542 | 38.542 | 38.833 | 38.792 | 4.250 |
| basin | 100.458 | 95.292 | 100.833 | 96.375 | 36.000 |

**Similar event counts conceal timing changes.** For quiet, A and B averaged
126.958 and 124.667 projections, but disagreed on 201.792 individual event ticks
per run. An event moved from one tick to another can create two disagreements;
this is not 201.792 distinct moved events. Quiet C had zero timing disagreements
and a nonzero mean path distance of 0.000097. Printed zeros are not an exact
trajectory-equivalence test. No practical equivalence margin was predeclared.

The results support strong effects of removing memory in several default
regimes. They do not establish that associative selection is irrelevant: the
selection policy also changes event timing. More projections are not scored as
better performance.

## Gate, recency and cadence

Each stimulus supplied 839,808 candidate comparisons; the current gate rejected
zero of them. Recall was available on 24,264 of 24,576 pre-step opportunities
per stimulus. The initial 13 opportunities per run had no summary.

Actual selected-node agreement with the newest eligible node, not inferred
from trajectory similarity:

| Stimulus | Newest-node selections | Recall steps | Agreement |
| --- | ---: | ---: | ---: |
| quiet | 13244 | 24264 | 54.58% |
| align | 10270 | 24264 | 42.33% |
| disrupt | 10907 | 24264 | 44.95% |
| pulse | 9034 | 24264 | 37.23% |
| periodic | 6671 | 24264 | 27.49% |
| basin | 11537 | 24264 | 47.55% |

Thus A is not generally the same selection rule as recency. Quiet had 3,021 of
3,023 projection intervals at eight ticks. With the default hold=6 and dwell=2,
that is six blocked steps followed by two qualifying checks. Threshold and
hysteresis conditions remain active. Cadence alone says nothing conclusive
about portability at other states or thresholds.

## Immediate coherence effect

At every A state, a one-step counterfactual removed only recall with identical
noise and prior feedback. These are mean changes in weighted terms before
projection can impose its coherence floor, not differences between independently
evolved A and E trajectories:

| Stimulus | Alignment | Calmness | Focus | Prior | Total score |
| --- | ---: | ---: | ---: | ---: | ---: |
| quiet | +0.131077 | -0.014243 | +0.004424 | +0.000000 | +0.121259 |
| align | +0.095626 | -0.007217 | +0.003799 | +0.000000 | +0.092208 |
| disrupt | +0.018007 | -0.000502 | +0.000662 | +0.000000 | +0.018168 |
| pulse | +0.114738 | -0.011374 | +0.004045 | +0.000000 | +0.107409 |
| periodic | +0.060999 | -0.002973 | +0.002527 | +0.000000 | +0.060553 |
| basin | +0.066379 | -0.009263 | +0.003877 | +0.000000 | +0.060994 |

The positive alignment contribution dominates these mean immediate changes.
This supports the proposed local mechanism without claiming it is the complete
explanation of long-run projection schedules. The leave-memory-out input
identity held to the stated 1e-12 tolerance; maximum observed norm residual was
1.1102230246251565e-16, not exact bitwise equality.

## Browser portability: numerical mismatch, event/hash agreement

Playwright core 1.57.0; Linux x64; Node 22.12.0 reference. Each browser ran all
72 reference-engine fixtures, 6,912 steps per browser. Memory Weather was not
part of this screen. Values were compared both as structured numerical SHA-256
records and as floating-point bit strings encoded inside the browser before
transport.

| Runtime | Version | Different numerical/bit records | Different diagnostic hashes | Event-schedule mismatch runs |
| --- | --- | ---: | ---: | ---: |
| chromium | 143.0.7499.4 | 3829 / 6912 | 0 | 0 / 72 |
| firefox | 144.0.2 | 2119 / 6912 | 0 | 0 / 72 |
| webkit | 26.0 | 4699 / 6912 | 0 | 0 / 72 |

All three statuses were `NUMERICAL_MISMATCH`; `allExact` was false. All 20,736
browser step hashes and all 216 projection schedules matched the Node reference.
Final latent vectors differed exactly in 4 Chromium cases, 1 Firefox case,
and 4 WebKit cases. Matching rounded hashes therefore did not establish exact
numerical portability. First-mismatch details are retained in the browser JSON;
this screen does not identify a complete operation-level cause or establish a
maximum long-run error bound.

Observation mode exited successfully because all requested runtimes executed.
That is not a numerical parity PASS. The default strict command exits nonzero
for this outcome. Branded Safari and other versions/platforms were not tested.
No deterministic-math library was installed into the pinned engine.

## Reproduce

From a clean clone containing the diagnostic:

```bash
npm ci
npm run install:apps
npm run verify
npm run build:site
node --experimental-strip-types scripts/memory-policy-probe-v3.ts --json /tmp/memory-policy.json
npm --prefix experiments/memory-policy-v3 ci
node experiments/memory-policy-v3/node_modules/playwright-core/cli.js install --with-deps chromium firefox webkit
node --experimental-strip-types experiments/memory-policy-v3/browser-replay.mjs --observe --json /tmp/browser-replay.json
```

Output paths must not already exist. Compare the numerical data SHA-256 rather
than entire JSON files when commit/platform metadata differs. This evidence is
about this implementation and tested conditions, not physics, consciousness,
QOFT validity, external utility, or universal equivalence of memory policies.
