import * as THREE from 'three';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { Mapping } from './fbxBoneMapping';
import type { RestSnapshot } from './fbxRestSnapshot';

export interface SampledFrames {
  trackData: Map<VRMHumanBoneName, { times: number[]; values: number[] }>;
  numFrames: number;
}

/**
 * Phases 3-5 of the retarget pipeline:
 *  • Build per-bone rest correction quaternion `q_post = q_fbx_rest_inv × q_vrm_rest`.
 *  • Build VRM dependency graph (each mapped bone → nearest mapped ancestor).
 *  • Drive the FBX clip on the FBX skeleton via a private mixer, frame by
 *    frame; snapshot world rotations and re-express each as VRM-local.
 *
 * Math:
 *   delta_world = q_fbx_world × q_fbx_rest_world.inverse
 *   q_target_world = delta_world × q_vrm_rest_world
 *                  = q_fbx_world × (q_fbx_rest_inv × q_vrm_rest)
 *   q_local = q_parent_world.inverse × q_target_world
 *
 * The trailing factor `q_post` is POST-multiplied onto q_fbx_world per frame
 * (NOT pre-multiplied). An earlier version flipped the order — that happens
 * to give the right answer for rotations *around the Y axis* because they
 * commute with the 180Y in q_vrm_rest, but flips the sign of any X/Z
 * component, mirroring arm-forward / leg-forward motions. Mixamo dances
 * visibly broke under the wrong order.
 */
export function sampleFrames(
  fbxRoot: THREE.Object3D,
  fbxClip: THREE.AnimationClip,
  mappings: Mapping[],
  rest: RestSnapshot,
  sampleFps: number,
): SampledFrames {
  const correction = buildPerBoneCorrection(mappings, rest);
  const { topDown, vrmParentMappedName } = buildTopDownDependency(mappings);

  const numFrames = Math.max(2, Math.ceil(fbxClip.duration * sampleFps) + 1);
  const sampleDt = 1 / sampleFps;

  const mixer = new THREE.AnimationMixer(fbxRoot);
  const action = mixer.clipAction(fbxClip);
  action.play();
  // Force time = 0 so the first sample reflects the first keyframe, not a
  // half-step.
  mixer.setTime(0);

  const trackData = new Map<VRMHumanBoneName, { times: number[]; values: number[] }>();
  for (const m of mappings) trackData.set(m.vrmName, { times: [], values: [] });

  // Per-frame world rotation cache + scratch quaternions reused inside the
  // inner loop (no `new` per frame).
  const vrmWorldThisFrame = new Map<VRMHumanBoneName, THREE.Quaternion>();
  const _q = new THREE.Quaternion();
  const _fbxWorld = new THREE.Quaternion();
  const _parentWorld = new THREE.Quaternion();
  const _targetWorld = new THREE.Quaternion();
  const _local = new THREE.Quaternion();

  for (let f = 0; f < numFrames; f++) {
    const t = Math.min(f * sampleDt, fbxClip.duration);
    mixer.setTime(t);
    fbxRoot.updateMatrixWorld(true);
    vrmWorldThisFrame.clear();

    for (const m of topDown) {
      m.fbxNode.getWorldQuaternion(_fbxWorld);
      const corr = correction.get(m.vrmName)!;
      _targetWorld.copy(_fbxWorld).multiply(corr);

      // Resolve parent world rotation for THIS frame.
      const parentVrmName = vrmParentMappedName.get(m.vrmName);
      if (parentVrmName && vrmWorldThisFrame.has(parentVrmName)) {
        _parentWorld.copy(vrmWorldThisFrame.get(parentVrmName)!);
      } else {
        // Unmapped ancestor — its world rotation never moves from rest.
        _parentWorld.copy(rest.vrmImmediateParentRestWorld.get(m.vrmName)!);
      }

      _q.copy(_parentWorld).invert();
      _local.copy(_q).multiply(_targetWorld);
      vrmWorldThisFrame.set(m.vrmName, new THREE.Quaternion().copy(_targetWorld));

      const td = trackData.get(m.vrmName)!;
      td.times.push(t);
      td.values.push(_local.x, _local.y, _local.z, _local.w);
    }
  }

  action.stop();
  mixer.uncacheClip(fbxClip);

  return { trackData, numFrames };
}

function buildPerBoneCorrection(
  mappings: Mapping[],
  rest: RestSnapshot,
): Map<VRMHumanBoneName, THREE.Quaternion> {
  const correction = new Map<VRMHumanBoneName, THREE.Quaternion>();
  for (const m of mappings) {
    const fbxRestInv = rest.fbxRestWorld.get(m.fbxName)!.clone().invert();
    const vrmRest = rest.vrmRestWorld.get(m.vrmName)!.clone();
    correction.set(m.vrmName, fbxRestInv.multiply(vrmRest));
  }
  return correction;
}

function buildTopDownDependency(mappings: Mapping[]): {
  topDown: Mapping[];
  vrmParentMappedName: Map<VRMHumanBoneName, VRMHumanBoneName | null>;
} {
  // For each mapped bone, find its nearest mapped ancestor in the VRM
  // hierarchy. Unmapped ancestors fall back to vrmImmediateParentRestWorld
  // (resolved per-frame in the caller).
  const vrmParentMappedName = new Map<VRMHumanBoneName, VRMHumanBoneName | null>();
  for (const m of mappings) {
    let parent = m.vrmNode.parent;
    let parentVrmName: VRMHumanBoneName | null = null;
    while (parent) {
      const found = mappings.find((mm) => mm.vrmNode === parent);
      if (found) { parentVrmName = found.vrmName; break; }
      parent = parent.parent;
    }
    vrmParentMappedName.set(m.vrmName, parentVrmName);
  }

  // Topological order: visit each bone only after all of its mapped
  // ancestors have been visited.
  const topDown: Mapping[] = [];
  const visited = new Set<VRMHumanBoneName>();
  const visit = (m: Mapping): void => {
    if (visited.has(m.vrmName)) return;
    visited.add(m.vrmName);
    const parentName = vrmParentMappedName.get(m.vrmName);
    if (parentName) {
      const parentMapping = mappings.find((mm) => mm.vrmName === parentName);
      if (parentMapping) visit(parentMapping);
    }
    topDown.push(m);
  };
  for (const m of mappings) visit(m);

  return { topDown, vrmParentMappedName };
}
