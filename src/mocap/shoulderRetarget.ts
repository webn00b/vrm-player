import * as THREE from 'three';
import type { Landmark3D } from './poseDetector';
import { mpDirToVrm } from './motionSpace';

export interface ShoulderTargetInput {
  mirrorX: boolean;
  restAxis: THREE.Vector3;
  parentWorldQuaternion: THREE.Quaternion;
  leftShoulder: Landmark3D;
  rightShoulder: Landmark3D;
  performerShoulder: Landmark3D | undefined;
  spreadRadians: number;
  spreadSign: number;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

export function solveShoulderTarget(input: ShoulderTargetInput): THREE.Quaternion {
  const {
    mirrorX,
    restAxis,
    parentWorldQuaternion,
    leftShoulder,
    rightShoulder,
    performerShoulder,
    spreadRadians,
    spreadSign,
  } = input;

  const spread = _q2.setFromAxisAngle(_v2.set(0, 0, 1), spreadSign * spreadRadians);
  if (!performerShoulder) return spread.clone();

  const midX = (leftShoulder.x + rightShoulder.x) * 0.5;
  const midY = (leftShoulder.y + rightShoulder.y) * 0.5;
  mpDirToVrm(
    mirrorX,
    performerShoulder.x - midX,
    performerShoulder.y - midY,
    0,
    _v1,
  );
  if (_v1.lengthSq() < 1e-6) return spread.clone();

  _q1.copy(parentWorldQuaternion).invert();
  _v1.applyQuaternion(_q1).normalize();
  _q1.setFromUnitVectors(restAxis, _v1).multiply(spread);
  return _q1.clone();
}
