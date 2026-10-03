// Explicit maintainer operation; tests NEVER rewrite their reference fixtures.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { cases, digest, rootRecord, weatherRecord, legacyConfig, rootKeyMap, prepareWeather, weatherActions } from '../tests/numerical-records.mjs';
const upstream = process.argv[2];
if (!upstream) throw new Error('Usage: node scripts/record-upstream-baseline.mjs /path/to/pinned/upstream');
const manifest = JSON.parse(fs.readFileSync(new URL('../docs/source-manifest.json', import.meta.url), 'utf8'));
for (const file of manifest.files) {
  const bytes = fs.readFileSync(path.join(upstream, file.path));
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`Unverified upstream file: ${file.path}`);
}
const root = await import(pathToFileURL(path.resolve(upstream, 'src/engine.ts')));
const weather = createRequire(import.meta.url)(path.resolve(upstream, 'apps/memory-weather/src/engine.js'));
const plan = cases(), result = { schemaVersion: 'migration-numerical-baseline/v1', sourceCommit: manifest.sourceCommit, root: [], weather: [], coupled: [] };
for (const spec of plan.root) {
  const context = root.initCtx('parity', spec.seed, legacyConfig(spec.config, rootKeyMap));
  let state = root.initPsi('state', context.seed); root.warmStartSelfModel(state, context);
  const checks = [];
  for (let i = 0; i < spec.ticks; i++) { const out = root.xiStep(state, context); state = out.psi_next; checks.push(digest(rootRecord(state, context, out.frame, out.events, true))); }
  result.root.push({ ...spec, checks, finalVector: state.latent });
}
for (const spec of plan.weather) {
  const state = prepareWeather(weather, spec, true), checks = [];
  for (let i = 0; i < spec.ticks; i++) { weatherActions(weather, state, i, true); const out = weather.step(state); checks.push(digest(weatherRecord(state, out, true))); }
  result.weather.push({ ...spec, checks, finalVector: state.psi.latent });
}
for (const enabled of [true, false]) for (const order of ['ab', 'ba']) {
  const a = weather.createState({ observerId: 'observer-a', config: { seed: 335389 } });
  const b = weather.createState({ observerId: 'observer-b', config: { seed: 12062026 } });
  const checks = [];
  for (let i = 0; i < 64; i++) { const out = weather.stepCoupledPair(a, b, {}, {}, { enabled, order }); checks.push(digest([weatherRecord(a, out.results[0], true), weatherRecord(b, out.results[1], true)])); }
  result.coupled.push({ enabled, order, checks });
}
fs.mkdirSync(new URL('../tests/fixtures/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../tests/fixtures/upstream-numerical.json', import.meta.url), JSON.stringify(result, null, 2)+'\n');
console.log(`Recorded ${result.root.length} engine runs, ${result.weather.length} weather runs, and ${result.coupled.length} coupled runs from verified upstream source.`);
