import { VRMHumanBoneName } from '@pixiv/three-vrm';

export function normalizeMixamoBoneName(name: string): string {
  return name
    .replace(/^mixamorig[:_\s-]?/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

const MIXAMO_TO_HUMANOID: Record<string, VRMHumanBoneName> = {
  hips: VRMHumanBoneName.Hips,
  spine: VRMHumanBoneName.Spine,
  spine1: VRMHumanBoneName.Chest,
  spine2: VRMHumanBoneName.UpperChest,
  neck: VRMHumanBoneName.Neck,
  head: VRMHumanBoneName.Head,

  leftshoulder: VRMHumanBoneName.LeftShoulder,
  leftarm: VRMHumanBoneName.LeftUpperArm,
  leftforearm: VRMHumanBoneName.LeftLowerArm,
  lefthand: VRMHumanBoneName.LeftHand,
  rightshoulder: VRMHumanBoneName.RightShoulder,
  rightarm: VRMHumanBoneName.RightUpperArm,
  rightforearm: VRMHumanBoneName.RightLowerArm,
  righthand: VRMHumanBoneName.RightHand,

  leftupleg: VRMHumanBoneName.LeftUpperLeg,
  leftleg: VRMHumanBoneName.LeftLowerLeg,
  leftfoot: VRMHumanBoneName.LeftFoot,
  lefttoebase: VRMHumanBoneName.LeftToes,
  rightupleg: VRMHumanBoneName.RightUpperLeg,
  rightleg: VRMHumanBoneName.RightLowerLeg,
  rightfoot: VRMHumanBoneName.RightFoot,
  righttoebase: VRMHumanBoneName.RightToes,

  lefthandthumb1: VRMHumanBoneName.LeftThumbMetacarpal,
  lefthandthumb2: VRMHumanBoneName.LeftThumbProximal,
  lefthandthumb3: VRMHumanBoneName.LeftThumbDistal,
  lefthandindex1: VRMHumanBoneName.LeftIndexProximal,
  lefthandindex2: VRMHumanBoneName.LeftIndexIntermediate,
  lefthandindex3: VRMHumanBoneName.LeftIndexDistal,
  righthandthumb1: VRMHumanBoneName.RightThumbMetacarpal,
  righthandthumb2: VRMHumanBoneName.RightThumbProximal,
  righthandthumb3: VRMHumanBoneName.RightThumbDistal,
  righthandindex1: VRMHumanBoneName.RightIndexProximal,
  righthandindex2: VRMHumanBoneName.RightIndexIntermediate,
  righthandindex3: VRMHumanBoneName.RightIndexDistal,
};

export function mixamoBoneToHumanoid(name: string): VRMHumanBoneName | null {
  return MIXAMO_TO_HUMANOID[normalizeMixamoBoneName(name)] ?? null;
}
