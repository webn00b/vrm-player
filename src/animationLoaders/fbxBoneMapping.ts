import * as THREE from 'three';
import { type VRMHumanBoneName, type VRM } from '@pixiv/three-vrm';
import { mapFbxBoneToVrm } from './fbxBoneMap';

export interface Mapping {
  fbxName: string;
  fbxNode: THREE.Object3D;
  vrmName: VRMHumanBoneName;
  vrmNode: THREE.Object3D;
}

export type ManualFbxBoneMapping = Partial<Record<VRMHumanBoneName, string>>;

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
export function buildFbxToVrmMappings(
  fbxRoot: THREE.Object3D,
  vrm: VRM,
  manualMapping: ManualFbxBoneMapping = {},
): Mapping[] {
  const mappings: Mapping[] = [];
  const usedFbxNodes = new Set<THREE.Object3D>();
  const usedVrmNames = new Set<VRMHumanBoneName>();
  const nodesByName = new Map<string, THREE.Object3D>();

  fbxRoot.traverse((obj) => {
    if (obj.name && !nodesByName.has(obj.name)) nodesByName.set(obj.name, obj);
  });

  for (const [vrmName, fbxName] of Object.entries(manualMapping) as Array<[VRMHumanBoneName, string]>) {
    if (!fbxName) continue;
    const fbxNode = nodesByName.get(fbxName);
    const vrmNode = vrm.humanoid.getNormalizedBoneNode(vrmName);
    if (!fbxNode || !vrmNode) continue;
    mappings.push({ fbxName, fbxNode, vrmName, vrmNode });
    usedFbxNodes.add(fbxNode);
    usedVrmNames.add(vrmName);
  }

  fbxRoot.traverse((obj) => {
    if (!obj.name) return;
    if (usedFbxNodes.has(obj)) return;
    const vrmBone = mapFbxBoneToVrm(obj.name);
    if (!vrmBone) return;
    if (usedVrmNames.has(vrmBone)) return;
    const vrmNode = vrm.humanoid.getNormalizedBoneNode(vrmBone);
    if (!vrmNode) return;
    mappings.push({ fbxName: obj.name, fbxNode: obj, vrmName: vrmBone, vrmNode });
    usedFbxNodes.add(obj);
    usedVrmNames.add(vrmBone);
  });

  if (mappings.length < MIN_MAPPED_BONES) {
    const sample = mappings.map((m) => m.fbxName).slice(0, MIN_MAPPED_BONES).join(', ');
    throw new Error(
      `World-space retarget: only ${mappings.length} bones mapped (need ≥${MIN_MAPPED_BONES}). Got: ${sample}`,
    );
  }

  return mappings;
}
