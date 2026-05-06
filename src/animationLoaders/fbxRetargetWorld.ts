import * as THREE from 'three';
import { VRMHumanBoneName, type VRM } from '@pixiv/three-vrm';
import { mapFbxBoneToVrm } from './fbxBoneMap';
import { normalizeQuaternionSignsInPlace } from './quaternionContinuity';

interface Mapping {
  fbxName: string;
  fbxNode: THREE.Object3D;
  vrmName: VRMHumanBoneName;
  vrmNode: THREE.Object3D;
}

interface RetargetOptions {
  /**
   * Sample rate for the retargeted clip (Hz). Higher = larger clip but
   * captures fast rotations correctly. 60 fps is the safe default — at 30
   * fps a fast spin (>180° between samples) gets short-arced the wrong way
   * by quaternion sign normalization, producing a visible 180° flip on
   * dance clips with whip turns (e.g. Mixamo samba ~6-7s mark).
   */
  sampleFps?: number;
}

/**
 * World-space retargeting from FBX skeleton to VRM normalized humanoid.
 *
 * Why this exists: simple per-track local rotation rewriting (q_vrm = q_fbx
 * × R_bind_inv etc.) cannot fully handle Mixamo→VRM because the two rigs
 * differ along multiple independent axes —
 *   1. Bind-pose local rotation (legs at 180Z in Mixamo, identity in VRM).
 *   2. Bone-direction convention (Mixamo's child sits at local +Y, VRM's at
 *      local −Y for legs).
 *   3. Spine subdivision (Mixamo Spine→Spine1→Spine2 with subtly different
 *      orientations between segments vs VRM Spine→Chest→UpperChest).
 *
 * World-space sampling sidesteps all three: we play the FBX clip on the FBX
 * skeleton, snapshot each bone's WORLD rotation per frame, then re-express
 * that rotation as VRM local rotations using the VRM rig's actual parent
 * chain at that frame. The result drives the VRM exactly the way the
 * original animator intended on the source rig.
 *
 * Performance: O(numFrames × numBones). For a 3-second Mixamo idle at 30 fps
 * that's ~90 × ~50 ≈ 4500 quaternion ops, sub-millisecond on any modern
 * laptop. Done once at import time, never per render frame.
 */
export function retargetFbxToVrmWorldSpace(
  fbxRoot: THREE.Object3D,
  fbxClip: THREE.AnimationClip,
  vrm: VRM,
  name: string,
  opts: RetargetOptions = {},
): THREE.AnimationClip {
  const sampleFps = opts.sampleFps ?? 60;

  // 1. Build name → bone mapping (FBX → VRM)
  const mappings: Mapping[] = [];
  fbxRoot.traverse((obj) => {
    if (!obj.name) return;
    const vrmBone = mapFbxBoneToVrm(obj.name);
    if (!vrmBone) return;
    const vrmNode = vrm.humanoid.getNormalizedBoneNode(vrmBone);
    if (!vrmNode) return;
    mappings.push({ fbxName: obj.name, fbxNode: obj, vrmName: vrmBone, vrmNode });
  });

  if (mappings.length < 8) {
    const sample = mappings.map((m) => m.fbxName).slice(0, 8).join(', ');
    throw new Error(
      `World-space retarget: only ${mappings.length} bones mapped (need ≥8). Got: ${sample}`,
    );
  }

  // 2. Snapshot REST world quaternions.
  //    FBX skeleton: just-loaded, no animation applied yet — already at rest.
  //    VRM: whatever pose the avatar is currently in (mocap, idle, queue
  //    playback). To get a clean rest snapshot we temporarily replace EVERY
  //    humanoid bone's local quaternion with its normalizedRestPose entry —
  //    not just the bones we're mapping — so unmapped ancestors of mapped
  //    bones don't leak their live rotation into the world snapshot. Both
  //    `vrmRestWorld` and `vrmImmediateParentRestWorld` are sampled inside
  //    this rest window before restoring live poses; the whole cycle is
  //    synchronous so no render frame sees the swapped state.
  fbxRoot.updateMatrixWorld(true);

  const fbxRestWorld = new Map<string, THREE.Quaternion>();
  const vrmRestWorld = new Map<VRMHumanBoneName, THREE.Quaternion>();
  const _q = new THREE.Quaternion();

  for (const m of mappings) {
    fbxRestWorld.set(m.fbxName, m.fbxNode.getWorldQuaternion(new THREE.Quaternion()));
  }

  const restPose = (vrm.humanoid as any).normalizedRestPose as
    | Record<string, { rotation?: [number, number, number, number] }>
    | undefined;
  const savedLocals: Array<{ node: THREE.Object3D; q: THREE.Quaternion }> = [];
  for (const boneName of Object.values(VRMHumanBoneName)) {
    const node = vrm.humanoid.getNormalizedBoneNode(boneName);
    if (!node) continue;
    savedLocals.push({ node, q: node.quaternion.clone() });
    const r = restPose?.[boneName]?.rotation;
    if (r && r.length === 4) {
      node.quaternion.set(r[0], r[1], r[2], r[3]);
    } else {
      node.quaternion.set(0, 0, 0, 1); // identity fallback
    }
  }
  vrm.scene.updateMatrixWorld(true);

  // Snapshot world rotations of mapped bones AND the immediate-parent world
  // rotation used as the fallback for chains whose nearest mapped ancestor
  // doesn't exist. Both are read inside the rest window.
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

  // Restore live poses (we'll mutate again later in the per-frame loop, but
  // for now keep things consistent with what the rest of the app expects).
  for (const s of savedLocals) s.node.quaternion.copy(s.q);
  vrm.scene.updateMatrixWorld(true);

  // 3. Per-bone rest correction (the math).
  //
  //   delta_world(t) = q_fbx_world(t) × q_fbx_rest_world.inverse()
  //   q_target_world(t) = delta_world(t) × q_vrm_rest_world
  //                      = q_fbx_world(t) × q_fbx_rest_world.inverse() × q_vrm_rest_world
  //
  // We pre-compute the trailing factor once: q_post = q_fbx_rest_inv × q_vrm_rest.
  // Then per-frame: q_target_world = q_fbx_world × q_post.
  //
  // Critically: this is POST-multiplied onto q_fbx_world, NOT pre-multiplied.
  // An earlier version flipped the order (q_corr × q_fbx_world) — that
  // happens to give the right answer for rotations *around the Y axis*
  // because they commute with the 180Y in q_vrm_rest, but flips the sign
  // of any X/Z component, mirroring arm-forward / leg-forward motions.
  // World-space Mixamo dances visibly broke under the wrong order.
  const correction = new Map<VRMHumanBoneName, THREE.Quaternion>();
  for (const m of mappings) {
    const fbxRestInv = fbxRestWorld.get(m.fbxName)!.clone().invert();
    const vrmRest = vrmRestWorld.get(m.vrmName)!.clone();
    // q_post = q_fbx_rest_inv × q_vrm_rest
    correction.set(m.vrmName, fbxRestInv.multiply(vrmRest));
  }

  // 4. Build VRM dependency graph (top-down): each mapped bone's nearest
  //    mapped ancestor in the VRM hierarchy. For unmapped ancestors we
  //    fall back to `vrmImmediateParentRestWorld` snapshotted above.
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

  // Top-down processing order: visit each bone after all of its mapped
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

  // 5. Sample the FBX animation at fixed FPS via a dedicated mixer. This
  //    drives the FBX skeleton's local rotations frame by frame so we can
  //    read its world rotations.
  const numFrames = Math.max(2, Math.ceil(fbxClip.duration * sampleFps) + 1);
  const sampleDt = 1 / sampleFps;

  const mixer = new THREE.AnimationMixer(fbxRoot);
  const action = mixer.clipAction(fbxClip);
  action.play();
  // Force time = 0 so the first sample reflects the first keyframe, not a
  // half-step.
  mixer.setTime(0);

  // Output time-series per VRM bone.
  const trackData = new Map<VRMHumanBoneName, { times: number[]; values: number[] }>();
  for (const m of mappings) trackData.set(m.vrmName, { times: [], values: [] });

  // Per-frame world rotation cache (re-used across the inner loop).
  const vrmWorldThisFrame = new Map<VRMHumanBoneName, THREE.Quaternion>();
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
      // q_target_world = q_fbx_world × q_post   (POST-multiply — see note above)
      _targetWorld.copy(_fbxWorld).multiply(corr);

      // Resolve parent world rotation for THIS frame.
      const parentVrmName = vrmParentMappedName.get(m.vrmName);
      if (parentVrmName && vrmWorldThisFrame.has(parentVrmName)) {
        _parentWorld.copy(vrmWorldThisFrame.get(parentVrmName)!);
      } else {
        // Unmapped ancestor — its world rotation never moves from rest.
        _parentWorld.copy(vrmImmediateParentRestWorld.get(m.vrmName)!);
      }

      // q_local = q_parent_world.inverse × q_target_world
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

  // 6. Build retargeted tracks. Per-bone sign-continuity pass first, then
  //    measure worst per-frame delta on the (now hemisphere-consistent) data
  //    for the diagnostic summary. > 90° in the summary means we're near the
  //    Nyquist limit for rotation at this sampleFps and risk short-arc errors.
  let signFlips = 0;
  let worstDeltaRad = 0;
  let worstDeltaBone: VRMHumanBoneName | null = null;
  let worstDeltaTime = 0;
  const newTracks: THREE.KeyframeTrack[] = [];
  for (const m of mappings) {
    const td = trackData.get(m.vrmName)!;
    if (td.times.length === 0) continue;
    const v = td.values;
    signFlips += normalizeQuaternionSignsInPlace(v);
    for (let i = 4; i < v.length; i += 4) {
      // After sign-norm dot ≥ 0, so |dot| = dot. Quaternion half-angle
      // θ/2 = acos(dot); rotation angle = 2·θ/2.
      const dot = Math.max(-1, Math.min(1,
        v[i - 4] * v[i] + v[i - 3] * v[i + 1]
      + v[i - 2] * v[i + 2] + v[i - 1] * v[i + 3]));
      const angleRad = 2 * Math.acos(dot);
      if (angleRad > worstDeltaRad) {
        worstDeltaRad = angleRad;
        worstDeltaBone = m.vrmName;
        worstDeltaTime = td.times[i / 4];
      }
    }
    newTracks.push(new THREE.QuaternionKeyframeTrack(
      `${m.vrmNode.name}.quaternion`,
      td.times,
      v,
    ));
  }

  // 7. Hips position track — copy from FBX, rescale by avatar/source ratio.
  const hipsPosTrack = fbxClip.tracks.find((t) => /hips\.position$/i.test(t.name));
  if (hipsPosTrack) {
    const hipsNode = vrm.humanoid.getNormalizedBoneNode('hips' as any);
    const v = hipsPosTrack.values;
    const firstHipY = v.length >= 2 ? v[1] : 0;
    const avatarHipY = (vrm.humanoid as any).normalizedRestPose?.hips?.position?.[1] ?? 0.86;
    if (firstHipY > 0.05 && hipsNode) {
      const scale = avatarHipY / firstHipY;
      const scaled = new Float32Array(v.length);
      for (let i = 0; i < v.length; i++) scaled[i] = v[i] * scale;
      console.info(
        `[fbx-import] hip position rescaled: firstHipY=${firstHipY.toFixed(2)} → ` +
        `avatarHipY=${avatarHipY.toFixed(2)} (×${scale.toFixed(4)})`,
      );
      newTracks.push(new THREE.VectorKeyframeTrack(
        `${hipsNode.name}.position`,
        Array.from(hipsPosTrack.times),
        Array.from(scaled),
      ));
    }
  }

  const worstDeltaDeg = (worstDeltaRad * 180 / Math.PI).toFixed(1);
  const worstWarn = worstDeltaRad > Math.PI / 2
    ? `  ⚠ worst delta exceeds 90° — bump sampleFps to fix short-arc artifacts`
    : '';
  console.info(
    `[fbx-import] world-space retarget: mapped ${mappings.length} bones, ` +
    `sampled ${numFrames} frames at ${sampleFps} fps, produced ${newTracks.length} tracks, ` +
    `quaternion sign-flips normalized: ${signFlips}, ` +
    `worst per-frame Δ: ${worstDeltaDeg}° on ${worstDeltaBone ?? '—'} @ t=${worstDeltaTime.toFixed(2)}s${worstWarn}`,
  );

  return new THREE.AnimationClip(name, fbxClip.duration, newTracks);
}
