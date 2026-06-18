import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { computeHipCompensationOffset } from './hipCompensation';

const v = (x: number, y: number, z: number): THREE.Vector3 =>
  new THREE.Vector3(x, y, z);

test('zero offset when CoM already over the support centre', () => {
  const r = computeHipCompensationOffset({
    segments: [{ position: v(0, 1, 0), mass: 10 }],
    support: [v(-0.1, 0, 0), v(0.1, 0, 0)], // centroid at origin
    gain: 1,
  });
  assert.ok(r.offset.length() < 1e-9, `offset=${r.offset.toArray()}`);
  assert.ok(Math.abs(r.com.x) < 1e-9 && Math.abs(r.com.z) < 1e-9);
});

test('CoM forward of feet → hips pushed back by the full error at gain 1', () => {
  // CoM at z=+0.2, feet centred at z=0. Offset should be (0,0,-0.2).
  const r = computeHipCompensationOffset({
    segments: [{ position: v(0, 1, 0.2), mass: 5 }],
    support: [v(0, 0, 0), v(0, 0, 0)],
    gain: 1,
  });
  assert.ok(Math.abs(r.offset.z + 0.2) < 1e-9, `offset.z=${r.offset.z}`);
  assert.ok(Math.abs(r.offset.x) < 1e-9 && Math.abs(r.offset.y) < 1e-9);
});

test('gain scales the correction linearly', () => {
  const r = computeHipCompensationOffset({
    segments: [{ position: v(0.4, 1, 0), mass: 1 }],
    support: [v(0, 0, 0)],
    gain: 0.5,
  });
  assert.ok(Math.abs(r.offset.x + 0.2) < 1e-9, `offset.x=${r.offset.x}`);
});

test('weighted CoM favours the heavier segment', () => {
  // mass 9 at x=0, mass 1 at x=1 → CoM.x = 0.1.
  const r = computeHipCompensationOffset({
    segments: [
      { position: v(0, 1, 0), mass: 9 },
      { position: v(1, 1, 0), mass: 1 },
    ],
    support: [v(0, 0, 0)],
    gain: 1,
  });
  assert.ok(Math.abs(r.com.x - 0.1) < 1e-9, `com.x=${r.com.x}`);
  assert.ok(Math.abs(r.offset.x + 0.1) < 1e-9, `offset.x=${r.offset.x}`);
});

test('horizontalOnly leaves Y untouched; disabling it corrects height too', () => {
  const horiz = computeHipCompensationOffset({
    segments: [{ position: v(0, 2, 0), mass: 1 }],
    support: [v(0, 0, 0)],
    gain: 1,
  });
  assert.ok(Math.abs(horiz.offset.y) < 1e-9, 'horizontalOnly default keeps Y=0');

  const full = computeHipCompensationOffset({
    segments: [{ position: v(0, 2, 0), mass: 1 }],
    support: [v(0, 0, 0)],
    gain: 1,
    horizontalOnly: false,
  });
  assert.ok(Math.abs(full.offset.y + 2) < 1e-9, `offset.y=${full.offset.y}`);
});

test('maxOffset caps the magnitude but keeps direction', () => {
  const r = computeHipCompensationOffset({
    segments: [{ position: v(3, 1, 4), mass: 1 }], // error length 5 in XZ
    support: [v(0, 0, 0)],
    gain: 1,
    maxOffset: 1,
  });
  assert.ok(Math.abs(r.offset.length() - 1) < 1e-9, `len=${r.offset.length()}`);
  // direction = -(3,0,4)/5 = (-0.6,0,-0.8)
  assert.ok(Math.abs(r.offset.x + 0.6) < 1e-9 && Math.abs(r.offset.z + 0.8) < 1e-9);
});

test('no support or no mass → no-op', () => {
  const noSupport = computeHipCompensationOffset({
    segments: [{ position: v(1, 1, 1), mass: 1 }],
    support: [],
  });
  assert.equal(noSupport.totalMass, 0);
  assert.ok(noSupport.offset.length() < 1e-9);

  const noMass = computeHipCompensationOffset({
    segments: [{ position: v(1, 1, 1), mass: 0 }],
    support: [v(0, 0, 0)],
  });
  assert.equal(noMass.totalMass, 0);
  assert.ok(noMass.offset.length() < 1e-9);
});
