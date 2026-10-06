# SINGLE-TRAJECTORY-1

Status: DESIGN. Proposed, not registered or run.
Implementation reference: `917c3e9df6a313474b22b28ff6574435313fc808`.
The engine source SHA-256 is
`db7c664d2fc14b8560ef2e6975f69aca3f640a89d994881baa140dbb7ae6804f`.
This proposal incorporates the explicit clarifications in REVIEW.md.

## 1. Question and scope

Can the frozen engine expose delayed relation information to a linear readout
on unseen starts, using a nuisance correction learned exclusively from training
trajectories? The primary comparison is corrected engine versus corrected,
tuned leaky integrator. A positive result concerns this task, correction and
readout. It establishes neither general memory utility nor a conclusive
explanation of the old four-mode result.

Preserve docs/BASELINE_PROPOSAL.md, docs/BASELINE_RESULT.md, their scripts and
recorded results unchanged. Seeds 1040 through 1059 are prohibited in this
experiment, including smoke tests, debugging, generation and evaluation.

## 2. Delayed relation recall

State dimension is 12. Run exactly 64 updates, indexed 0 through 63. Let e1 and
e2 be the first two coordinate unit vectors and b1,b2 each be -1 or +1.

| Updates | Recorded input |
| --- | --- |
| 0 through 7 | 0.5 * b1 * e1 |
| 8 through 23 | zero |
| 24 through 31 | 0.5 * b2 * e2 |
| 32 through 63 | zero |

Target is 1 for equal signs and 0 otherwise. Each seed block contains the four
sign combinations in order (-1,-1), (-1,+1), (+1,-1), (+1,+1). Both models
receive the same recorded vectors, without stimulus-envelope rescaling.
Final state means the state after update 63, at state.t = 64. Initial state
means before update 0. The last 32 inputs are identical across labels; either
cue alone is uninformative in a complete balanced block.

The integrator endpoint is affine in the two bits. In this design the bound
is inactive in exact arithmetic: the initial norm is at most 2, input norm is
at most 0.5, and each update is a convex combination with 0 < a <= 1. Thus a
linear classifier cannot perfectly separate agreement within a block. The
validation ceiling remains an empirical safeguard, including numerical defects.

Do not add noise, shorten delay, change amplitude or horizon, substitute tasks,
or choose settings after scores are inspected.

## 3. Independent units and splits

| Split | Numeric seeds, inclusive | Blocks | Episodes |
| --- | --- | --- | --- |
| Train | 2000 through 2031 | 32 | 128 |
| Validation | 2032 through 2047 | 16 | 64 |
| Test | 2048 through 2111 | 64 | 256 |

Check prior experiment manifests and available history before registration.
Require a reviewed inventory with file hashes and an owner attestation about
unpublished use. A repository search cannot establish absence of private use.
If any proposed seed was examined, replace the entire study range before any
generation and review/freeze the amended proposal. Seeds are numeric uint32
values, not strings, booleans, fractions or wrapped aliases.

A seed block is the independent unit. All four episodes share an initial
vector and receive freshly reset contexts, including smoothed state. Never
split a block across splits or count 256 test episodes as 256 independent
starts. Historical results are not fresh validation.

This is a compact screen for a substantial effect. Assuming a block difference
SD of 0.30, 64 blocks give approximately 80% power for a true +0.15 advantage
against a +0.05 margin with a conventional 95% interval. This is a planning
approximation, not demonstrated bootstrap coverage or an estimated SD from the
old task. No sample extension after test uncertainty is observed.

Development parity and reset fixtures use only 9000001, 9000002 and 9000003.
These are excluded from every study split and must also be included in the
pre-registration audit. Development checks do not fit or score the study task.

## 4. Models

Engine: frozen source, default dynamics, projection/memory/summaries/noise all
off; default seeded initial state with proper smoothed-state initialization.
No dynamics search. The adapter replaces only the input-delivery expression
inside stepSimulation. Source hash and a unique replacement anchor are required.
All equations, diagnostics and update ordering remain the frozen engine's.

Integrator: same initial vector and bound operation (coordinate clamp [-2,2],
then radial projection to norm 2). Update:

    x(t+1) = bound((1-a)*x(t) + a*u(t))

Fixed rates: 0.003125, 0.00625, 0.0125, 0.025, 0.05, 0.1, 0.2, 0.32, 0.5,
0.75, 1.0. Matching starts is specific to this new experiment; the closed
baseline integrator started at zero and is not revised.

Dynamics receive no labels, class identifiers, sibling endpoints or future
inputs. The adapter computes endpoints from seed and recorded inputs before
attaching labels. No endpoints or context are shared between episodes.

## 5. Single-trajectory correction

For each model/rate fit an affine predictor of final state from initial state:

    predicted_final = B * initial_state + c
    feature = final_state - predicted_final

Fit on all training episodes only, without labels, using float64 NumPy SVD
pseudoinverse with relative cutoff 1e-12 on [initial_state, 1]. The stored
13-by-12 coefficient matrix uses row vectors, equivalently the formula above.
Balanced repeated starts are permitted. Freeze B,c before validation/test
inference. Every episode uses only its own initial and final vectors.

No seed lookup, fitted per-seed intercept, sibling endpoint, quiet counterfactual,
batch centering or adaptation. Nonlinear nuisance or input/start interactions
may defeat this correction. Both models use the same correction family.

## 6. Readout and selection

Binary logistic regression, intercept unpenalized; objective is mean negative
log likelihood plus (lambda/2)*squared weight norm. Training coordinate means
and population SDs standardize features. Replace SD < 1e-12 with 1. Apply only
frozen training statistics thereafter.

Penalty grid: 0.0001, 0.001, 0.01, 0.1, 1, 10, 100. Class 1 when probability
>= 0.5 (equivalently logit >= 0). Fit on training only; no validation refit.

Select highest validation accuracy, then lowest log loss, then largest lambda,
then largest a. Comparisons use exact computed float64 values, without a
near-tie tolerance. Engine selects lambda; integrator selects a and lambda.
No grid extensions. Disclose selection at either endpoint of each grid.

Optimizer is zero-initialized Newton, at most 100 updates, stopping only when
gradient infinity norm < 1e-8. Solve the Hessian system directly. Armijo
coefficient 1e-4; try steps 1, 1/2, ..., 2^-59. Nonfinite values, nonpositive
descent, singular solves, exhausted search or nonconvergence invalidate the
whole selection. No candidate is dropped. The intercept is last in the stored
parameter vector. Stable logaddexp computes loss; no epsilon loss clipping.

## 7. Controls

Fit and independently select lambda for engine raw final, engine final minus
start, initial state only, and final input only, with the same procedure.
These cannot replace the primary representation. There are 112 required fits:
77 integrator candidates and 35 across corrected engine and four controls.

Every initial-only and final-input-only candidate must score exactly 50% on
validation, and their selected models must do so on test. Repeated features
across opposite labels require this exactly. A cue-reading oracle must score
100% on every generated split. Any failure stops the experiment. No paired
centering classifier is included.

## 8. Validation gate

Inspect validation once under the fixed selection procedure. Stop without
test generation if replay, initialization/reset, split, prohibited-seed,
leakage, finite-value or required-fit checks fail. A selected integrator
validation accuracy strictly above 85% yields TASK_UNINFORMATIVE and closes
the protocol. Do not repair the task inside this experiment.

There is no favorable engine score requirement. Chance-level validation is
reportable and permits no changed feature, task, horizon or dynamics.

## 9. Two locks

Before validation, freeze protocol, generator, seed allowlists, source pin,
input adapter, correction, grids, solver, controls, selection, inference and
analysis. Require explicit approval identifying this protocol's digest and a
registration reference, a completed seed audit, and replay parity on development
fixtures. Pin exact runtime/dependency versions and NumPy build in this lock.

Before test generation, freeze selected parameters, fitted coefficients,
preprocessing, full validation report, recorded training/validation data and
the first lock in a SHA-256 manifest. Require a separate test approval record.
The test command must verify both locks, all covered files and environment.
Training/validation reject test seeds. All generation rejects 1040 through 1059.
No test features, geometry summaries or partial scoring before the second lock.

The checked-in implementation remains DESIGN. No approval records or study
locks ship with it. Approval metadata records a human decision; hashes are
integrity checks, not signatures or protection against an owner editing code.
Enforcement covers this experiment's commands, not arbitrary access to the
general-purpose engine or unchanged historical scripts.

## 10. Primary analysis

For each of 64 test blocks compute each model's accuracy over four episodes,
then engine minus integrator. Primary estimand is the mean paired block
accuracy difference. Report both absolute accuracies and the difference.

Use 50,000 whole-block paired bootstrap resamples, NumPy PCG64 seed 20261005.
Construct one 50000-by-64 integer index matrix and reuse it for all intervals.
Two-sided 95% percentile intervals use quantiles 0.025 and 0.975, method linear.
Report widths. Coverage is approximate and conditional on the frozen training
sample, fits and selection; this bootstrap does not quantify retraining variation.

Primary success requires BOTH difference lower bound > +0.05 and corrected
engine accuracy lower bound > 0.50. Difference upper bound < +0.05 rules out
an advantage exceeding that margin under this interval procedure on this task.
Otherwise the margin comparison is inconclusive. If the difference lower bound
clears the margin but the engine chance gate fails, report no benefit verdict
and disclose the failed chance gate. These are conjunctive tests.

If integrator test accuracy unexpectedly exceeds 85%, report unexpected test
ceiling and no benefit verdict, publishing locked scores and intervals unchanged.

## 11. Diagnostic interpretation

Report raw, delta and corrected engine accuracies and marginal block intervals
side by side, plus all controls. Diagnostic intervals are descriptive, without
multiplicity correction. A diagnostic arm 'clears chance' only if its marginal
lower bound exceeds 0.50; it cannot authorize a primary success claim.

Corrected success with lagging raw/delta is consistent with nuisance masking;
it does not establish that correction caused the advantage. Engine above chance
without the integrator margin shows usable signal under this readout without
comparative benefit. If no representation clears chance, these readouts did
not demonstrate usable signal; information absence does not follow. Invalidity
or a validation ceiling yields no test benefit verdict.

This experiment does not test memory modules, projection, general intelligence
or the original four-generator classification claim. See REVIEW.md for the
sign-symmetry limitation and why a positive outcome would need replication.

## 12. Completion and defects

Score the locked test once and publish all declared arms/controls. No optional
stopping, extension or replacement test split. Exclusive attempt markers block
accidental reruns. Interruptions leave the attempt closed to automatic retry;
an audited recovery may rerun only identical hashes and identical analysis.
No automatic delete/reset/unlock command exists.

A substantive defect after test exposure invalidates the run. Document it and
use a new protocol and fresh test seeds for a corrected experiment. Never use
1040 through 1059 as a rescue set.
