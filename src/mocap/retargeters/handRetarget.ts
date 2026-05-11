import * as THREE from 'three';
import { Hand as KalidoHand } from 'kalidokit';
import type { HandFrame } from '../pipeline/poseDetector';
import { kalidoHandBoneToVrm } from './directPoseConfig';
import { mpDirToVrm } from '../solvers/motionSpace';

export interface HandRetargetContext {
  nodeCache: Map<string, THREE.Object3D>;
  handRestBasis: Map<string, THREE.Quaternion>;
  mirrorX: boolean;
  handLerp: number;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();

export function applyTrackedPalmRetarget(
  ctx: HandRetargetContext,
  hand: HandFrame,
  snap = false,
): void {
  const side = hand.side === 'Left' ? 'left' : 'right';
  const handName = `${side}Hand`;
  const handNode = ctx.nodeCache.get(handName);
  const restBasis = ctx.handRestBasis.get(handName);
  const lms = hand.worldLandmarks;
  const wrist = lms[0];
  const index = lms[5];
  const middle = lms[9];
  const ring = lms[13];
  const little = lms[17];
  if (!handNode || !handNode.parent || !restBasis || !wrist || !index || !middle || !ring || !little) return;

  mpDirToVrm(ctx.mirrorX, index.x - little.x, index.y - little.y, index.z - little.z, _v1);
  mpDirToVrm(
    ctx.mirrorX,
    (index.x + middle.x + ring.x + little.x) * 0.25 - wrist.x,
    (index.y + middle.y + ring.y + little.y) * 0.25 - wrist.y,
    (index.z + middle.z + ring.z + little.z) * 0.25 - wrist.z,
    _v2,
  );
  if (_v1.lengthSq() < 1e-6 || _v2.lengthSq() < 1e-6) return;

  handNode.parent.updateWorldMatrix(true, false);
  handNode.parent.getWorldQuaternion(_q1).invert();
  _v1.applyQuaternion(_q1).normalize();
  _v2.applyQuaternion(_q1).normalize();
  _v3.crossVectors(_v1, _v2);
  if (_v3.lengthSq() < 1e-6) return;
  _v3.normalize();
  _v1.crossVectors(_v2, _v3).normalize();

  _m1.makeBasis(_v1, _v2, _v3);
  _q2.setFromRotationMatrix(_m1);
  _q1.copy(restBasis).invert();
  _q2.multiply(_q1);

  if (snap || ctx.handLerp >= 1) handNode.quaternion.copy(_q2);
  else                           handNode.quaternion.slerp(_q2, ctx.handLerp);
  handNode.updateWorldMatrix(false, true);
}

export function applyKalidoHandRetarget(
  ctx: HandRetargetContext,
  landmarks: any[],
  side: 'Left' | 'Right',
  includeWrist = false,
  snap = false,
): void {
  // PoseDetector already flips holistic hand labels into the same mirrored
  // avatar-side convention that body tracking uses, so applying another
  // left/right swap here would send wrist/finger rotations to the opposite
  // hand and make palm orientation diverge from the video.
  const rig = KalidoHand.solve(landmarks as any, side);
  if (!rig) return;
  for (const [kalidoKey, rot] of Object.entries(rig)) {
    if (!includeWrist && kalidoKey.endsWith('Wrist')) continue;
    const vrmName = kalidoHandBoneToVrm(kalidoKey);
    const node = ctx.nodeCache.get(vrmName);
    if (!node) continue;
    const r = rot as any;
    _q1.setFromEuler(
      new THREE.Euler(r.x, r.y, r.z, (r.rotationOrder ?? 'XYZ') as THREE.EulerOrder),
    );
    if (snap || ctx.handLerp >= 1) node.quaternion.copy(_q1);
    else                           node.quaternion.slerp(_q1, ctx.handLerp);
  }
}
