"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../src/engine.js");
const Projection = require("../src/projection.js");
const Field = require("../src/field.js");

test("field construction is pure and deterministic", () => {
  const state = Engine.createState({ seed: 8765 });
  for (let i = 0; i < 24; i += 1) Engine.step(state);
  const projection = Projection.createProjection();
  const before = Engine.stateDigest(state);
  const a = Field.buildField(state, projection, { size: 33 });
  const middle = Engine.stateDigest(state);
  const b = Field.buildField(state, projection, { size: 33 });
  const after = Engine.stateDigest(state);
  assert.equal(before, middle);
  assert.equal(middle, after);
  assert.equal(a.dataHash, b.dataHash);
  assert.deepEqual(a.fields, b.fields);
});

test("all field channels are finite and match the grid size", () => {
  const state = Engine.createState({ seed: 14 });
  const field = Field.buildField(state, Projection.createProjection(), { size: 29 });
  for (const values of Object.values(field.fields)) {
    assert.equal(values.length, 29 * 29);
    assert.ok(values.every(Number.isFinite));
  }
  assert.equal(field.coordinates.length, 29 * 29);
});

test("Memory influence influence renders only from an applied packet", () => {
  const state = Engine.createState({ seed: 222, recallThreshold: -1 });
  const projection = Projection.createProjection();
  let field = Field.buildField(state, projection, { size: 25 });
  assert.ok(field.fields.memoryInfluence.every((value) => value === 0));
  Engine.inscribeMemory(state, "applied packet", 1);
  const packet = Engine.queueRecall(state, "applied packet");
  assert.ok(packet);
  Engine.step(state);
  field = Field.buildField(state, projection, { size: 25 });
  assert.ok(Math.max(...field.fields.memoryInfluence) > 0);
  assert.equal(field.live.appliedRecall.packetId, packet.packetId);
});

test("projection changes field hashes but never engine state", () => {
  const state = Engine.createState({ seed: 345 });
  for (let i = 0; i < 12; i += 1) Engine.step(state);
  const digest = Engine.stateDigest(state);
  const a = Field.buildField(state, Projection.createProjection({ seed: 1 }), { size: 25 });
  const b = Field.buildField(state, Projection.createProjection({ seed: 2 }), { size: 25 });
  assert.notEqual(a.dataHash, b.dataHash);
  assert.equal(Engine.stateDigest(state), digest);
});

test("Basin projection readiness surface uses the actual implementation threshold", () => {
  const projection = Projection.createProjection();
  const lowThreshold = Engine.createState({ seed: 12, projectionThreshold: 0.2 });
  const highThreshold = Engine.createState({ seed: 12, projectionThreshold: 0.9 });
  const low = Field.buildField(lowThreshold, projection, { size: 21 });
  const high = Field.buildField(highThreshold, projection, { size: 21 });
  for (let i = 0; i < low.fields.projectionMargin.length; i += 1) {
    assert.ok(low.fields.projectionMargin[i] > high.fields.projectionMargin[i]);
  }
});
