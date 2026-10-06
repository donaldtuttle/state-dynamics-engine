# Review of the proposed design

Status: source inspection and development checks only. No study seed generated.

The primary comparison is interpretable as a fixed supervised pipeline on new
starts, conditional on its training data. The held-out blocks, balanced labels,
training-only correction, fixed grids and conjunctive success rule are retained.

## Material limitations

1. Bounding does not rescue the integrator here. The ball of radius 2 is convex,
   and its inputs lie inside it. The recurrence stays inside without clipping
   in exact arithmetic. An affine correction and coordinate standardization
   preserve its affine dependence on the two bits. The comparison tests a
   nonlinear representation against a deliberately linear baseline on agreement.
   It does not establish general competitive memory performance. Floating-point
   residue can perturb logistic decisions near zero; retain the empirical gate.
2. The engine also has a relevant symmetry. With these mechanisms disabled,
   jointly negating start and all inputs negates the vector trajectory while
   preserving norms, coherence and the agreement label. Over a distribution of
   starts symmetric about zero this can erase class mean differences. Balanced
   logistic regression can then favor the constant predictor even when class
   information exists in nonlinear geometry. The finite numeric seed sample is
   not guaranteed exactly symmetric. This is a risk to sensitivity, not a claim
   that every finite split must score 50%. Preserve the proposed task and report
   failure faithfully; do not silently substitute quadratic features.
3. A 95% bootstrap interval over test starts is conditional on the selected fit.
   It does not cover variability from choosing another training sample. The
   approximate power calculation is an assumption, not a verified power study.
   Interpreting the interval beyond these particular seeds also assumes that
   the declared consecutive seed range represents the intended start population.
4. A good corrected score would not identify the cause of an improvement over
   raw/delta representations, nor establish the old task's failure mechanism.

## Clarifications implemented before any study generation

- Exact endpoint indexing, sign order, numeric seed types and disjoint development
  allowlist; complete blocks and identical starts are checked at ingestion.
- No stimulus-envelope rescaling for the recorded custom vectors.
- Full step/context parity for the adapter across all six built-in inputs on
  development seeds; no production equations edited.
- Solver, loss arithmetic, tie ordering, candidate count and failure criteria
  fixed. All candidates must converge; intercept is never penalized.
- Engine absolute-accuracy interval uses the same bootstrap draws as the paired
  difference. Diagnostic chance statements have an explicit descriptive rule.
- Exact dependencies captured at the first lock, not deferred until test.
- Immutable stage artifacts, attempt markers, approval/registration metadata,
  seed-audit inventory and both manifest checks precede generation.
- No automatic recovery from invalid or interrupted runs, and no claim that
  local hashes authenticate an approval or sandbox an owner.

## Seed review scope

At inspected repository main c5f52039e81f0dcd4a97da5d13c121546520a158, the
historical baseline and exploratory scripts declare study seeds 1000 through
1059 (exploration used training/validation). No prior study declaration of the
proposed 2000 through 2111 range was found in those documents/scripts. This is
not evidence about uncommitted work, other branches, other chats or private
experiments. Registration requires the explicit inventory and owner attestation
described in README.md. The current task does not supply that attestation.

## Decision

Suitable to implement and review as a proposal with these limitations visible.
Not approved, registered, or executed. A null result would remain scientifically
limited by the linear readout and the sign symmetry; registration should accept
that risk explicitly rather than interpreting null accuracy as absent memory.
