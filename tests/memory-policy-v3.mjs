import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import * as engine from '../src/engine.ts';
import {ENGINE_BLOB, POLICIES, STIMULI, similarity, injection, eligible, selectRecall, stepWithPolicy, feedback} from '../experiments/memory-policy-v3/policy.ts';
import {assertControl, stats} from '../scripts/lib/memory-policy-cli.mjs';
const vector = (a, b = 0) => [a, b, ...Array(10).fill(0)];
const setup = (seed = 1, config = {}) => {
  const context = engine.createContext('run', seed, config);
  const state = engine.createInitialState('state', context.seed);
  engine.initializeSmoothedState(state, context);
  return {state, context};
};

test('engine bytes remain exactly pinned', () => {
  const bytes = readFileSync(new URL('../src/engine.ts', import.meta.url));
  assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), ENGINE_BLOB);
});
test('alignment matches zero, tiny, orthogonal and opposed vector semantics', () => {
  assert.equal(similarity(vector(0), vector(1)), 0);
  assert.equal(similarity(vector(1e-10), vector(1)), 0);
  assert.equal(similarity(vector(1), vector(0, 1)), .5);
  assert.equal(similarity(vector(1), vector(-1)), 0);
  assert.equal(similarity(vector(1), vector(1)), 1);
  const {state, context} = setup(); state.latent = vector(0);
  context.memorySummaries = [{id: 0, step: 12, latent: vector(1), coherenceScore: .5}];
  assert.deepEqual(eligible(state, context), []);
  for (const p of POLICIES) assert.equal(selectRecall(p, state, context), undefined);
});
test('argmax keeps first exact tie; recent uses newest eligible, not newest opposed', () => {
  const {state, context} = setup(); state.latent = vector(1);
  context.memorySummaries = [
    {id: 0, step: 12, latent: vector(.2), coherenceScore: .5},
    {id: 1, step: 24, latent: vector(.4), coherenceScore: .5},
    {id: 2, step: 36, latent: vector(-1), coherenceScore: .5},
  ];
  assert.equal(selectRecall('A_argmax', state, context).nodeId, 0);
  assert.equal(selectRecall('C_recent', state, context).nodeId, 1);
  assert.equal(selectRecall('E_off', state, context), undefined);
  assert.throws(() => selectRecall('not-a-policy', state, context), /Unknown policy/);
});
test('mean policy averages eligible latents then recomputes its own gain', () => {
  const {state, context} = setup(); state.latent = vector(1);
  context.memorySummaries = [
    {id: 0, step: 12, latent: vector(1), coherenceScore: .5},
    {id: 1, step: 24, latent: vector(0, 1), coherenceScore: .5},
  ];
  const p = selectRecall('D_mean', state, context);
  assert.deepEqual(p.latent, vector(.5, .5));
  assert.equal(p.similarity, similarity(state.latent, p.latent));
  assert.deepEqual(injection(p), p.latent.map(v => v * (.25 * p.similarity)));
});
test('random policy is reproducible and does not mutate context or engine draws', () => {
  const {state, context} = setup();
  context.memorySummaries = [{id: 0, step: 12, latent: [...state.latent], coherenceScore: .5}];
  const before = structuredClone(context), noise = engine.sampleAdaptiveNoise(state, context);
  assert.deepEqual(selectRecall('B_random', state, context), selectRecall('B_random', state, context));
  assert.deepEqual(context, before);
  assert.deepEqual(engine.sampleAdaptiveNoise(state, context), noise);
});
test('all policies honor disabled memory without removing summary construction', () => {
  const {state, context} = setup(1, {mechanisms: {...engine.DEFAULT_CONFIG.mechanisms, memory: false}});
  context.memorySummaries = [{id: 0, step: 12, latent: [...state.latent], coherenceScore: .5}];
  for (const p of POLICIES) assert.equal(selectRecall(p, state, context), undefined);
});
test('A and E match actual engine states, frames, events and complete feedback', () => {
  for (const stimulus of STIMULI) for (const memory of [true, false]) for (const seed of [1, 2]) {
    const cfg = {stimulus, mechanisms: {...engine.DEFAULT_CONFIG.mechanisms, memory}};
    const a = setup(seed, cfg), b = setup(seed, cfg);
    for (let i = 0; i < 96; i++) {
      const result = stepWithPolicy(memory ? 'A_argmax' : 'E_off', a.state, a.context);
      const expected = engine.stepSimulation(b.state, b.context);
      assertControl(result, expected, a.context, b.context);
      a.state = result.nextState; b.state = expected.nextState;
    }
    assert.deepEqual(a.context, b.context);
  }
});
test('control catches sub-hash-precision drift, changed feedback and changed event timing', () => {
  const a = setup(), b = setup();
  const result = stepWithPolicy('A_argmax', a.state, a.context);
  const expected = engine.stepSimulation(b.state, b.context);
  const tiny = structuredClone(result);
  tiny.nextState.latent[0] += 1e-12;
  assert.equal(engine.hashState(tiny.nextState), engine.hashState(result.nextState));
  assert.throws(() => assertControl(tiny, expected, a.context, b.context));
  const badCtx = structuredClone(a.context); badCtx.holdLeft++;
  assert.throws(() => assertControl(result, expected, badCtx, b.context));
  const event = structuredClone(result); event.events.push({step: 1});
  assert.throws(() => assertControl(event, expected, a.context, b.context));
});
test('first summary admits recall at pre-step 13, not 12', () => {
  const live = setup(1, {stimulus: 'quiet'});
  let first = null;
  for (let i = 0; i < 30; i++) {
    const out = stepWithPolicy('A_argmax', live.state, live.context);
    if (out.observation.rec && first === null) first = i;
    live.state = out.nextState;
  }
  assert.equal(first, 13);
});
test('six hold ticks plus two dwell checks produce eight, not seven, tick spacing', () => {
  const a = engine.run(32, 1, {projectionThreshold: 0, hold: 6, dwell: 2, hysteresis: 0});
  assert.deepEqual(a.events.map(e => e.step), [1, 9, 17, 25]);
  const b = engine.run(24, 1, {projectionThreshold: 0, hold: 6, dwell: 1, hysteresis: 0});
  assert.deepEqual(b.events.map(e => e.step), [0, 7, 14, 21]);
});
test('coherence expansion and immediate leave-out use the same state and noise', () => {
  const live = setup(1, {stimulus: 'quiet'});
  for (let i = 0; i < 48; i++) {
    const fork = structuredClone(live.context);
    const a = stepWithPolicy('A_argmax', live.state, live.context);
    const e = stepWithPolicy('E_off', live.state, fork);
    assert.deepEqual(a.observation.noise, e.observation.noise);
    assert.equal(a.observation.parts.prior, e.observation.parts.prior);
    assert(Math.abs(a.observation.parts.expansionResidual) < 1e-12);
    live.state = a.nextState;
  }
});
test('empty summaries stay unavailable; nonfinite diagnostics fail rather than serialize to null', () => {
  assert.equal(stats([]).p50, null);
  assert.throws(() => stats([Infinity]), /Nonfinite/);
  assert.throws(() => stats([NaN]), /Nonfinite/);
});
test('CLI rejects unknown arguments and overwrites; smoke report is reproducible', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'memory-policy-'));
  const command = new URL('../scripts/memory-policy-probe-v3.ts', import.meta.url).pathname;
  const launch = args => spawnSync(process.execPath, ['--experimental-strip-types', command, ...args], {encoding: 'utf8'});
  try {
    assert.notEqual(launch(['--typo']).status, 0);
    const a = path.join(folder, 'a.json'), b = path.join(folder, 'b.json');
    const runA = launch(['--smoke', '--json', a]); assert.equal(runA.status, 0, runA.stderr);
    const runB = launch(['--smoke', '--json', b]); assert.equal(runB.status, 0, runB.stderr);
    assert.equal(readFileSync(a, 'utf8'), readFileSync(b, 'utf8'));
    const before = readFileSync(a, 'utf8');
    assert.notEqual(launch(['--smoke', '--json', a]).status, 0);
    assert.equal(readFileSync(a, 'utf8'), before);
  } finally {rmSync(folder, {recursive: true, force: true});}
});
