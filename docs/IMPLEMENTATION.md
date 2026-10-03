# Implementation guide

## Reference engine

The state consists of a 12-number vector, step counter, coherence score, input
strength, and optional basin ID. Each component is clamped to [-2, 2], then the
whole vector is limited to a Euclidean norm of 2.

One call to `stepSimulation()` performs these operations in order:

1. Initialize the smoothed state from the actual starting state when necessary.
   Then update it as `(1 - smoothingRate) * previous + smoothingRate * current`.
2. Retrieve the most similar stored history summary when memory is enabled.
3. Generate seeded Gaussian noise once for this tick. The amplitude rises by a
   factor of 2.2 when prior coherence exceeds 0.85 and prior update norm is below
   0.05. The random stream uses the original seed mixing and Box-Muller method.
4. Sample the selected stimulus, then add enabled noise and recalled memory.
5. Compute `updateScale * (0.2 + 0.8 * coherence) * (input - state)`, limited to
   magnitude 1.4.
6. Compute `mix = clamp(0.35 + 0.5 * coherence, 0.2, 0.9)` and
   `gate = clamp(0.15 + 0.7 * (1 - 0.45 * coherence), 0.1, 1)`.
   Combine as `smoothed + gate * (1 - mix) * update`, then enforce state bounds.
7. Update coherence using the formula below. If the threshold, dwell, hysteresis,
   and hold rules allow, blend 82% toward the nearest fixed basin vector.
8. Compute final-state diagnostics, append state history, periodically mean-pool
   a history summary, and advance the modulo-eight phase counter.

The coherence score uses cosine alignment mapped into [0, 1], input calmness,
update smallness, and the previous score:

```text
raw = 0.50 * alignment
    + 0.25 / (1 + inputStrength)
    + 0.15 / (1 + updateMagnitude)
    + 0.10 * previousCoherence
score = clamp(0.65 * raw + 0.35 * previousCoherence, 0, 1)
```

It is a local control metric. `entropy` is a normalized eight-bin statistic of
state components. `smoothingConfidence` is exp(-distance(state, smoothedState)).
These names do not imply externally calibrated uncertainty or cognitive states.

`mechanisms` contains booleans named `projection`, `memory`, `summaries`, and
`noise`; **true enables** the mechanism. The full session validates construction
and changes, bounds retained data, and restarts a run after configuration changes
so its export has one reproducible configuration. Input mode changes and queued
one-step pulses are recorded in the schedule.

The default hold of 6 suppresses six full steps following a projection; the next
eligible step is seven steps after that event. Only smoothing updates its own
cache. A basin projection changes the current state without overwriting that cache.

## Memory Weather

Memory Weather retains its distinct numerical policy, thresholds, seeded streams,
memory inscription, replay, projection basis, and optional pair coupling.
Diagnostics are assessed before the projection decision and finalized in the same
frame. The reference engine reports its diagnostic entropy after projection.
The difference is deliberate and inherited from the two implementations.

Its two interfaces share the same engine factory bodies. `sync-engine:check`
compares the React wrappers with the original JavaScript modules. Coupled updates
read frozen prior states before either member advances.

Text inscription uses a deterministic hash-based vector encoder. Similarity and
attractor plots describe this local numerical representation; they are not an
evaluation of language understanding or semantic retrieval quality.

Memory Weather's numerical policy version remains 0.1.1 because that value
participates in historical run IDs. Its successor package is 0.1.0 and its replay
schema is `memory-weather-replay/v2`. Package, policy, and schema versions have
different purposes.

## Supported scope

This is an inspectable experimental dynamical system. The tested migration
preserves its numerical behavior. Advantages over a simpler simulator or on an
external task remain unmeasured. New mechanisms should be evaluated against
matched controls, with seeds, inputs, metrics, and thresholds chosen in advance.
