import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { mapFbxBoneToVrm } from './animationLoaders/fbxBoneMap';
import type { ManualFbxBoneMapping } from './animationLoaders/fbxBoneMapping';
import { parseBVH } from './bvhLoader';

export const RETARGET_REQUIRED_BONES = new Set<VRMHumanBoneName>([
  VRMHumanBoneName.Hips,
  VRMHumanBoneName.Spine,
  VRMHumanBoneName.Head,
  VRMHumanBoneName.LeftUpperArm,
  VRMHumanBoneName.RightUpperArm,
  VRMHumanBoneName.LeftLowerArm,
  VRMHumanBoneName.RightLowerArm,
  VRMHumanBoneName.LeftHand,
  VRMHumanBoneName.RightHand,
  VRMHumanBoneName.LeftUpperLeg,
  VRMHumanBoneName.RightUpperLeg,
  VRMHumanBoneName.LeftLowerLeg,
  VRMHumanBoneName.RightLowerLeg,
  VRMHumanBoneName.LeftFoot,
  VRMHumanBoneName.RightFoot,
]);

const RETARGET_BONE_SLOT_PAIRS: Array<[VRMHumanBoneName, string]> = [
  [VRMHumanBoneName.Hips, 'Hips'],
  [VRMHumanBoneName.Spine, 'Spine'],
  [VRMHumanBoneName.Chest, 'Chest'],
  [VRMHumanBoneName.UpperChest, 'Upper Chest'],
  [VRMHumanBoneName.Neck, 'Neck'],
  [VRMHumanBoneName.Head, 'Head'],
  [VRMHumanBoneName.LeftShoulder, 'Left Shoulder'],
  [VRMHumanBoneName.LeftUpperArm, 'Left Upper Arm'],
  [VRMHumanBoneName.LeftLowerArm, 'Left Lower Arm'],
  [VRMHumanBoneName.LeftHand, 'Left Hand'],
  [VRMHumanBoneName.RightShoulder, 'Right Shoulder'],
  [VRMHumanBoneName.RightUpperArm, 'Right Upper Arm'],
  [VRMHumanBoneName.RightLowerArm, 'Right Lower Arm'],
  [VRMHumanBoneName.RightHand, 'Right Hand'],
  [VRMHumanBoneName.LeftUpperLeg, 'Left Upper Leg'],
  [VRMHumanBoneName.LeftLowerLeg, 'Left Lower Leg'],
  [VRMHumanBoneName.LeftFoot, 'Left Foot'],
  [VRMHumanBoneName.LeftToes, 'Left Toes'],
  [VRMHumanBoneName.RightUpperLeg, 'Right Upper Leg'],
  [VRMHumanBoneName.RightLowerLeg, 'Right Lower Leg'],
  [VRMHumanBoneName.RightFoot, 'Right Foot'],
  [VRMHumanBoneName.RightToes, 'Right Toes'],

  [VRMHumanBoneName.LeftThumbMetacarpal, 'Left Thumb 1'],
  [VRMHumanBoneName.LeftThumbProximal, 'Left Thumb 2'],
  [VRMHumanBoneName.LeftThumbDistal, 'Left Thumb 3'],
  [VRMHumanBoneName.LeftIndexProximal, 'Left Index 1'],
  [VRMHumanBoneName.LeftIndexIntermediate, 'Left Index 2'],
  [VRMHumanBoneName.LeftIndexDistal, 'Left Index 3'],
  [VRMHumanBoneName.LeftMiddleProximal, 'Left Middle 1'],
  [VRMHumanBoneName.LeftMiddleIntermediate, 'Left Middle 2'],
  [VRMHumanBoneName.LeftMiddleDistal, 'Left Middle 3'],
  [VRMHumanBoneName.LeftRingProximal, 'Left Ring 1'],
  [VRMHumanBoneName.LeftRingIntermediate, 'Left Ring 2'],
  [VRMHumanBoneName.LeftRingDistal, 'Left Ring 3'],
  [VRMHumanBoneName.LeftLittleProximal, 'Left Little 1'],
  [VRMHumanBoneName.LeftLittleIntermediate, 'Left Little 2'],
  [VRMHumanBoneName.LeftLittleDistal, 'Left Little 3'],

  [VRMHumanBoneName.RightThumbMetacarpal, 'Right Thumb 1'],
  [VRMHumanBoneName.RightThumbProximal, 'Right Thumb 2'],
  [VRMHumanBoneName.RightThumbDistal, 'Right Thumb 3'],
  [VRMHumanBoneName.RightIndexProximal, 'Right Index 1'],
  [VRMHumanBoneName.RightIndexIntermediate, 'Right Index 2'],
  [VRMHumanBoneName.RightIndexDistal, 'Right Index 3'],
  [VRMHumanBoneName.RightMiddleProximal, 'Right Middle 1'],
  [VRMHumanBoneName.RightMiddleIntermediate, 'Right Middle 2'],
  [VRMHumanBoneName.RightMiddleDistal, 'Right Middle 3'],
  [VRMHumanBoneName.RightRingProximal, 'Right Ring 1'],
  [VRMHumanBoneName.RightRingIntermediate, 'Right Ring 2'],
  [VRMHumanBoneName.RightRingDistal, 'Right Ring 3'],
  [VRMHumanBoneName.RightLittleProximal, 'Right Little 1'],
  [VRMHumanBoneName.RightLittleIntermediate, 'Right Little 2'],
  [VRMHumanBoneName.RightLittleDistal, 'Right Little 3'],
];

export const RETARGET_BONE_SLOTS: Array<{ name: VRMHumanBoneName; label: string; required: boolean }> =
  RETARGET_BONE_SLOT_PAIRS.map(([name, label]) => ({ name, label, required: RETARGET_REQUIRED_BONES.has(name) }));

export interface SkeletonJointMeta {
  id: string;
  name: string;
  parentId: string | null;
  trackCount: number;
  position: [number, number, number];
}

export interface RetargetLabAnalysis {
  format: 'bvh' | 'fbx' | 'vrma';
  clipCount: number;
  duration: number;
  sourceJoints: SkeletonJointMeta[];
  targetJoints: SkeletonJointMeta[];
  mapping: ManualFbxBoneMapping;
  warnings: string[];
}

const SUPPORTED_REGEX = /\.(bvh|fbx|vrma)$/i;

export function isRetargetLabFile(file: File): boolean {
  return SUPPORTED_REGEX.test(file.name);
}

export function baseAnimationName(filename: string): string {
  return filename.replace(SUPPORTED_REGEX, '');
}

function trackBoneNames(clips: THREE.AnimationClip[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const clip of clips) {
    for (const track of clip.tracks) {
      const dot = track.name.indexOf('.');
      const name = dot > 0 ? track.name.slice(0, dot) : track.name;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return counts;
}

function objectTreeToJoints(root: THREE.Object3D, clips: THREE.AnimationClip[]): SkeletonJointMeta[] {
  const trackCounts = trackBoneNames(clips);
  const joints: SkeletonJointMeta[] = [];
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (!obj.name) return;
    const isAnimated = trackCounts.has(obj.name);
    const isBone = (obj as THREE.Bone).isBone;
    if (!isBone && !isAnimated) return;
    const p = obj.getWorldPosition(new THREE.Vector3());
    joints.push({
      id: obj.uuid,
      name: obj.name,
      parentId: obj.parent?.uuid ?? null,
      trackCount: trackCounts.get(obj.name) ?? 0,
      position: [p.x, p.y, p.z],
    });
  });
  return joints;
}

export function getRetargetTargetJoints(vrm: VRM): SkeletonJointMeta[] {
  vrm.scene.updateMatrixWorld(true);
  const nodeToSlot = new Map<THREE.Object3D, VRMHumanBoneName>();
  for (const { name } of RETARGET_BONE_SLOTS) {
    const node = vrm.humanoid.getNormalizedBoneNode(name);
    if (node) nodeToSlot.set(node, name);
  }
  return RETARGET_BONE_SLOTS.flatMap(({ name }) => {
    const node = vrm.humanoid.getNormalizedBoneNode(name);
    if (!node) return [];
    let parent = node.parent ?? null;
    let parentId: string | null = null;
    while (parent) {
      const slot = nodeToSlot.get(parent);
      if (slot) { parentId = slot; break; }
      parent = parent.parent;
    }
    const p = node.getWorldPosition(new THREE.Vector3());
    return [{
      id: name,
      name,
      parentId,
      trackCount: 0,
      position: [p.x, p.y, p.z],
    }];
  });
}

function autoMapFromNames(sourceJoints: SkeletonJointMeta[]): ManualFbxBoneMapping {
  const mapping: ManualFbxBoneMapping = {};
  for (const joint of sourceJoints) {
    const slot = mapFbxBoneToVrm(joint.name);
    if (slot && !mapping[slot]) mapping[slot] = joint.name;
  }
  return mapping;
}

function mappingWarnings(mapping: ManualFbxBoneMapping, sourceJoints: SkeletonJointMeta[]): string[] {
  const warnings: string[] = [];
  const sourceNames = new Set(sourceJoints.map((j) => j.name));
  const visibleSlots = new Set(RETARGET_BONE_SLOTS.map((slot) => slot.name));
  const missingRequired = RETARGET_BONE_SLOTS
    .filter((slot) => slot.required && !mapping[slot.name])
    .map((slot) => slot.label);
  if (missingRequired.length > 0) {
    warnings.push(`Missing required slots: ${missingRequired.join(', ')}`);
  }
  const unknownMapped = Object.values(mapping).filter((name): name is string => !!name && !sourceNames.has(name));
  if (unknownMapped.length > 0) {
    warnings.push(`Mapped source bones not found in file: ${unknownMapped.join(', ')}`);
  }
  const mappedVisibleCount = RETARGET_BONE_SLOTS.filter((slot) => !!mapping[slot.name]).length;
  const extraMappedCount = Object.keys(mapping).filter((slot) => !visibleSlots.has(slot as VRMHumanBoneName) && !!mapping[slot as VRMHumanBoneName]).length;
  warnings.push(`Auto-mapped ${mappedVisibleCount}/${RETARGET_BONE_SLOTS.length} visible humanoid slots.`);
  if (extraMappedCount > 0) {
    warnings.push(`Also detected ${extraMappedCount} extra humanoid bones outside this table, mostly fingers.`);
  }
  return warnings;
}

export async function analyzeRetargetLabFile(file: File, vrm: VRM): Promise<RetargetLabAnalysis> {
  const lower = file.name.toLowerCase();
  const targetJoints = getRetargetTargetJoints(vrm);

  if (lower.endsWith('.bvh')) {
    const parsed = parseBVH(await file.text());
    const trackCounts = trackBoneNames([parsed.clip]);
    const sourceJoints = parsed.skeleton.bones.map((bone) => ({
      id: bone.uuid,
      name: bone.name,
      parentId: bone.parent?.uuid ?? null,
      trackCount: trackCounts.get(bone.name) ?? 0,
      position: (() => {
        bone.updateMatrixWorld(true);
        const p = bone.getWorldPosition(new THREE.Vector3());
        return [p.x, p.y, p.z] as [number, number, number];
      })(),
    }));
    const mapping = autoMapFromNames(sourceJoints);
    return {
      format: 'bvh',
      clipCount: 1,
      duration: parsed.clip.duration,
      sourceJoints,
      targetJoints,
      mapping,
      warnings: [
        ...mappingWarnings(mapping, sourceJoints),
        'BVH import still uses the stable BVH→VRMA retarget path; manual table edits are diagnostic for now.',
      ],
    };
  }

  if (lower.endsWith('.fbx')) {
    const root = new FBXLoader().parse(await file.arrayBuffer(), '');
    const clips = root.animations ?? [];
    const sourceJoints = objectTreeToJoints(root, clips);
    const mapping = autoMapFromNames(sourceJoints);
    return {
      format: 'fbx',
      clipCount: clips.length,
      duration: clips[0]?.duration ?? 0,
      sourceJoints,
      targetJoints,
      mapping,
      warnings: mappingWarnings(mapping, sourceJoints),
    };
  }

  return {
    format: 'vrma',
    clipCount: 1,
    duration: 0,
    sourceJoints: [],
    targetJoints,
    mapping: {},
    warnings: ['VRMA already carries VRM humanoid animation semantics, so no manual bone mapping is needed.'],
  };
}
