# Baseline comparison

Status: PROPOSED / NOT RUN.

No task evaluation is in this repository. Matching the historical
implementation is migration evidence. It is not evidence that this engine is
useful, novel, or better than a simpler model.

## What the implementation actually is

Each reference step, in `src/engine.ts`, does all of the following:

1. Smooth the previous state toward the current state.
2. Build an input from a stimulus, plus optional seeded noise and an optional
   recalled history summary.
3. Form a bounded step from input minus state. Coherence changes the scale.
4. Combine that step with the smoothed state, then clamp each component to
   [-2, 2] and limit the vector norm to 2.
5. Optionally blend the state most of the way toward the nearest of six fixed
   basin vectors.

The twelve coordinates are abstract. They are not assigned physical units or
psychological meanings.

### Leaky integrator

A discrete leaky integrator keeps one vector and replaces it with a mix of
itself and the current input:

```text
x <- bound((1 - a) * x + a * u)
```

The reference engine has a smoother of that general shape, and its update is
also pulled by the current input. It is not only that filter. The stored state
is the gated combination, coherence changes the gain, and memory and basin
projection are additional optional steps. Calling the engine a leaky integrator
would drop those parts.

### Echo-state network

Jaeger (2001) describes a large recurrent reservoir whose internal weights stay
fixed, with the echo-state property used so that only the weights to the output
units are trained.

This release has a fixed 12-dimensional update and no trained readout. It does
not build a random reservoir, and it does not claim the echo-state property.
Shared words such as "recurrent" and "memory" do not make it an echo-state
network.

Jaeger, H. (2001). The "echo state" approach to analysing and training
recurrent neural networks. GMD Report 148, German National Research Center
for Information Technology.

### Hopfield network

Hopfield (1982) defines an attractor network whose state moves by a threshold
rule on a weight matrix, as a content-addressable memory.

Basin projection here blends toward the nearest of six hand-written vectors
when coherence, dwell, hysteresis, and hold allow it. There is no weight
matrix, no Hebbian learning, and the recorded `energyDrop` is a change in
vector norm, not a Hopfield energy. The projection is attractor-like only in
that loose sense.

Hopfield, J. J. (1982). Neural networks and physical systems with emergent
collective computational abilities. Proc. Natl. Acad. Sci. USA 79(8),
2554-2558. https://pmc.ncbi.nlm.nih.gov/articles/PMC346238/

## Proposed experiment

Question: if both models see the same input vectors, and both are scored by a
linear readout of the same size, does the reference engine's final state
identify the stimulus mode more accurately than a 12-dimensional leaky
integrator?

Primary hypothesis: on the test seeds below, with projection, memory,
summaries, and noise turned off, the engine's classification accuracy exceeds
the integrator's by enough to meet the threshold below. Mechanisms are off so
the comparison is the core update, not the extra machinery.

A second arm may turn the default mechanisms on. That arm is a different
question. It must be reported separately and cannot replace the primary result.

### Data

Modes: `quiet`, `align`, `periodic`, and `basin`. `disrupt` is left out of the
primary set because its stimulus draws extra random numbers. Adding it later
requires logging those draws.

For every seed and mode, record the 12-number stimulus at ticks 0 through 63
from `sampleInput`, with noise and memory inactive. Both models then receive
that recorded sequence. Neither model sees the mode label while the state is
running.

This needs a new input adapter. `run()` currently generates its own stimulus.
The adapter must inject the recorded vectors without changing the equations or
defaults used by the product. If the adapter's recorded `basin` sequence
disagrees with a normal engine run, the experiment is invalid.

### Split

Seeds are assigned before any test result is computed.

| Split | Seeds | Role |
| --- | --- | --- |
| Train | 1000-1029 | Fit the readout only |
| Validation | 1030-1039 | Choose the integrator rate |
| Test | 1040-1059 | Report the comparison once |

Each seed contributes four sequences, one per mode. No seed is reused.

### Models and readout

Leaky integrator, the only tuned baseline:

```text
x(0) = 0
x(t+1) = bound((1 - a) * x(t) + a * u(t))
```

`bound` is the engine's own clamp and norm limit. Choose `a` on the validation
split only, from 0.05, 0.1, 0.2, 0.32, and 0.5.

The engine uses `createInitialState`, the default smoothing rate, and the
default update scale. Do not search engine constants. The engine therefore
gets no tuning on this task. The integrator gets one predeclared grid.

Readout: one linear classifier (multinomial logistic regression, L2 strength
1) from the 12-number state after 64 inputs to the four mode labels. Fit a
separate readout for each model on the training states only. Do not give the
classifier coherence, the mode name, or a nonlinear hidden layer.

### Metrics

Primary metric: accuracy on the test seeds, paired by seed. For each test
seed, score the four modes, then subtract the integrator's accuracy from the
engine's.

Uncertainty: a 95 percent percentile bootstrap of those 20 paired differences,
with 10,000 resamples. Report the interval.

Secondary diagnostics, not success criteria: accuracy of each mode, and the
mean distance between the two models' final states. Do not treat coherence as
a performance score.

### Ablations and failure modes

Optional descriptions, not the primary claim:

- Default mechanisms on, same recorded inputs.
- Projection on, the other mechanisms off.

The result is not interpretable if:

- The injected inputs do not match a normal run of the same mode and seed.
- Either model is near chance on every mode, or both are near a perfect score,
  so the task does not separate them.
- The validation choice of `a` flips when one grid point is removed. Report
  that if it happens.
- Test seeds are used to choose `a` or the readout.

### How to read a difference

Count a benefit only if the test interval lies entirely above +0.05 accuracy
(5 percentage points). A smaller positive estimate, or an interval that
includes 0, does not support the hypothesis.

Outcomes that count against the proposed benefit:

- The interval includes 0 or lies below 0.
- The engine is ahead only when extra mechanisms are on, and not in the
  primary comparison.
- The engine is ahead on the training seeds and not on the test seeds.

Do not run this experiment as part of a documentation change, and do not tune
it until a favorable number appears.
