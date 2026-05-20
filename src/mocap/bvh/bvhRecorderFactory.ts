import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { BvhRecorder, BVH_JOINTS } from './bvhRecorder';
import { getCachedHumanoidRestAxes } from '../../humanoidRestPose';

/**
 * Build a `BvhRecorder` configured to write a self-consistent BVH file from
 * the given VRM's normalized bones. Produces the same kind of recorder that
 * `MocapController._createRecorder` makes for live mocap, but as a free
 * function so non-mocap consumers (notably the queue's "⬇ BVH" export) can
 * use the same encode pipeline.
 *
 * Behaviour:
 *  - hips offset = (0,0,0); other joint offsets = bone's normalized rest position
 *  - rest correction inverse map applied per joint so T-pose lands at identity
 *  - exported BVH stays in external-tool space. The old VRM0 x/z pre-flip is
 *    only enabled for the app's own round-trip verifier, where
 *    `createVRMAnimationClip` performs the matching inverse on replay.
 */
export type BvhRecorderCompatibility = 'external' | 'internal-roundtrip';

export interface CreateBvhRecorderForVrmOptions {
  compatibility?: BvhRecorderCompatibility;
}

export function createBvhRecorderForVrm(
  vrm: VRM,
  options: CreateBvhRecorderForVrmOptions = {},
): BvhRecorder {
  const correctionInvMap = buildCorrectionInvMap(vrm);
  const compatibility = options.compatibility ?? 'external';
  const flipForVrm0 = compatibility === 'internal-roundtrip' && vrm.meta.metaVersion === '0';
  return new BvhRecorder({
    getJointOffset: (name) => getJointOffset(vrm, name),
    getRestCorrectionInv: (name) => correctionInvMap.get(name) ?? null,
    flipForVrm0,
  });
}

function buildCorrectionInvMap(vrm: VRM): Map<string, [number, number, number, number]> {
  const map = new Map<string, [number, number, number, number]>();
  const restAxes = getCachedHumanoidRestAxes(vrm);
  const q = new THREE.Quaternion();
  for (const [bone, info] of restAxes) {
    q.copy(info.correction).invert();
    map.set(bone, [q.x, q.y, q.z, q.w]);
  }
  return map;
}

const _childWorld = new THREE.Vector3();
const _parentWorld = new THREE.Vector3();
const _parentWorldInv = new THREE.Quaternion();

export function getJointOffset(vrm: VRM, name: string): [number, number, number] | null {
  if (name === 'hips') return [0, 0, 0];
  const node = vrm.humanoid.getNormalizedBoneNode(name as VRMHumanBoneName);
  if (!node) return null;

  const parentName = BVH_JOINTS.find((joint) => joint.name === name)?.parent ?? null;
  const parent = parentName
    ? vrm.humanoid.getNormalizedBoneNode(parentName as VRMHumanBoneName)
    : null;
  if (!parent) return [node.position.x, node.position.y, node.position.z];

  // BVH_JOINTS intentionally omits some humanoid bones (for example
  // upperChest/toes). When an omitted bone sits between the BVH parent and
  // this node, node.position is relative to the omitted bone, not to the BVH
  // parent. External importers build their retarget axes from OFFSETs, so write
  // the transform in the declared BVH parent's local space.
  vrm.scene.updateMatrixWorld(true);
  node.getWorldPosition(_childWorld);
  parent.getWorldPosition(_parentWorld);
  parent.getWorldQuaternion(_parentWorldInv).invert();
  _childWorld.sub(_parentWorld).applyQuaternion(_parentWorldInv);
  return [_childWorld.x, _childWorld.y, _childWorld.z];
}
