import "./styles.css";

import { BASINS, type Mechanisms, type EngineConfig, type DiagnosticFrame, type Vector } from "../../../src/engine.ts";
import { runImplementationVerification, type ComplianceReport } from "./compliance.ts";
import {
  createSession,
  PERSISTENT_STIMULI,
  type LiveConfigPatch,
  type PersistentStimulus,
  type SimulationSession,
  type SessionSnapshot,
  type SessionStep,
} from "./session.ts";
import { FieldVisualizer } from "./visualizer.ts";
import { createProjectionLedgerItem } from "./projection-ledger.ts";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app root");

app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">SD</div>
        <div>
          <div class="eyebrow">Deterministic simulation / 12 dimensions</div>
          <h1>State Dynamics Lab</h1>
        </div>
      </div>
      <div class="header-equation">Input. History. Repeatable change.</div>
      <div class="status-strip" aria-label="Simulation status">
        <div class="status-chip"><span>tick</span><strong id="status-tick">0</strong></div>
        <div class="status-chip"><span>phase</span><strong id="status-phase">0</strong></div>
        <div class="status-chip" id="status-mode"><span>engine</span><strong>paused</strong></div>
        <div class="status-chip"><span>hash</span><strong id="status-hash"> - </strong></div>
        <a class="status-chip status-link" href="./probe.html"><span>view</span><strong>probe</strong></a>
      </div>
    </header>

    <div class="workspace">
      <main class="primary">
        <nav class="tabs" role="tablist" aria-label="Simulator views">
          <button class="tab" role="tab" id="tab-field" aria-controls="view-field" aria-selected="true" data-view="field">Field</button>
          <button class="tab" role="tab" id="tab-trace" aria-controls="view-trace" aria-selected="false" tabindex="-1" data-view="trace">Trace + memory</button>
          <button class="tab" role="tab" id="tab-operators" aria-controls="view-operators" aria-selected="false" tabindex="-1" data-view="operators">How it works</button>
          <button class="tab" role="tab" id="tab-verify" aria-controls="view-verify" aria-selected="false" tabindex="-1" data-view="verify">Verification</button>
        </nav>

        <section class="view" id="view-field" role="tabpanel" aria-labelledby="tab-field" data-panel="field">
          <div class="field-layout">
            <article class="card stage-card">
              <header class="stage-head">
                <div>
                  <div class="section-kicker">Current state / 12-axis view</div>
                  <h2 id="stage-title">Latent state at t = 0</h2>
                </div>
                <div class="legend" aria-label="Field legend">
                  <span class="legend-item legend-field">Current state</span>
                  <span class="legend-item legend-smoothed">Smoothed state</span>
                  <span class="legend-item legend-update">Update direction</span>
                </div>
              </header>
              <canvas
                id="field-canvas"
                role="button"
                tabindex="0"
                aria-describedby="inject-hint"
                aria-label="Twelve-axis state view. Activate to queue one pulse stimulus."
              ></canvas>
              <div class="inject-hint" id="inject-hint">Click or press Enter to queue a one-tick input pulse</div>
            </article>

            <div class="side-stack">
              <article class="card metric-card">
                <div class="metric-top">
                  <span class="metric-label">Coherence score</span>
                  <strong class="metric-value" id="coherenceScore-value">0.000</strong>
                </div>
                <svg class="sparkline" id="coherenceScore-spark" viewBox="0 0 200 42" preserveAspectRatio="none" aria-hidden="true">
                  <path class="area"></path><path class="line"></path>
                </svg>
              </article>
              <article class="card metric-card">
                <div class="metric-top">
                  <span class="metric-label">Update magnitude</span>
                  <strong class="metric-value" id="update-value">0.000</strong>
                </div>
                <svg class="sparkline" id="update-spark" viewBox="0 0 200 42" preserveAspectRatio="none" aria-hidden="true">
                  <path class="area"></path><path class="line"></path>
                </svg>
              </article>
              <article class="card metric-card">
                <div class="metric-top">
                  <span class="metric-label">entropy</span>
                  <strong class="metric-value" id="entropy-value">0.000</strong>
                </div>
                <svg class="sparkline" id="entropy-spark" viewBox="0 0 200 42" preserveAspectRatio="none" aria-hidden="true">
                  <path class="area"></path><path class="line"></path>
                </svg>
              </article>
              <article class="card metric-card">
                <div class="metric-top">
                  <span class="metric-label">Input strength</span>
                  <strong class="metric-value" id="input-value">0.000</strong>
                </div>
                <svg class="sparkline" id="input-spark" viewBox="0 0 200 42" preserveAspectRatio="none" aria-hidden="true">
                  <path class="area"></path><path class="line"></path>
                </svg>
              </article>
              <article class="card state-card">
                <div class="metric-top">
                  <span class="metric-label">12D latent channels</span>
                  <span class="control-value" id="basin-value">basin  - </span>
                </div>
                <div class="state-grid" id="latent-grid"></div>
              </article>
            </div>
          </div>
        </section>

        <section class="view" id="view-trace" role="tabpanel" aria-labelledby="tab-trace" data-panel="trace" hidden>
          <header class="section-heading">
            <div>
              <div class="section-kicker">Engine-derived telemetry only</div>
              <h2>Trace, projection events, and history summaries</h2>
              <p class="section-note">Every plotted point comes from a committed Diagnostics frame. Projection markers resolve to emitted pre/post-hash events.</p>
            </div>
          </header>
          <div class="trace-grid">
            <article class="card chart-card">
              <div class="metric-top"><span class="metric-label">Last 256 committed ticks</span><span class="control-value" id="trace-count">0 frames</span></div>
              <div class="chart-legend">
                <span style="color: var(--cyan)">Coherence score</span>
                <span style="color: var(--gold)">Update magnitude</span>
                <span style="color: var(--coral)">Input strength</span>
                <span style="color: var(--blue)">entropy</span>
              </div>
              <svg class="trace-chart" id="trace-chart" viewBox="0 0 1000 220" preserveAspectRatio="none" role="img" aria-label="Telemetry time series" aria-describedby="trace-summary"></svg>
              <p class="visually-hidden" id="trace-summary">No committed telemetry frames.</p>
            </article>
            <article class="card event-card">
              <div class="metric-top"><span class="metric-label">Basin projection ledger</span><span class="control-value" id="event-count">0 events</span></div>
              <ul class="event-list" id="event-list"></ul>
            </article>
            <article class="card memorySummaries-card">
              <div class="metric-top"><span class="metric-label">History summaries</span><span class="control-value" id="memorySummaries-count">0 nodes</span></div>
              <ul class="memorySummaries-list" id="memorySummaries-list"></ul>
            </article>
            <article class="card state-card">
              <div class="metric-top"><span class="metric-label">Current run recipe</span><span class="control-value" id="pulse-count">0 pulses</span></div>
              <div class="type-spine" id="run-recipe">seed = 0x51e1d\nstimulus = periodic\nframes = 0</div>
            </article>
          </div>
        </section>

        <section class="view" id="view-operators" role="tabpanel" aria-labelledby="tab-operators" data-panel="operators" hidden>
          <header class="section-heading"><div><div class="section-kicker">How one step works</div><h2>Inside the engine</h2><p class="section-note">Each step applies the same ordered calculations to a bounded 12-number state.</p></div></header>
          <div class="operator-grid">
            <article class="card operator-card"><div class="metric-label">Update pipeline</div>
              <div class="operator-list">
                <div class="operator-item"><strong>1. Smooth</strong><p>Blend the previous smoothed state with the current state using an exponential moving average.</p></div>
                <div class="operator-item"><strong>2. Sample input</strong><p>Combine the selected stimulus, optional seeded noise, and recalled history.</p></div>
                <div class="operator-item"><strong>3. Compute update</strong><p>Scale the difference between the input and the current state, then limit its magnitude.</p></div>
                <div class="operator-item"><strong>4. Combine</strong><p>Apply the gated update to the smoothed state and enforce the vector bounds.</p></div>
                <div class="operator-item"><strong>5. Project</strong><p>When the coherence threshold and dwell rule permit, move toward the nearest of six fixed basin vectors.</p></div>
                <div class="operator-item"><strong>6. Record</strong><p>Emit diagnostics, retain state history, and periodically store a mean-pooled history summary.</p></div>
              </div>
            </article>
            <article class="card scope-card"><div class="metric-label">Reading the instrument</div><h2>What the measurements mean</h2>
              <ul><li><strong>Coherence score:</strong> a weighted combination of alignment, input strength, update size, and the prior score.</li><li><strong>Input strength:</strong> the Euclidean norm of the sampled input vector.</li><li><strong>Update magnitude:</strong> the Euclidean norm of the bounded update vector.</li><li><strong>Entropy:</strong> a normalized eight-bin statistic of the state components.</li><li><strong>Basin 1-6:</strong> fixed reference vectors with no assigned psychological meaning.</li></ul>
              <p>Disable one mechanism, reset, and compare the trace under the same seed. The six basins and numeric thresholds are settings of this particular model.</p>
              <div class="boundary-callout">This is an experimental software simulation. Its numerical behavior is reproducible; usefulness for a real task requires a separate evaluation.</div>
            </article>
          </div>
        </section>

        <section class="view" id="view-verify" role="tabpanel" aria-labelledby="tab-verify" data-panel="verify" hidden>
          <header class="section-heading">
            <div>
              <div class="section-kicker">Executable implementation checks</div>
              <h2>Determinism and invariant verification</h2>
              <p class="section-note">Checks rerun the browser-safe engine locally. Passing means this implementation is repeatable under the tested conditions; it checks the software behavior described here.</p>
            </div>
            <button class="primary-button" id="run-checks-button">Run checks</button>
          </header>
          <div class="verify-grid">
            <article class="card checks-card">
              <div class="metric-top"><span class="metric-label">Check results</span><span class="control-value" id="check-overall">not run</span></div>
              <ul class="check-list" id="check-list"><li class="empty-state">Run the checks to compare deterministic replays, projection integrity, trace alignment, pulse scheduling, and mechanisms.</li></ul>
            </article>
            <article class="card scope-card">
              <div class="metric-label">Current-run evidence</div>
              <div class="verification-summary">
                <div class="summary-cell"><span class="table-label">frames</span><strong id="summary-frames">0</strong></div>
                <div class="summary-cell"><span class="table-label">events</span><strong id="summary-events">0</strong></div>
                <div class="summary-cell"><span class="table-label">summaries</span><strong id="summary-memorySummaries">0</strong></div>
              </div>
              <div class="boundary-callout">Primary falsifier: identical seed, configuration, and input schedule produce different hashes. A causal ablation also fails its claim if the supposedly disabled path remains active.</div>
            </article>
          </div>
        </section>
      </main>

      <aside class="control-panel" id="control-panel" aria-label="Simulation controls">
        <header class="panel-heading">
          <div><div class="section-kicker">Step cycle recurrence controls</div><h2>Run console</h2></div>
          <div class="icon-actions">
            <button class="icon-button" id="play-button" title="Play or pause (Space)" aria-label="Play simulation">Play</button>
            <button class="icon-button" id="step-button" title="Step one tick (Right arrow)" aria-label="Step one tick">+1</button>
            <button class="icon-button" id="reset-button" title="Reset this seed (R)" aria-label="Reset simulation">Reset</button>
          </div>
        </header>
        <button class="secondary-button mobile-controls-toggle" id="controls-toggle" aria-expanded="false" aria-controls="parameter-sections">Show parameters</button>

        <section class="control-section">
          <div class="control-value-row"><span class="control-label">Seed</span><span class="control-value" id="normalized-seed"> - </span></div>
          <div class="seed-row">
            <input class="text-input" id="seed-input" value="0x51e1d" maxlength="128" aria-label="Simulation seed" spellcheck="false" />
            <button class="icon-button" id="new-seed-button" title="Generate a new seed" aria-label="Generate a new seed">New</button>
          </div>
          <div class="control-value-row" style="margin-top: 13px"><span class="control-label">Tick interval</span><span class="control-value" id="interval-value">180 ms</span></div>
          <input class="range" id="interval-range" type="range" min="50" max="800" step="10" value="180" aria-label="Tick interval in milliseconds" />
        </section>

        <div id="parameter-sections" class="parameter-sections">
        <section class="control-section">
          <div class="control-label">Input</div>
          <div class="mode-grid" id="mode-grid">
            ${PERSISTENT_STIMULI.map((mode) => `<button class="mode-button" data-mode="${mode}" aria-pressed="${mode === "periodic"}">${mode}</button>`).join("")}
          </div>
        </section>

        <section class="control-section">
          <div class="control-value-row"><label class="control-label" for="projectionThreshold-range">Projection threshold</label><span class="control-value" id="projectionThreshold-value">0.78</span></div>
          <input class="range" id="projectionThreshold-range" type="range" min="0.40" max="0.99" step="0.01" value="0.78" />
          <div class="control-value-row" style="margin-top: 12px"><label class="control-label" for="update-range">Update scale</label><span class="control-value" id="update-scale-value">0.32</span></div>
          <input class="range" id="update-range" type="range" min="0.05" max="0.80" step="0.01" value="0.32" />
          <div class="control-value-row" style="margin-top: 12px"><label class="control-label" for="noise-range">Adaptive noise amplitude</label><span class="control-value" id="noise-value">0.055</span></div>
          <input class="range" id="noise-range" type="range" min="0" max="0.20" step="0.005" value="0.055" />
        </section>

        <section class="control-section">
          <div class="control-label">Mechanisms</div>
          <div class="switch-list">
            <label class="switch-row"><span>Basin projection<small>threshold projection + event</small></span><input class="switch" type="checkbox" data-ablation="projection" checked /></label>
            <label class="switch-row"><span>Memory influence<small>recall a similar history summary</small></span><input class="switch" type="checkbox" data-ablation="memory" checked /></label>
            <label class="switch-row"><span>History summaries<small>store averaged state history</small></span><input class="switch" type="checkbox" data-ablation="summaries" checked /></label>
            <label class="switch-row"><span>Adaptive noise<small>seeded Gaussian input sample</small></span><input class="switch" type="checkbox" data-ablation="noise" checked /></label>
          </div>
        </section>

        <section class="control-section">
          <div class="action-row">
            <button class="primary-button" id="pulse-button">Queue input pulse</button>
            <button class="secondary-button" id="export-button">Export trace JSON</button>
          </div>
        </section>
        </div>
      </aside>
    </div>

    <footer class="footer-boundary">Experimental 12D state simulation. Compare mechanisms under identical seeds and inputs.</footer>
  </div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
`;

function required<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing UI element: ${selector}`);
  return node;
}

const canvas = required<HTMLCanvasElement>("#field-canvas");
const visualizer = new FieldVisualizer(canvas);
const runNonce = new Uint32Array(2);
crypto.getRandomValues(runNonce);
const runId = `state-dynamics-ui-${[...runNonce].map((value) => value.toString(16).padStart(8, "0")).join("")}`;
let session: SimulationSession = createSession({ runId, seed: "0x51e1d" });
let intervalMs = 180;
let timer: number | undefined;
let toastTimer: number | undefined;

const text = (selector: string, value: string | number): void => {
  required<HTMLElement>(selector).textContent = String(value);
};

function format(value: number | undefined, digits = 3): string {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : " - ";
}

function safeBasinLabel(snapshot: SessionSnapshot): string {
  const id = snapshot.currentState.basinId;
  return id === undefined ? " - " : (BASINS[id]?.label ?? `#${id}`);
}

function showToast(message: string): void {
  const toast = required<HTMLElement>("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function valuesPath(values: number[], width: number, height: number, fixedMax?: number): string {
  if (!values.length) return "";
  const min = fixedMax === undefined ? Math.min(...values) : 0;
  const max = fixedMax ?? Math.max(...values);
  const range = Math.max(max - min, 1e-9);
  return values.map((value, index) => {
    const x = values.length === 1 ? width : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 4) - 2;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function updateSparkline(selector: string, values: number[], fixedMax?: number): void {
  const svg = required<SVGSVGElement>(selector);
  const line = svg.querySelector<SVGPathElement>(".line");
  const area = svg.querySelector<SVGPathElement>(".area");
  if (!line || !area) return;
  const path = valuesPath(values, 200, 42, fixedMax);
  line.setAttribute("d", path);
  area.setAttribute("d", path ? `${path} L200,42 L0,42 Z` : "");
}

function updateLatentGrid(latent: Vector): void {
  const grid = required<HTMLElement>("#latent-grid");
  if (grid.childElementCount !== latent.length) {
    grid.replaceChildren(...latent.map((_, index) => {
      const cell = document.createElement("div");
      cell.className = "latent-cell";
      cell.innerHTML = `<span>state${String(index + 1).padStart(2, "0")}</span><span class="fill"></span><strong></strong>`;
      return cell;
    }));
  }
  [...grid.children].forEach((child, index) => {
    const cell = child as HTMLElement;
    const value = latent[index] ?? 0;
    cell.style.setProperty("--level", `${Math.round(((value + 2) / 4) * 100)}%`);
    const strong = cell.querySelector("strong");
    if (strong) strong.textContent = value.toFixed(2);
  });
}

function svgElement<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

function updateTraceChart(frames: DiagnosticFrame[], totalFrameCount: number): void {
  const svg = required<SVGSVGElement>("#trace-chart");
  const recent = frames;
  svg.replaceChildren();
  for (let y = 0; y <= 4; y += 1) {
    svg.append(svgElement("line", { x1: "0", x2: "1000", y1: String(y * 55), y2: String(y * 55), class: "grid-line" }));
  }
  const series: Array<{ values: number[]; color: string; dash?: string; max?: number }> = [
    { values: recent.map((frame) => frame.coherenceScore), color: "#58d7ca", max: 1 },
    { values: recent.map((frame) => frame.updateMagnitude), color: "#f5c978", dash: "10 4", max: 1.4 },
    { values: recent.map((frame) => frame.inputStrength), color: "#ff7d8b", dash: "2 5" },
    { values: recent.map((frame) => frame.entropy), color: "#76a9ff", dash: "12 4 2 4", max: 1 },
  ];
  for (const item of series) {
    svg.append(svgElement("path", {
      d: valuesPath(item.values, 1000, 220, item.max),
      class: "series",
      stroke: item.color,
      ...(item.dash ? { "stroke-dasharray": item.dash } : {}),
    }));
  }
  recent.forEach((frame, index) => {
    if (!frame.projectionTriggered) return;
    const x = recent.length === 1 ? 1000 : (index / (recent.length - 1)) * 1000;
    svg.append(svgElement("line", { x1: String(x), x2: String(x), y1: "0", y2: "220", stroke: "#ffe2a9", "stroke-width": "1", "stroke-dasharray": "4 4", opacity: "0.72" }));
  });
  text("#trace-count", `${totalFrameCount} frame${totalFrameCount === 1 ? "" : "s"}`);
  const latest = recent.at(-1);
  text(
    "#trace-summary",
    latest
      ? `The chart shows ${recent.length} most recent of ${totalFrameCount} committed frames. Latest values: coherence ${format(latest.coherenceScore)}, StateUpdate magnitude ${format(latest.updateMagnitude)}, Phi energy ${format(latest.inputStrength)}, entropy ${format(latest.entropy)}. The four series also use distinct line patterns.`
      : "No committed telemetry frames.",
  );
}

function updateEvents(snapshot: SessionSnapshot): void {
  const list = required<HTMLUListElement>("#event-list");
  const eventHistory = snapshot.eventHistory;
  text("#event-count", `${eventHistory.total} event${eventHistory.total === 1 ? "" : "s"}`);
  if (!eventHistory.events.length) {
    list.innerHTML = '<li class="empty-state">No Basin projection event yet. Basin drive or a lower threshold makes the implementation-specific predicate easier to reach.</li>';
    return;
  }
  list.replaceChildren(...eventHistory.events.slice().reverse().map(createProjectionLedgerItem));
}

function updateMesh(snapshot: SessionSnapshot): void {
  const list = required<HTMLUListElement>("#memorySummaries-list");
  text("#memorySummaries-count", `${snapshot.memorySummaries.length} node${snapshot.memorySummaries.length === 1 ? "" : "s"}`);
  if (!snapshot.memorySummaries.length) {
    list.innerHTML = `<li class="empty-state">History summary summarizes every ${snapshot.config.summaryInterval} ticks when enabled.</li>`;
    return;
  }
  list.replaceChildren(...snapshot.memorySummaries.slice().reverse().map((node) => {
    const item = document.createElement("li");
    item.className = "memorySummaries-item";
    item.innerHTML = `<header><span>modulation-${node.id}</span><span>t=${node.step}</span></header><p>Coherence ${format(node.coherenceScore)}  /  12D mean-pooled trace window</p>`;
    return item;
  }));
}

function updateTransport(snapshot: SessionSnapshot): void {
  const play = required<HTMLButtonElement>("#play-button");
  play.textContent = snapshot.playing ? "Pause" : "Play";
  play.setAttribute("aria-label", snapshot.playing ? "Pause simulation" : "Play simulation");
  play.classList.toggle("is-running", snapshot.playing);
  const atLimit = snapshot.frameCount >= snapshot.maxTicks;
  required<HTMLButtonElement>("#pulse-button").disabled = atLimit;
  canvas.setAttribute("aria-disabled", String(atLimit));
  text("#status-tick", snapshot.currentState.t);
  text("#status-phase", snapshot.latestFrame?.phase ?? 0);
  text("#status-hash", snapshot.stateHash.slice(0, 8));
  const status = required<HTMLElement>("#status-mode");
  const state = snapshot.latestFrame?.projectionTriggered ? "Basin projection" : snapshot.playing ? "live" : "paused";
  status.querySelector("strong")!.textContent = state;
  status.classList.toggle("live", snapshot.playing && !snapshot.latestFrame?.projectionTriggered);
  status.classList.toggle("projection", Boolean(snapshot.latestFrame?.projectionTriggered));
  text("#normalized-seed", `u32 ${snapshot.seed}`);
  text("#inject-hint", snapshot.pulsePending ? "Input pulse queued for the next committed tick" : "Click or press Enter to queue a one-tick input pulse");
}

function updateModeButtons(snapshot: SessionSnapshot): void {
  document.querySelectorAll<HTMLButtonElement>(".mode-button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.mode === snapshot.persistentStimulus));
  });
}

function updateControls(snapshot: SessionSnapshot): void {
  const controls: Array<[string, number, string, number]> = [
    ["#projectionThreshold-range", snapshot.config.projectionThreshold, "#projectionThreshold-value", 2],
    ["#update-range", snapshot.config.updateScale, "#update-scale-value", 2],
    ["#noise-range", snapshot.config.noiseAmplitude, "#noise-value", 3],
  ];
  for (const [inputSelector, value, outputSelector, digits] of controls) {
    required<HTMLInputElement>(inputSelector).value = String(value);
    text(outputSelector, value.toFixed(digits));
  }
  document.querySelectorAll<HTMLInputElement>("[data-ablation]").forEach((input) => {
    const key = input.dataset.ablation as keyof Mechanisms;
    input.checked = snapshot.config.mechanisms[key];
  });
}

function refresh(lastStep?: SessionStep): void {
  const snapshot = session.snapshot();
  const frames = snapshot.recentFrames;
  const latest = snapshot.latestFrame;

  updateTransport(snapshot);
  updateModeButtons(snapshot);
  updateControls(snapshot);
  text("#stage-title", `Latent state at t = ${snapshot.currentState.t}`);
  text("#coherenceScore-value", format(latest?.coherenceScore ?? snapshot.currentState.coherence));
  text("#update-value", format(latest?.updateMagnitude));
  text("#entropy-value", format(latest?.entropy));
  text("#input-value", format(latest?.inputStrength ?? snapshot.currentState.inputStrength));
  text("#basin-value", `basin ${safeBasinLabel(snapshot)}`);
  text("#pulse-count", `${snapshot.pulseCount} pulse${snapshot.pulseCount === 1 ? "" : "s"}`);
  text("#summary-frames", snapshot.frameCount);
  text("#summary-events", snapshot.eventHistory.total);
  text("#summary-memorySummaries", snapshot.memorySummaries.length);
  text("#run-recipe", `seed = ${String(snapshot.seedInput)}\nu32 = ${snapshot.seed}\nstimulus = ${snapshot.persistentStimulus}\nframes = ${snapshot.frameCount}\npulses = ${snapshot.pulseCount}\nthreshold = ${snapshot.config.projectionThreshold.toFixed(2)}`);

  const recent = frames.slice(-64);
  updateSparkline("#coherenceScore-spark", recent.map((frame) => frame.coherenceScore), 1);
  updateSparkline("#update-spark", recent.map((frame) => frame.updateMagnitude), 1.4);
  updateSparkline("#entropy-spark", recent.map((frame) => frame.entropy), 1);
  updateSparkline("#input-spark", recent.map((frame) => frame.inputStrength));
  updateLatentGrid(snapshot.currentState.latent);
  updateTraceChart(frames, snapshot.frameCount);
  updateEvents(snapshot);
  updateMesh(snapshot);

  const priorUpdate = snapshot.priorUpdate ?? Array(12).fill(0);
  visualizer.update({
    latent: snapshot.currentState.latent,
    smoothedState: snapshot.smoothedState,
    update: priorUpdate,
    trail: snapshot.stateHistory.slice(-64).map((sample) => sample.latent),
    coherenceScore: latest?.coherenceScore ?? snapshot.currentState.coherence,
    phase: latest?.phase ?? 0,
    step: snapshot.currentState.t,
    inputStrength: latest?.inputStrength ?? snapshot.currentState.inputStrength,
    projected: Boolean(lastStep?.events.length),
    mechanisms: snapshot.config.mechanisms,
    summaries: snapshot.memorySummaries,
    // The session does not expose its latest recall packet. Do not retrieve again.
    recall: null,
  });
  canvas.setAttribute("aria-label", `Twelve-axis state view at tick ${snapshot.currentState.t}; coherence ${format(latest?.coherenceScore ?? snapshot.currentState.coherence)}; ${snapshot.pulsePending ? "pulse queued" : "activate to queue a pulse"}.`);
}

function stopTimer(): void {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
}

function syncTimer(): void {
  stopTimer();
  if (!session.snapshot().playing) return;
  timer = window.setInterval(() => {
    const step = session.tick();
    if (step) refresh(step);
    const after = session.snapshot();
    if (!after.playing) {
      stopTimer();
      if (after.frameCount >= after.maxTicks) {
        showToast(`Reached the ${after.maxTicks}-tick safety limit. Export or reset to continue.`);
      }
    }
  }, intervalMs);
}

function resetSession(seed?: string | number, playing?: boolean): void {
  try {
    session.reset({ seed, playing });
    refresh();
    syncTimer();
  } catch (error) {
    required<HTMLInputElement>("#seed-input").value = String(session.snapshot().seedInput);
    showToast(error instanceof Error ? error.message : "The session could not be reset.");
  }
}

function applyConfigAndRestart(patch: LiveConfigPatch): void {
  const wasPlaying = session.snapshot().playing;
  session.pause();
  session.updateConfig(patch);
  if (wasPlaying) session.play();
  refresh();
  syncTimer();
  showToast("Configuration changed; a fresh deterministic run was started.");
}

function setMechanismAndRestart(key: keyof Mechanisms, enabled: boolean): void {
  const wasPlaying = session.snapshot().playing;
  session.pause();
  session.setMechanisms({ [key]: enabled });
  if (wasPlaying) session.play();
  refresh();
  syncTimer();
  showToast(`${key} ${enabled ? "enabled" : "ablated"}; a fresh run was started.`);
}

function queuePulse(clientX?: number, clientY?: number): void {
  try {
    session.queuePulse();
    if (clientX !== undefined && clientY !== undefined) visualizer.markPulse(clientX, clientY);
    refresh();
    showToast("One-tick Input pulse queued. It will be consumed by the next committed step.");
  } catch (error) {
    refresh();
    showToast(error instanceof Error ? error.message : "The pulse could not be queued.");
  }
}

function selectView(view: string): void {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
    const selected = tab.dataset.view === view;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll<HTMLElement>(".view").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== view;
  });
  if (view === "field") window.requestAnimationFrame(() => refresh());
}

function renderCompliance(report: ComplianceReport): void {
  const list = required<HTMLUListElement>("#check-list");
  list.replaceChildren(...report.checks.map((check) => {
    const item = document.createElement("li");
    item.className = "check-item";
    item.dataset.status = check.status;
    item.innerHTML = `<header><span>${check.name}</span><span class="check-status">${check.status.replace("-", " ")}</span></header><p>${check.detail}</p>`;
    return item;
  }));
  const passed = report.checks.filter((check) => check.status === "pass").length;
  const notTested = report.checks.filter((check) => check.status === "not-tested").length;
  text("#check-overall", `${passed}/${report.checks.length} pass${notTested ? `  /  ${notTested} not tested` : ""}`);
}

function stepOnce(): void {
  try {
    refresh(session.step());
    if (!session.snapshot().playing) syncTimer();
  } catch (error) {
    refresh();
    syncTimer();
    showToast(error instanceof Error ? error.message : "The session could not advance.");
  }
}

document.querySelectorAll<HTMLButtonElement>(".tab").forEach((button) => {
  button.addEventListener("click", () => selectView(button.dataset.view ?? "field"));
  button.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll<HTMLButtonElement>(".tab")];
    const current = tabs.indexOf(button);
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(current + direction + tabs.length) % tabs.length];
    if (!next) return;
    selectView(next.dataset.view ?? "field");
    next.focus();
  });
});

required<HTMLButtonElement>("#controls-toggle").addEventListener("click", (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  const panel = required<HTMLElement>("#control-panel");
  const expanded = !panel.classList.contains("expanded");
  panel.classList.toggle("expanded", expanded);
  button.setAttribute("aria-expanded", String(expanded));
  button.textContent = expanded ? "Hide parameters" : "Show parameters";
});

required<HTMLButtonElement>("#play-button").addEventListener("click", () => {
  session.togglePlaying();
  refresh();
  syncTimer();
});

required<HTMLButtonElement>("#step-button").addEventListener("click", stepOnce);
required<HTMLButtonElement>("#reset-button").addEventListener("click", () => resetSession(required<HTMLInputElement>("#seed-input").value));
required<HTMLButtonElement>("#new-seed-button").addEventListener("click", () => {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  const seed = `0x${random[0].toString(16).padStart(8, "0")}`;
  required<HTMLInputElement>("#seed-input").value = seed;
  resetSession(seed);
});

required<HTMLInputElement>("#seed-input").addEventListener("change", (event) => resetSession((event.currentTarget as HTMLInputElement).value));
required<HTMLInputElement>("#interval-range").addEventListener("input", (event) => {
  intervalMs = Number((event.currentTarget as HTMLInputElement).value);
  text("#interval-value", `${intervalMs} ms`);
  syncTimer();
});

document.querySelectorAll<HTMLButtonElement>(".mode-button").forEach((button) => {
  button.addEventListener("click", () => {
    session.setInputMode(button.dataset.mode as PersistentStimulus);
    refresh();
  });
});

const configRanges: Array<{ input: string; output: string; key: keyof Pick<EngineConfig, "projectionThreshold" | "updateScale" | "noiseAmplitude">; digits: number }> = [
  { input: "#projectionThreshold-range", output: "#projectionThreshold-value", key: "projectionThreshold", digits: 2 },
  { input: "#update-range", output: "#update-scale-value", key: "updateScale", digits: 2 },
  { input: "#noise-range", output: "#noise-value", key: "noiseAmplitude", digits: 3 },
];

for (const item of configRanges) {
  const input = required<HTMLInputElement>(item.input);
  input.addEventListener("input", () => text(item.output, Number(input.value).toFixed(item.digits)));
  input.addEventListener("change", () => applyConfigAndRestart({ [item.key]: Number(input.value) }));
}

document.querySelectorAll<HTMLInputElement>("[data-ablation]").forEach((input) => {
  input.addEventListener("change", () => setMechanismAndRestart(input.dataset.ablation as keyof Mechanisms, input.checked));
});

canvas.addEventListener("click", (event) => queuePulse(event.clientX, event.clientY));
canvas.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    event.stopPropagation();
    const rect = canvas.getBoundingClientRect();
    queuePulse(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }
});
required<HTMLButtonElement>("#pulse-button").addEventListener("click", () => queuePulse());

required<HTMLButtonElement>("#export-button").addEventListener("click", () => {
  const data = session.exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `state-dynamics-${String(data.seedInput).replace(/[^a-z0-9_-]+/gi, "_")}-${data.frameCount}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  showToast("Trace export created from the current deterministic session.");
});

required<HTMLButtonElement>("#run-checks-button").addEventListener("click", () => {
  const button = required<HTMLButtonElement>("#run-checks-button");
  button.disabled = true;
  button.textContent = "Checking...";
  window.setTimeout(() => {
    try {
      renderCompliance(runImplementationVerification(session.exportData()));
      selectView("verify");
    } finally {
      button.disabled = false;
      button.textContent = "Run checks";
    }
  }, 20);
});

window.addEventListener("keydown", (event) => {
  if (event.defaultPrevented) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, select, button, a[href], [role='button'], [contenteditable='true']")) return;
  if (event.code === "Space") {
    event.preventDefault();
    session.togglePlaying();
    refresh();
    syncTimer();
  } else if (event.code === "ArrowRight") {
    event.preventDefault();
    stepOnce();
  } else if (event.key.toLowerCase() === "r") {
    resetSession();
  }
});

window.addEventListener("beforeunload", () => {
  stopTimer();
  visualizer.destroy();
});

refresh();
