import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import type { Mapping } from './fbxBoneMapping';
import { normalizeQuaternionSignsInPlace } from './quaternionContinuity';
import { computeHipsAdaptation, MIN_HIPS_REST, type HipsAdaptation } from './hipsAdaptation';
import { measureAvatarMetrics } from '../avatarMetrics';

export interface BuiltTracks {
  tracks: THREE.KeyframeTrack[];
  signFlips: number;
  worstDeltaRad: number;
  worstDeltaBone: VRMHumanBoneName | null;
  worstDeltaTime: number;
  /** Hips translation rescale that was applied (null if no hips track). */
  hipsAdaptation: HipsAdaptation | null;
}

/**
 * Phases 6-7 of the retarget pipeline. Convert per-bone time-series produced
 * by `sampleFrames` into final QuaternionKeyframeTracks:
 *  • hemisphere-consistent sign normalisation per track,
 *  • worst per-frame angular delta measurement (for diagnostics — bumping
 *    sampleFps becomes obvious if this exceeds 90°),
 *  • hip POSITION track copy + rescale to the avatar's normalized rest hip
 *    height so a Mixamo character (~95 cm hip) drives a VRM avatar (~86 cm)
 *    without floor-clipping or floating.
 */
export function buildTracksFromSamples(
  mappings: Mapping[],
  trackData: Map<VRMHumanBoneName, { times: number[]; values: number[] }>,
  fbxClip: THREE.AnimationClip,
  vrm: VRM,
  sourceHipsRestY?: number,
): BuiltTracks {
  let signFlips = 0;
  let worstDeltaRad = 0;
  let worstDeltaBone: VRMHumanBoneName | null = null;
  let worstDeltaTime = 0;
  const tracks: THREE.KeyframeTrack[] = [];

  for (const m of mappings) {
    const td = trackData.get(m.vrmName)!;
    if (td.times.length === 0) continue;
    const v = td.values;
    signFlips += normalizeQuaternionSignsInPlace(v);

    // After sign-norm dot ≥ 0, so |dot| = dot. Quaternion half-angle
    // θ/2 = acos(dot); rotation angle = 2·θ/2.
    for (let i = 4; i < v.length; i += 4) {
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

    tracks.push(new THREE.QuaternionKeyframeTrack(
      `${m.vrmNode.name}.quaternion`,
      td.times,
      v,
    ));
  }

  const hipsAdaptation = appendHipPositionTrack(tracks, fbxClip, vrm, sourceHipsRestY);

  return { tracks, signFlips, worstDeltaRad, worstDeltaBone, worstDeltaTime, hipsAdaptation };
}

function appendHipPositionTrack(
  tracks: THREE.KeyframeTrack[],
  fbxClip: THREE.AnimationClip,
  vrm: VRM,
  sourceHipsRestY?: number,
): HipsAdaptation | null {
  const hipsPosTrack = fbxClip.tracks.find((t) => /hips\.position$/i.test(t.name));
  if (!hipsPosTrack) return null;
  const hipsNode = vrm.humanoid.getNormalizedBoneNode('hips');
  if (!hipsNode) return null;
  const v = hipsPosTrack.values;

  // Source reference height, in the same parent-local space as the track
  // values (unit-agnostic — a cm-based FBX divides out correctly). Prefer
  // the bind-pose hips offset over the first keyframe: a clip that starts
  // mid-crouch or mid-jump would otherwise skew the scale.
  const firstHipY = v.length >= 2 ? v[1] : 0;
  const sourceHipY = sourceHipsRestY && sourceHipsRestY > MIN_HIPS_REST ? sourceHipsRestY : firstHipY;
  const avatarHipY = measureAvatarMetrics(vrm).hipsHeight;
  // Grounded/degenerate source (hips at the origin): translating the avatar's
  // hips there would fold it onto the floor — drop the track, keep rest hips.
  if (sourceHipY <= MIN_HIPS_REST) return null;

  const adaptation = computeHipsAdaptation(sourceHipY, avatarHipY);
  const scale = adaptation.applied ? adaptation.scale : 1;
  const scaled = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) scaled[i] = v[i] * scale;
  if (adaptation.applied) {
    console.info(
      `[fbx-import] hip position rescaled: sourceHipY=${sourceHipY.toFixed(2)} → ` +
      `avatarHipY=${avatarHipY.toFixed(2)} (×${scale.toFixed(4)})`,
    );
  }
  tracks.push(new THREE.VectorKeyframeTrack(
    `${hipsNode.name}.position`,
    Array.from(hipsPosTrack.times),
    Array.from(scaled),
  ));
  return adaptation;
}
