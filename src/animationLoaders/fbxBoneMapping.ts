import * as THREE from 'three';
import { type VRMHumanBoneName, type VRM } from '@pixiv/three-vrm';
import { mapFbxBoneToVrm } from './fbxBoneMap';

export interface Mapping {
  fbxName: string;
  fbxNode: THREE.Object3D;
  vrmName: VRMHumanBoneName;
  vrmNode: THREE.Object3D;
}

const MIN_MAPPED_BONES = 8;

/**
 * Phase 1 of the FBX→VRM world-space retarget pipeline. Walk the FBX scene
 * graph, recognise each bone via fbxBoneMap, look up the matching VRM
 * normalized humanoid node, and return the FBX↔VRM correspondences.
 *
 * Throws on rigs we don't recognise (fewer than MIN_MAPPED_BONES matches).
 * The error message includes the names we DID recognise so the user has a
 * starting point for extending fbxBoneMap if needed.
 */
export function buildFbxToVrmMappings(fbxRoot: THREE.Object3D, vrm: VRM): Mapping[] {
  const mappings: Mapping[] = [];
  fbxRoot.traverse((obj) => {
    if (!obj.name) return;
    const vrmBone = mapFbxBoneToVrm(obj.name);
    if (!vrmBone) return;
    const vrmNode = vrm.humanoid.getNormalizedBoneNode(vrmBone);
    if (!vrmNode) return;
    mappings.push({ fbxName: obj.name, fbxNode: obj, vrmName: vrmBone, vrmNode });
  });

  if (mappings.length < MIN_MAPPED_BONES) {
    const sample = mappings.map((m) => m.fbxName).slice(0, MIN_MAPPED_BONES).join(', ');
    throw new Error(
      `World-space retarget: only ${mappings.length} bones mapped (need ≥${MIN_MAPPED_BONES}). Got: ${sample}`,
    );
  }

  return mappings;
}
