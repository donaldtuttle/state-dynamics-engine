import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as root from '../src/engine.ts';
import { digest, rootRecord, weatherRecord, prepareWeather, weatherActions } from './numerical-records.mjs';
const weather = createRequire(import.meta.url)('../apps/memory-weather/src/engine.js');
const baseline = JSON.parse(fs.readFileSync(new URL('./fixtures/upstream-numerical.json', import.meta.url), 'utf8'));
let compared = 0;
for (const spec of baseline.root) {
  const context = root.createContext('parity', spec.seed, spec.config);
  let state = root.createInitialState('state', context.seed); root.initializeSmoothedState(state, context);
  for (let i = 0; i < spec.ticks; i++) { const out = root.stepSimulation(state, context); state = out.nextState; assert.equal(digest(rootRecord(state, context, out.frame, out.events)), spec.checks[i], `engine ${spec.id} tick ${i}`); compared++; }
  assert.deepEqual(state.latent, spec.finalVector);
}
for (const spec of baseline.weather) {
  let state = prepareWeather(weather, spec);
  for (let i = 0; i < spec.ticks; i++) {
    // Exercise continuation through the successor's own serialize/hydrate path.
    if (i === 48) state = weather.hydrate(weather.serialize(state));
    weatherActions(weather, state, i); const out = weather.step(state);
    assert.equal(digest(weatherRecord(state, out)), spec.checks[i], `weather ${spec.id} tick ${i}`); compared++;
  }
  assert.deepEqual(state.currentState.latent, spec.finalVector);
}
for (const spec of baseline.coupled) {
  const a = weather.createState({ observerId: 'observer-a', config: { seed: 335389 } });
  const b = weather.createState({ observerId: 'observer-b', config: { seed: 12062026 } });
  for (let i = 0; i < spec.checks.length; i++) { const out = weather.stepCoupledPair(a, b, {}, {}, spec); assert.equal(digest([weatherRecord(a, out.results[0]), weatherRecord(b, out.results[1])]), spec.checks[i], `coupled ${spec.enabled}/${spec.order} tick ${i}`); compared += 2; }
}
console.log(`PASS: ${baseline.root.length} reference-engine runs, ${baseline.weather.length} weather runs, ${baseline.coupled.length} coupled runs; ${compared} state steps exactly match upstream numerical records.`);
