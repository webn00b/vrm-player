import * as THREE from 'three';
import { solveTwoBoneIK, type TwoBoneIKResult } from './twoBoneIK';

export interface TwoBoneChainApplicationInput {
  rootWorld: THREE.Vector3;
  targetWorld: THREE.Vector3;
  poleDirection: THREE.Vector3;
  upperLength: number;
  lowerLength: number;
  upperNode: THREE.Object3D;
  lowerNode: THREE.Object3D;
  upperRestAxis: THREE.Vector3;
  lowerRestAxis: THREE.Vector3;
  lerp: number;
}

const _v1 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _clampedTarget = new THREE.Vector3();
const _ikResult: TwoBoneIKResult = {
  upperDir: new THREE.Vector3(),
  elbowPos: new THREE.Vector3(),
  lowerDir: new THREE.Vector3(),
  reachable: true,
};

/** Safety margin for IK target pullback. 0.98 keeps the chain slightly bent
 *  even at max reach so the solver doesn't degenerate to a straight line
 *  (which produces a flat, "noodle-stretched" pose visually). */
const IK_MAX_REACH_FRACTION = 0.98;

export function applyTwoBoneChain(input: TwoBoneChainApplicationInput): void {
  const {
    rootWorld,
    targetWorld,
    poleDirection,
    upperLength,
    lowerLength,
    upperNode,
    lowerNode,
    upperRestAxis,
    lowerRestAxis,
    lerp,
  } = input;

  if (!upperNode.parent) return;

  // C2: pull the target back toward root if it sits beyond anatomical reach.
  // Without this, the solver fully extends the arm whenever the performer's
  // wrist target exceeds avatar arm length (calibration-induced overshoot,
  // mocap noise on Z, foreshortening misread) — producing a stiff "stretched
  // out" pose. Clamping to 98% of max reach lets the chain stay slightly
  // bent and follow the target's direction without the noodle effect.
  _clampedTarget.copy(targetWorld);
  const maxReach = (upperLength + lowerLength) * IK_MAX_REACH_FRACTION;
  const distToTarget = _clampedTarget.distanceTo(rootWorld);
  if (distToTarget > maxReach) {
    _clampedTarget.sub(rootWorld)
                  .multiplyScalar(maxReach / distToTarget)
                  .add(rootWorld);
  }

  const ik = solveTwoBoneIK(
    rootWorld,
    _clampedTarget,
    poleDirection,
    upperLength,
    lowerLength,
    _ikResult,
  );

  upperNode.parent.getWorldQuaternion(_q1).invert();
  _v1.copy(ik.upperDir).applyQuaternion(_q1);
  _q2.setFromUnitVectors(upperRestAxis, _v1);
  if (lerp >= 1) upperNode.quaternion.copy(_q2);
  else           upperNode.quaternion.slerp(_q2, lerp);
  upperNode.updateWorldMatrix(false, true);

  upperNode.getWorldQuaternion(_q1).invert();
  _v1.copy(ik.lowerDir).applyQuaternion(_q1);
  _q2.setFromUnitVectors(lowerRestAxis, _v1);
  if (lerp >= 1) lowerNode.quaternion.copy(_q2);
  else           lowerNode.quaternion.slerp(_q2, lerp);
  lowerNode.updateWorldMatrix(false, true);
}
