(function () {
  "use strict";

  const Engine = window.MemoryWeatherEngine;
  const Projection = window.MemoryWeatherProjection;
  const Field = window.MemoryWeatherField;
  const Renderer = window.MemoryWeatherRenderer;
  const M = window.MWMath;

  const WEATHER_PRESENTATION = Object.freeze({
    initial: {
      label: "No measured regime",
      rationale: "No committed simulation tick is available yet."
    },
    "projection-clearing": {
      label: "Commitment event registered",
      rationale: "A basin projection was applied and recorded on this tick."
    },
    "stable-high": {
      label: "Coherent low-update regime",
      rationale: "Coherence is high while update magnitude remains low."
    },
    "shear-front": {
      label: "High-drive regime",
      rationale: "Input strength and update magnitude are elevated."
    },
    "projection-watch": {
      label: "Commitment condition active",
      rationale: "The Basin projection readiness condition is active; dwell or hold rules may still prevent commitment."
    },
    "memory-front": {
      label: "Recall-influenced regime",
      rationale: "A memory replay packet Memory influence is influencing the current update."
    },
    variable: {
      label: "Mixed dynamical regime",
      rationale: "No specialized deterministic regime rule matched the current telemetry."
    }
  });

  const FEATURE_LABELS = Object.freeze({
    "weather-composite": "Regime composite",
    "attractor-potential": "Attractor potential",
    "coherenceScore-field": "Coherence field Coherence",
    "update-vectors": "Context-conditioned update Update",
    "memory-influence": "Memory influence",
    "projection-surface": "Basin projection readiness",
    "currentState-smoothed": "State-to-smoothed distance",
    "event-markers": "Recorded events",
    "multi-observer-coupling": "Coupled simulations"
  });

  function presentWeather(weather) {
    const source = weather || {
      id: "initial",
      label: "Unformed field",
      rationale: "No committed tick yet"
    };
    const presentation = WEATHER_PRESENTATION[source.id] || {
      label: source.label || "Measured regime",
      rationale: source.rationale || "Derived from the current telemetry."
    };
    return {
      ...presentation,
      alias: source.label || source.id || "Unformed field"
    };
  }

  const byId = (id) => document.getElementById(id);
  const canvas = byId("fieldCanvas");
  const renderer = Renderer.createRenderer(canvas);
  let projection = Projection.createProjection();
  let state = Engine.createState({ seed: Number(byId("seedInput").value) });
  let peerState = null;
  let field = Field.buildField(state, projection);
  let catalog = Projection.featureCatalog(projection, state, field.spec);
  let running = false;
  let runTimer = null;
  let dirty = true;
  let selectedEvent = null;
  let currentForcing = null;
  let lastFrameAt = performance.now();
  let renderedFrames = 0;
  let measuredFps = 0;
  let toastTimer = null;
  let pointerState = null;

  function format(value, digits = 3) {
    return Number.isFinite(value) ? value.toFixed(digits) : " - ";
  }

  function shortHash(hash) {
    if (!hash) return " - ";
    return hash.replace("mw-fnv64:", "").slice(-10);
  }

  function setText(id, value) {
    byId(id).textContent = String(value);
  }

  function setMeter(valueId, barId, value, scale = 1) {
    setText(valueId, format(value));
    byId(barId).style.width = `${M.clamp(value / scale, 0, 1) * 100}%`;
  }

  function showToast(message) {
    const toast = byId("toast");
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
  }

  function announce(message) {
    byId("liveRegion").textContent = message;
  }

  function latestFrame() {
    return state.frames[state.frames.length - 1] || null;
  }

  function rebuildField() {
    const size = window.innerWidth < 560 ? 35 : window.innerWidth > 1800 ? 57 : 45;
    field = Field.buildField(state, projection, { size });
    catalog = Projection.featureCatalog(projection, state, field.spec);
    syncFeatureOptions();
    dirty = true;
  }

  function observationFromControls() {
    return {
      stimulusMode: byId("stimulusSelect").value,
      stimulusAmplitude: Number(byId("amplitudeRange").value),
      selectedBasin: Number(byId("basinSelect").value),
      forcingVector: currentForcing ? currentForcing.latent : null,
      forcingLabel: currentForcing ? currentForcing.label : null
    };
  }

  function executeStep() {
    const observation = observationFromControls();
    const result = peerState
      ? Engine.stepCoupledPair(state, peerState, observation, observation, {
        strength: Number(byId("couplingRange").value),
        enabled: true
      }).results[0]
      : Engine.step(state, observation);
    rebuildField();
    updateUi();
    if (result.frame.projection_triggered) {
      const event = result.events.find((item) => item.kind === "projection");
      const message = `Basin projection registered at tick ${result.frame.step}, attractor region ${event ? event.basinLabel : "unknown"}.`;
      announce(message);
      showToast(message);
    }
    return result;
  }

  function scheduleRun() {
    clearTimeout(runTimer);
    if (!running) return;
    const delay = Number(byId("speedSelect").value);
    runTimer = setTimeout(() => {
      executeStep();
      scheduleRun();
    }, delay);
  }

  function setRunning(value) {
    running = Boolean(value);
    const button = byId("runBtn");
    button.setAttribute("aria-pressed", String(running));
    button.innerHTML = running ? '<span aria-hidden="true">Pause</span> Pause' : '<span aria-hidden="true">&gt;</span> Run';
    const status = byId("runStatus");
    status.textContent = running ? "running" : "paused";
    status.classList.toggle("running", running);
    scheduleRun();
  }

  function configFromControls(seed) {
    const mechanisms = {};
    document.querySelectorAll("[data-ablation]").forEach((input) => {
      mechanisms[input.dataset.ablation] = input.checked;
    });
    return {
      seed,
      stimulusMode: byId("stimulusSelect").value,
      stimulusAmplitude: Number(byId("amplitudeRange").value),
      selectedBasin: Number(byId("basinSelect").value),
      mechanisms,
      couplingStrength: Number(byId("couplingRange").value)
    };
  }

  function resetEngine() {
    setRunning(false);
    const seed = Number(byId("seedInput").value);
    try {
      state = Engine.createState(configFromControls(seed));
      peerState = byId("peerToggle").checked
        ? Engine.createState({ config: configFromControls((seed + 1) >>> 0), observerId: "observer-b" })
        : null;
      currentForcing = null;
      renderer.selected = null;
      selectedEvent = null;
      rebuildField();
      updateUi();
      showToast(`Reset with seed ${seed}.`);
    } catch (error) {
      showToast(error.message);
    }
  }

  function loadDemo() {
    setRunning(false);
    const demoSeed = 12062026;
    byId("seedInput").value = String(demoSeed);
    state = Engine.createState(configFromControls(demoSeed));
    peerState = null;
    byId("peerToggle").checked = false;
    currentForcing = null;
    renderer.selected = null;
    selectedEvent = null;
    Engine.inscribeMemory(state, "observer field", 1.15);
    Engine.inscribeMemory(state, "projection provenance", 0.95);
    Engine.inscribeMemory(state, "memory front", 0.78);
    for (let tick = 0; tick < 96; tick += 1) {
      if (tick === 22) Engine.queueRecall(state, "projection provenance");
      if (tick === 51) Engine.requestProjection(state);
      Engine.step(state, {
        stimulusMode: tick < 36 ? "periodic" : tick < 70 ? "pulse" : "basin",
        stimulusAmplitude: 0.82,
        selectedBasin: 4
      });
    }
    syncControlsFromState();
    rebuildField();
    updateUi();
    showToast("Loaded the deterministic 96-tick demonstration run.");
  }

  function updateTelemetry() {
    const frame = latestFrame();
    setMeter("coherenceValue", "coherenceBar", frame ? frame.coherenceScore : state.currentState.coherence, 1);
    setMeter("inputValue", "inputBar", frame ? frame.input_strength : 0, 2);
    setMeter("updateValue", "updateBar", frame ? frame.update_magnitude : 0, state.config.updateLimit);
    setMeter("smoothingValue", "smoothingBar", frame ? frame.smoothing_confidence : 1, 1);
    const sourceWeather = frame ? frame.weather : { id: "initial", label: "Unformed field", rationale: "No committed tick yet" };
    const weather = presentWeather(sourceWeather);
    setText("weatherLabel", weather.label);
    setText("weatherRationale", weather.rationale);
    setText("weatherAlias", `Weather alias: ${weather.alias}`);
    setText("tickValue", state.context.step);
    setText("phaseValue", state.context.phase);
    setText("stateHash", shortHash(state.currentHash));
    setText("projectionHash", shortHash(projection.matrixHash));
    setText("fieldHash", shortHash(field.dataHash));
    setText("projectionCount", `${state.counters.projection} basin projections`);
    setText("memoryCount", `${state.counters.memoryWrites} memory records`);
    setText("summaryCount", `${state.counters.summaries} history summaries`);
    canvas.setAttribute("aria-label", `${weather.label}, weather alias ${weather.alias}. Tick ${state.context.step}. Coherence ${format(state.currentState.coherence, 2)}. ${state.events.length} recorded events. ${state.memories.length} memory records.${peerState ? ` Observer B coherence ${format(peerState.currentState.coherence, 2)}.` : ""}`);
  }

  function syncFeatureOptions() {
    const select = byId("featureSelect");
    const previous = select.value;
    const ordered = Object.values(catalog);
    if (select.options.length !== ordered.length) {
      select.replaceChildren();
      for (const record of ordered) {
        const option = document.createElement("option");
        option.value = record.feature_id;
        option.textContent = FEATURE_LABELS[record.feature_id] || record.label;
        select.append(option);
      }
    }
    if (catalog[previous]) select.value = previous;
    else select.value = renderer.scalarMode === "weather" ? "weather-composite" : scalarFeatureId(renderer.scalarMode);
    renderProvenance();
  }

  function scalarFeatureId(mode) {
    return mode === "potential" ? "attractor-potential"
      : mode === "coherenceScore" ? "coherenceScore-field"
        : mode === "memoryInfluence" ? "memory-influence"
          : mode === "projectionReadiness" ? "projection-surface"
            : mode === "separation" ? "currentState-smoothed"
              : mode === "fronts" ? "update-vectors"
                : "weather-composite";
  }

  function appendProvenanceRow(list, term, detail) {
    const wrapper = document.createElement("div");
    wrapper.className = "prov-row";
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = Array.isArray(detail) ? detail.join(" to ") : String(detail == null ? " - " : detail);
    wrapper.append(dt, dd);
    list.append(wrapper);
  }

  function renderProvenance() {
    const card = byId("provenanceCard");
    const record = catalog[byId("featureSelect").value] || Object.values(catalog)[0];
    card.replaceChildren();
    const list = document.createElement("dl");
    list.style.margin = "0";
    appendProvenanceRow(list, "Evidence", record.evidence_class);
    appendProvenanceRow(list, "Implementation component", record.implementation_refs.length ? record.implementation_refs : "None  -  implementation-local");
    appendProvenanceRow(list, "Runtime source", record.runtime_paths);
    appendProvenanceRow(list, "Transform", record.transform_chain);
    appendProvenanceRow(list, "Projection", shortHash(record.projection_hash));
    appendProvenanceRow(list, "Discarded", record.discarded_information);
    appendProvenanceRow(list, "Permitted", record.permitted_interpretation);
    appendProvenanceRow(list, "Forbidden", record.forbidden_extrapolation);
    if (selectedEvent) appendProvenanceRow(list, "Selected event", M.stableStringify(selectedEvent, 5));
    card.append(list);
  }

  function updateMemoryList() {
    const list = byId("memoryList");
    list.replaceChildren();
    if (!state.memories.length) {
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = "No memory records yet. Trace history summaries remain a separate mechanism.";
      list.append(empty);
      return;
    }
    for (const memory of state.memories.slice().reverse()) {
      const item = document.createElement("li");
      const title = document.createElement("strong");
      const weight = document.createElement("b");
      const meta = document.createElement("small");
      title.textContent = memory.label;
      weight.textContent = `w ${memory.weight.toFixed(2)}`;
      meta.textContent = `t${memory.createdStep}  /  ${memory.memoryId.split(":").pop()}  /  ${shortHash(memory.sourceStateHash)}`;
      item.append(title, weight, meta);
      list.append(item);
    }
  }

  function eventTitle(event) {
    if (event.kind === "projection") return `Basin projection  /  ${event.basinLabel}`;
    if (event.kind === "memory-write") return `Memory record  /  ${event.label}`;
    if (event.kind === "summary") return "History summary";
    if (event.kind === "basin-transition") return `Attractor region  /  ${event.toBasinLabel}`;
    return event.kind;
  }

  function eventMeta(event) {
    if (event.kind === "projection") return `t${event.step}  /  Coherence ${format(event.coherenceScore, 2)}  /  ${shortHash(event.postHash)}`;
    if (event.kind === "memory-write") return `t${event.step}  /  ${shortHash(event.sourceStateHash)}`;
    if (event.kind === "summary") return `t${event.step}  /  ${shortHash(event.sourceHash)}`;
    return `t${event.step}  /  direct event`;
  }

  function updateTimeline() {
    const timeline = byId("timeline");
    timeline.replaceChildren();
    if (!state.events.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Run the engine or inscribe a memory to create auditable events.";
      timeline.append(empty);
      return;
    }
    for (const event of state.events.slice(-48)) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `event-card ${event.kind}`;
      const title = document.createElement("strong");
      const meta = document.createElement("small");
      title.textContent = eventTitle(event);
      meta.textContent = eventMeta(event);
      card.append(title, meta);
      card.addEventListener("click", () => {
        selectedEvent = event;
        byId("featureSelect").value = "event-markers";
        renderProvenance();
      });
      timeline.append(card);
    }
    timeline.scrollLeft = timeline.scrollWidth;
  }

  function updateUi() {
    updateTelemetry();
    updateMemoryList();
    updateTimeline();
    renderProvenance();
  }

  function updateSelection(point) {
    renderer.selected = point;
    const sample = Field.sampleAt(field, point.x, point.y);
    const latent = Projection.viewportToLatent(projection, point.x, point.y, state.config.radialLimit);
    currentForcing = { latent, label: `viewport(${point.x.toFixed(2)},${point.y.toFixed(2)})` };
    const readout = byId("selectionReadout");
    readout.hidden = false;
    readout.textContent = `forcing target (${point.x.toFixed(2)}, ${point.y.toFixed(2)})  /  coherence ${sample.coherence.toFixed(3)}  /  projection margin ${sample.projectionMargin.toFixed(3)}  /  next tick`;
    dirty = true;
  }

  function projectionPayload() {
    return {
      ...Projection.projectionRecord(projection, state.currentState.latent),
      seed: projection.seed,
      matrix3: projection.matrix3,
      anchor: projection.anchor
    };
  }

  function downloadFile(name, mime, content) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportReplay() {
    const replay = Engine.serialize(state, {
      projection: projectionPayload(),
      field: { spec: field.spec, gridSpecHash: field.gridSpecHash, dataHash: field.dataHash },
      provenance: Object.values(catalog),
      viewport: { view: renderer.view, scalarMode: renderer.scalarMode, layers: renderer.layers },
      ensemble: peerState ? {
        peerState: Engine.serialize(peerState).state,
        couplingStrength: Number(byId("couplingRange").value),
        policy: "frozen snapshot; symmetric double-buffered input"
      } : null
    });
    downloadFile(`memory-weather-${state.runId}-t${state.context.step}.json`, "application/json", `${JSON.stringify(replay, null, 2)}\n`);
    showToast("Replay JSON exported.");
  }

  function csvEscape(value) {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function exportCsv() {
    const columns = ["run_id", "observer_id", "step", "phase", "coherenceScore", "input_strength", "update_magnitude", "smoothing_confidence", "entropy", "drift", "stable", "projection_triggered", "state_hash", "tags"];
    const lines = [columns.join(",")];
    for (const frame of state.frames) {
      lines.push(columns.map((column) => csvEscape(column === "tags" ? frame.tags.join("|") : frame[column])).join(","));
    }
    downloadFile(`memory-weather-${state.runId}-telemetry.csv`, "text/csv", `${lines.join("\n")}\n`);
    showToast("Telemetry CSV exported.");
  }

  async function importReplay(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) throw new RangeError("Replay exceeds the 10 MiB local import limit.");
    const text = await file.text();
    const replay = JSON.parse(text);
    const nextState = Engine.hydrate(replay);
    let nextProjection = Projection.createProjection();
    if (replay.projection) {
      nextProjection = Projection.createProjection({
        seed: replay.projection.seed,
        matrix3: replay.projection.matrix3,
        anchor: replay.projection.anchor
      });
      if (replay.projection.matrix_hash && replay.projection.matrix_hash !== nextProjection.matrixHash) {
        throw new Error("projection hash mismatch");
      }
    }
    setRunning(false);
    state = nextState;
    peerState = replay.ensemble && replay.ensemble.peerState
      ? Engine.hydrate({ schemaVersion: Engine.SCHEMA_VERSION, state: replay.ensemble.peerState })
      : null;
    projection = nextProjection;
    byId("seedInput").value = String(state.config.seed);
    syncControlsFromState();
    currentForcing = state.context.forcingVector ? { latent: [...state.context.forcingVector], label: state.context.forcingLabel || "imported" } : null;
    byId("peerToggle").checked = Boolean(peerState);
    if (replay.ensemble && Number.isFinite(replay.ensemble.couplingStrength)) {
      byId("couplingRange").value = String(replay.ensemble.couplingStrength);
      setText("couplingOutput", Number(replay.ensemble.couplingStrength).toFixed(2));
    }
    rebuildField();
    updateUi();
    showToast(`Imported ${state.runId} at tick ${state.context.step}.`);
  }

  function syncControlsFromState() {
    byId("stimulusSelect").value = state.context.stimulusMode;
    byId("amplitudeRange").value = String(state.context.stimulusAmplitude);
    setText("amplitudeOutput", Number(state.context.stimulusAmplitude).toFixed(2));
    byId("basinSelect").value = String(state.context.selectedBasin);
    document.querySelectorAll("[data-ablation]").forEach((input) => {
      input.checked = state.config.mechanisms[input.dataset.ablation];
    });
  }

  function bindControls() {
    byId("runBtn").addEventListener("click", () => setRunning(!running));
    byId("stepBtn").addEventListener("click", executeStep);
    byId("resetBtn").addEventListener("click", resetEngine);
    byId("speedSelect").addEventListener("change", scheduleRun);
    byId("scalarSelect").addEventListener("change", (event) => {
      Renderer.setScalarMode(renderer, event.target.value);
      byId("featureSelect").value = scalarFeatureId(event.target.value);
      renderProvenance();
      dirty = true;
    });
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-view]").forEach((item) => {
          const active = item === button;
          item.classList.toggle("active", active);
          item.setAttribute("aria-pressed", String(active));
        });
        Renderer.setView(renderer, button.dataset.view);
        setText("projectionMode", button.dataset.view === "terrain" ? "fixed 3x12 projection" : "fixed 2x12 projection");
        dirty = true;
      });
    });
    byId("layerControls").addEventListener("change", (event) => {
      if (event.target.matches("[data-layer]")) {
        Renderer.setLayer(renderer, event.target.dataset.layer, event.target.checked);
        dirty = true;
      }
    });
    byId("ablationControls").addEventListener("change", (event) => {
      if (event.target.matches("[data-ablation]")) {
        Engine.setMechanism(state, event.target.dataset.ablation, event.target.checked);
        rebuildField();
        updateUi();
      }
    });
    byId("amplitudeRange").addEventListener("input", (event) => {
      setText("amplitudeOutput", Number(event.target.value).toFixed(2));
    });
    byId("stimulusSelect").addEventListener("change", () => {
      currentForcing = null;
      renderer.selected = null;
      byId("selectionReadout").hidden = true;
      showToast("Preset selected; explicit viewport forcing cleared.");
    });
    byId("weightRange").addEventListener("input", (event) => {
      setText("weightOutput", Number(event.target.value).toFixed(2));
    });
    byId("couplingRange").addEventListener("input", (event) => {
      setText("couplingOutput", Number(event.target.value).toFixed(2));
    });
    byId("peerToggle").addEventListener("change", (event) => {
      if (event.target.checked) {
        const peerSeed = (state.config.seed + 1) >>> 0;
        peerState = Engine.createState({ config: configFromControls(peerSeed), observerId: "observer-b" });
        for (let i = 0; i < state.context.step; i += 1) Engine.step(peerState, observationFromControls());
        byId("featureSelect").value = "multi-observer-coupling";
        showToast("Observer B enabled with an independent seed and frozen-snapshot coupling.");
      } else {
        peerState = null;
        showToast("Instance B disabled; instance A state is unchanged.");
      }
      rebuildField();
      updateUi();
    });
    byId("inscribeBtn").addEventListener("click", () => {
      try {
        const result = Engine.inscribeMemory(state, byId("memoryInput").value, Number(byId("weightRange").value));
        if (!result.memory) return showToast("Memory writing is currently ablated.");
        rebuildField();
        updateUi();
        showToast(`Recorded "${result.memory.label}" as a local memory artifact.`);
      } catch (error) {
        showToast(error.message);
      }
    });
    byId("recallBtn").addEventListener("click", () => {
      const packet = Engine.queueRecall(state, byId("memoryInput").value);
      rebuildField();
      updateUi();
      showToast(packet ? `Memory replay queued "${packet.label}" at similarity ${packet.similarity.toFixed(3)}.` : "No eligible memory replay Memory influence packet.");
    });
    byId("projectionBtn").addEventListener("click", () => {
      Engine.requestProjection(state);
      showToast("Basin projection requested. The next state-transition tick Step will assess and, if eligible, register it.");
    });
    byId("featureSelect").addEventListener("change", () => {
      selectedEvent = null;
      renderProvenance();
    });
    byId("exportBtn").addEventListener("click", exportReplay);
    byId("csvBtn").addEventListener("click", exportCsv);
    byId("demoBtn").addEventListener("click", loadDemo);
    byId("importBtn").addEventListener("click", () => byId("importFile").click());
    byId("importFile").addEventListener("change", async (event) => {
      try {
        await importReplay(event.target.files[0]);
      } catch (error) {
        showToast(`Import rejected: ${error.message}`);
      } finally {
        event.target.value = "";
      }
    });

    canvas.addEventListener("pointerdown", (event) => {
      pointerState = { x: event.clientX, y: event.clientY, yaw: renderer.yaw, pitch: renderer.pitch, moved: false };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!pointerState || renderer.view !== "terrain") return;
      const dx = event.clientX - pointerState.x;
      const dy = event.clientY - pointerState.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) pointerState.moved = true;
      renderer.yaw = pointerState.yaw + dx * 0.009;
      renderer.pitch = M.clamp(pointerState.pitch + dy * 0.006, 0.35, 1.28);
      dirty = true;
    });
    canvas.addEventListener("pointerup", (event) => {
      if (pointerState && !pointerState.moved && renderer.view !== "terrain") {
        updateSelection(Renderer.screenToField(renderer, field, event.clientX, event.clientY));
      }
      pointerState = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointercancel", () => { pointerState = null; });
    canvas.addEventListener("wheel", (event) => {
      if (renderer.view !== "terrain") return;
      event.preventDefault();
      renderer.pitch = M.clamp(renderer.pitch + Math.sign(event.deltaY) * 0.05, 0.35, 1.28);
      dirty = true;
    }, { passive: false });

    window.addEventListener("keydown", (event) => {
      const tag = document.activeElement && document.activeElement.tagName;
      if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(tag)) return;
      if (event.code === "Space") { event.preventDefault(); setRunning(!running); }
      else if (event.key === ".") executeStep();
      else if (event.key.toLowerCase() === "r") resetEngine();
      else if (["1", "2", "3"].includes(event.key)) document.querySelector(`[data-view="${event.key === "1" ? "weather" : event.key === "2" ? "field" : "terrain"}"]`).click();
    });

    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => { rebuildField(); }).observe(byId("viewport"));
    } else window.addEventListener("resize", rebuildField);
  }

  function animationLoop(now) {
    if (dirty) {
      Renderer.render(renderer, field, state, projection, peerState);
      dirty = false;
      renderedFrames += 1;
    }
    if (now - lastFrameAt >= 1000) {
      measuredFps = Math.round((renderedFrames * 1000) / (now - lastFrameAt));
      setText("frameRate", `${measuredFps} fps`);
      renderedFrames = 0;
      lastFrameAt = now;
    }
    requestAnimationFrame(animationLoop);
  }

  bindControls();
  syncFeatureOptions();
  updateUi();
  requestAnimationFrame(animationLoop);
})();
