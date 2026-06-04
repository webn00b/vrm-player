import * as THREE from 'three';
import type { Landmark3D } from '../mocap/pipeline/poseDetector';

export const distLm = (a: Landmark3D | null | undefined, b: Landmark3D | null | undefined): number => {
  if (!a || !b) return Number.NaN;
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

export const distVec = (a: THREE.Vector3 | null | undefined, b: THREE.Vector3 | null | undefined): number =>
  a && b ? a.distanceTo(b) : Number.NaN;

export const avgVec = (a: THREE.Vector3 | null | undefined, b: THREE.Vector3 | null | undefined): THREE.Vector3 | null =>
  a && b ? new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5) : null;

export const vecBetween = (from: THREE.Vector3 | null | undefined, to: THREE.Vector3 | null | undefined): THREE.Vector3 | null =>
  from && to ? new THREE.Vector3().subVectors(to, from) : null;

export const angleVecDeg = (a: THREE.Vector3 | null | undefined, b: THREE.Vector3 | null | undefined): number => {
  if (!a || !b) return Number.NaN;
  const lenA = a.length();
  const lenB = b.length();
  if (lenA <= 1e-6 || lenB <= 1e-6) return Number.NaN;
  return THREE.MathUtils.radToDeg(a.angleTo(b));
};

export const deltaAxis = (
  a: THREE.Vector3 | null | undefined,
  b: THREE.Vector3 | null | undefined,
  axis: 'x' | 'y' | 'z',
): number =>
  a && b ? a[axis] - b[axis] : Number.NaN;
