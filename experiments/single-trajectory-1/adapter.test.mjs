import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { inputs, parity, assertSeed, developmentEpisode, DEV, bound, RATES } from './adapter.mjs';

test('full state, diagnostics and context match reference for 1152 development updates',()=>{
  assert.deepEqual(parity(),{status:'PASS',seeds:DEV,steps:1152});
});
test('exact two-cue timing and balanced oracle',()=>{
  const labels=[];
  for(const b1 of [-1,1]) for(const b2 of [-1,1]) {
    const u=inputs(b1,b2); assert.equal(u.length,64);
    for(let t=0;t<64;t++) for(let i=0;i<12;i++) {
      assert.equal(u[t][i],i===0&&t<8?.5*b1:i===1&&t>=24&&t<32?.5*b2:0);
    }
    labels.push(Number(u[0][0]*u[24][1]>0));
  }
  assert.deepEqual(labels,[1,0,0,1]);
});
test('all study and historical prohibited seeds rejected by development entry',()=>{
  for(let seed=1040;seed<=1059;seed++) assert.throws(()=>assertSeed(seed),/prohibited/);
  for(let seed=2000;seed<=2111;seed++) assert.throws(()=>developmentEpisode(seed,1,1),/allowlist/);
  for(const seed of ['2000',true,NaN,Infinity,2.5,-1,2**32+9000001]) assert.throws(()=>assertSeed(seed));
});
test('fresh context and matching starts independent of prior episode order',()=>{
  const first=developmentEpisode(DEV[0],1,-1);
  developmentEpisode(DEV[0],-1,1);
  assert.deepEqual(developmentEpisode(DEV[0],1,-1),first);
  assert.deepEqual(developmentEpisode(DEV[0],1,1).initial,first.initial);
});
test('baseline matches closed form where bound is inactive',()=>{
  const result=developmentEpisode(DEV[1],-1,1), u=inputs(-1,1);
  for(const a of RATES) {
    const expected=result.initial.map((v,i)=>v*(1-a)**64+u.reduce((s,x,t)=>s+a*(1-a)**(63-t)*x[i],0));
    expected.forEach((x,i)=>assert.ok(Math.abs(x-result.integrators[String(a)][i])<1e-14));
  }
  assert.deepEqual(bound([3,0]),[2,0]);
});
test('direct test generator cannot run without a lock',()=>{
  const result=spawnSync(process.execPath,['--experimental-strip-types',
    new URL('./adapter.mjs',import.meta.url).pathname,'test','/nonexistent-single-trajectory-lock'],{encoding:'utf8'});
  assert.notEqual(result.status,0); assert.equal(result.stdout,'');
});
