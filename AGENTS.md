# Working on State Dynamics Engine

Use ordinary descriptive names in source, schemas, controls, and documentation.
Keep repository-owned text ASCII. Historical input strings may be represented
with JSON escapes in compatibility fixtures and attribution records.

The reference engine and Memory Weather are different implementations. Do not
merge their formulas or claim that their trajectories are equivalent. The React
Memory Weather interface must remain synchronized with its sibling engine.

Before changing numerical behavior, distinguish it from a presentation change.
Preserve the pinned migration fixture; never regenerate it to make a changed
engine pass. Explain intentional numerical changes and version them separately.
Maintain explicit schema and hash-version boundaries.

Run `npm run verify` and `npm run build:site` for engine or interface changes.
Report commands actually run and any failures. Browser rendering must be checked
when controls, labels, or layout change. Unit tests establish software behavior,
not external scientific or task-performance claims.

Keep original author attribution, MPL license text, and source provenance.
The upstream repository is historical reference; do not rewrite its contracts.
Do not commit dependencies, local caches, credentials, or runtime user exports.
