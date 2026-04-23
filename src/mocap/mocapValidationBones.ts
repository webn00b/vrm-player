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
