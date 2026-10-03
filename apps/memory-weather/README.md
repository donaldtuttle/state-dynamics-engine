# Memory Weather

A separate experimental simulation with spatial projections, stored text-derived
vectors, history summaries, replay, basin events, and optional coupling between
two simulation instances.

Open `dist/memory-weather.html` directly, or serve this directory:

```bash
python3 -m http.server 8000
```

The standalone build needs no external runtime dependency. Inputs and outputs
stay in the browser unless you export a file.

```bash
npm run verify
```

This checks source syntax, engine behavior, field/projection calculations,
the committed demo replay, and static interface wiring; then rebuilds the demo,
standalone HTML, and SHA-256 manifest. Use `sha256sum -c MANIFEST.sha256` to check
the manifest without rewriting it.

Replay schema: `memory-weather-replay/v2`. Historical v1 replays must be opened
with the pinned upstream engine. This engine differs from the root TypeScript
reference engine; its two interfaces share a single numerical policy.
