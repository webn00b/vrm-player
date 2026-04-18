/**
 * Two-bone IK for a shoulder → elbow → hand (or hip → knee → ankle) chain.
 *
 * Closed-form law-of-cosines solver. Given a fixed shoulder position A,
 * target hand position D, bone lengths L1 and L2, and a pole vector that
 * hints where the elbow should point, it returns the world-space direction
 * of the upper bone and the elbow position — which is all we need to then
 * compose bone-local quaternions.
 *
 * Unreachable targets (|D - A| > L1 + L2) fully extend toward D. Degenerate
 * targets (too close to A) fall back to the pole direction for elbow
 * orientation.
 */

import * as THREE from 'three';

const _ab    = new THREE.Vector3();
const _abDir = new THREE.Vector3();
const _pole  = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up    = new THREE.Vector3();
const _upper = new THREE.Vector3();

export interface TwoBoneIKResult {
  /** World-space unit direction the upper bone points (shoulder → elbow). */
  upperDir: THREE.Vector3;
  /** World-space elbow position (= root + upperDir * upperLen). */
  elbowPos: THREE.Vector3;
  /** World-space unit direction the lower bone points (elbow → target). */
  lowerDir: THREE.Vector3;
  /** True if target was within reach; false means chain is fully extended. */
  reachable: boolean;
}

/**
 * @param root       Shoulder (or hip) world position. Fixed pivot.
 * @param target     Desired hand (or ankle) world position.
 * @param pole       Direction in which the elbow should bulge, relative to root.
 *                   Doesn't need to be normalized; any non-zero vector that
 *                   picks the right side of the arm plane works.
 * @param upperLen   Upper-bone rest length (metres).
 * @param lowerLen   Lower-bone rest length (metres).
 * @param out        Optional caller-owned result object to avoid allocation.
 */
export function solveTwoBoneIK(
  root:     THREE.Vector3,
  target:   THREE.Vector3,
  pole:     THREE.Vector3,
  upperLen: number,
  lowerLen: number,
  out?:     TwoBoneIKResult,
): TwoBoneIKResult {
  const result = out ?? {
    upperDir: new THREE.Vector3(),
    elbowPos: new THREE.Vector3(),
    lowerDir: new THREE.Vector3(),
    reachable: true,
  };

  _ab.subVectors(target, root);
  const abLen = _ab.length();

  // Unreachable → straight line from root to target.
  const maxReach = upperLen + lowerLen;
  if (abLen >= maxReach - 1e-6) {
    _abDir.copy(_ab).multiplyScalar(1 / Math.max(abLen, 1e-6));
    result.upperDir.copy(_abDir);
    result.lowerDir.copy(_abDir);
    result.elbowPos.copy(root).addScaledVector(_abDir, upperLen);
    result.reachable = abLen < maxReach;
    return result;
  }
  // Target too close → fall back to pole direction for upper bone orientation.
  if (abLen < 1e-4) {
    _pole.copy(pole);
    if (_pole.lengthSq() < 1e-6) _pole.set(0, -1, 0);
    _pole.normalize();
    result.upperDir.copy(_pole);
    result.elbowPos.copy(root).addScaledVector(_pole, upperLen);
    result.lowerDir.copy(root).sub(result.elbowPos).normalize();
    result.reachable = true;
    return result;
  }

  _abDir.copy(_ab).multiplyScalar(1 / abLen);

  // Angle at root between upper bone and root→target line, by law of cosines.
  const cosAlpha = (upperLen * upperLen + abLen * abLen - lowerLen * lowerLen)
                 / (2 * upperLen * abLen);
  const alpha = Math.acos(Math.max(-1, Math.min(1, cosAlpha)));

  // Build an orthonormal frame {_abDir, _up} on the plane containing the pole
  // and _abDir. _up is the component of pole perpendicular to _abDir.
  _pole.copy(pole);
  if (_pole.lengthSq() < 1e-6) _pole.set(0, -1, 0);
  // Remove projection onto _abDir so _up is orthogonal to the chain's axis.
  const dot = _pole.dot(_abDir);
  _up.copy(_pole).addScaledVector(_abDir, -dot);
  if (_up.lengthSq() < 1e-6) {
    // Pole aligned with chain — pick any perpendicular.
    _up.set(1, 0, 0).addScaledVector(_abDir, -_abDir.x);
    if (_up.lengthSq() < 1e-6) _up.set(0, 1, 0).addScaledVector(_abDir, -_abDir.y);
  }
  _up.normalize();

  // Upper bone direction = rotate _abDir by α around the axis perpendicular to
  // both _abDir and _up. Equivalent to: cos(α)*_abDir + sin(α)*_up, since _up
  // is the direction the elbow bulges.
  _upper.copy(_abDir).multiplyScalar(Math.cos(alpha))
        .addScaledVector(_up, Math.sin(alpha));

  result.upperDir.copy(_upper);
  result.elbowPos.copy(root).addScaledVector(_upper, upperLen);
  result.lowerDir.subVectors(target, result.elbowPos).normalize();
  result.reachable = true;

  return result;
}
