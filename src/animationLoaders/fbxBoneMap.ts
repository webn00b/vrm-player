import { VRMHumanBoneName } from '@pixiv/three-vrm';

/**
 * Maps common FBX bone names (Mixamo, Maya HumanIK, Blender Rigify, plain
 * "Hips/Spine/...") to VRM humanoid bone names. Match is case-insensitive,
 * with the `mixamorig:` prefix stripped before lookup.
 *
 * Note: matching is *exact* against the normalized key — we don't substring-
 * match because that produces false positives (e.g. "LeftUpLeg" contains "Up"
 * which would fool a substring search for upperLeg).
 */

// Normalize the FBX track-binding name to a comparable key:
// - drop the "mixamorig:" prefix if any
// - lowercase
// - drop common trailing "_end" or "_01" markers some exporters add
function normalizeKey(rawName: string): string {
  let s = rawName;
  const colon = s.indexOf(':');
  if (colon >= 0) s = s.slice(colon + 1);
  s = s.toLowerCase();
  s = s.replace(/_end$/, '').replace(/_\d+$/, '');
  return s;
}

// All supported aliases live in this single table. Order doesn't matter — we
// build a Map<normalizedAlias, VRMHumanBoneName> at module init.
const ALIASES: Array<[VRMHumanBoneName, string[]]> = [
  // Spine + head
  [VRMHumanBoneName.Hips,        ['hips', 'pelvis', 'root', 'bip01', 'cog']],
  [VRMHumanBoneName.Spine,       ['spine', 'spine1', 'spine_01', 'lowerback', 'spinelower', 'abdomen']],
  [VRMHumanBoneName.Chest,       ['chest', 'spine2', 'spine_02', 'spinemid', 'spinemiddle']],
  [VRMHumanBoneName.UpperChest,  ['upperchest', 'spine3', 'spine_03', 'spineupper']],
  [VRMHumanBoneName.Neck,        ['neck', 'neck1', 'neck_01']],
  [VRMHumanBoneName.Head,        ['head']],

  // Left arm
  [VRMHumanBoneName.LeftShoulder, ['leftshoulder', 'lshoulder', 'leftclavicle', 'lclavicle', 'clav.l', 'clavicle.l', 'shoulder.l']],
  [VRMHumanBoneName.LeftUpperArm, ['leftarm', 'larm', 'leftupperarm', 'lupperarm', 'upperarm.l']],
  [VRMHumanBoneName.LeftLowerArm, ['leftforearm', 'lforearm', 'leftlowerarm', 'llowerarm', 'forearm.l']],
  [VRMHumanBoneName.LeftHand,     ['lefthand', 'lhand', 'hand.l']],

  // Right arm
  [VRMHumanBoneName.RightShoulder, ['rightshoulder', 'rshoulder', 'rightclavicle', 'rclavicle', 'clav.r', 'clavicle.r', 'shoulder.r']],
  [VRMHumanBoneName.RightUpperArm, ['rightarm', 'rarm', 'rightupperarm', 'rupperarm', 'upperarm.r']],
  [VRMHumanBoneName.RightLowerArm, ['rightforearm', 'rforearm', 'rightlowerarm', 'rlowerarm', 'forearm.r']],
  [VRMHumanBoneName.RightHand,     ['righthand', 'rhand', 'hand.r']],

  // Left leg
  [VRMHumanBoneName.LeftUpperLeg, ['leftupleg', 'leftupperleg', 'lupleg', 'lupperleg', 'leftthigh', 'lthigh', 'thigh.l', 'upperleg.l']],
  [VRMHumanBoneName.LeftLowerLeg, ['leftleg', 'lleg', 'leftlowerleg', 'llowerleg', 'leftshin', 'lshin', 'shin.l', 'lowerleg.l', 'calf.l']],
  [VRMHumanBoneName.LeftFoot,     ['leftfoot', 'lfoot', 'foot.l']],
  [VRMHumanBoneName.LeftToes,     ['lefttoebase', 'ltoebase', 'lefttoe', 'ltoes', 'toes.l', 'toe.l']],

  // Right leg
  [VRMHumanBoneName.RightUpperLeg, ['rightupleg', 'rightupperleg', 'rupleg', 'rupperleg', 'rightthigh', 'rthigh', 'thigh.r', 'upperleg.r']],
  [VRMHumanBoneName.RightLowerLeg, ['rightleg', 'rleg', 'rightlowerleg', 'rlowerleg', 'rightshin', 'rshin', 'shin.r', 'lowerleg.r', 'calf.r']],
  [VRMHumanBoneName.RightFoot,     ['rightfoot', 'rfoot', 'foot.r']],
  [VRMHumanBoneName.RightToes,     ['righttoebase', 'rtoebase', 'righttoe', 'rtoes', 'toes.r', 'toe.r']],
];

const MAP = new Map<string, VRMHumanBoneName>();
for (const [vrm, aliases] of ALIASES) {
  for (const a of aliases) MAP.set(a, vrm);
}

/**
 * Look up the VRM humanoid bone name corresponding to an FBX bone name, or
 * `null` if unknown. The track that drives an unknown bone should be dropped
 * by the caller (and logged once).
 */
export function mapFbxBoneToVrm(fbxName: string): VRMHumanBoneName | null {
  return MAP.get(normalizeKey(fbxName)) ?? null;
}

/** For diagnostics — counts how many distinct VRM bones a clip will drive. */
export function countMappedBones(fbxNames: Iterable<string>): number {
  const seen = new Set<VRMHumanBoneName>();
  for (const n of fbxNames) {
    const v = mapFbxBoneToVrm(n);
    if (v) seen.add(v);
  }
  return seen.size;
}
