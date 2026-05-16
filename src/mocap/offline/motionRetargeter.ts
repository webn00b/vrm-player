import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import type { CanonicalJointName, CanonicalMotionClip, Vec3Tuple } from './canonicalMotion';
import { cleanupCanonicalMotionClip } from './motionCleanup';
import { normalizeQuaternionSignsAcrossClip } from '../../animationLoaders/quaternionContinuity';
import { clampClip, validateClip } from '../../validation/clipValidator';

export interface OfflineRetargetOptions {
  clampOutOfRange?: boolean;
  positionSmoothingAlpha?: number;
  rootMotionMode?: 'preserve' | 'horizontal' | 'locked';
  rootMotionScale?: number;
}

const DIRECTION_CHILD: Partial<Record<CanonicalJointName, CanonicalJointName[]>> = {
  hips: ['spine', 'chest'],
  spine: ['chest', 'upperChest', 'neck'],
  chest: ['upperChest', 'neck'],
  upperChest: ['neck', 'head'],
  neck: ['head'],
  leftShoulder: ['leftUpperArm'],
  leftUpperArm: ['leftLowerArm'],
  leftLowerArm: ['leftHand'],
  rightShoulder: ['rightUpperArm'],
  rightUpperArm: ['rightLowerArm'],
  rightLowerArm: ['rightHand'],
  leftUpperLeg: ['leftLowerLeg'],
  leftLowerLeg: ['leftFoot'],
  leftFoot: ['leftToes'],
  rightUpperLeg: ['rightLowerLeg'],
  rightLowerLeg: ['rightFoot'],
  rightFoot: ['rightToes'],
};

const PROCESS_ORDER: CanonicalJointName[] = [
  'hips',
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  'leftShoulder',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightShoulder',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'leftToes',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
  'rightToes',
];

const HUMANOID_PARENT: Partial<Record<CanonicalJointName, CanonicalJointName>> = {
  spine: 'hips',
  chest: 'spine',
  upperChest: 'chest',
  neck: 'upperChest',
  head: 'neck',
  leftShoulder: 'chest',
  leftUpperArm: 'leftShoulder',
  leftLowerArm: 'leftUpperArm',
  leftHand: 'leftLowerArm',
  rightShoulder: 'chest',
  rightUpperArm: 'rightShoulder',
  rightLowerArm: 'rightUpperArm',
  rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips',
  leftLowerLeg: 'leftUpperLeg',
  leftFoot: 'leftLowerLeg',
  leftToes: 'leftFoot',
  rightUpperLeg: 'hips',
  rightLowerLeg: 'rightUpperLeg',
  rightFoot: 'rightLowerLeg',
  rightToes: 'rightFoot',
};

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();

function vec3(tuple?: Vec3Tuple): THREE.Vector3 | null {
  return tuple ? new THREE.Vector3(tuple[0], tuple[1], tuple[2]) : null;
}

function getNode(vrm: VRM, name: CanonicalJointName): THREE.Object3D | null {
  return vrm.humanoid.getNormalizedBoneNode(name as VRMHumanBoneName);
}

function sourcePosition(frame: CanonicalMotionClip['frames'][number], name: CanonicalJointName): THREE.Vector3 | null {
  return vec3(frame.joints[name]?.position);
}

function firstAvailable(
  frame: CanonicalMotionClip['frames'][number],
  names: CanonicalJointName[],
): THREE.Vector3 | null {
  for (const name of names) {
    const v = sourcePosition(frame, name);
    if (v) return v;
  }
  return null;
}

function sourceDirection(
  frame: CanonicalMotionClip['frames'][number],
  from: CanonicalJointName,
  to: CanonicalJointName,
): THREE.Vector3 | null {
  const a = sourcePosition(frame, from);
  const b = sourcePosition(frame, to);
  if (!a || !b) return null;
  _v1.subVectors(b, a);
  if (_v1.lengthSq() < 1e-8) return null;
  return _v1.clone().normalize();
}

function restAxis(vrm: VRM, bone: CanonicalJointName, child: CanonicalJointName): THREE.Vector3 | null {
  const node = getNode(vrm, bone);
  const childNode = getNode(vrm, child);
  if (!node || !childNode) return null;
  _v1.copy(childNode.position);
  if (_v1.lengthSq() < 1e-8) return null;
  return _v1.clone().normalize();
}

function directionChildFor(
  vrm: VRM,
  frame: CanonicalMotionClip['frames'][number],
  bone: CanonicalJointName,
): CanonicalJointName | null {
  const candidates = DIRECTION_CHILD[bone] ?? [];
  for (const child of candidates) {
    if (getNode(vrm, child) && sourcePosition(frame, child)) return child;
  }
  return null;
}

function parentWorldFor(
  vrm: VRM,
  bone: CanonicalJointName,
  worldQ: Map<CanonicalJointName, THREE.Quaternion>,
): THREE.Quaternion | null {
  let parent = HUMANOID_PARENT[bone];
  while (parent) {
    const q = worldQ.get(parent);
    if (q) return q;
    parent = HUMANOID_PARENT[parent];
  }

  const node = getNode(vrm, bone);
  if (!node?.parent) return null;
  node.parent.getWorldQuaternion(_q2);
  return _q2.clone();
}

function makeBasisQuaternion(xAxis: THREE.Vector3, yAxis: THREE.Vector3): THREE.Quaternion | null {
  if (xAxis.lengthSq() < 1e-8 || yAxis.lengthSq() < 1e-8) return null;
  const x = xAxis.clone().normalize();
  const y = yAxis.clone();
  y.addScaledVector(x, -y.dot(x));
  if (y.lengthSq() < 1e-8) return null;
  y.normalize();
  const z = _v3.crossVectors(x, y).normalize();
  if (z.lengthSq() < 1e-8) return null;
  _m1.makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(_m1).normalize();
}

function hipsBasisFromSource(frame: CanonicalMotionClip['frames'][number]): THREE.Quaternion | null {
  const leftHip = firstAvailable(frame, ['leftUpperLeg']);
  const rightHip = firstAvailable(frame, ['rightUpperLeg']);
  const hips = sourcePosition(frame, 'hips');
  const spine = firstAvailable(frame, ['spine', 'chest', 'upperChest', 'neck']);
  if (!leftHip || !rightHip || !hips || !spine) return null;
  return makeBasisQuaternion(_v1.subVectors(leftHip, rightHip), _v2.subVectors(spine, hips));
}

function hipsRestBasisFromVrm(vrm: VRM): THREE.Quaternion {
  vrm.scene.updateMatrixWorld(true);
  const l = getNode(vrm, 'leftUpperLeg');
  const r = getNode(vrm, 'rightUpperLeg');
  const h = getNode(vrm, 'hips');
  const s = getNode(vrm, 'spine');
  if (!l || !r || !h || !s) return new THREE.Quaternion();
  const lp = new THREE.Vector3();
  const rp = new THREE.Vector3();
  const hp = new THREE.Vector3();
  const sp = new THREE.Vector3();
  l.getWorldPosition(lp);
  r.getWorldPosition(rp);
  h.getWorldPosition(hp);
  s.getWorldPosition(sp);
  return makeBasisQuaternion(lp.sub(rp), sp.sub(hp)) ?? new THREE.Quaternion();
}

function estimateSourceHeight(clip: CanonicalMotionClip): number {
  for (const frame of clip.frames) {
    const head = sourcePosition(frame, 'head');
    const leftFoot = sourcePosition(frame, 'leftFoot');
    const rightFoot = sourcePosition(frame, 'rightFoot');
    const footY = Math.min(leftFoot?.y ?? Infinity, rightFoot?.y ?? Infinity);
    if (head && Number.isFinite(footY)) return Math.max(0.1, head.y - footY);
  }
  return 1;
}

function estimateAvatarHeight(vrm: VRM): number {
  vrm.scene.updateMatrixWorld(true);
  const head = getNode(vrm, 'head');
  const leftFoot = getNode(vrm, 'leftFoot');
  const rightFoot = getNode(vrm, 'rightFoot');
  const hp = new THREE.Vector3();
  const lf = new THREE.Vector3();
  const rf = new THREE.Vector3();
  head?.getWorldPosition(hp);
  leftFoot?.getWorldPosition(lf);
  rightFoot?.getWorldPosition(rf);
  const footY = Math.min(leftFoot ? lf.y : Infinity, rightFoot ? rf.y : Infinity);
  return head && Number.isFinite(footY) ? Math.max(0.1, hp.y - footY) : 1;
}

function getRestHipsPosition(vrm: VRM): THREE.Vector3 {
  const hips = getNode(vrm, 'hips');
  return hips ? hips.position.clone() : new THREE.Vector3(0, 1, 0);
}

function frameRootPosition(frame: CanonicalMotionClip['frames'][number]): THREE.Vector3 | null {
  return vec3(frame.root?.position) ?? sourcePosition(frame, 'hips');
}

export function retargetCanonicalMotionToVrm(
  vrm: VRM,
  sourceClip: CanonicalMotionClip,
  opts: OfflineRetargetOptions = {},
): THREE.AnimationClip {
  const clip = cleanupCanonicalMotionClip(sourceClip, {
    positionSmoothingAlpha: opts.positionSmoothingAlpha,
  });
  const frames = clip.frames;
  const times = Float32Array.from(frames.map((frame) => frame.time));
  const tracks: THREE.KeyframeTrack[] = [];
  const restHips = getRestHipsPosition(vrm);
  const firstRoot = frameRootPosition(frames[0]) ?? new THREE.Vector3();
  const rootScale = opts.rootMotionScale ?? (estimateAvatarHeight(vrm) / estimateSourceHeight(clip));
  const hipsRestBasis = hipsRestBasisFromVrm(vrm);

  const quatValues = new Map<CanonicalJointName, number[]>();
  const lastQuat = new Map<CanonicalJointName, THREE.Quaternion>();
  const hipsPosValues: number[] = [];

  for (const frame of frames) {
    const worldQ = new Map<CanonicalJointName, THREE.Quaternion>();
    const rootPos = frameRootPosition(frame);
    if (rootPos) {
      _v1.subVectors(rootPos, firstRoot).multiplyScalar(rootScale).add(restHips);
      if (opts.rootMotionMode === 'horizontal') {
        _v1.y = restHips.y;
      } else if (opts.rootMotionMode === 'locked') {
        _v1.copy(restHips);
      }
      hipsPosValues.push(_v1.x, _v1.y, _v1.z);
    } else {
      hipsPosValues.push(restHips.x, restHips.y, restHips.z);
    }

    for (const bone of PROCESS_ORDER) {
      const node = getNode(vrm, bone);
      if (!node) continue;
      let q: THREE.Quaternion | null = null;

      if (bone === 'hips') {
        const sourceHipsBasis = hipsBasisFromSource(frame);
        if (sourceHipsBasis) {
          q = sourceHipsBasis.clone().multiply(_q1.copy(hipsRestBasis).invert()).normalize();
        } else if (frame.root?.rotation) {
          q = new THREE.Quaternion().fromArray(frame.root.rotation).normalize();
        }
      } else {
        const child = directionChildFor(vrm, frame, bone);
        const sourceDir = child ? sourceDirection(frame, bone, child) : null;
        const axis = child ? restAxis(vrm, bone, child) : null;
        if (sourceDir && axis) {
          const parentWorld = parentWorldFor(vrm, bone, worldQ);
          const parentInv = parentWorld ? _q2.copy(parentWorld).invert() : _q2.identity();
          _v1.copy(sourceDir).applyQuaternion(parentInv);
          q = new THREE.Quaternion().setFromUnitVectors(axis, _v1.normalize()).normalize();
        } else if (frame.joints[bone]?.rotation) {
          q = new THREE.Quaternion().fromArray(frame.joints[bone]!.rotation!).normalize();
        }
      }

      if (!q) q = lastQuat.get(bone)?.clone() ?? new THREE.Quaternion();
      lastQuat.set(bone, q.clone());

      const parentWorld = parentWorldFor(vrm, bone, worldQ);
      worldQ.set(bone, parentWorld ? _q3.copy(parentWorld).multiply(q).clone() : q.clone());

      let values = quatValues.get(bone);
      if (!values) {
        values = [];
        quatValues.set(bone, values);
      }
      values.push(q.x, q.y, q.z, q.w);
    }
  }

  const hipsNode = getNode(vrm, 'hips');
  if (hipsNode) {
    tracks.push(new THREE.VectorKeyframeTrack(`${hipsNode.name}.position`, times, Float32Array.from(hipsPosValues)));
  }

  for (const [bone, values] of quatValues) {
    const node = getNode(vrm, bone);
    if (!node || values.length !== frames.length * 4) continue;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, Float32Array.from(values)));
  }

  const out = new THREE.AnimationClip(sourceClip.name, -1, tracks);
  const flipReport = normalizeQuaternionSignsAcrossClip(out);
  if (flipReport.totalFlips > 0) {
    console.info(
      `[offline-retarget] '${out.name}' quaternion sign-continuity pass: ` +
      `${flipReport.totalFlips} flips across ${flipReport.tracksAffected} track(s)`,
    );
  }

  const report = opts.clampOutOfRange ? clampClip(out, vrm) : validateClip(out, vrm);
  if (report.violationCount > 0) {
    const worst = report.worstBone
      ? `worst ${report.worstBone} (+${THREE.MathUtils.radToDeg(report.worstOverBy).toFixed(1)} deg)`
      : '';
    console.warn(
      `[offline-retarget] clip "${out.name}": ${report.violationCount} out-of-range keyframes; ${worst}`,
    );
  }

  return out;
}
