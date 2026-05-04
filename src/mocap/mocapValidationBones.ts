import { VRMHumanBoneName } from '@pixiv/three-vrm';

const HAND_BONE_SUFFIXES = [
  'ThumbMetacarpal',
  'ThumbProximal',
  'ThumbDistal',
  'IndexProximal',
  'IndexIntermediate',
  'IndexDistal',
  'MiddleProximal',
  'MiddleIntermediate',
  'MiddleDistal',
  'RingProximal',
  'RingIntermediate',
  'RingDistal',
  'LittleProximal',
  'LittleIntermediate',
  'LittleDistal',
] as const;

// Bones driven by mocap each frame — excluded from ROM clamping while live.
export const MOCAP_VALIDATION_EXCLUDED_BONES = new Set<VRMHumanBoneName>([
  VRMHumanBoneName.LeftShoulder,
  VRMHumanBoneName.LeftUpperArm,
  VRMHumanBoneName.LeftLowerArm,
  VRMHumanBoneName.LeftHand,
  VRMHumanBoneName.LeftUpperLeg,
  VRMHumanBoneName.LeftLowerLeg,
  VRMHumanBoneName.LeftFoot,
  VRMHumanBoneName.RightShoulder,
  VRMHumanBoneName.RightUpperArm,
  VRMHumanBoneName.RightLowerArm,
  VRMHumanBoneName.RightHand,
  VRMHumanBoneName.RightUpperLeg,
  VRMHumanBoneName.RightLowerLeg,
  VRMHumanBoneName.RightFoot,
  ...(['Left', 'Right'] as const).flatMap((side) =>
    HAND_BONE_SUFFIXES.map(
      (suffix) => VRMHumanBoneName[`${side}${suffix}` as keyof typeof VRMHumanBoneName],
    ),
  ),
]);

// Bones excluded from ROM clamping while a BVH/FBX clip is the authoritative
// source. Superset of the mocap exclusion list with `Hips` added: clip-driven
// dance content (samba etc.) routinely rotates hips ~90° around an axis, which
// our default ROM treats as overshoot. Euler→clamp→Euler near gimbal-lock
// then alternates between equivalent decompositions of the same orientation
// and produces visible 180° flips between adjacent frames. Mocap solver has
// its own hip handling so the live path keeps the original list.
export const CLIP_VALIDATION_EXCLUDED_BONES = new Set<VRMHumanBoneName>([
  ...MOCAP_VALIDATION_EXCLUDED_BONES,
  VRMHumanBoneName.Hips,
]);
