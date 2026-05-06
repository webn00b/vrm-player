import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { buildFbxToVrmMappings } from './fbxBoneMapping';
import { snapshotRestPose } from './fbxRestSnapshot';
import { sampleFrames } from './fbxFrameSampler';
import { buildTracksFromSamples } from './fbxTrackBuilder';

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
 * Pipeline (split across modules in this directory):
 *  1. fbxBoneMapping   — find FBX↔VRM bone correspondences.
 *  2. fbxRestSnapshot  — snapshot REST world quaternions on both rigs.
 *  3. fbxFrameSampler  — per-bone correction quat, dependency order, and
 *                        the mixer-driven per-frame sample loop.
 *  4. fbxTrackBuilder  — sign-norm, worst-delta diagnostic, hip position
 *                        track, final assembly.
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

  const mappings = buildFbxToVrmMappings(fbxRoot, vrm);
  const rest     = snapshotRestPose(fbxRoot, vrm, mappings);
  const sampled  = sampleFrames(fbxRoot, fbxClip, mappings, rest, sampleFps);
  const built    = buildTracksFromSamples(mappings, sampled.trackData, fbxClip, vrm);

  const worstDeltaDeg = (built.worstDeltaRad * 180 / Math.PI).toFixed(1);
  const worstWarn = built.worstDeltaRad > Math.PI / 2
    ? '  ⚠ worst delta exceeds 90° — bump sampleFps to fix short-arc artifacts'
    : '';
  console.info(
    `[fbx-import] world-space retarget: mapped ${mappings.length} bones, ` +
    `sampled ${sampled.numFrames} frames at ${sampleFps} fps, produced ${built.tracks.length} tracks, ` +
    `quaternion sign-flips normalized: ${built.signFlips}, ` +
    `worst per-frame Δ: ${worstDeltaDeg}° on ${built.worstDeltaBone ?? '—'} @ t=${built.worstDeltaTime.toFixed(2)}s${worstWarn}`,
  );

  return new THREE.AnimationClip(name, fbxClip.duration, built.tracks);
}
