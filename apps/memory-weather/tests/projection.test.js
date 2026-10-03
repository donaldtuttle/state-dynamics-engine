"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Projection = require("../src/projection.js");
const Engine = require("../src/engine.js");
const M = require("../src/math.js");

test("fixed projection is deterministic and orthonormal", () => {
  const a = Projection.createProjection({ seed: 777 });
  const b = Projection.createProjection({ seed: 777 });
  assert.equal(a.matrixHash, b.matrixHash);
  assert.deepEqual(a.matrix3, b.matrix3);
  for (let i = 0; i < 3; i += 1) {
    assert.ok(Math.abs(M.norm(a.matrix3[i]) - 1) < 1e-10);
    for (let j = i + 1; j < 3; j += 1) assert.ok(Math.abs(M.dot(a.matrix3[i], a.matrix3[j])) < 1e-10);
  }
  assert.notEqual(a.matrixHash, Projection.createProjection({ seed: 778 }).matrixHash);
});

test("lift/project round trip is exact on the declared projection slice", () => {
  const projection = Projection.createProjection();
  const coordinates = [0.84, -1.12];
  const latent = Projection.lift(projection, coordinates, 2);
  const projected = Projection.project(projection, latent, 2);
  assert.ok(M.distance(coordinates, projected) < 1e-10);
  const loss = Projection.residual(projection, latent, 2);
  assert.ok(loss.norm < 1e-10);
  assert.equal(loss.discardedDimensions, 10);
});

test("projection reports information loss for an arbitrary R12 state", () => {
  const projection = Projection.createProjection();
  const state = Engine.createState({ seed: 981 });
  const loss2 = Projection.residual(projection, state.currentState.latent, 2);
  const loss3 = Projection.residual(projection, state.currentState.latent, 3);
  assert.equal(loss2.discardedDimensions, 10);
  assert.equal(loss3.discardedDimensions, 9);
  assert.ok(loss3.norm <= loss2.norm + 1e-10);
});

test("provenance catalog is complete for every scientific feature", () => {
  const projection = Projection.createProjection();
  const state = Engine.createState({ seed: 48 });
  Engine.step(state);
  const catalog = Projection.featureCatalog(projection, state, { size: 45 });
  assert.ok(Object.keys(catalog).length >= 10);
  for (const record of Object.values(catalog)) {
    for (const key of ["feature_id", "label", "evidence_class", "runtime_paths", "transform_chain", "projection_hash", "discarded_information", "permitted_interpretation", "forbidden_extrapolation"]) {
      assert.ok(Object.hasOwn(record, key), `${record.feature_id} missing ${key}`);
    }
    assert.ok(record.runtime_paths.length > 0);
    assert.ok(record.transform_chain.length > 0);
  }
});

test("invalid imported projection matrices fail closed", () => {
  const projection = Projection.createProjection();
  const bad = projection.matrix3.map((row) => [...row]);
  bad[1] = [...bad[0]];
  assert.throws(() => Projection.createProjection({ matrix3: bad }), /orthogonal/);
  const wrongShape = projection.matrix3.slice(0, 2);
  assert.throws(() => Projection.createProjection({ matrix3: wrongShape }), /3 rows/);
});
