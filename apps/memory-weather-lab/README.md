# Memory Weather Lab

Alternative React interface to the sibling Memory Weather simulation. It adds
the workspace layout and controls while retaining the same engine factory bodies.

```bash
npm ci
npm run verify
npm run dev
```

After changing a sibling JavaScript module, run `npm run sync-engine`, inspect
the generated wrapper diff, and run `npm run verify`. The sync check fails if a
wrapper differs from its source. The published demo and replay hashes must match
the sibling engine under identical inputs.

See [the sibling guide](../memory-weather/README.md) for model scope and replay
version boundaries.
