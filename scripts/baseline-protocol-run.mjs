/**
 * One run of docs/BASELINE_PROPOSAL.md.
 * Thresholds, seeds, grids, and the bootstrap seed are fixed.
 * Test seeds are not loaded until validation has locked the horizon.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
  createContext,
  createInitialState,
  initializeSmoothedState,
  run,
  sampleAdaptiveNoise,
  sampleInput,
  stepSimulation,
} from "../src/engine.ts";

const OFF = { projection: false, memory: false, summaries: false, noise: false };
const MODES = ["quiet", "align", "periodic", "basin"];
const HORIZONS = [64, 32, 16];
const BASE_RATES = ["0.05", "0.1", "0.2", "0.32", "0.5"];
const EXTRA_RATES = ["0.025", "0.0125", "0.75", "1.0"];
const RATES = [...BASE_RATES, ...EXTRA_RATES];
const TRAIN = range(1000, 1029);
const VAL = range(1030, 1039);
const TEST = range(1040, 1059);

function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

function norm(v) {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

function bound(a) {
  let v = a.map((x) => Math.max(-2, Math.min(2, x)));
  const n = norm(v);
  if (n > 2) v = v.map((x) => x * (2 / n));
  return v;
}

function fail(message) {
  throw new Error(`baseline invalid: ${message}`);
}

function capture(seed, mode) {
  const config = { stimulus: mode, mechanisms: OFF };
  const context = createContext("baseline", seed, config);
  let state = createInitialState("state", context.seed, 12);
  initializeSmoothedState(state, context);
  const inputs = [];
  const latents = {};
  for (let t = 0; t < 64; t++) {
    context.step = state.t;
    const noise = sampleAdaptiveNoise(state, context);
    if (noise.active) fail(`noise active at ${seed} ${mode} ${t}`);
    const input = sampleInput(state, context, undefined, noise);
    inputs.push(input.data.slice());
    const stepped = stepSimulation(state, context);
    if (Math.abs(stepped.frame.inputStrength - input.energy) > 1e-9) fail(`energy mismatch ${seed} ${mode} ${t}`);
    if (stepped.events.length || stepped.frame.projectionTriggered) fail(`projection ${seed} ${mode} ${t}`);
    if (stepped.frame.tags.includes("noise")) fail(`noise tag ${seed} ${mode} ${t}`);
    state = stepped.nextState;
    if (t + 1 === 16 || t + 1 === 32 || t + 1 === 64) latents[t + 1] = state.latent.slice();
  }
  for (const h of HORIZONS) {
    const normal = run(h, seed, config);
    if (normal.events.length) fail(`run projected ${seed} ${mode} ${h}`);
    for (let t = 0; t < h; t++) {
      if (Math.abs(normal.frames[t].inputStrength - norm(inputs[t])) > 1e-9) fail(`run energy ${seed} ${mode} ${t}`);
    }
    for (let i = 0; i < 12; i++) {
      if (normal.currentState.latent[i] !== latents[h][i]) fail(`latent diverge ${seed} ${mode} ${h}`);
    }
  }
  return { inputs, latents };
}

function integrate(inputs, aStr, h) {
  const a = Number(aStr);
  let x = Array(12).fill(0);
  for (let t = 0; t < h; t++) {
    const u = inputs[t];
    x = bound(x.map((v, i) => (1 - a) * v + a * u[i]));
  }
  if (x.some((v) => v < -2 || v > 2) || norm(x) > 2 + 1e-9) fail(`integrator left the bound a=${aStr}`);
  return x;
}

function python(mode, payload) {
  const res = spawnSync("python3", ["scripts/baseline-readout.py", mode], {
    cwd: "/tmp/sde",
    input: payload === undefined ? "" : JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    process.stderr.write(res.stderr || "");
    process.stderr.write(res.stdout || "");
    fail(`python ${mode} exited ${res.status}`);
  }
  if (mode === "--self-check") return res.stdout.trim();
  return JSON.parse(res.stdout);
}

function rows(records, seeds, h, a) {
  const x = [];
  const y = [];
  for (const seed of seeds) {
    MODES.forEach((mode, k) => {
      const rec = records.get(`${seed}:${mode}`);
      const latent = a === "engine" ? rec.latents[h] : integrate(rec.inputs, a, h);
      x.push(latent);
      y.push(k);
    });
  }
  return { a, split: "", x, y };
}

function pack(records, seeds, h, a, split) {
  const built = rows(records, seeds, h, a);
  built.split = split;
  return built;
}

function horizonPayload(records, h) {
  const engine = [
    pack(records, TRAIN, h, "engine", "train"),
    pack(records, VAL, h, "engine", "validation"),
  ];
  const integrator = [];
  for (const a of RATES) {
    integrator.push(pack(records, TRAIN, h, a, "train"));
    integrator.push(pack(records, VAL, h, a, "validation"));
  }
  return { H: h, engine, integrator };
}

function meanDistance(records, seeds, h, a) {
  let total = 0;
  let n = 0;
  for (const seed of seeds) {
    for (const mode of MODES) {
      const rec = records.get(`${seed}:${mode}`);
      const e = rec.latents[h];
      const g = integrate(rec.inputs, a, h);
      total += norm(e.map((v, i) => v - g[i]));
      n += 1;
    }
  }
  return total / n;
}

function fmt(n) {
  return Number(n).toFixed(6);
}

function tableLines(rows) {
  const lines = ["| a | lambda | validation correct | converged |", "| --- | --- | --- | --- |"];
  for (const row of rows) {
    lines.push(`| ${row.a} | ${row.lambda} | ${row.correct}/${row.total} | ${row.converged ? "yes" : "no"} |`);
  }
  return lines;
}

const selfCheck = python("--self-check");
if (!selfCheck.startsWith("self-check ok")) fail(selfCheck);

const pilotSeeds = [...TRAIN, ...VAL];
const records = new Map();
let referenceInputs = null;
for (const seed of pilotSeeds) {
  for (const mode of MODES) {
    const rec = capture(seed, mode);
    if (referenceInputs === null) referenceInputs = new Map();
    if (!referenceInputs.has(mode)) referenceInputs.set(mode, rec.inputs);
    const ref = referenceInputs.get(mode);
    for (let t = 0; t < 64; t++) {
      for (let i = 0; i < 12; i++) {
        if (rec.inputs[t][i] !== ref[t][i]) fail(`input depends on seed ${seed} ${mode} ${t}`);
      }
    }
    if (mode === "quiet" && rec.inputs.some((u) => u.some((v) => v !== 0))) fail("quiet input was not zero");
    records.set(`${seed}:${mode}`, rec);
  }
}

const walked = [];
let locked = null;
for (const h of HORIZONS) {
  const selected = python("--select", { horizons: [horizonPayload(records, h)] }).horizons[0];
  if (!selected.engine || !selected.integrator) fail(`readout did not converge at H=${h}`);
  const informative = selected.integrator.correct <= 36;
  walked.push({ selected, informative, validationDistance: meanDistance(records, VAL, h, selected.integrator.a) });
  if (informative || h === 16) {
    locked = walked[walked.length - 1];
    break;
  }
}

const pilot = locked.selected;
const scoreTest = locked.informative && pilot.engine.converged && pilot.integrator.converged;
let scored = null;
if (scoreTest) {
  for (const seed of TEST) {
    for (const mode of MODES) {
      const rec = capture(seed, mode);
      const ref = referenceInputs.get(mode);
      for (let t = 0; t < 64; t++) {
        for (let i = 0; i < 12; i++) {
          if (rec.inputs[t][i] !== ref[t][i]) fail(`test input mismatch ${seed} ${mode}`);
        }
      }
      records.set(`${seed}:${mode}`, rec);
    }
  }
  const h = pilot.H;
  const engineX = [];
  const integX = [];
  const y = [];
  const seeds = [];
  const modes = [];
  const distances = [];
  for (const seed of TEST) {
    MODES.forEach((mode, k) => {
      const rec = records.get(`${seed}:${mode}`);
      const e = rec.latents[h];
      const g = integrate(rec.inputs, pilot.integrator.a, h);
      engineX.push(e);
      integX.push(g);
      y.push(k);
      seeds.push(seed);
      modes.push(mode);
      distances.push(norm(e.map((v, i) => v - g[i])));
    });
  }
  scored = python("--score", {
    engine_theta: pilot.engine.theta,
    integrator_theta: pilot.integrator.theta,
    engine_x: engineX,
    integrator_x: integX,
    y,
    seeds,
    modes,
    distances,
    bootstrap_seed: 20261004,
    bootstrap_draws: 10000,
  });
}

const interpretable = scoreTest && pilot.a_flips.length === 0;
const lines = [];
lines.push("# Baseline result");
lines.push("");
lines.push("Status: RUN once. The rules in [docs/BASELINE_PROPOSAL.md](BASELINE_PROPOSAL.md) were not changed after these scores.");
lines.push("");
lines.push("Primary arm only: projection, memory, summaries, and noise off. This result says nothing about memory or basin projection.");
lines.push("");
lines.push("## Lock");
lines.push("");
lines.push(`Horizon walk, in order, using validation seeds 1030-1039 only:`);
lines.push("");
for (const step of walked) {
  const eng = step.selected.engine;
  const integ = step.selected.integrator;
  lines.push(`- H=${step.selected.H}: integrator ${integ.correct}/${integ.total} at a=${integ.a}, lambda=${integ.lambda}; engine ${eng.correct}/${eng.total} at lambda=${eng.lambda}; ${step.informative ? "at or below 0.90, locked" : "above 0.90, horizon uninformative"}.`);
}
lines.push("");
lines.push(`Last horizon examined: ${pilot.H}. Test scoring happens only when that horizon is at or below 0.90.`);
lines.push(`Integrator rate a=${pilot.integrator.a} after ${pilot.integrator.extensions} extension(s). Cap hit: ${pilot.integrator.cap_hit ? "yes" : "no"}.`);
lines.push(`Lambdas: engine ${pilot.engine.lambda}, integrator ${pilot.integrator.lambda}.`);
lines.push(`Lambda on a grid edge: engine ${pilot.engine.edge ? "yes" : "no"}, integrator ${pilot.integrator.edge ? "yes" : "no"}. The lambda grid was not extended.`);
lines.push(`Original five-rate choice of a, before extensions: ${pilot.base_selected_a}.`);
if (pilot.a_flips.length === 0) lines.push("Removing one original rate did not flip that choice of a.");
else lines.push(`Removing one original rate flipped that choice: ${pilot.a_flips.map((f) => `drop ${f.dropped} -> ${f.selected_a}`).join("; ")}. The selected rate was not replaced. The comparison is not interpretable.`);
lines.push(`Mean Euclidean distance on the validation sequences at the locked setting: ${fmt(locked.validationDistance)}.`);
lines.push("");
lines.push("Engine validation grid:");
lines.push("");
lines.push(...tableLines(pilot.engine_table));
lines.push("");
lines.push("Integrator validation grid at the eligible rates:");
lines.push("");
lines.push(...tableLines(pilot.integrator_final_table));
lines.push("");
lines.push("## Inputs");
lines.push("");
lines.push("For every training and validation seed, the recorded `sampleInput` vectors matched the input strength of `run()` at the same mode, seed, and tick, and the final 12-number state matched `run()`. The four generators did not depend on the seed. `quiet` was the zero vector. No projection events fired. Test seeds are loaded only after a horizon is locked for scoring.");
lines.push("");
lines.push("## Readout");
lines.push("");
lines.push("Multinomial logistic regression, reference class `quiet` fixed at zero weights and zero bias. Other classes have an unpenalized bias. The penalty is `(lambda / 2)` times the sum of squared weights. The data term is the mean negative log likelihood on the training rows. Newton stopped below a gradient infinity norm of `1e-8`. The same training coefficients scored validation and, if reached, test. Bootstrap seed `20261004`, 10000 resamples, percentile interval by NumPy's linear quantile.");
lines.push("");
if (!scoreTest) {
  lines.push("## Verdict");
  lines.push("");
  lines.push("The tuned integrator was still above 0.90 validation accuracy at 16 ticks, or a required fit did not converge. Test seeds were not scored. There is no benefit verdict. The task, as written, is uninformative.");
} else {
  lines.push("## Test");
  lines.push("");
  lines.push(`Engine ${scored.engine_correct}/${scored.total}. Integrator ${scored.integrator_correct}/${scored.total}.`);
  if (scored.integrator_correct / scored.total > 0.9) {
    lines.push("The integrator's test accuracy is above 0.90 even though its validation accuracy was not. The horizon was not shortened after seeing the test seeds.");
  }
  lines.push(`Mean paired difference (engine minus integrator): ${fmt(scored.point)}.`);
  lines.push(`95 percent interval: [${fmt(scored.low)}, ${fmt(scored.high)}]. Width: ${fmt(scored.width)}.`);
  lines.push(`Interval entirely below 0: ${scored.entirely_below_zero ? "yes" : "no"}.`);
  lines.push(`Mean Euclidean distance on the test sequences: ${fmt(scored.mean_distance)}.`);
  lines.push("");
  lines.push("| mode | engine | integrator |");
  lines.push("| --- | --- | --- |");
  for (const row of scored.modes) {
    lines.push(`| ${row.mode} | ${row.engine_correct}/${row.total} | ${row.integrator_correct}/${row.total} |`);
  }
  lines.push("");
  lines.push("Per-seed differences, engine accuracy minus integrator accuracy:");
  lines.push("");
  lines.push(scored.diffs.map((d) => fmt(d)).join(", "));
  lines.push("");
  lines.push("## Verdict");
  lines.push("");
  lines.push(`Mechanical tier: ${scored.verdict}.`);
  if (!interpretable) lines.push("The rate-grid sensitivity check fired, so this tier is not an interpretable comparison.");
  lines.push("A pass or a fail here does not say anything about memory or projection. Those arms were not run.");
}
lines.push("");
lines.push("No second run was used to replace these numbers.");
lines.push("");

const markdown = lines.join("\n");
writeFileSync("/tmp/sde/docs/BASELINE_RESULT.md", markdown);
writeFileSync("/tmp/sde/docs/baseline-result.json", JSON.stringify({
  selfCheck,
  walked: walked.map((step) => ({
    H: step.selected.H,
    informative: step.informative,
    validationDistance: step.validationDistance,
    engine: { lambda: step.selected.engine.lambda, correct: step.selected.engine.correct, total: step.selected.engine.total, edge: step.selected.engine.edge, converged: step.selected.engine.converged, grad_inf: step.selected.engine.grad_inf },
    integrator: { a: step.selected.integrator.a, lambda: step.selected.integrator.lambda, correct: step.selected.integrator.correct, total: step.selected.integrator.total, extensions: step.selected.integrator.extensions, cap_hit: step.selected.integrator.cap_hit, edge: step.selected.integrator.edge, converged: step.selected.integrator.converged, grad_inf: step.selected.integrator.grad_inf },
    base_selected_a: step.selected.base_selected_a,
    a_flips: step.selected.a_flips,
    engine_table: step.selected.engine_table,
    integrator_final_table: step.selected.integrator_final_table,
    extension_history: step.selected.extension_history,
  })),
  scored,
  scoreTest,
  interpretable,
}, null, 2));
process.stdout.write(markdown);
