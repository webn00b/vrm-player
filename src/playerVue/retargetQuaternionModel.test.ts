import assert from 'node:assert/strict';
import * as THREE from 'three';
import { test } from 'vitest';
import {
  buildQuaternionEditorState,
  quaternionFromEditorState,
  quaternionTuple,
} from './retargetLab/retargetQuaternionModel';

test('buildQuaternionEditorState exposes normalized quaternion fields', () => {
  const q = new THREE.Quaternion(0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4));
  const state = buildQuaternionEditorState(q);

  assert.equal(Number(state.axisAngle.z.toFixed(6)), 1);
  assert.equal(Number(state.axisAngle.angle.toFixed(6)), 90);
  assert.deepEqual(quaternionTuple(quaternionFromEditorState('quat', state)).map((n) => Number(n.toFixed(6))), [
    0,
    0,
    0.707107,
    0.707107,
  ]);
});

test('quaternionFromEditorState uses a default axis for zero axis-angle vectors', () => {
  const q = quaternionFromEditorState('axis', {
    quat: { x: 0, y: 0, z: 0, w: 1 },
    eulerDeg: { x: 0, y: 0, z: 0 },
    axisAngle: { x: 0, y: 0, z: 0, angle: 180 },
  });

  assert.deepEqual(quaternionTuple(q).map((n) => Number(n.toFixed(6))), [1, 0, 0, 0]);
});
