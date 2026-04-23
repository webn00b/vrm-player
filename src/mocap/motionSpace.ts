import * as THREE from 'three';

export function mpDeltaToVrm(
  mirrorX: boolean,
  dx: number,
  dy: number,
  dz: number,
  out: THREE.Vector3,
  depthScale = 1,
): void {
  out.set(mirrorX ? -dx : dx, -dy, -dz * depthScale);
}

export function mpDirToVrm(
  mirrorX: boolean,
  dx: number,
  dy: number,
  dz: number,
  out: THREE.Vector3,
): void {
  out.set(mirrorX ? -dx : dx, -dy, -dz);
}

export function mpDirToVrmTorso(
  mirrorX: boolean,
  dx: number,
  dy: number,
  dz: number,
  out: THREE.Vector3,
  torsoDepthDamping = 3,
): void {
  out.set(mirrorX ? -dx : dx, -dy, -dz / torsoDepthDamping);
}
