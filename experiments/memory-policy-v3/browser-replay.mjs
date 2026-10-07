/** Three browser portability screen of exactly the 72 historical root cases. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {chromium, firefox, webkit} from 'playwright-core';
import * as engine from '../../src/engine.ts';
import {rootRecord, digest} from '../../tests/numerical-records.mjs';
import {ENGINE_BLOB} from './policy.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const observe = args.includes('--observe');
let outPath = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--observe') continue;
  if (args[i] === '--json' && args[i + 1]) outPath = args[++i];
  else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
}
if (outPath && fs.existsSync(outPath)) throw new Error('Refusing to overwrite a browser report');
const source = fs.readFileSync(path.join(root, 'src/engine.ts'));
assert.equal(createHash('sha1').update(`blob ${source.length}\0`).update(source).digest('hex'), ENGINE_BLOB);
const fixtureBytes = fs.readFileSync(path.join(root, 'tests/fixtures/upstream-numerical.json'));
const cases = JSON.parse(fixtureBytes).root;
assert.equal(cases.length, 72, 'Fixture scope changed; review before running');
assert.equal(cases.reduce((n, s) => n + s.ticks, 0), 6912);
const compiled = ts.transpileModule(source.toString('utf8'), {compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
}}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;

// Encode all floating-point bit patterns before any browser/Node JSON transport.
function numberBits(value) {
  const view = new DataView(new ArrayBuffer(8));
  const words = [];
  const visit = x => {
    if (typeof x === 'number') {
      if (!Number.isFinite(x)) throw new Error('Nonfinite browser value');
      view.setFloat64(0, x, false);
      words.push(view.getUint32(0, false).toString(16).padStart(8, '0') + view.getUint32(4, false).toString(16).padStart(8, '0'));
    } else if (Array.isArray(x)) x.forEach(visit);
    else if (x && typeof x === 'object') Object.values(x).forEach(visit);
  };
  visit(value);
  return words.join('');
}
function firstDifference(a, b, label = '$') {
  if (Object.is(a, b)) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return {path: label + '.length', node: a.length, browser: b.length};
    for (let i = 0; i < a.length; i++) {const d = firstDifference(a[i], b[i], `${label}[${i}]`); if (d) return d;}
    return null;
  }
  return {path: label, node: a, browser: b, absoluteDifference: typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) : null};
}
const baseline = cases.map(spec => {
  const ctx = engine.createContext('parity', spec.seed, spec.config);
  let state = engine.createInitialState('state', ctx.seed);
  engine.initializeSmoothedState(state, ctx);
  const records = [], hashes = [], events = [];
  for (let tick = 0; tick < spec.ticks; tick++) {
    const out = engine.stepSimulation(state, ctx); state = out.nextState;
    const numeric = rootRecord(state, ctx, out.frame, out.events);
    assert.equal(digest(numeric), spec.checks[tick], `Node does not match frozen fixture: ${spec.id} tick ${tick}`);
    records.push({numeric, bits: numberBits(numeric)});
    hashes.push(engine.hashState(state));
    events.push(...out.events.map(e => ({step: e.step, basinId: e.basinId})));
  }
  assert.deepStrictEqual(state.latent, spec.finalVector);
  return {records, hashes, events};
});
const results = [];
for (const [name, browserType] of Object.entries({chromium, firefox, webkit})) {
  let browser;
  try {
    browser = await browserType.launch({headless: true});
    const page = await browser.newPage();
    await page.evaluate(async ({moduleUrl, recordSource, bitsSource}) => {
      globalThis.auditEngine = await import(moduleUrl);
      globalThis.auditRecord = (0, eval)(`(${recordSource})`);
      globalThis.auditBits = (0, eval)(`(${bitsSource})`);
    }, {moduleUrl, recordSource: rootRecord.toString(), bitsSource: numberBits.toString()});
    const rows = [];
    for (let index = 0; index < cases.length; index++) {
      const spec = cases[index], expected = baseline[index];
      const actual = await page.evaluate(spec => {
        const e = globalThis.auditEngine;
        const ctx = e.createContext('parity', spec.seed, spec.config);
        let state = e.createInitialState('state', ctx.seed); e.initializeSmoothedState(state, ctx);
        const records = [], hashes = [], events = [];
        for (let tick = 0; tick < spec.ticks; tick++) {
          const out = e.stepSimulation(state, ctx); state = out.nextState;
          const numeric = globalThis.auditRecord(state, ctx, out.frame, out.events);
          records.push({text: JSON.stringify(numeric), bits: globalThis.auditBits(numeric)});
          hashes.push(e.hashState(state));
          events.push(...out.events.map(e => ({step: e.step, basinId: e.basinId})));
        }
        return {records, hashes, events, finalVector: state.latent};
      }, spec);
      let differentBits = 0, differentFixture = 0, differentHashes = 0, firstMismatch = null;
      for (let tick = 0; tick < spec.ticks; tick++) {
        if (actual.records[tick].bits !== expected.records[tick].bits) differentBits++;
        if (createHash('sha256').update(actual.records[tick].text).digest('hex') !== spec.checks[tick]) {
          differentFixture++;
          firstMismatch ??= {tick, ...firstDifference(expected.records[tick].numeric, JSON.parse(actual.records[tick].text))};
        }
        if (actual.hashes[tick] !== expected.hashes[tick]) differentHashes++;
      }
      rows.push({id: spec.id, ticks: spec.ticks, differentBits, differentFixture, differentHashes,
        projectionScheduleMatches: JSON.stringify(actual.events) === JSON.stringify(expected.events),
        nodeProjectionEvents: expected.events, browserProjectionEvents: actual.events,
        finalVectorMatches: JSON.stringify(actual.finalVector) === JSON.stringify(spec.finalVector),
        finalHashMatches: actual.hashes.at(-1) === expected.hashes.at(-1), firstMismatch});
    }
    const summary = {name, version: browser.version(), status: rows.every(r => !r.differentBits && !r.differentFixture && !r.differentHashes && r.projectionScheduleMatches) ? 'EXACT_ON_TESTED_CASES' : 'NUMERICAL_MISMATCH',
      cases: rows.length, ticks: rows.reduce((s, r) => s + r.ticks, 0),
      differentBitsTicks: rows.reduce((s, r) => s + r.differentBits, 0),
      differentFixtureTicks: rows.reduce((s, r) => s + r.differentFixture, 0),
      differentHashTicks: rows.reduce((s, r) => s + r.differentHashes, 0),
      projectionScheduleMismatchRuns: rows.filter(r => !r.projectionScheduleMatches).length};
    console.log(JSON.stringify(summary));
    results.push({...summary, rows});
  } catch (error) {
    results.push({name, status: 'EXECUTION_FAILED', error: String(error)});
    console.error(`${name}: EXECUTION_FAILED: ${error}`);
  } finally {await browser?.close();}
}
const report = {metadata: {gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(), node: process.version, v8: process.versions.v8,
  platform: process.platform, arch: process.arch, playwrightCore: JSON.parse(fs.readFileSync(new URL('./node_modules/playwright-core/package.json', import.meta.url))).version,
  engineBlob: ENGINE_BLOB, engineSha256: createHash('sha256').update(source).digest('hex'),
  fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
  checkerSha256: createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex')},
  scope: '72 reference-engine fixture runs, 6912 ticks per runtime. No Memory Weather, no Safari-branded or universal claim.',
  observeOnly: observe, allExact: results.every(r => r.status === 'EXACT_ON_TESTED_CASES'), results};
if (outPath) {
  fs.mkdirSync(path.dirname(path.resolve(outPath)), {recursive: true});
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
}
console.log(`BROWSER_ALL_EXACT=${report.allExact}; observationMode=${observe}`);
if (results.some(r => r.status === 'EXECUTION_FAILED') || (!observe && !report.allExact)) process.exitCode = 1;
