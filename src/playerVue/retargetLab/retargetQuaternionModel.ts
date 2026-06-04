import * as THREE from 'three';
import type { QuaternionEditorMode, QuaternionEditorState } from './retargetQuaternionTypes';

export function buildQuaternionEditorState(q: THREE.Quaternion): QuaternionEditorState {
  const normalized = q.clone().normalize();
  const e = new THREE.Euler().setFromQuaternion(normalized, 'YXZ');
  const clampedW = THREE.MathUtils.clamp(normalized.w, -1, 1);
  const angle = 2 * Math.acos(clampedW);
  const s = Math.sqrt(Math.max(0, 1 - clampedW * clampedW));
  const axis = s < 0.0001
    ? { x: 1, y: 0, z: 0 }
    : { x: normalized.x / s, y: normalized.y / s, z: normalized.z / s };

  return {
    quat: {
      x: normalized.x,
      y: normalized.y,
      z: normalized.z,
      w: normalized.w,
    },
    eulerDeg: {
      x: THREE.MathUtils.radToDeg(e.x),
      y: THREE.MathUtils.radToDeg(e.y),
      z: THREE.MathUtils.radToDeg(e.z),
    },
    axisAngle: {
      ...axis,
      angle: THREE.MathUtils.radToDeg(angle),
    },
  };
}

export function quaternionFromEditorState(
  mode: QuaternionEditorMode,
  state: QuaternionEditorState,
): THREE.Quaternion {
  if (mode === 'euler') {
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(state.eulerDeg.x),
      THREE.MathUtils.degToRad(state.eulerDeg.y),
      THREE.MathUtils.degToRad(state.eulerDeg.z),
      'YXZ',
    )).normalize();
  }

  if (mode === 'axis') {
    const axis = new THREE.Vector3(state.axisAngle.x, state.axisAngle.y, state.axisAngle.z);
    if (axis.lengthSq() < 0.000001) axis.set(1, 0, 0);
    axis.normalize();
    return new THREE.Quaternion()
      .setFromAxisAngle(axis, THREE.MathUtils.degToRad(state.axisAngle.angle))
      .normalize();
  }

  return new THREE.Quaternion(state.quat.x, state.quat.y, state.quat.z, state.quat.w).normalize();
}

export function quaternionTuple(q: THREE.Quaternion): [number, number, number, number] {
  return [q.x, q.y, q.z, q.w];
}
