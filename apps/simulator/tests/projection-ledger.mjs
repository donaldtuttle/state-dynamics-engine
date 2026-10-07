import assert from 'node:assert/strict';
import test from 'node:test';
import {createSession, PRE_LEDGER_ENGINE_BLOB} from '../src/session.ts';
import {evaluateSessionCompliance} from '../src/compliance.ts';
import {projectionMetrics} from '../src/projection-ledger.ts';

function exported() {
  const session = createSession({seed: 'ledger', config: {
    stimulus: 'basin', projectionThreshold: 0, dwell: 1, hold: 0,
  }});
  session.stepMany(16);
  return session.exportData();
}
function compliant(data) {
  const report = evaluateSessionCompliance(data);
  assert.equal(report.compliant, true, report.failures.map(check => check.id).join(', '));
}

test('ledger shows real displacement when hashes differ but norm drop is zero', () => {
  const data = exported();
  compliant(data);
  const event = data.eventHistory.events.find(event => event.energyDrop === 0 && event.projectionDistance > 0.01);
  assert.ok(event);
  assert.notEqual(event.preHash, event.postHash);
  assert.deepEqual(projectionMetrics(event), {
    primary: `State change ${event.projectionDistance.toFixed(3)}`,
    secondary: `Norm change +${event.normChange.toFixed(3)}`,
  });
});

test('ledger formats norm increase, decrease and rounded zero at existing precision', () => {
  const event = exported().eventHistory.events[0];
  for (const [value, expected] of [[0.083, '+0.083'], [-0.083, '-0.083'], [0, '0.000'], [-0.00001, '0.000'], [0.00001, '0.000']]) {
    assert.equal(projectionMetrics({...event, normChange: value}).secondary, `Norm change ${expected}`);
  }
  assert.equal(projectionMetrics({...event, projectionDistance: 0}).primary, 'State change 0.000');
});

test('historical v2 pin and events without new metrics pass unchanged with truthful fallback', () => {
  const data = exported();
  data.provenance.engineGitBlob = PRE_LEDGER_ENGINE_BLOB;
  for (const event of data.eventHistory.events) {
    delete event.projectionDistance;
    delete event.normChange;
    assert.deepEqual(projectionMetrics(event), {primary: `Norm drop ${event.energyDrop.toFixed(3)}`});
  }
  const before = structuredClone(data);
  compliant(data);
  assert.deepEqual(data, before, 'validation must not synthesize missing metrics in the input');
  data.eventHistory.events[0].energyDrop += 0.1;
  assert.equal(evaluateSessionCompliance(data).compliant, false, 'legacy norm drop still checked');
});

test('optional fields may be independently absent on individual events', () => {
  const data = exported();
  delete data.eventHistory.events[0].projectionDistance;
  delete data.eventHistory.events[1].normChange;
  compliant(data);
  const old = data.eventHistory.events[0];
  assert.equal(projectionMetrics(old).primary, `Norm drop ${old.energyDrop.toFixed(3)}`);
  assert.equal(projectionMetrics(data.eventHistory.events[1]).secondary, undefined);
});

test('present projection metrics must be finite, correctly signed and replay-exact', () => {
  for (const [key, values] of [
    ['projectionDistance', [-1, NaN, Infinity, null, undefined, 0.123]],
    ['normChange', [NaN, Infinity, null, undefined, 0.123]],
  ]) for (const value of values) {
    const data = exported();
    data.eventHistory.events[0][key] = value;
    assert.equal(evaluateSessionCompliance(data).compliant, false, `${key}=${value}`);
  }
});

test('compatibility permits only the reviewed previous provenance pin', () => {
  const data = exported();
  data.provenance.engineGitBlob = '0'.repeat(40);
  assert.equal(evaluateSessionCompliance(data).compliant, false);
  data.provenance.engineGitBlob = PRE_LEDGER_ENGINE_BLOB;
  data.provenance.sourceCommit = '0'.repeat(40);
  assert.equal(evaluateSessionCompliance(data).compliant, false);
});
