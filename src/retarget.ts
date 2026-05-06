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
   * Skip the rest-pose correction step entirely. Rarely useful; mainly for
   * debugging.
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
  // Step 1: convert BVH to VRMA ArrayBuffer.
  //
  // We force the source skeleton's hips world Y to equal the target VRM's
  // normalizedRestPose.hips.position.y. The loader (`@pixiv/three-vrm-animation`)
  // reads `restHipsPosition` from `hips.getWorldPosition()` and computes
  // `scale = humanoidY / animationY` — passing matching values gives scale = 1
  // and the hips translation track becomes a bit-exact round-trip. Without it
  // we hit the bbox-derived skeleton depth (~0.78 m) instead of true bind
  // height (~0.86 m) and every hips keyframe drifts by ~9 cm.
  const hipsRestY = (vrm.humanoid as any).normalizedRestPose?.hips?.position?.[1];
  const vrmaBuffer: ArrayBuffer = await convertBVHToVRMAnimation(bvh, { hipsRestY });

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
    // Step 2b: defensive quaternion sign continuity. THREE.js BVHLoader does
    // Euler→quaternion per-frame independently, so at gimbal lock (e.g.
    // hip Y ≈ ±90° common in Mixamo dance BVHs) two physically-identical
    // orientations can land in opposite hemispheres of the 4-sphere. Three.js
    // QuaternionLinearInterpolant (slerpFlat) handles dot<0 between adjacent
    // pairs internally, but ANY post-processing that reads raw `track.values`
    // (rest correction, validator, BVH recorder, VRMA exporter) will see the
    // sign-discontinuity as a real 180° flip. Force consecutive-frame
    // hemisphere consistency once here, after rest correction.
    const signFlipsPerTrack = normalizeQuaternionSignsAcrossClip(clip);
    if (signFlipsPerTrack.totalFlips > 0) {
      console.info(
        `[retarget] '${name}' quaternion sign-continuity pass: flipped ${signFlipsPerTrack.totalFlips} keyframes ` +
        `across ${signFlipsPerTrack.tracksAffected} track(s); worst track: ${signFlipsPerTrack.worstTrack} (${signFlipsPerTrack.worstFlips} flips)`,
      );
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

interface SignFlipReport {
  totalFlips: number;
  tracksAffected: number;
  worstTrack: string;
  worstFlips: number;
}

/**
 * Walk every QuaternionKeyframeTrack on the clip and force consecutive-frame
 * sign continuity (negate `q_curr` if `dot(q_prev, q_curr) < 0`). Mutates
 * track values in place. Returns aggregate stats for diagnostics.
 *
 * Why we need this: THREE.js BVHLoader does Euler→quaternion per-frame
 * independently, so at gimbal lock (e.g. hip Y ≈ ±90° common in Mixamo dance
 * BVHs) two physically-identical orientations can land in opposite hemispheres
 * of the 4-sphere. Three.js's QuaternionLinearInterpolant handles dot<0
 * pairwise during slerp, but ANY post-processing that reads raw `track.values`
 * (rest correction, validator, downstream re-export) sees the
 * sign-discontinuity as a real 180° flip. We collapse it here, once, after
 * all other quaternion-mutating steps so subsequent consumers see continuous
 * signal.
 */
function normalizeQuaternionSignsAcrossClip(clip: THREE.AnimationClip): SignFlipReport {
  let totalFlips = 0;
  let tracksAffected = 0;
  let worstTrack = '';
  let worstFlips = 0;
  for (const track of clip.tracks) {
    if (!(track instanceof THREE.QuaternionKeyframeTrack)) continue;
    const v = track.values;
    let trackFlips = 0;
    for (let i = 4; i < v.length; i += 4) {
      const dot = v[i - 4] * v[i] + v[i - 3] * v[i + 1]
                + v[i - 2] * v[i + 2] + v[i - 1] * v[i + 3];
      if (dot < 0) {
        v[i]     = -v[i];
        v[i + 1] = -v[i + 1];
        v[i + 2] = -v[i + 2];
        v[i + 3] = -v[i + 3];
        trackFlips++;
      }
    }
    if (trackFlips > 0) {
      tracksAffected++;
      totalFlips += trackFlips;
      if (trackFlips > worstFlips) {
        worstFlips = trackFlips;
        worstTrack = track.name;
      }
    }
  }
  return { totalFlips, tracksAffected, worstTrack, worstFlips };
}

/**
 * Build the same VRMA glTF binary that the retarget pipeline produces and
 * trigger a `<name>.vrma` download. Reuses convertBVHToVRMAnimation with the
 * matching `hipsRestY` so the exported file plays back identically in third-
 * party VRM viewers (UniVRM Sample, pixiv reference player, etc).
 */
export async function exportBvhAsVrma(
  vrm: VRM,
  bvh: ParsedBVH,
  name: string,
): Promise<void> {
  const hipsRestY = (vrm.humanoid as any).normalizedRestPose?.hips?.position?.[1];
  const buf: ArrayBuffer = await convertBVHToVRMAnimation(bvh, { hipsRestY });
  const blob = new Blob([buf], { type: 'model/gltf-binary' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: `${name}.vrma`,
  });
  a.click();
  URL.revokeObjectURL(url);
}
