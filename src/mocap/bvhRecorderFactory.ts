import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { BvhRecorder } from './bvhRecorder';
import { bvhExportConfig } from './bvhExportConfig';
import { getCachedHumanoidRestAxes } from '../humanoidRestPose';

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
 *  - VRM 0.x avatars get x/z pre-flipped so a round-trip through
 *    `createVRMAnimationClip` cancels out
 */
export function createBvhRecorderForVrm(
  vrm: VRM,
  options: { systemAnimatorCompat?: boolean } = {},
): BvhRecorder {
  const correctionInvMap = buildCorrectionInvMap(vrm);
  const flipForVrm0 = vrm.meta.metaVersion === '0';
  // Default to the global toggle if not explicitly overridden — the queue's
  // "⬇ BVH" button doesn't pass options, so the UI checkbox controls both.
  const saCompat = options.systemAnimatorCompat ?? bvhExportConfig.systemAnimatorCompat;
  return new BvhRecorder({
    getJointOffset: (name) => getJointOffset(vrm, name),
    getRestCorrectionInv: (name) => correctionInvMap.get(name) ?? null,
    flipForVrm0,
    systemAnimatorCompat: saCompat,
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

function getJointOffset(vrm: VRM, name: string): [number, number, number] | null {
  if (name === 'hips') return [0, 0, 0];
  const node = vrm.humanoid.getNormalizedBoneNode(name as any);
  if (!node) return null;
  return [node.position.x, node.position.y, node.position.z];
}
