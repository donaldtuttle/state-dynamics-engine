import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BASINS, createContext, createInitialState, hashState, initializeSmoothedState,
  projectTowardBasin, stepSimulation,
} from '../src/engine.ts';

const norm = vector => Math.hypot(...vector);
const distance = (a, b) => norm(a.map((value, i) => value - b[i]));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
const state = latent => ({id: 'projection-test', t: 7, latent, coherence: 0.5, inputStrength: 0.2});

for (const [name, latent, sign] of [
  ['increased norm with zero norm drop', Array(12).fill(0), 1],
  ['decreased norm', BASINS[0].latent.map(value => value * 1.5), -1],
]) {
  test(`projection measures Euclidean displacement and ${name}`, () => {
    const pre = state(latent);
    const before = structuredClone(pre);
    const {currentState: post, event} = projectTowardBasin(pre, createContext('projection-test', 1));
    assert.deepEqual(pre, before, 'projection must not mutate its input');
    assert.ok(event.projectionDistance > 0.1, 'appreciable movement');
    close(event.projectionDistance, distance(pre.latent, post.latent));
    close(event.normChange, norm(post.latent) - norm(pre.latent));
    close(event.energyDrop, Math.max(0, norm(pre.latent) - norm(post.latent)));
    assert.equal(Math.sign(event.normChange), sign);
    assert.equal(event.preHash, hashState(pre));
    assert.equal(event.postHash, hashState(post));
    assert.notEqual(event.preHash, event.postHash);
    if (sign > 0) assert.equal(event.energyDrop, 0, 'movement despite zero norm drop');
  });
}

test('distance uses the final bounded vector returned by projection', () => {
  const pre = state(Array(12).fill(10));
  const {currentState: post, event} = projectTowardBasin(pre, createContext('bounds', 1));
  assert.ok(norm(post.latent) <= 2 + 1e-12);
  close(event.projectionDistance, distance(pre.latent, post.latent));
  close(event.normChange, norm(post.latent) - norm(pre.latent));
});

test('projection displacement is isolated from the rest of the tick', () => {
  const context = createContext('tick', 335389, {projectionThreshold: 0, dwell: 1, hold: 0});
  const preTick = createInitialState('state', context.seed);
  initializeSmoothedState(preTick, context);
  const withoutProjection = structuredClone(context);
  withoutProjection.config.mechanisms.projection = false;
  const preProjection = stepSimulation(preTick, withoutProjection).nextState;
  const actual = stepSimulation(preTick, context);
  const event = actual.events[0];
  assert.ok(event);
  assert.equal(event.preHash, hashState(preProjection));
  close(event.projectionDistance, distance(preProjection.latent, actual.nextState.latent));
  close(actual.frame.scalars.stateChange, distance(preTick.latent, actual.nextState.latent));
  assert.ok(Math.abs(event.projectionDistance - actual.frame.scalars.stateChange) > 1e-3);
});

test('seed, configuration and mixed schedule reproduce full states and event telemetry', () => {
  function replay() {
    const context = createContext('replay', 335389, {projectionThreshold: 0.5, dwell: 1, hold: 2, summaryInterval: 4});
    let current = createInitialState('state', context.seed);
    initializeSmoothedState(current, context);
    const outputs = [];
    for (let tick = 0; tick < 96; tick++) {
      context.config.stimulus = ['basin', 'quiet', 'pulse', 'disrupt', 'periodic'][tick % 5];
      const output = stepSimulation(current, context);
      outputs.push(structuredClone(output));
      current = output.nextState;
    }
    return {outputs, context};
  }
  const a = replay();
  assert.ok(a.outputs.flatMap(output => output.events).length > 5);
  assert.deepEqual(replay(), a);
});
