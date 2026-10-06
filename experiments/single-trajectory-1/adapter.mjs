// Isolated input injection. The production engine is never edited.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import * as reference from '../../src/engine.ts';

export const ENGINE_SHA256 = 'db7c664d2fc14b8560ef2e6975f69aca3f640a89d994881baa140dbb7ae6804f';
export const OFF = { projection: false, memory: false, summaries: false, noise: false };
export const RATES = [0.003125, 0.00625, 0.0125, 0.025, 0.05, 0.1, 0.2, 0.32, 0.5, 0.75, 1];
export const SIGNS = [[-1,-1],[-1,1],[1,-1],[1,1]];
export const DEV = [9000001, 9000002, 9000003];
const source = readFileSync(new URL('../../src/engine.ts', import.meta.url), 'utf8');
assert.equal(createHash('sha256').update(source).digest('hex'), ENGINE_SHA256, 'engine pin changed');
const needle = 'const input = sampleInput(currentState, context, rec, noise);';
assert.equal(source.split(needle).length, 2, 'input injection anchor must be unique');
const injected = source.replace(needle, 'const input = recordedInput;') + `
let recordedInput;
export function stepRecorded(state, context, input) {
  recordedInput = input;
  try { return stepSimulation(state, context); }
  finally { recordedInput = undefined; }
}
`;
const engine = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(injected)).toString('base64'));
export const norm = v => Math.sqrt(v.reduce((s,x) => s+x*x, 0));
export function bound(v) {
  v = v.map(x => Math.max(-2, Math.min(2,x)));
  const n = norm(v);
  return n > 2 ? v.map(x => x*(2/n)) : v;
}
export function inputs(b1, b2) {
  assert.ok([-1,1].includes(b1) && [-1,1].includes(b2));
  return Array.from({length:64}, (_,t) => {
    const v = Array(12).fill(0);
    if(t < 8) v[0] = .5*b1;
    if(t >= 24 && t < 32) v[1] = .5*b2;
    return v;
  });
}
export function assertSeed(seed, allowed = DEV) {
  assert.ok(Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff, 'numeric uint32 seed required');
  assert.ok(!(seed >= 1040 && seed <= 1059), 'prohibited seed');
  assert.ok(allowed.includes(seed), 'seed outside phase allowlist');
}
function initial(seed, stimulus = 'quiet') {
  const context = engine.createContext('single-trajectory-1', seed, {stimulus, mechanisms:OFF});
  const state = engine.createInitialState('state', seed);
  engine.initializeSmoothedState(state, context);
  return {state, context};
}
function trajectory(seed, data) {
  assert.equal(data.length,64);
  let {state, context} = initial(seed);
  const start = state.latent.slice();
  for (let t=0; t<64; t++) {
    const v = data[t];
    assert.ok(v.length === 12 && v.every(Number.isFinite));
    const out = engine.stepRecorded(state,context,{fieldId:'recorded',data:v.slice(),timestamp:t,energy:norm(v)});
    assert.equal(out.events.length,0);
    assert.equal(out.frame.scalars.noiseActive,0);
    assert.equal(out.frame.inputStrength,norm(v));
    assert.ok(out.nextState.latent.every(Number.isFinite));
    state = out.nextState;
  }
  assert.equal(state.t,64);
  assert.equal(context.memorySummaries.length,0);
  const integrators = {};
  for (const a of RATES) {
    let x = start.slice();
    for(const u of data) x = bound(x.map((v,i)=>(1-a)*v+a*u[i]));
    integrators[String(a)] = x;
  }
  return {initial:start, final:state.latent, integrators};
}
export function developmentEpisode(seed,b1,b2) {
  assertSeed(seed);
  return trajectory(seed,inputs(b1,b2));
}
export function parity() {
  for(const seed of DEV) for(const stimulus of ['quiet','align','disrupt','pulse','periodic','basin']) {
    let {state,context} = initial(seed,stimulus);
    let refState = structuredClone(state), refContext = structuredClone(context);
    for(let t=0;t<64;t++) {
      refContext.step = refState.t;
      const input = reference.sampleInput(refState,refContext);
      const expected = reference.stepSimulation(refState,refContext);
      const actual = engine.stepRecorded(state,context,input);
      assert.deepEqual(actual,expected);
      assert.deepEqual(context,refContext);
      state = actual.nextState; refState = expected.nextState;
    }
  }
  return {status:'PASS',seeds:DEV,steps:DEV.length*6*64};
}
// No arbitrary-seed CLI. The Python guard verifies the lock and active attempt
// before returning the exact allowlist. Exported dev helpers reject study seeds.
if(process.argv[1] === fileURLToPath(import.meta.url)) {
  const [split, directory] = process.argv.slice(2);
  const guard = spawnSync('python3',[fileURLToPath(new URL('./run.py',import.meta.url)),
    'authorize-generation','--directory',directory ?? '', '--split',split ?? ''],{encoding:'utf8'});
  if(guard.status !== 0) throw new Error(guard.stderr || 'generation denied');
  const seeds = JSON.parse(guard.stdout);
  const rows = [];
  for(const seed of seeds) {
    assertSeed(seed,seeds);
    let blockStart;
    for(const [b1,b2] of SIGNS) {
      const data = inputs(b1,b2), result = trajectory(seed,data);
      if(blockStart) assert.deepEqual(result.initial,blockStart,'reset mismatch');
      blockStart = result.initial;
      rows.push({seed,b1,b2,label:Number(b1===b2),inputs:data,...result});
    }
  }
  process.stdout.write(JSON.stringify(rows));
}
