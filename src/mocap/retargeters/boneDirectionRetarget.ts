import * as THREE from 'three';

export interface BoneDirectionRetargetInput {
  node: THREE.Object3D;
  restAxis: THREE.Vector3;
  worldDirection: THREE.Vector3;
  lerp: number;
}

const _v1 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

export function applyWorldDirectionToBone(input: BoneDirectionRetargetInput): void {
  const { node, restAxis, worldDirection, lerp } = input;
  if (!node.parent || worldDirection.lengthSq() < 1e-6) return;

  node.parent.updateWorldMatrix(true, false);
  node.parent.getWorldQuaternion(_q1).invert();
  _v1.copy(worldDirection).applyQuaternion(_q1).normalize();
  _q2.setFromUnitVectors(restAxis, _v1);

  if (lerp >= 1) node.quaternion.copy(_q2);
  else           node.quaternion.slerp(_q2, lerp);
  node.updateWorldMatrix(false, true);
}
