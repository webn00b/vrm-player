import * as THREE from 'three';
import { VRMHumanBoneName, type VRM } from '@pixiv/three-vrm';
import type { Mapping } from './fbxBoneMapping';

export interface RestSnapshot {
  /** FBX bone WORLD rotation at bind. */
  fbxRestWorld: Map<string, THREE.Quaternion>;
  /** VRM bone WORLD rotation when ALL humanoid bones are at normalized rest. */
  vrmRestWorld: Map<VRMHumanBoneName, THREE.Quaternion>;
  /**
   * Rest WORLD rotation of each mapped bone's IMMEDIATE parent — used as
   * the per-frame fallback when the bone's nearest mapped ancestor is
   * itself unmapped (e.g. hips' parent in normalized humanoid is a helper
   * node that doesn't appear in our mappings).
   */
  vrmImmediateParentRestWorld: Map<VRMHumanBoneName, THREE.Quaternion>;
}

/**
 * Phase 2 of the retarget pipeline. Snapshot REST world quaternions on both
 * the FBX skeleton (just-loaded, already at bind) and the VRM (which we
 * temporarily force into normalized rest pose).
 *
 * Why we touch EVERY humanoid bone, not just the mapped subset: unmapped
 * ancestors of mapped bones (head/jaw/eyes etc) might be in non-rest poses
 * from active animation/mocap at import time. Resetting only the mapped
 * subset would let those ancestors leak transient rotations into the world
 * snapshot, which then gets baked as a constant offset into every per-bone
 * correction quaternion. The whole save/swap/restore cycle is synchronous so
 * no render frame sees the swapped state.
 */
export function snapshotRestPose(
  fbxRoot: THREE.Object3D,
  vrm: VRM,
  mappings: Mapping[],
): RestSnapshot {
  // FBX is at bind — no animation applied yet.
  fbxRoot.updateMatrixWorld(true);
  const fbxRestWorld = new Map<string, THREE.Quaternion>();
  for (const m of mappings) {
    fbxRestWorld.set(m.fbxName, m.fbxNode.getWorldQuaternion(new THREE.Quaternion()));
  }

  // Save every humanoid bone's live local quaternion, swap to normalized
  // rest, sample, restore. `restPose` exposes per-bone authored rest values
  // when the rig has them; identity is the safe fallback.
  type RestPoseLike = {
    [name: string]: { rotation?: [number, number, number, number] };
  };
  const restPose = (vrm.humanoid as { normalizedRestPose?: RestPoseLike }).normalizedRestPose;
  const savedLocals: Array<{ node: THREE.Object3D; q: THREE.Quaternion }> = [];
  for (const boneName of Object.values(VRMHumanBoneName)) {
    const node = vrm.humanoid.getNormalizedBoneNode(boneName);
    if (!node) continue;
    savedLocals.push({ node, q: node.quaternion.clone() });
    const r = restPose?.[boneName]?.rotation;
    if (r && r.length === 4) {
      node.quaternion.set(r[0], r[1], r[2], r[3]);
    } else {
      node.quaternion.set(0, 0, 0, 1);
    }
  }
  vrm.scene.updateMatrixWorld(true);

  const vrmRestWorld = new Map<VRMHumanBoneName, THREE.Quaternion>();
  const vrmImmediateParentRestWorld = new Map<VRMHumanBoneName, THREE.Quaternion>();
  for (const m of mappings) {
    vrmRestWorld.set(m.vrmName, m.vrmNode.getWorldQuaternion(new THREE.Quaternion()));
    if (m.vrmNode.parent) {
      vrmImmediateParentRestWorld.set(
        m.vrmName,
        m.vrmNode.parent.getWorldQuaternion(new THREE.Quaternion()),
      );
    } else {
      vrmImmediateParentRestWorld.set(m.vrmName, new THREE.Quaternion());
    }
  }

  // Restore the live poses we found on entry — the rest of the app expects
  // its mocap/idle/animation state untouched.
  for (const s of savedLocals) s.node.quaternion.copy(s.q);
  vrm.scene.updateMatrixWorld(true);

  return { fbxRestWorld, vrmRestWorld, vrmImmediateParentRestWorld };
}
