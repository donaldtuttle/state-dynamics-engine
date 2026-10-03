"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Engine = require("../src/engine.js");
const Projection = require("../src/projection.js");
const Field = require("../src/field.js");

const state = Engine.createState({ seed: 12062026 });
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
const projection = Projection.createProjection();
const field = Field.buildField(state, projection, { size: 45 });
const replay = Engine.serialize(state, {
  projection: {
    ...Projection.projectionRecord(projection, state.currentState.latent),
    seed: projection.seed,
    matrix3: projection.matrix3,
    anchor: projection.anchor
  },
  field: { spec: field.spec, gridSpecHash: field.gridSpecHash, dataHash: field.dataHash },
  provenance: Object.values(Projection.featureCatalog(projection, state, field.spec)),
  demo: { id: "fixed-seed-demo/v1", ticks: 96 }
});
const directory = path.resolve(__dirname, "..", "examples");
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, "fixed-seed-demo.json"), `${JSON.stringify(replay, null, 2)}\n`, "utf8");
process.stdout.write(`Wrote examples/fixed-seed-demo.json (${state.currentHash})\n`);
