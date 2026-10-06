# SINGLE-TRAJECTORY-1 validation record

Validation completed on 2026-10-06. Status: PASS through the validation gate.
Test generation and scoring have not been authorized by the separate second
approval or performed. These are selection results, not a test benefit verdict.

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
2048 through 2111 and prohibited historical seeds 1040 through 1059 were not
generated. No equations, readouts, thresholds or grids changed after exposure.

## Files and integrity

- validation-lock.json: source, environment, approval, audit and parity freeze.
- validation-approval.json and seed-audit.json: authorization and audit scope.
- train.json and validation.json: complete recorded inputs, starts and endpoints.
- selected.json: frozen corrections, standardization and selected readouts.
- validation-report.json: all candidate scores and selected parameters.
- validation-started.json: exclusive attempt marker.
- validation-completed.json: SHA-256 completion receipt over the run artifacts.

The lock and completion receipt were reverified after execution. To continue,
use these files in one run directory with the pinned code/environment. A separate
test approval must bind the exact validation-report.json digest. Do not refit,
retune, regenerate validation or remove the attempt marker. Test generation
requires both locks; the second lock has not yet been created.
