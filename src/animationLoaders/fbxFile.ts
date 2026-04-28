import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import type { VRM } from '@pixiv/three-vrm';
import { mapFbxBoneToVrm, countMappedBones } from './fbxBoneMap';

/**
 * Load an `.fbx` file and produce a THREE.AnimationClip whose tracks bind to
 * the given VRM's normalized humanoid bones.
 *
 * Approach: the FBX loader returns a Group with one or more AnimationClips.
 * We take the first clip, walk every KeyframeTrack, and rewrite its `name`
 * (the binding) to the corresponding VRM bone — looked up via `fbxBoneMap`.
 * Tracks for unmappable bones are dropped (logged once each).
 *
 * This works for skeletons that share the VRM convention (same axes, T-pose).
 * Mixamo / Maya HumanIK / Blender Rigify are all supported by name. If the
 * caller's avatar uses a different rest pose, `applyHumanoidRestCorrectionsToClip`
 * (called downstream where appropriate) handles the offset.
 */
export async function loadFbxFromFile(
  file: File,
  vrm: VRM,
  name: string,
): Promise<THREE.AnimationClip> {
  const buffer = await file.arrayBuffer();
  const loader = new FBXLoader();
  // FBXLoader.parse expects an ArrayBuffer + a path (used to resolve embedded
  // texture refs). We have neither textures nor a real path, so '' is fine.
  const root = loader.parse(buffer, '');

  if (!root.animations?.length) {
    throw new Error('FBX file contains no animation clips');
  }

  const sourceClip = root.animations[0];

  // Inspect the source bone names to give the user a meaningful error if the
  // skeleton is unrecognised before doing any track work.
  const sourceBones = new Set<string>();
  for (const track of sourceClip.tracks) {
    const dot = track.name.indexOf('.');
    sourceBones.add(dot > 0 ? track.name.slice(0, dot) : track.name);
  }
  const mappedCount = countMappedBones(sourceBones);
  if (mappedCount < 8) {
    const unmapped = [...sourceBones]
      .filter((n) => !mapFbxBoneToVrm(n))
      .slice(0, 12)
      .join(', ');
    throw new Error(
      `FBX skeleton not recognised — only ${mappedCount} bones mapped. Unmapped: ${unmapped}…`,
    );
  }

  // Rewrite each track binding to the VRM normalized bone path. The
  // VRMHumanoid normalized rig adds a "Normalized_" prefix to bone names —
  // the AnimationMixer attached to vrm.scene resolves them via THREE's
  // PropertyBinding name lookup, so plain bone names work as track targets.
  const warnedUnmapped = new Set<string>();
  const newTracks: THREE.KeyframeTrack[] = [];
  for (const track of sourceClip.tracks) {
    const dot = track.name.indexOf('.');
    const fbxBone = dot > 0 ? track.name.slice(0, dot) : track.name;
    const property = dot > 0 ? track.name.slice(dot + 1) : '';
    const vrmBone = mapFbxBoneToVrm(fbxBone);
    if (!vrmBone) {
      if (!warnedUnmapped.has(fbxBone)) {
        warnedUnmapped.add(fbxBone);
        console.warn(`[fbx-import] unmapped bone '${fbxBone}' — track dropped`);
      }
      continue;
    }
    // Drop position tracks for everything except the root (hips). Most FBX
    // rigs include per-bone translation tracks that, applied to a VRM's mesh
    // skinned to its own rest, would distort segment lengths. Hips position
    // is the only translation we want.
    if (property === 'position' && vrmBone !== 'hips') continue;

    // Resolve the actual node on the VRM and bind by UUID. This is more
    // robust than name-binding since the normalized humanoid bones live
    // under a "Normalized_" prefix that THREE's name-resolver can't see
    // when targeting a pretty name like "leftHand".
    const node = vrm.humanoid.getNormalizedBoneNode(vrmBone);
    if (!node) {
      if (!warnedUnmapped.has(fbxBone)) {
        warnedUnmapped.add(fbxBone);
        console.warn(`[fbx-import] avatar lacks bone '${vrmBone}' (FBX '${fbxBone}') — track dropped`);
      }
      continue;
    }

    const cloned = track.clone();
    cloned.name = `${node.uuid}.${property}`;
    newTracks.push(cloned);
  }

  if (newTracks.length === 0) {
    throw new Error('No FBX tracks could be retargeted to this VRM');
  }

  const out = new THREE.AnimationClip(name, sourceClip.duration, newTracks);
  return out;
}
