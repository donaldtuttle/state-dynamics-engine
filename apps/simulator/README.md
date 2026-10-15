# State Dynamics Lab

Interactive interface to the root State Dynamics Engine. The full simulator and
compact probe both use `SimulationSession` and `stepSimulation()`.

```bash
npm ci
npm run dev
```

The full interface supports play, pause, single steps, reset, seed selection,
input modes, one-step pulses, mechanism switches, diagnostics, event inspection,
history summaries, JSON export, and in-browser replay verification.

Changing a numeric setting or a mechanism after stepping starts a new run.
Changing input mode and queuing pulses are captured in the replay schedule.
The session retains at most 16,384 frames. Export and reset to start another run.

Verification records the checked seed, tick, and state hash. Resetting, changing
the seed or configuration, selecting another input mode, queuing a pulse, or
advancing the run clears the previous results. Run checks again to verify the
new snapshot. Play/pause and tick interval changes alone preserve the results.
Seven checks exercise fixed engine scenarios; Current export replay checks the
current session, including an empty session at tick zero.

The verification UI regression check exports `checkVerificationLifecycle(page)`
from `tests/verification-browser.mjs`. Pass a Playwright-compatible page; it
exercises the visible controls and throws if stale PASS results remain.

The compact view is at `probe.html`. It uses the same engine and has no fallback
trajectory. Its 64-step reference pin uses the successor's ASCII state ID.

```bash
npm run check
```

See [implementation](../../docs/IMPLEMENTATION.md) and
[migration](../../docs/MIGRATION.md) for definitions and compatibility.
