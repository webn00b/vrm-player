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
const _ikResult: TwoBoneIKResult = {
  upperDir: new THREE.Vector3(),
  elbowPos: new THREE.Vector3(),
  lowerDir: new THREE.Vector3(),
  reachable: true,
};

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

  const ik = solveTwoBoneIK(
    rootWorld,
    targetWorld,
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
