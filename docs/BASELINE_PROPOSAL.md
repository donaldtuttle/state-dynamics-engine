# Baseline comparison

Status: CLOSED. The ceiling rule triggered. See [docs/BASELINE_RESULT.md](BASELINE_RESULT.md).

The rules below were declared first and were not changed after the pilot.
Test seeds 1040-1059 were never scored. There is no benefit verdict.

Pilot, validation seeds 1030-1039 only:

- Integrator accuracy was 40/40 at 64, 32, and 16 ticks.
- Engine accuracy was 11/40. Chance for four classes is 10/40.
- At 64 ticks the seed's share of the engine's final-state sum of squares was 0.997. The mean cosine with the starting state was 0.999.

Within-seed check, same validation seeds, not a verdict. After each seed's mean across the four generators is removed, SS_class / SS_residual is 8.08 at 64 ticks, 7.35 at 32, and 5.42 at 16. The class contrast is present in that paired residual. It is small: the mean distance between two modes of the same seed is 0.056 at 64 ticks. Removing the recorded start instead, and fitting a leave-one-seed-out linear readout, scored between 10/40 and 15/40. State minus start does not by itself name the generator.

Say that a predeclared ceiling rule caught an uninformative task before any test seeds were scored. Do not say that the engine fails or underperforms.

Matching the historical implementation is migration evidence. It is not evidence that this engine is useful, novel, or better than a simpler model.

## What a primary result would mean

The primary arm compares a bounded smoothing map with a 12-dimensional leaky
integrator. Memory, basin projection, and noise are off. A pass or a fail on
that arm says nothing about memory or projection.

This document does not give the secondary arms a hypothesis, a threshold, or
a split. They are not pass/fail. If a later write-up is going to claim
something about memory or projection, that hypothesis has to be declared
before those runs are scored. It cannot be added afterward, and it cannot
change the primary verdict.

Disclosure for any arm that turns projection on: the input generator named
`basin` is built from the same six vectors that projection blends toward.
With projection off, both models only receive that waveform. With projection
on, accuracy on the `basin` label is partly circular.

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

Primary hypothesis: on the test seeds below, at the horizon locked by the
rules in this document, with projection, memory, summaries, and noise turned
off, the lower end of the test interval lies above +0.05 accuracy. Mechanisms
are off so the comparison is the core smoothing update, not the extra
machinery. That is the only pass/fail.

Runs with mechanisms on, or with projection alone, are a different question.
They have no hypothesis here. Report them separately if they are run. They
cannot replace the primary result. A projection-on score on the `basin`
generator is partly circular, as stated above.

### Data

The label is the name of the input generator. It is chosen before either
model runs. It is not the engine's basin assignment, and the readout does not
receive it.

Modes: `quiet`, `align`, `periodic`, and `basin`. `disrupt` is left out of the
primary set because its stimulus draws extra random numbers. Adding it later
requires logging those draws.

`quiet` is the zero vector. `align` and `periodic` are fixed functions of the
tick and the coordinate index. `basin` copies the same hand-written basin
table used by projection, scaled by tick. With projection off, that copy is
only an input waveform.

For every seed and mode, record the 12-number stimulus at ticks 0 through 63
from `sampleInput`, with noise and memory inactive. Both models then receive
that recorded sequence, or a prefix of it if the horizon rule below shortens
the run. Do not regenerate a different waveform for a shorter horizon. The
envelope in `stimulusVec` depends on the tick, so the prefix is the shorter
run of the same generator. Neither model sees the mode label while the state
is running.

This needs a new input adapter. `run()` currently generates its own stimulus.
The adapter must inject the recorded vectors without changing the equations or
defaults used by the product. If a recorded sequence disagrees with a normal
engine run of the same mode, seed, and ticks, the experiment is invalid.

### Split

Seeds are assigned before any test result is computed.

| Split | Seeds | Role |
| --- | --- | --- |
| Train | 1000-1029 | Fit the readout only |
| Validation | 1030-1039 | Choose `a`, the readout penalty, and the horizon |
| Test | 1040-1059 | Score once, and only if the task stays informative |

Each seed contributes four sequences, one per mode. No seed is reused.
Validation accuracy is the fraction correct among those 40 sequences.

### Models and readout

Leaky integrator, the only tuned baseline dynamics:

```text
x(0) = 0
x(t+1) = bound((1 - a) * x(t) + a * u(t))
```

`bound` is the engine's own clamp and norm limit. The starting grid for `a`
is 0.05, 0.1, 0.2, 0.32, and 0.5.

The engine uses `createInitialState`, the default smoothing rate, and the
default update scale. Do not search those constants. The integrator starts at
the zero vector, not at the engine's seeded state. Do not change either
initial state after seeing a score. The engine therefore gets no search over
its update. The integrator's rate grid is the larger one.

Readout: one linear classifier (multinomial logistic regression) from the
12-number state after H inputs to the four mode labels. Fit a separate
readout for each model on the training states only. Do not give the
classifier coherence, the basin id, the mode name, memory terms, or a
nonlinear hidden layer. Both models see the same twelve numbers.

The L2 penalty strength, called lambda here, is not left at 1. A fixed
penalty depends on feature scale and can favor one geometry. Choose lambda on
the validation split only, from 0.01, 0.1, 1, 10, and 100. The engine gets
one of those five values. The integrator gets one of those five values at the
same time as its choice of `a`, so the integrator's joint grid is larger.
That keeps the stricter reading: both readouts are tuned the same way, and
only the baseline's dynamics are searched.

Selection uses validation accuracy only. If two engine penalties tie, take
the larger lambda. If two integrator pairs tie, take the larger lambda, then
the larger `a`. The test readout is that training fit. Do not refit on
validation or test states.

Edge rule for `a`, still on validation only, at most two extensions:

- If the selected `a` is 0.05, add 0.025 and select again.
- If the selected `a` is then 0.025, add 0.0125 and select again.
- If the selected `a` is 0.5, add 0.75 and select again.
- If the selected `a` is then 0.75, add 1.0 and select again.
- Stop early when the selected `a` is not the new edge. A value of `a` must
  stay in (0, 1].
- If the selected `a` is 0.0125 or 1.0, stop and report that the cap was hit.
- Each extension re-selects the pair (`a`, lambda) on the enlarged rate grid.
  The lambda grid does not grow. If the chosen lambda is 0.01 or 100, report
  that edge and do not add a new penalty.
- A new horizon starts again from the five original rates. Extensions do not
  carry over.

### Ceiling

Pilot both models on seeds 1030-1039 while choosing `a` and lambda. Never use
seeds 1040-1059 for this pilot.

After that choice, if the tuned integrator's validation accuracy is greater
than 0.90, the task is uninformative at that horizon. The baseline is then
near the top of the scale. Failing to clear +0.05 on a later test would not
show that the engine had no benefit. Do not score that horizon.

The only difficulty knob is a shorter horizon. Observation noise on the
readout is not an alternative, and it cannot be introduced after seeing the
pilot. If the 64-tick horizon is uninformative, repeat selection at the
32-tick prefix. If that is still above 0.90, repeat once more at the 16-tick
prefix. That is at most two shortenings. Re-select `a` and lambda from
scratch at the new horizon, including the edge rule, before any test score.

The ceiling trigger is the integrator's validation accuracy, not the
engine's. Report the engine's validation accuracy and do not use it to choose
the horizon. If the integrator is still above 0.90 at 16 ticks, do not score
the test seeds. The result is that the task is uninformative.

If the integrator's validation accuracy is 0.90 or below, lock the horizon,
`a`, and both penalties. Then score the test seeds once.

### Metrics

Primary metric: accuracy on the test seeds, paired by seed. For each test
seed, score the four modes, then subtract the integrator's accuracy from the
engine's. That is 20 paired differences.

Uncertainty: a 95 percent percentile bootstrap of those differences, with
10,000 resamples. In every case report the interval and its width, upper
minus lower.

Verdict, compared with +0.05 and not with 0:

- Lower bound above +0.05: benefit shown.
- Upper bound below +0.05: a benefit above the margin is ruled out.
- The interval straddles +0.05: inconclusive.

An interval such as [-0.01, +0.03] rules the margin out. An interval such as
[-0.04, +0.12] is inconclusive. Do not describe those two cases with the same
sentence. Width is reported in all three cases.

Within the ruled-out tier, also say whether the interval lies entirely below
0. Entirely below 0 means the engine was behind on this split. That is not
the same result as a small interval that crosses 0 or sits between 0 and
+0.05, and it is not a fourth pass/fail tier.

If the ceiling rule forbids test scoring, there is no benefit verdict.

Also report both models' test accuracies. If the integrator's test accuracy
is above 0.90 even though its validation accuracy was not, say so. Do not
shorten the horizon after seeing test seeds, and do not turn that into a
benefit.

Secondary diagnostics, not success criteria: accuracy of each mode, the mean
distance between the two models' final states, and the validation accuracies
used by the pilot. Do not treat coherence as a performance score.

### Arms that are not the primary claim

These runs have no predeclared hypothesis, threshold, or split:

- Default mechanisms on, same recorded inputs.
- Projection on, the other mechanisms off.

A lead that appears only there is not a primary result. For the projection-on
run, read the `basin` class as partly circular.

The result is not interpretable if:

- The injected inputs do not match a normal run of the same mode, seed, and
  ticks.
- The ceiling check uses test seeds, or is skipped.
- `a`, lambda, or the horizon changes after any test seed is scored.
- Test seeds are used to choose `a`, lambda, the horizon, or the readout.
- The validation choice of `a` flips when one point of the original
  five-value grid is removed. Report that if it happens. Do not replace the
  selected value with the flipped one.

### How to read a difference

These are not a shown benefit:

- The interval straddles +0.05 (inconclusive).
- The upper bound is below +0.05 (margin ruled out).
- The task is still above the 0.90 ceiling at 16 ticks.
- The engine is ahead only when extra mechanisms are on.
- The engine is ahead on the training seeds and not on the test seeds.

Do not run this experiment as part of a documentation change, and do not tune
it until a favorable number appears.
