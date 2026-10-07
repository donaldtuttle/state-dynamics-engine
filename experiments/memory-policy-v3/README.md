# Memory policy diagnostic, revision 3.1

Status: DEVELOP / exploratory. This is not a registered utility evaluation.
Implementation: root `src/engine.ts`, Git blob
`7e9deb3bb47f4f615b255b701bf4a4ada41a94df`.

## What this answers

How much do memory injection and the choice of stored summary alter this
particular simulator? Separately, do its existing reference fixtures reproduce
exactly in the tested browser runtimes?

The starting design is the v3 probe supplied by Donald Tuttle from the Claude
review conversation. This revision strengthens controls and measurement. It
neither changes the production engine nor adopts any theory-level claim.

The first execution is recorded in [the dated result](records/20261007/RESULT.md).

## Run

From the repository root, with Node.js 22.12 or later:

```bash
npm ci
npm run test:memory-policy
npm run typecheck:memory-policy
node --experimental-strip-types scripts/memory-policy-probe-v3.ts --smoke
node --experimental-strip-types scripts/memory-policy-probe-v3.ts --json /tmp/memory-policy-full.json
```

Full diagnostic: numeric seeds 1 through 24, 1,024 ticks, six stimuli and five
policies. These seeds and outcomes have already been inspected in development.
Smoke: seeds 1 and 2, 96 ticks. Neither mode touches another experiment's seed
ranges, locks, scoring rules, or results. Existing output files are not replaced.

The CLI reports its Git commit, dirty status, Node/V8 versions, engine blob,
source SHA-256 values and a deterministic numerical-result SHA-256. Per-seed
rows, projection event schedules, denominators and unrounded numbers are in
JSON. Printed decimal zeros must not be interpreted as exact equality.

## Policies and intervention boundary

| Policy | Recall substitution |
| --- | --- |
| A_argmax | The real engine's best-similarity retrieval |
| B_random | Uniform selection among eligible summaries, using a separate deterministic draw |
| C_recent | Most recently recorded eligible summary |
| D_mean | Mean of eligible latent vectors with similarity and gain recomputed for that mean |
| E_off | No recalled vector; summary creation stays on |

For B and C, each selected summary keeps its own similarity-dependent gain.
D changes aggregation and gain, not just selection. Its synthetic mean does not
receive a second admission test. Zero/tiny vectors use the engine's actual
alignment guard: similarity zero, not 0.5. Exact argmax ties retain the first
candidate, matching the engine.

All arms start from matched seeds and fixed settings, but thereafter evolve
**their own** state, history, memory and adaptive-noise amplitude. This is a
closed-loop policy intervention, not a replay against A's frozen memory store.
The underlying random draws remain seed/tick matched; state-dependent amplitude
need not remain equal. B has one policy draw schedule per seed, not independent
random-policy replicates. `pulse` is a persistent raw-engine stress condition;
the normal session interface only queues individual pulse ticks.

## Controls

`policy.ts` mirrors the pinned step body using the real exported functions.
Frames, events, history, summaries, counters and update order are preserved.
Only recall dispatch changes. Added observables do not enter the feedback path.

For every seed/stimulus A run, every unrounded state, frame, event and feedback
context is compared with the actual `stepSimulation()`. Trace prefixes are not
recompared on every tick, but each appended frame is checked and the complete
trace is checked at the end. The final complete context, events, state and hash
sequence are also checked against `run()`. E is independently compared with the
real engine's memory-off switch. A failed control aborts report creation.

The old eight-character state hashes remain secondary diagnostics. They round
to six decimal places and cannot establish bitwise numerical equality alone.
A regression test deliberately adds a sub-hash-precision perturbation and
requires the stronger control to reject it.

## Measurements and interpretation

Candidate survival and candidate-available-step survival have separate
numerators and denominators. A threshold curve is measured on A's actual
trajectory; it is not a rerun under that altered threshold.

Winner margins and winner/runner-up or winner/random injection differences use
each packet's own gain. Margins have explicit sample counts and counts below
1e-12, 1e-9 and 1e-6. These are descriptive proximity checks, not a bound on
cross-runtime error or proof that winner swaps cannot occur.

Recency is measured by comparing the actual chosen node ID with the newest
eligible node ID. A similar trajectory under C does not prove A selects C's
node. Ages are `state.t - summary.step`, labeled recorded summary age.

Per-policy path distance, final distance, coherence differences, projection
counts **and exact event-tick disagreement counts** are retained. The last basin
label is not current basin occupancy. The JSON includes both the coarse label
match including `none` and a conditional match with its own denominator.

Projection spacing includes the entire interval histogram, not just its minimum.
With hold=6 and dwell=2, sustained above-threshold candidates can project every
8 ticks: six blocked ticks followed by two qualifying checks. An eight-tick
cadence does not remove the threshold, dwell or hysteresis conditions, or prove
floating-point robustness.

## Coherence decomposition

The weighted terms are alignment 0.325, calmness 0.1625, focus 0.0975 and prior
coherence 0.415. Measurements use the provisional state **before** projection
can raise coherence to 0.82. The original nested arithmetic computes the score;
the expanded terms' floating-point residual is reported.

Two different comparisons are recorded:

* `ownTrajectoryCoherenceTerms`: each complete policy run, including accumulated
  downstream changes. Differences are not a same-state component intervention.
* `sameStateImmediateMemoryEffect`: at each A tick, clone the pre-step feedback,
  remove recall for one step, use identical noise, and compare provisional
  coherence terms and the resulting state/event decision. This isolates the
  immediate local recall intervention at states visited by A, not its total
  long-term effect.

The leave-memory-out input difference is compared with the injection norm to
1e-12, and the maximum floating-point residual is reported. It is not asserted
to be bitwise equal. Norm ratios do not identify percentage contributions when
vectors can reinforce or cancel.

## Browser screen

```bash
npm --prefix experiments/memory-policy-v3 ci
node experiments/memory-policy-v3/node_modules/playwright-core/cli.js install --with-deps chromium firefox webkit
node --experimental-strip-types experiments/memory-policy-v3/browser-replay.mjs --json /tmp/browser-replay.json
```

This runs the **72 reference-engine cases / 6,912 ticks per runtime**, not the
separate Memory Weather fixtures. Node must first match the frozen SHA-256
numerical fixture. Each browser then reports exact numerical-record agreement,
IEEE-754 bit patterns encoded before transport, per-tick diagnostic hashes,
final vectors, and projection event steps and labels. The original pure
`rootRecord()` function is reused, not a second handwritten record definition.

The default command exits nonzero on numerical mismatch. `--observe` records
numerical mismatches without treating them as an execution failure; missing
browsers and runtime errors still exit nonzero. CI uses observation mode because
portability is the question, not an assumed result. A successful observation
job means the screen executed, **not** that all browsers matched. Read
`allExact` and each runtime's status. No tolerances turn a mismatch into a pass.

Playwright and its browser versions are reported. Playwright WebKit is not
branded Safari. Agreement on these fixtures does not guarantee all browsers,
operating systems, versions, inputs or near-threshold conditions. A mismatch
must be localized before proposing a versioned deterministic-math policy; this
work does not install an fdlibm replacement inside the engine.

## Claim limits

Trajectory and event differences establish software behavior in these tested
conditions. No task-utility metric, equivalence margin, minimum useful effect,
power analysis or confirmatory hypothesis was predeclared. Do not conclude
that associative selection is unnecessary, that all memory policies are
equivalent, or that more projection events are better. A memory-off contrast
is not a validation of physics, consciousness or the broader QOFT framework.

Results belong in a dated, source-pinned development record after execution,
not in the historical migration fixture or another experiment's result file.
