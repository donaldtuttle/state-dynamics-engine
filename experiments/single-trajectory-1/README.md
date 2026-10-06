# SINGLE-TRAJECTORY-1 tooling

Status: DESIGN. Read [the protocol](PROTOCOL.md) and [design review](REVIEW.md).
No study trajectories, fitted study coefficients, approval records or run locks
are committed. Historical baseline files and production dynamics are unchanged.

## Development checks

Use Node 24.19.0 (module type stripping is required) and Python with NumPy.
The development environment used NumPy 2.3.5. Install the exact dependency:

```sh
python3 -m pip install -r experiments/single-trajectory-1/requirements.txt
python3 experiments/single-trajectory-1/run.py design-check
node --experimental-strip-types --test experiments/single-trajectory-1/adapter.test.mjs
python3 -m unittest discover -s experiments/single-trajectory-1 -p 'test_*.py'
```

Tests use synthetic algebraic fixtures and the three designated development
seeds. They never generate training, validation or test trajectories. Seed
numbers can appear in rejection tests without initializing those states.

## Approval and registration are separate future actions

The following commands document the lifecycle; do not execute them while this
is only a proposal. There are deliberately no ready-to-use approval files.

An approval JSON must contain decision APPROVED, phase validation or test,
approved_by, approved_at, registration_reference, and protocol_sha256 equal to
the current PROTOCOL.md digest. The record must reflect a real authorization;
do not fabricate it. A test approval must also bind validation_report_sha256.

A seed audit JSON must contain decision NO_PRIOR_USE, reviewed_by,
external_history_scope, owner_attests_unexamined true, conflicts [], the exact
splits and development_seeds from run.py, and sources mapping every historical
baseline document/script listed by run.HISTORICAL to its SHA-256. Review the
actual evidence and any outside use before setting these fields. Prior use
requires a newly reviewed proposal with a new entire study range.

```sh
python3 experiments/single-trajectory-1/run.py lock-validation \
  --directory /path/to/new-run --approval /path/to/validation-approval.json \
  --seed-audit /path/to/seed-audit.json
python3 experiments/single-trajectory-1/run.py run-validation --directory /path/to/new-run
# Review complete validation results and authorize the frozen test separately.
python3 experiments/single-trajectory-1/run.py lock-test \
  --directory /path/to/new-run --approval /path/to/test-approval.json
python3 experiments/single-trajectory-1/run.py run-test --directory /path/to/new-run
```

The first lock covers protocol, source, tests, historical files, seeds, exact
runtime/build versions and development parity. The second lock additionally
covers the completed validation artifacts, selected corrections, preprocessing
and coefficients. The generator independently invokes the lock verifier before
initializing any study seed. There is no arbitrary-seed CLI or test preview.

Stage completion or failure closes generation. An existing attempt prevents
another run, including after interruption. No reset command is provided. Any
exceptional identical retry requires an auditable recovery outside this normal
workflow. Changed analyses after test exposure require a new experiment.

Publish the full run directory only after completing the authorized lifecycle,
including locks, input recordings, selected fits, every candidate's validation
score, controls and final paired block results. Do not report design checks as
experimental results. Hashes detect changes; they do not prove author identity
or prevent deliberate modification by a person controlling the files.
