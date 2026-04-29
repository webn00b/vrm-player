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
// - drop the "mixamorig:" / "mixamorig" prefix (THREE's FBXLoader strips the
//   colon during parse, so the names in clip.tracks look like
//   "mixamorigHips" with no delimiter)
// - lowercase
// - drop common trailing "_end" markers some exporters add
function normalizeKey(rawName: string): string {
  let s = rawName;
  const colon = s.indexOf(':');
  if (colon >= 0) s = s.slice(colon + 1);
  // Mixamo prefix is sometimes baked in without the colon. Match
  // case-insensitively so "MixamoRig" / "mixamorig" both work.
  s = s.replace(/^mixamorig/i, '');
  s = s.toLowerCase();
  s = s.replace(/_end$/, '');
  return s;
}

// All supported aliases live in this single table. Order doesn't matter — we
// build a Map<normalizedAlias, VRMHumanBoneName> at module init.
const ALIASES: Array<[VRMHumanBoneName, string[]]> = [
  // Spine + head.
  // Mixamo convention: Spine=Spine, Spine1=Chest, Spine2=UpperChest.
  // Unreal SK_Mannequin: spine_01=Spine, spine_02=Chest, spine_03=UpperChest.
  // (Bare "spine"/"chest"/"upperchest" handle Maya HumanIK and plain rigs.)
  [VRMHumanBoneName.Hips,        ['hips', 'pelvis', 'root', 'bip01', 'cog']],
  [VRMHumanBoneName.Spine,       ['spine', 'spine_01', 'lowerback', 'spinelower', 'abdomen']],
  [VRMHumanBoneName.Chest,       ['chest', 'spine1', 'spine_02', 'spinemid', 'spinemiddle']],
  [VRMHumanBoneName.UpperChest,  ['upperchest', 'spine2', 'spine_03', 'spineupper', 'spine3']],
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

  // ── Fingers ──────────────────────────────────────────────────────────────
  // Mixamo uses 3-segment fingers + 3-segment thumb; the first thumb segment
  // maps to VRM's ThumbMetacarpal (the carpometacarpal joint), the second to
  // ThumbProximal, the third to ThumbDistal. Mixamo "Pinky" → VRM "Little".
  // Other rigs (Blender Rigify, Maya HumanIK) follow similar patterns; aliases
  // include the typical separators (.l, _l, lefthand…).
  [VRMHumanBoneName.LeftThumbMetacarpal,    ['lefthandthumb1', 'thumb01.l', 'lthumb1', 'leftthumbmetacarpal', 'leftthumb1']],
  [VRMHumanBoneName.LeftThumbProximal,      ['lefthandthumb2', 'thumb02.l', 'lthumb2', 'leftthumbproximal', 'leftthumb2']],
  [VRMHumanBoneName.LeftThumbDistal,        ['lefthandthumb3', 'thumb03.l', 'lthumb3', 'leftthumbdistal', 'leftthumb3']],
  [VRMHumanBoneName.LeftIndexProximal,      ['lefthandindex1', 'index01.l', 'lindex1', 'leftindexproximal', 'leftindex1', 'f_index.01.l']],
  [VRMHumanBoneName.LeftIndexIntermediate,  ['lefthandindex2', 'index02.l', 'lindex2', 'leftindexintermediate', 'leftindex2', 'f_index.02.l']],
  [VRMHumanBoneName.LeftIndexDistal,        ['lefthandindex3', 'index03.l', 'lindex3', 'leftindexdistal', 'leftindex3', 'f_index.03.l']],
  [VRMHumanBoneName.LeftMiddleProximal,     ['lefthandmiddle1', 'middle01.l', 'lmiddle1', 'leftmiddleproximal', 'leftmiddle1', 'f_middle.01.l']],
  [VRMHumanBoneName.LeftMiddleIntermediate, ['lefthandmiddle2', 'middle02.l', 'lmiddle2', 'leftmiddleintermediate', 'leftmiddle2', 'f_middle.02.l']],
  [VRMHumanBoneName.LeftMiddleDistal,       ['lefthandmiddle3', 'middle03.l', 'lmiddle3', 'leftmiddledistal', 'leftmiddle3', 'f_middle.03.l']],
  [VRMHumanBoneName.LeftRingProximal,       ['lefthandring1', 'ring01.l', 'lring1', 'leftringproximal', 'leftring1', 'f_ring.01.l']],
  [VRMHumanBoneName.LeftRingIntermediate,   ['lefthandring2', 'ring02.l', 'lring2', 'leftringintermediate', 'leftring2', 'f_ring.02.l']],
  [VRMHumanBoneName.LeftRingDistal,         ['lefthandring3', 'ring03.l', 'lring3', 'leftringdistal', 'leftring3', 'f_ring.03.l']],
  [VRMHumanBoneName.LeftLittleProximal,     ['lefthandpinky1', 'lefthandlittle1', 'pinky01.l', 'lpinky1', 'llittle1', 'leftlittleproximal', 'leftpinky1', 'f_pinky.01.l']],
  [VRMHumanBoneName.LeftLittleIntermediate, ['lefthandpinky2', 'lefthandlittle2', 'pinky02.l', 'lpinky2', 'llittle2', 'leftlittleintermediate', 'leftpinky2', 'f_pinky.02.l']],
  [VRMHumanBoneName.LeftLittleDistal,       ['lefthandpinky3', 'lefthandlittle3', 'pinky03.l', 'lpinky3', 'llittle3', 'leftlittledistal', 'leftpinky3', 'f_pinky.03.l']],

  [VRMHumanBoneName.RightThumbMetacarpal,    ['righthandthumb1', 'thumb01.r', 'rthumb1', 'rightthumbmetacarpal', 'rightthumb1']],
  [VRMHumanBoneName.RightThumbProximal,      ['righthandthumb2', 'thumb02.r', 'rthumb2', 'rightthumbproximal', 'rightthumb2']],
  [VRMHumanBoneName.RightThumbDistal,        ['righthandthumb3', 'thumb03.r', 'rthumb3', 'rightthumbdistal', 'rightthumb3']],
  [VRMHumanBoneName.RightIndexProximal,      ['righthandindex1', 'index01.r', 'rindex1', 'rightindexproximal', 'rightindex1', 'f_index.01.r']],
  [VRMHumanBoneName.RightIndexIntermediate,  ['righthandindex2', 'index02.r', 'rindex2', 'rightindexintermediate', 'rightindex2', 'f_index.02.r']],
  [VRMHumanBoneName.RightIndexDistal,        ['righthandindex3', 'index03.r', 'rindex3', 'rightindexdistal', 'rightindex3', 'f_index.03.r']],
  [VRMHumanBoneName.RightMiddleProximal,     ['righthandmiddle1', 'middle01.r', 'rmiddle1', 'rightmiddleproximal', 'rightmiddle1', 'f_middle.01.r']],
  [VRMHumanBoneName.RightMiddleIntermediate, ['righthandmiddle2', 'middle02.r', 'rmiddle2', 'rightmiddleintermediate', 'rightmiddle2', 'f_middle.02.r']],
  [VRMHumanBoneName.RightMiddleDistal,       ['righthandmiddle3', 'middle03.r', 'rmiddle3', 'rightmiddledistal', 'rightmiddle3', 'f_middle.03.r']],
  [VRMHumanBoneName.RightRingProximal,       ['righthandring1', 'ring01.r', 'rring1', 'rightringproximal', 'rightring1', 'f_ring.01.r']],
  [VRMHumanBoneName.RightRingIntermediate,   ['righthandring2', 'ring02.r', 'rring2', 'rightringintermediate', 'rightring2', 'f_ring.02.r']],
  [VRMHumanBoneName.RightRingDistal,         ['righthandring3', 'ring03.r', 'rring3', 'rightringdistal', 'rightring3', 'f_ring.03.r']],
  [VRMHumanBoneName.RightLittleProximal,     ['righthandpinky1', 'righthandlittle1', 'pinky01.r', 'rpinky1', 'rlittle1', 'rightlittleproximal', 'rightpinky1', 'f_pinky.01.r']],
  [VRMHumanBoneName.RightLittleIntermediate, ['righthandpinky2', 'righthandlittle2', 'pinky02.r', 'rpinky2', 'rlittle2', 'rightlittleintermediate', 'rightpinky2', 'f_pinky.02.r']],
  [VRMHumanBoneName.RightLittleDistal,       ['righthandpinky3', 'righthandlittle3', 'pinky03.r', 'rpinky3', 'rlittle3', 'rightlittledistal', 'rightpinky3', 'f_pinky.03.r']],
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
