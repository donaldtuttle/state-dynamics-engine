# SINGLE-TRAJECTORY-1 completed run

Validation and the locked test completed on 2026-10-06. All validity gates
passed. Primary verdict: MARGIN_RULED_OUT. The prespecified practical advantage
was not supported on this task under this correction and readout.

## Final test result

| Arm | Correct / 256 | Accuracy | Descriptive 95% interval |
| --- | --- | --- | --- |
| Corrected engine (primary) | 123 / 256 | 48.046875% | 45.3125% to 50.78125% |
| Corrected integrator (primary) | 128 / 256 | 50% | 50% to 50% |
| Raw engine | 128 / 256 | 50% | 48.828125% to 51.171875% |
| Engine final minus start | 128 / 256 | 50% | 50% to 50% |
| Initial state only | 128 / 256 | 50% | 50% to 50% |
| Final input only | 128 / 256 | 50% | 50% to 50% |

Engine minus integrator was -1.953125 percentage points. The paired 95%
bootstrap interval was -4.6875 to +0.78125 percentage points, width 5.46875
points. Its upper bound is below the predeclared +5-point margin. The corrected
engine's absolute-accuracy lower bound also failed the above-chance requirement.
Neither success criterion passed. The interval includes zero, so this does not
establish that the engine is worse.

The bootstrap resampled 64 complete seed blocks, jointly across models, 50,000
times with PCG64 seed 20261005 and linear quantiles. It is conditional on the
frozen fitted models and has approximate coverage. Diagnostic intervals are
descriptive. No engine representation cleared chance by its declared interval
rule. This does not prove class information is absent, especially given the
linear readout and sign-symmetry limitation documented in REVIEW.md.

The integrator did not trigger the unexpected test ceiling. Both leakage
controls and the cue oracle passed. Test generation occurred once, only after
the second lock was publicly committed at
`64d410565263e4c674e15d0b55415be864f7557d`. The test authorization record cites
the owner's existing request to check and run; it does not claim a new message
after validation. No retuning, additional samples or replacement split occurred.

The owner authorized validation and reported no known outside use of study
seeds 2000 through 2111, qualified as "as far as I know". That qualification is
preserved in seed-audit.json. Development fixtures were previously disclosed.

The source and protocol were frozen at merged commit
`f3d67335446b722ecd63be3a5e2de52cef7b9928`. The first lock, approval and audit
were published at commit `31577dca43c8e34a6dda61f1da6d4af32e9a400d` before
the validation command was executed. This is a GitHub timestamped registration
record, not registration with an independent study registry. The original
DESIGN document remains the frozen specification; these records track execution.

## Selected validation scores

| Arm | Correct / 64 | Accuracy | Lambda | Rate |
| --- | --- | --- | --- | --- |
| Corrected engine (primary) | 31 / 64 | 48.4375% | 0.0001 | n/a |
| Corrected integrator (primary) | 32 / 64 | 50% | 100 | 1.0 |
| Raw engine | 33 / 64 | 51.5625% | 0.01 | n/a |
| Engine final minus start | 33 / 64 | 51.5625% | 0.1 | n/a |
| Initial state only | 32 / 64 | 50% | 100 | n/a |
| Final input only | 32 / 64 | 50% | 100 | n/a |

All 112 required fits converged. Both leakage controls passed exactly. The
cue oracle, complete-block, input, state and reset checks passed. The baseline
did not exceed the 85% validation ceiling. A favorable engine score was not
required by the protocol and is not a reason to stop or change the design.

The corrected engine selected the minimum lambda. The integrator selected
maximum lambda and maximum rate. Both leakage controls selected maximum lambda.
At rate 1, the integrator's final zero-input update erases its state. All these
edge selections are disclosed; the grids are not expanded.

Training used 32 blocks (128 episodes), validation used 16 blocks (64 episodes).
No inference interval is reported from these selection scores. Test seeds
2048 through 2111 were generated only after the final lock. Prohibited historical
seeds 1040 through 1059 were never generated. No equations, readouts, thresholds
or grids changed after exposure.

## Files and integrity

- validation-lock.json: source, environment, approval, audit and parity freeze.
- validation-approval.json and seed-audit.json: authorization and audit scope.
- train.json and validation.json: complete recorded inputs, starts and endpoints.
- selected.json: frozen corrections, standardization and selected readouts.
- validation-report.json: all candidate scores and selected parameters.
- validation-started.json: exclusive attempt marker.
- validation-completed.json: SHA-256 completion receipt over the run artifacts.
- test-approval.json and test-lock.json: second approval record and artifact lock.
- test-started.json: exclusive test attempt marker.
- test.json and test-report.json: all test inputs/endpoints and declared results.

Both locks and the validation completion receipt were reverified after execution.
This run is complete. Do not refit, retune, regenerate either split, or remove
attempt markers. A follow-up experiment requires a separate protocol and fresh
test seeds. These results do not test the disabled memory or projection modules.
