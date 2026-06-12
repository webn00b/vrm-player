import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';

/**
 * Body measurements of a VRM avatar, in meters (world units).
 *
 * Single source of truth for "how big is this model" — consumed by both the
 * live video-mocap calibration (per-frame performer→avatar scaling) and the
 * animation importers (one-time clip→avatar hips adaptation). Keeping the
 * measurement code in one place guarantees the two pipelines agree on what
 * the avatar's proportions are.
 */
export interface AvatarMetrics {
  /**
   * Rest hips height above the ground plane. Prefers
   * `humanoid.normalizedRestPose.hips.position[1]` (pose-independent);
   * falls back to the hips node's current world Y.
   */
  hipsHeight: number;
  /** World distance between leftUpperLeg and rightUpperLeg origins. */
  hipWidth: number;
  /** World distance between leftUpperArm and rightUpperArm origins. 0 if arms missing. */
  shoulderWidth: number;
  /**
   * Ear-to-ear head width estimate: eye distance × 1.8 when eye bones exist,
   * else head bone length × 1.5, else 0 (head-based scaling disabled).
   */
  headWidth: number;
  /** Bone lengths = child bone's local rest offset magnitude. */
  leftUpperArm: number;
  leftLowerArm: number;
  rightUpperArm: number;
  rightLowerArm: number;
  leftUpperLeg: number;
  leftLowerLeg: number;
  rightUpperLeg: number;
  rightLowerLeg: number;
}

interface NormalizedRestPoseLike {
  hips?: { position?: { [index: number]: number } };
}

type HumanoidWithNormalizedRestPose = VRM['humanoid'] & {
  normalizedRestPose?: NormalizedRestPoseLike;
};

// Pinned to the first measurement like humanoidRestPose's axis cache: callers
// are expected to measure near bind pose (model load / calibration start).
// World-distance metrics (widths) are pose-dependent, so re-measuring mid-
// animation would give garbage — the cache protects against that.
const _metricsCache = new WeakMap<VRM, AvatarMetrics>();

/**
 * Measure the avatar. Cached per VRM — the first call (expected near bind
 * pose) pins the result for the model's lifetime.
 */
export function measureAvatarMetrics(vrm: VRM): AvatarMetrics {
  const cached = _metricsCache.get(vrm);
  if (cached) return cached;

  vrm.scene.updateMatrixWorld(true);
  const humanoid = vrm.humanoid;
  const getBone = (name: VRMHumanBoneName): THREE.Object3D | null =>
    humanoid.getNormalizedBoneNode(name);
  const boneLen = (childName: VRMHumanBoneName): number => {
    const node = getBone(childName);
    return node ? node.position.length() : 0;
  };
  const worldDistance = (a: VRMHumanBoneName, b: VRMHumanBoneName): number => {
    const nodeA = getBone(a);
    const nodeB = getBone(b);
    if (!nodeA || !nodeB) return 0;
    const posA = new THREE.Vector3();
    const posB = new THREE.Vector3();
    nodeA.getWorldPosition(posA);
    nodeB.getWorldPosition(posB);
    return posA.distanceTo(posB);
  };

  // Hips height: normalizedRestPose is pose-independent and survives the
  // model being mid-animation; world Y is the fallback for stubs/tests.
  const restPoseHipsY = (humanoid as HumanoidWithNormalizedRestPose)
    .normalizedRestPose?.hips?.position?.[1];
  let hipsHeight: number;
  if (typeof restPoseHipsY === 'number' && restPoseHipsY > 0) {
    hipsHeight = restPoseHipsY;
  } else {
    const hips = getBone('hips');
    hipsHeight = hips ? hips.getWorldPosition(new THREE.Vector3()).y : 0;
  }

  // Head width: prefer inter-pupillary × 1.8 (correlates with real face
  // width far better than head-bone length); fallback head length × 1.5.
  let headWidth = worldDistance('leftEye', 'rightEye') * 1.8;
  if (headWidth <= 0) {
    const head = getBone('head');
    headWidth = head ? head.position.length() * 1.5 : 0;
  }

  const metrics: AvatarMetrics = {
    hipsHeight,
    hipWidth: worldDistance('leftUpperLeg', 'rightUpperLeg'),
    shoulderWidth: worldDistance('leftUpperArm', 'rightUpperArm'),
    headWidth,
    leftUpperArm: boneLen('leftLowerArm'),
    leftLowerArm: boneLen('leftHand'),
    rightUpperArm: boneLen('rightLowerArm'),
    rightLowerArm: boneLen('rightHand'),
    leftUpperLeg: boneLen('leftLowerLeg'),
    leftLowerLeg: boneLen('leftFoot'),
    rightUpperLeg: boneLen('rightLowerLeg'),
    rightLowerLeg: boneLen('rightFoot'),
  };

  _metricsCache.set(vrm, metrics);
  return metrics;
}
