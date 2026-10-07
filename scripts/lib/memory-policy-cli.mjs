import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as engine from '../../src/engine.ts';
import { ENGINE_BLOB, POLICIES, STIMULI, norm, distance, sub, similarity, injection,
  policyRandom, eligible, selectRecall, stepWithPolicy, feedback } from '../../experiments/memory-policy-v3/policy.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
export function stats(a) {
  if (a.some(x => !Number.isFinite(x))) throw new Error('Nonfinite diagnostic sample');
  const b = [...a].sort((x, y) => x - y);
  const q = p => b.length ? b[Math.floor(p * (b.length - 1))] : null;
  return {n: a.length, mean: mean(a), min: b[0] ?? null, p5: q(.05), p50: q(.5), p95: q(.95), max: b.at(-1) ?? null};
}
export function assertControl(actual, expected, actualContext, expectedContext) {
  const {observation, ...output} = actual;
  assert.deepStrictEqual(output, expected, 'Unrounded output/state/frame/event control failed');
  assert.deepStrictEqual(feedback(actualContext), feedback(expectedContext), 'Feedback/counter control failed');
}
const makeRun = (seed, stimulus, memory = true) => {
  const context = engine.createContext('run', seed, {stimulus, mechanisms: {...engine.DEFAULT_CONFIG.mechanisms, memory}});
  const state = engine.createInitialState('state', context.seed);
  engine.initializeSmoothedState(state, context);
  return {state, context};
};
const fmt = (x, digits = 6) => x === null ? 'n/a' : x.toFixed(digits);
const fields = ['alignment', 'calm', 'focus', 'prior', 'score'];
const thresholdGrid = [-.7, 0, .25, .5, .6, .7, .8, .9, .95, .98, .99];

export function runProbe({seeds = 24, steps = 1024} = {}) {
  if (![2, 24].includes(seeds) || ![96, 1024].includes(steps)) throw new Error('Use the declared smoke or full dimensions');
  const output = [];
  for (const stimulus of STIMULI) {
    const diagnostics = Object.fromEntries(['margin', 'runnerSwap', 'randomSwap', 'memoryDelta', 'updateNorm', 'age', 'counterfactualStateDistance', 'candidateCoherence', 'eligibleThresholdDistance', 'eligibleFloorDistance', 'projectionBoost'].map(k => [k, []]));
    const direct = Object.fromEntries(fields.map(k => [k, []]));
    const own = Object.fromEntries(POLICIES.map(p => [p, Object.fromEntries(fields.map(k => [k, []]))]));
    const rows = [];
    const counts = {candidateAvailableSteps: 0, candidates: 0, rejectedAtCurrentGate: 0, recallSteps: 0, recencyMatches: 0, eligibleSteps: 0, eligibleAboveThreshold: 0, counterfactualProjectionChanges: 0};
    const survival = thresholdGrid.map(cosine => ({cosine, candidates: 0, steps: 0}));
    const gaps = {};
    let minCandidateCosine = Infinity, maxDeltaResidual = 0, maxExpansionResidual = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      let baseline;
      for (const policy of POLICIES) {
        const live = makeRun(seed, stimulus, policy !== 'E_off');
        // E independently checks the real production memory-off switch, too.
        const reference = ['A_argmax', 'E_off'].includes(policy) ? makeRun(seed, stimulus, policy !== 'E_off') : null;
        const points = [], hashes = [engine.hashState(live.state)], eventRecords = [];
        const digest = createHash('sha256');
        let firstRecall = null, previousProjection = null;
        for (let tick = 0; tick < steps; tick++) {
          const state = live.state, context = live.context;
          context.step = state.t;
          let counterfactual;
          if (policy === 'A_argmax') {
            // Trace is diagnostics-only; avoid cloning its growing prefix.
            const fork = structuredClone({...context, trace: []});
            counterfactual = stepWithPolicy('E_off', structuredClone(state), fork);
            const available = eligible(state, context);
            const selected = engine.retrieveSimilarMemory(state, context);
            const cosines = context.memorySummaries.map(n => 2 * similarity(state.latent, n.latent) - 1);
            if (cosines.length) {
              counts.candidateAvailableSteps++;
              counts.candidates += cosines.length;
              counts.rejectedAtCurrentGate += context.memorySummaries.length - available.length;
              minCandidateCosine = Math.min(minCandidateCosine, ...cosines);
              const bestCos = Math.max(...cosines);
              for (const row of survival) {
                row.candidates += cosines.filter(c => c >= row.cosine).length;
                row.steps += +(bestCos >= row.cosine);
              }
            }
            if (selected) {
              counts.recallSteps++;
              const newest = available.reduce((a, b) => b.step > a.step ? b : a);
              counts.recencyMatches += +(selected.nodeId === newest.nodeId);
              const node = available.find(p => p.nodeId === selected.nodeId);
              diagnostics.age.push(state.t - node.step);
            }
            if (available.length > 1) {
              available.sort((a, b) => b.similarity - a.similarity);
              const [winner, runner] = available;
              diagnostics.margin.push(2 * winner.similarity - 2 * runner.similarity);
              diagnostics.runnerSwap.push(distance(injection(winner), injection(runner)));
              const random = available[Math.floor(policyRandom(context.seed ^ 0x51, state.t) * available.length)];
              diagnostics.randomSwap.push(distance(injection(winner), injection(random)));
            }
          }
          const result = stepWithPolicy(policy, state, context);
          if (reference) {
            const expected = engine.stepSimulation(reference.state, reference.context);
            assertControl(result, expected, context, reference.context);
            reference.state = expected.nextState;
          }
          const obs = result.observation;
          maxExpansionResidual = Math.max(maxExpansionResidual, Math.abs(obs.parts.expansionResidual));
          for (const field of fields) own[policy][field].push(obs.parts[field]);
          if (obs.rec && firstRecall === null) firstRecall = tick;
          if (policy === 'A_argmax') {
            assert.deepStrictEqual(obs.noise, counterfactual.observation.noise, 'Same-state counterfactual must use identical noise');
            for (const field of fields) direct[field].push(obs.parts[field] - counterfactual.observation.parts[field]);
            diagnostics.counterfactualStateDistance.push(distance(result.nextState.latent, counterfactual.nextState.latent));
            counts.counterfactualProjectionChanges += +(result.events.length !== counterfactual.events.length);
            diagnostics.candidateCoherence.push(obs.preProjection.coherence);
            diagnostics.projectionBoost.push(result.nextState.coherence - obs.preProjection.coherence);
            if (!obs.held) {
              counts.eligibleSteps++;
              counts.eligibleAboveThreshold += +(obs.preProjection.coherence >= context.config.projectionThreshold);
              diagnostics.eligibleThresholdDistance.push(Math.abs(obs.preProjection.coherence - context.config.projectionThreshold));
              diagnostics.eligibleFloorDistance.push(Math.abs(obs.preProjection.coherence - (context.config.projectionThreshold - context.config.hysteresis)));
            }
            if (obs.rec) {
              const delta = norm(sub(obs.input.data, counterfactual.observation.input.data));
              const residual = Math.abs(delta - norm(injection(obs.rec)));
              assert(residual <= 1e-12, 'Leave-memory-out input identity failed');
              maxDeltaResidual = Math.max(maxDeltaResidual, residual);
              diagnostics.memoryDelta.push(delta);
              diagnostics.updateNorm.push(obs.update.magnitude);
            }
            if (result.events.length) {
              if (previousProjection !== null) {
                const gap = tick - previousProjection;
                gaps[gap] = (gaps[gap] ?? 0) + 1;
              }
              previousProjection = tick;
            }
          }
          live.state = result.nextState;
          const stateHash = engine.hashState(live.state);
          hashes.push(stateHash);
          eventRecords.push(...result.events);
          const point = {latent: live.state.latent.slice(), coherence: live.state.coherence, projected: result.events.length, basin: live.state.basinId ?? null};
          points.push(point);
          digest.update(JSON.stringify([live.state, feedback(context), result.events]) + '\n');
        }
        if (reference) assert.deepStrictEqual(live.context.trace, reference.context.trace, 'Complete diagnostic trace control failed');
        if (policy === 'A_argmax') {
          const realRun = engine.run(steps, seed, {stimulus});
          assert.deepStrictEqual(hashes, realRun.hashes);
          assert.deepStrictEqual(live.state, realRun.currentState);
          assert.deepStrictEqual(live.context, realRun.context);
          assert.deepStrictEqual(eventRecords, realRun.events);
          baseline = points;
        }
        const pathDistances = points.map((p, i) => distance(p.latent, baseline[i].latent));
        const projected = points.flatMap((p, i) => p.projected ? [i] : []);
        const labelComparable = points.filter((p, i) => p.basin !== null && baseline[i].basin !== null).length;
        rows.push({seed, policy, meanPathDistance: mean(pathDistances), maxPathDistance: Math.max(...pathDistances),
          finalDistance: distance(points.at(-1).latent, baseline.at(-1).latent),
          meanAbsoluteCoherenceDifference: mean(points.map((p, i) => Math.abs(p.coherence - baseline[i].coherence))),
          projectionCount: projected.length, projectionSteps: projected,
          projectionTickDisagreements: points.filter((p, i) => p.projected !== baseline[i].projected).length,
          lastProjectedBasinMatchIncludingNone: mean(points.map((p, i) => +(p.basin === baseline[i].basin))),
          lastProjectedBasinComparableSteps: labelComparable,
          lastProjectedBasinMatchWhenBothPresent: labelComparable ? points.filter((p, i) => p.basin !== null && baseline[i].basin !== null && p.basin === baseline[i].basin).length / labelComparable : null,
          distinctProjectedLabels: new Set(eventRecords.map(e => e.basinId)).size,
          firstRecallStep: firstRecall, finalHash: hashes.at(-1), trajectorySha256: digest.digest('hex')});
      }
    }
    const summary = POLICIES.map(policy => {
      const selected = rows.filter(r => r.policy === policy);
      return {policy, meanPathDistance: stats(selected.map(r => r.meanPathDistance)), finalDistance: stats(selected.map(r => r.finalDistance)),
        projectionCount: stats(selected.map(r => r.projectionCount)), projectionTickDisagreements: stats(selected.map(r => r.projectionTickDisagreements)),
        meanAbsoluteCoherenceDifference: stats(selected.map(r => r.meanAbsoluteCoherenceDifference))};
    });
    const margins = diagnostics.margin;
    const intervals = Object.values(gaps).reduce((a, b) => a + b, 0);
    const minGap = intervals ? Math.min(...Object.keys(gaps).map(Number)) : null;
    const entry = {stimulus, pulseScope: stimulus === 'pulse' ? 'persistent raw-engine stress condition' : null,
      controls: {A_exactRuns: seeds, E_exactRuns: seeds, ticksPerRun: steps, comparison: 'unrounded state/frame/event/feedback equality; full trace and run() control for A'},
      counts, minCandidateCosine: Number.isFinite(minCandidateCosine) ? minCandidateCosine : null,
      survival: survival.map(r => ({...r, candidateFraction: counts.candidates ? r.candidates / counts.candidates : null, candidateAvailableStepFraction: counts.candidateAvailableSteps ? r.steps / counts.candidateAvailableSteps : null})),
      diagnostics: Object.fromEntries(Object.entries(diagnostics).map(([k, v]) => [k, stats(v)])),
      ties: [1e-12, 1e-9, 1e-6].map(threshold => ({threshold, n: margins.length, below: margins.filter(v => v < threshold).length})),
      maxInputIdentityResidual: maxDeltaResidual, maxCoherenceExpansionResidual: maxExpansionResidual,
      sameStateImmediateMemoryEffect: Object.fromEntries(fields.map(k => [k, stats(direct[k])])),
      ownTrajectoryCoherenceTerms: Object.fromEntries(POLICIES.map(p => [p, Object.fromEntries(fields.map(k => [k, stats(own[p][k])]))])),
      projectionSpacing: {intervals, gapCounts: gaps, minGap, fractionAtMinimum: intervals ? gaps[minGap] / intervals : null,
        hold: engine.DEFAULT_CONFIG.hold, dwell: engine.DEFAULT_CONFIG.dwell, sustainedAboveThresholdEarliestGap: engine.DEFAULT_CONFIG.hold + engine.DEFAULT_CONFIG.dwell},
      summary, rows};
    output.push(entry);
    console.log(`\n${stimulus}: exact controls A=${seeds}/${seeds}, E=${seeds}/${seeds}; candidates=${counts.candidates}; rejected=${counts.rejectedAtCurrentGate}`);
    console.log('policy       meanPathDistance  projections/run  eventTickDisagreements/run');
    for (const r of summary) console.log(`${r.policy.padEnd(12)} ${fmt(r.meanPathDistance.mean).padStart(16)} ${fmt(r.projectionCount.mean, 3).padStart(16)} ${fmt(r.projectionTickDisagreements.mean, 3).padStart(27)}`);
    console.log(`A chose newest eligible: ${counts.recencyMatches}/${counts.recallSteps}; projection intervals at minimum ${minGap}: ${intervals ? gaps[minGap] : 0}/${intervals}`);
    console.log(`Same-state preprojection coherence changes: ${fields.map(k => `${k}=${fmt(mean(direct[k]))}`).join(' ')}`);
  }
  return {status: 'DEVELOP_EXPLORATORY', auditRevision: '3.1', setup: {seedType: 'numeric', seeds: Array.from({length: seeds}, (_, i) => i + 1), steps, stimuli: [...STIMULI], config: engine.DEFAULT_CONFIG},
    limits: ['Previously inspected development seeds; not confirmatory.', 'No task-utility or equivalence criterion.', 'B uses one independent stateless policy draw per tick, not random-policy replicates.', 'Policies evolve their own states, memories, and adaptive noise amplitudes.', 'D changes aggregation and gain as well as selection.', 'Clock spacing does not establish cross-browser stability.', 'Norm differences are not percentage contributions.'], stimuli: output};
}

export function main(args = process.argv.slice(2)) {
  let smoke = false, out = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--smoke') smoke = true;
    else if (args[i] === '--json' && args[i + 1]) out = args[++i];
    else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
  }
  if (out && fs.existsSync(out)) throw new Error('Refusing to overwrite an existing report');
  const engineBytes = fs.readFileSync(path.join(root, 'src/engine.ts'));
  const blob = createHash('sha1').update(`blob ${engineBytes.length}\0`).update(engineBytes).digest('hex');
  assert.equal(blob, ENGINE_BLOB, 'Pinned engine source changed; review and version the probe before running');
  const data = runProbe(smoke ? {seeds: 2, steps: 96} : undefined);
  const sourcePaths = ['src/engine.ts', 'scripts/memory-policy-probe-v3.ts', 'scripts/lib/memory-policy-cli.mjs', 'experiments/memory-policy-v3/policy.ts'];
  const metadata = {node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch,
    gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
    gitDirty: Boolean(execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim()),
    engineBlob: blob, sourceSha256: Object.fromEntries(sourcePaths.map(p => [p, sha(fs.readFileSync(path.join(root, p)))]))};
  const report = {metadata, numericalSha256: sha(JSON.stringify(data)), data};
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), {recursive: true});
    // Exclusive create prevents accidentally replacing an evidence artifact.
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  }
  console.log(`\nNUMERICAL_SHA256 ${report.numericalSha256}`);
  console.log(`SOURCE ${metadata.gitCommit} dirty=${metadata.gitDirty} Node=${metadata.node}`);
  return report;
}
