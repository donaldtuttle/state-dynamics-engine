# SINGLE-TRAJECTORY-1

Status: REGISTERED. Not run.
Implementation reference: 917c3e9df6a313474b22b28ff6574435313fc808.
This file is the registration. It is not a result.

Seed audit before registration, on that tree: the only assigned experiment
seeds are the closed baseline ranges 1000-1029, 1030-1039, and 1040-1059.
Integers 2000-2111 appear inside hashes, years, and the ES2022 compiler
target, not as initial-state seeds. The range below is unused and is frozen.
Do not replace it after this registration.

Preserve BASELINE_PROPOSAL.md, BASELINE_RESULT.md, their scripts, and their
recorded results unchanged. This is a separate experiment.

Seeds 1040-1059 remain prohibited throughout, including smoke tests,
calibration, debugging, generation, and evaluation.

## 1. Question and scope

Can the frozen engine expose delayed relation information to a linear
readout on unseen starts, using a nuisance correction learned exclusively
from training trajectories?

Primary comparison: corrected engine versus corrected, tuned leaky integrator.

A positive result concerns this task, this correction, and this readout.
It does not establish general memory utility or explain the old four-mode
result conclusively.

## 2. Task: delayed relation recall

State dimension: 12.
Horizon: exactly 64 updates, indexed t = 0,...,63.

Let e1 and e2 be the first two coordinate unit vectors.
For each episode select b1, b2 in {-1, +1}.

Input:

- t = 0,...,7: u(t) = 0.5 * b1 * e1
- t = 8,...,23: u(t) = 0
- t = 24,...,31: u(t) = 0.5 * b2 * e2
- t = 32,...,63: u(t) = 0

Target: 1 if b1 = b2, otherwise 0.

Sign order inside every block is fixed: (+1,+1), (+1,-1), (-1,+1), (-1,-1).
Episode order is increasing seed, then that sign order.

Each seed block contains all four sign combinations.
Both models receive exactly the same recorded vectors.
The last 32 inputs are identical across labels. Either cue alone is
uninformative about the balanced target.

For an unclipped leaky integrator, the endpoint is affine in the two bits.
A linear classifier cannot perfectly separate their agreement relation.
Bounding can change that argument, so actual baseline headroom is checked.

Do not add noise, shorten the delay, change amplitude, substitute a task,
or select a horizon after inspecting scores.

Final-input control feature: the delivered vector u(63). Under this schedule
it is the zero vector for every episode.

## 3. Independent units and split

| Split | Seeds | Blocks | Episodes |
| --- | --- | ---: | ---: |
| Train | 2000-2031 | 32 | 128 |
| Validation | 2032-2047 | 16 | 64 |
| Test | 2048-2111 | 64 | 256 |

A seed block is the independent unit. Its four episodes share the initial
state but have separate, freshly reset simulation contexts.
Never split a block across training, validation, or test.
Never count the 256 test episodes as 256 independent initial states.
Historical results may motivate the design but are not fresh validation.
This is a compact screen for a substantial effect, not a precision study
of a five-percentage-point effect.

Planning approximation: with block-difference SD = 0.30, 64 test blocks
provide roughly 80% power for a true +0.15 advantage against a +0.05
margin using a conventional 95% interval. That SD is an assumption,
not an estimate established by the old task.

Do not enlarge the sample after seeing test uncertainty.

## 4. Models

Engine:

- Frozen implementation and default dynamics.
- Projection, memory, summaries, and adaptive noise off.
- Stimulus slot is quiet so the built-in generator contributes zeros.
- The input adapter then replaces only the delivered data vector and its energy.
- Default seeded initial state and proper smoothed-state initialization.
- No search over smoothing, update scale, coherence, or other dynamics.

Integrator:

- Same 12-dimensional bound operation: clamp each coordinate to [-2, 2], then
  rescale to Euclidean norm 2 if that norm exceeds 2.
- Same seeded initial vector as the engine.
- x(t+1) = bound((1 - a) * x(t) + a * u(t)).
- a is the IEEE-754 float64 value of the decimal string.
- Fixed rate grid:
  0.003125, 0.00625, 0.0125, 0.025, 0.05, 0.1, 0.2, 0.32, 0.5, 0.75, 1.0.

Matching starts is an explicit change for this experiment.
It does not revise the closed baseline, whose integrator started at zero.

Neither dynamics implementation receives labels, class identifiers,
sibling endpoints, or future inputs.

Authorized development fixtures for replay parity, and for nothing else:
numeric seeds 7, 11, and 335389, and the demo string 0x51e1d.
They are outside 1040-1059 and outside 2000-2111.
Parity does not score this relation task.

## 5. Single-trajectory nuisance correction

Fit a separate affine predictor for each model and each rate:

    predicted_final = B * initial_state + c
    feature = final_state - predicted_final

Fit B and c by ordinary least squares on training episodes only, without
labels. Use a float64 SVD pseudoinverse with relative cutoff 1e-12
(numpy.linalg.pinv rcond). The design matrix is the initial state plus a
column of ones. Rows follow the frozen episode order.

The balanced training design prevents a seed's label composition from
varying across blocks. Repeated training starts are permitted.

At validation and test time, B and c are frozen.
Prediction for an episode consumes only that episode's initial and final
vectors. No seed lookup, per-seed fitted intercept, sibling trajectory,
counterfactual quiet run, batch centering, or adaptation is permitted.

This is a learned correction hypothesis. It may fail because the nuisance
depends nonlinearly on the start or interacts with the input.

The same correction family and fitting procedure apply to both models.
Raw, delta, initial-only, and final-input controls do not use this fit.
Delta means final state minus recorded start.

## 6. Readout and selection

Binary logistic regression with an intercept.

Let z be the standardized feature and p = sigmoid(w dot z + b).
Objective: mean negative log likelihood plus (lambda / 2) * ||w||^2.
Do not penalize the intercept.

Negative log likelihood of one row is softplus(eta) - y * eta, with
eta = w dot z + b and softplus(eta) = log(1 + exp(eta)) computed stably.

Standardize each feature coordinate using the training mean and the
training population standard deviation (divide by N, not N - 1).
Replace a standard deviation below 1e-12 with 1.
Apply those frozen training statistics thereafter.

Penalty grid: 0.0001, 0.001, 0.01, 0.1, 1, 10, 100.

Predict class 1 when p >= 0.5.
Fit on training episodes only. No final refit on validation or test.

Solver, frozen before validation:

- float64
- parameters start at w = 0 and b = 0
- Newton-Raphson using the analytic gradient and Hessian
- at most 40 Newton iterations
- stop when the infinity norm of the gradient is below 1e-8
- the Newton direction s solves H s = gradient
- accept a step only if s is a descent direction (gradient dot s > 0)
  and the Armijo condition holds with c = 1e-4
- backtracking starts at step length 1 and halves at most 20 times
- a singular Hessian, a failed line search, or any nonfinite value
  marks that fit as failed
- a fit that already meets the gradient tolerance at initialization
  is converged

Any required fit that fails those criteria invalidates selection.
Do not silently drop unsuccessful candidates. Required fits are every
penalty on the corrected engine, every rate and penalty on the corrected
integrator, and every penalty on the raw, delta, initial-only, and
final-input controls.

Select by validation episode accuracy.
Ties: lower validation log loss, then larger lambda, then larger a.
Validation log loss is the mean unpenalized negative log likelihood.
Engine selects lambda. Integrator selects a and lambda.
No grid extensions.

A selected rate or penalty at a grid edge is disclosed. It does not
authorize extension or replacement.

## 7. Diagnostic controls

Run these declared controls with the same split and readout procedure:

- Engine raw final state.
- Engine final minus recorded start.
- Initial-state-only classifier.
- Final-input-only classifier, using u(63).

Raw and delta controls diagnose whether the learned correction helps.
They cannot replace the primary engine representation after selection.

On complete balanced blocks, initial-only and final-input-only controls
must score exactly 50 percent, since their features repeat across opposite
labels. Any deviation indicates a pipeline defect and stops the experiment.
This check is applied to every split that is scored.

A rule reading the two original cues must score 100 percent:
predict 1 if and only if b1 = b2. This validates labels and the generator.
It is not a competing memory model.

No paired-centering classifier is included.

In the written result, a representation clears chance only when its own
lower 95 percent block-bootstrap bound is above 0.50. Raw and delta use
the same resampled block indexes as the primary interval. Lag means a
strictly lower point accuracy than the corrected engine. These sentences
operationalize section 11. They are not extra success criteria.

## 8. Validation gate and stop rules

Inspect validation once under the fixed selection procedure.
Stop without generating or scoring test trajectories if:

- Input replay, initialization, or reset checks fail.
- A split or prohibited-seed assertion fails.
- A leakage control fails.
- Any required fit fails or produces nonfinite values.
- Selected integrator validation accuracy exceeds 85 percent.

The 85 percent ceiling leaves room to examine a practical advantage.
If triggered by that ceiling, report TASK_UNINFORMATIVE and close this
protocol. Do not repair the task inside this experiment.

Do not require a favorable engine validation result to proceed.
Chance-level engine validation remains reportable and does not authorize
a new feature, task, horizon, or dynamics setting.

## 9. Two locks

Before validation, freeze this protocol, the generator, the seed
allowlists, the engine reference, the input adapter, the correction, the
grids, the optimizer, the selection rules, the controls, the inference
code, and the analysis code.

Verify replay parity against the frozen engine on the authorized
development fixtures. Custom inputs must change only input delivery, not
equations or update order. When the delivered vector equals the vector
sampleInput produced, the adapter trajectory must match stepSimulation.

Before test generation, freeze the selected parameters, all fitted
coefficients and preprocessing, the validation report, dependency
versions, and the SHA-256 manifest.

The test command must require that locked manifest.
Training and validation commands must reject test seeds.
All commands must reject 1040-1059.
No test feature inspection, geometry summaries, or partial scoring before
the final lock.

The lock covers these files:

- docs/SINGLE_TRAJECTORY_1.md
- scripts/st1-adapter.mjs
- scripts/st1-analysis.py
- scripts/st1-run.mjs
- src/engine.ts

## 10. Primary analysis and success

For each of 64 test blocks:

- Compute corrected-engine accuracy across its four episodes.
- Compute corrected-integrator accuracy across its four episodes.
- Record their paired difference.

Primary estimand: mean paired accuracy difference, engine minus integrator.

Report both absolute accuracies, the difference, and a two-sided 95
percent percentile bootstrap interval.
Bootstrap whole seed blocks jointly across models:
50,000 resamples; NumPy PCG64 seed 20261005; quantile method "linear".
One draw of block indexes is reused for the engine accuracy, the
integrator accuracy, the difference, and the raw and delta diagnostics.
Report interval width and disclose that bootstrap coverage is approximate.

Primary success requires BOTH:

1. Lower 95 percent bound for engine-minus-integrator accuracy > +0.05.
2. Lower 95 percent bound for engine accuracy > 0.50.

These are conjunctive requirements, not alternative routes to success.

For the difference interval:

- Lower bound > +0.05: practical advantage supported, subject to (2).
- Upper bound < +0.05: advantage exceeding the margin ruled out by this
  interval procedure on this task.
- Otherwise: inconclusive.

If the integrator unexpectedly exceeds 85 percent on test, report
unexpected test ceiling and no benefit verdict. Publish the locked scores
and intervals. Do not modify the experiment.

## 11. Interpretation of diagnostics

Report raw, delta, and corrected engine accuracies side by side.
Primary success alone does not establish that nuisance correction caused
the advantage. Improvement over raw and delta is a separate diagnostic
comparison, not another primary success criterion.

Possible readings:

- Corrected engine succeeds while raw and delta lag:
  consistent with nuisance masking. Independent confirmation is needed.
- Engine clears chance but not the integrator margin:
  usable signal shown, comparative benefit not established.
- No engine representation clears chance:
  this task and these readouts did not demonstrate usable signal.
  Do not conclude that all class information is absent.
- Validation ceiling or invalidity:
  no test benefit verdict.

This experiment does not test memory modules, basin projection, general
intelligence, or the original four-generator classification claim.

## 12. Completion and failure handling

Score the locked test set once and publish all declared arms and controls.
No optional stopping, sample extension, or replacement test split.

A technical retry is allowed only for an interrupted identical execution,
with identical hashes and no changed analysis. If a result file already
exists, the test command must refuse.

A substantive defect discovered after test exposure invalidates this run.
Document it. A corrected experiment requires a new protocol and fresh test
seeds. Never reuse 1040-1059 as a rescue set.

The key limitation is deliberate: this can establish usable
single-trajectory information on a new temporal task. It cannot
retroactively turn the old paired contrast into a demonstrated capability.
