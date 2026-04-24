import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import type { ParsedBVH } from './bvhLoader';
// @ts-ignore — copied JS module from pixiv/bvh2vrma
import { convertBVHToVRMAnimation } from './bvh2vrma/convertBVHToVRMAnimation.js';
import { applyHumanoidRestCorrectionsToClip } from './humanoidRestPose';
import { validateClip, clampClip } from './validation/clipValidator';

export interface RetargetOptions {
  /** If true, keyframes outside anatomical ROM are clamped in-place. Default false (log only). */
  clampOutOfRange?: boolean;
  /**
   * Skip the raw→normalized rest-pose correction step.
   * Set this when the BVH was recorded from the VRM's own normalized bones
   * (i.e. self-recorded via BvhRecorder), because those quaternions are already
   * in normalized T-pose space and applying the correction again would corrupt them.
   */
  skipRestCorrection?: boolean;
}

/**
 * Full pipeline: BVH → VRMA (via GLTFExporter) → VRMAnimation → AnimationClip
 * Uses the exact same logic as the reference project (pixiv/bvh2vrma).
 */
export async function retargetBvhToVrm(
  vrm: VRM,
  bvh: ParsedBVH,
  name: string,
  opts: RetargetOptions = {},
): Promise<THREE.AnimationClip> {
  // Step 1: convert BVH to VRMA ArrayBuffer
  const vrmaBuffer: ArrayBuffer = await convertBVHToVRMAnimation(bvh);

  // Step 2: load the VRMA via GLTFLoader + VRMAnimationLoaderPlugin
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  const blob = new Blob([vrmaBuffer], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  let clip: THREE.AnimationClip;
  try {
    const gltf = await loader.loadAsync(url);
    const vrmAnimations = gltf.userData.vrmAnimations;
    if (!vrmAnimations?.length) throw new Error('No VRM animations in exported VRMA');
    clip = createVRMAnimationClip(vrmAnimations[0], vrm);
    clip.name = name;
    if (!opts.skipRestCorrection) {
      const correctedTracks = applyHumanoidRestCorrectionsToClip(clip, vrm);
      if (correctedTracks > 0) {
        console.info(`[retarget] applied rest-pose correction to ${correctedTracks} quaternion track(s) in "${name}"`);
      }
    }
  } finally {
    URL.revokeObjectURL(url);
  }

  // Step 3: validate (and optionally clamp) against anatomical ROM
  const report = opts.clampOutOfRange ? clampClip(clip, vrm) : validateClip(clip, vrm);
  if (report.violationCount > 0) {
    const worst = report.worstBone
      ? `worst ${report.worstBone} (+${(report.worstOverBy * 180 / Math.PI).toFixed(1)}°)`
      : '';
    const action = opts.clampOutOfRange ? 'clamped' : 'out-of-range';
    console.warn(
      `[validator] clip "${name}": ${report.violationCount} ${action} keyframes across ${report.trackedBones} bones; ${worst}`,
    );
  }

  return clip;
}
