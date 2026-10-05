# Changelog

## Unreleased

- Document the demo, the 12-number state, a matched noise comparison, the
  session trace, and the baseline protocol.
- Tighten that unrun baseline: validation ceiling, shorter-horizon fallback,
  integrator-rate edge rule, shared readout-penalty grid, and three verdict
  tiers. A primary result would still say nothing about memory or projection.
- Run that protocol once. The integrator's validation accuracy was 40/40 at
  64, 32, and 16 ticks, so the test seeds were not scored. There is no
  benefit verdict.
- Close that protocol. Record the validation-only finding that, with
  mechanisms off, the default update leaves the state near its start, while
  a within-seed class contrast remains.
- Add the validation-only scripts for that check. They do not score test seeds.
- Register and run SINGLE-TRAJECTORY-1 on a delayed agreement relation.
  The learned start correction did not clear chance, and the test interval
  ruled out an advantage above +0.05. No benefit verdict. Seeds 1040-1059
  were not used. The closed baseline was not changed.
- Add a screenshot of the deployed State Dynamics Lab.

## 0.1.0 - 2026-10-03

- Independent State Dynamics Engine identity and State Dynamics Lab interface.
- Descriptive API, configuration, diagnostic, and control names.
- Neutral Basin 1-6 labels with original numeric vectors.
- Separate reference-engine and Memory Weather documentation and interfaces.
- Versioned session/replay schemas and explicit state-hash migration policy.
- Validated historical reference-session import and configuration adapter.
- Pinned-source numerical regression records and compatibility checks.
- Local app launcher, CI, and manually triggered Pages deployment workflow.
- Original MPL-2.0 license and lossless historical attribution retained.
