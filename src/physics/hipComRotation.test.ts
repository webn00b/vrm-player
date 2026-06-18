import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { computeHipComRotation } from './hipComRotation';

const v = (x: number, y: number, z: number): THREE.Vector3 =>
  new THREE.Vector3(x, y, z);

/** Apply the result rotation to the CoM and return where it lands. */
const rotatedCoMDir = (
  com: THREE.Vector3,
  rot: THREE.Quaternion,
): THREE.Vector3 => com.clone().normalize().applyQuaternion(rot);

test('CoM already straight up → identity rotation', () => {
  const r = computeHipComRotation({
    segments: [{ position: v(0, 1, 0), mass: 5 }],
    gain: 1,
  });
  assert.ok(r.angle < 1e-6, `angle=${r.angle}`);
  assert.ok(Math.abs(r.rotation.x) < 1e-9 && Math.abs(r.rotation.y) < 1e-9 &&
            Math.abs(r.rotation.z) < 1e-9, 'rotation is identity');
});

test('CoM tilted forward → rotation brings CoM dir onto +Y', () => {
  // CoM at 45° forward (y=z). After the rotation, its direction should be +Y.
  const r = computeHipComRotation({
    segments: [{ position: v(0, 1, 1), mass: 1 }],
    gain: 1,
  });
  const landed = rotatedCoMDir(r.com, r.rotation);
  assert.ok(landed.y > 0.999, `landed.y=${landed.y}`);
  assert.ok(Math.abs(landed.z) < 1e-6 && Math.abs(landed.x) < 1e-6, 'aligned to +Y');
  // 45° tilt → ~0.785 rad correction.
  assert.ok(Math.abs(r.angle - Math.PI / 4) < 1e-6, `angle=${r.angle}`);
});

test('CoM tilted sideways → rotation onto +Y', () => {
  const r = computeHipComRotation({
    segments: [{ position: v(1, 1, 0), mass: 2 }],
    gain: 1,
  });
  const landed = rotatedCoMDir(r.com, r.rotation);
  assert.ok(landed.y > 0.999, `landed.y=${landed.y}`);
});

test('weighted CoM favours heavier bone', () => {
  // mass 9 straight up at x=0, mass 1 out at x=10,y=0 → CoM x=1,y=9.
  const r = computeHipComRotation({
    segments: [
      { position: v(0, 1, 0), mass: 9 },
      { position: v(10, 0, 0), mass: 1 },
    ],
    gain: 1,
  });
  assert.ok(Math.abs(r.com.x - 1) < 1e-9 && Math.abs(r.com.y - 0.9) < 1e-9,
    `com=${r.com.toArray()}`);
});

test('gain scales the correction angle', () => {
  const full = computeHipComRotation({
    segments: [{ position: v(0, 1, 1), mass: 1 }],
    gain: 1,
  });
  const half = computeHipComRotation({
    segments: [{ position: v(0, 1, 1), mass: 1 }],
    gain: 0.5,
  });
  assert.ok(Math.abs(half.angle - full.angle / 2) < 1e-6,
    `half=${half.angle} full=${full.angle}`);
});

test('maxAngle clamps the correction', () => {
  const r = computeHipComRotation({
    segments: [{ position: v(0, 0, 1), mass: 1 }], // 90° tilt
    gain: 1,
    maxAngle: Math.PI / 6, // 30°
  });
  assert.ok(Math.abs(r.angle - Math.PI / 6) < 1e-6, `angle=${r.angle}`);
});

test('custom up axis', () => {
  const r = computeHipComRotation({
    segments: [{ position: v(0, 1, 0), mass: 1 }],
    up: v(1, 0, 0),
    gain: 1,
  });
  const landed = rotatedCoMDir(r.com, r.rotation);
  assert.ok(landed.x > 0.999, `landed.x=${landed.x}`);
});

test('no mass → identity', () => {
  const r = computeHipComRotation({ segments: [{ position: v(0, 1, 1), mass: 0 }] });
  assert.equal(r.totalMass, 0);
  assert.ok(r.angle < 1e-9);
});

test('CoM at pivot → identity (no defined direction)', () => {
  const r = computeHipComRotation({ segments: [{ position: v(0, 0, 0), mass: 5 }] });
  assert.equal(r.totalMass, 5);
  assert.ok(r.angle < 1e-9);
});
