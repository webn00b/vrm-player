import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import type { ParsedBVH } from './bvhLoader';
// @ts-ignore — copied JS module from pixiv/bvh2vrma
import { convertBVHToVRMAnimation } from './bvh2vrma/convertBVHToVRMAnimation.js';
import { applyHumanoidRestCorrectionsToClip } from './humanoidRestPose';
import { validateClip, clampClip } from './validation/clipValidator';
import { normalizeQuaternionSignsAcrossClip } from './animationLoaders/quaternionContinuity';

interface NormalizedRestPoseLike {
  hips?: {
    position?: {
      [index: number]: number;
    };
  };
}

type HumanoidWithNormalizedRestPose = VRM['humanoid'] & {
  normalizedRestPose?: NormalizedRestPoseLike;
};

function uniqueTrackTargets(clip: THREE.AnimationClip): number {
  const targets = new Set<string>();
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    if (dot > 0) targets.add(track.name.slice(0, dot));
  }
  return targets.size;
}

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
  const hipsRestY = (vrm.humanoid as HumanoidWithNormalizedRestPose).normalizedRestPose?.hips?.position?.[1];
  const vrmaBuffer: ArrayBuffer = await convertBVHToVRMAnimation(bvh, { hipsRestY });

  // Step 2: load the VRMA via GLTFLoader + VRMAnimationLoaderPlugin
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  const blob = new Blob([vrmaBuffer], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  let clip: THREE.AnimationClip;
  let correctedTracks = 0;
  let signFlips = 0;
  let signFlipTracks = 0;
  try {
    const gltf = await loader.loadAsync(url);
    const vrmAnimations = gltf.userData.vrmAnimations;
    if (!vrmAnimations?.length) throw new Error('No VRM animations in exported VRMA');
    clip = createVRMAnimationClip(vrmAnimations[0], vrm);
    clip.name = name;
    if (!opts.skipRestCorrection) {
      correctedTracks = applyHumanoidRestCorrectionsToClip(clip, vrm);
    }
    // Step 2b: defensive quaternion sign continuity, after rest correction so
    // every downstream reader sees a clip without hemisphere-cross
    // discontinuities. See quaternionContinuity.ts for the why.
    const flipReport = normalizeQuaternionSignsAcrossClip(clip);
    signFlips = flipReport.totalFlips;
    signFlipTracks = flipReport.tracksAffected;
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

  console.info('[animation:retarget]', {
    name,
    source: 'bvh',
    sourceBones: bvh.skeleton.bones.length,
    sourceTracks: bvh.clip.tracks.length,
    clipDurationSec: Number(clip.duration.toFixed(3)),
    clipTracks: clip.tracks.length,
    clipTargets: uniqueTrackTargets(clip),
    restCorrectionTracks: correctedTracks,
    signFlips,
    signFlipTracks,
    validationViolations: report.violationCount,
    validationWorstBone: report.worstBone ?? null,
  });

  return clip;
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
  const hipsRestY = (vrm.humanoid as HumanoidWithNormalizedRestPose).normalizedRestPose?.hips?.position?.[1];
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
