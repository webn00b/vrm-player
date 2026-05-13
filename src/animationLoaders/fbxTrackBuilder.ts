import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import type { Mapping } from './fbxBoneMapping';
import { normalizeQuaternionSignsInPlace } from './quaternionContinuity';

export interface BuiltTracks {
  tracks: THREE.KeyframeTrack[];
  signFlips: number;
  worstDeltaRad: number;
  worstDeltaBone: VRMHumanBoneName | null;
  worstDeltaTime: number;
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

  appendHipPositionTrack(tracks, fbxClip, vrm);

  return { tracks, signFlips, worstDeltaRad, worstDeltaBone, worstDeltaTime };
}

function appendHipPositionTrack(
  tracks: THREE.KeyframeTrack[],
  fbxClip: THREE.AnimationClip,
  vrm: VRM,
): void {
  const hipsPosTrack = fbxClip.tracks.find((t) => /hips\.position$/i.test(t.name));
  if (!hipsPosTrack) return;
  const hipsNode = vrm.humanoid.getNormalizedBoneNode('hips');
  const v = hipsPosTrack.values;
  const firstHipY = v.length >= 2 ? v[1] : 0;
  const avatarHipY = (vrm.humanoid as { normalizedRestPose?: { hips?: { position?: { [k: number]: number } } } }).normalizedRestPose?.hips?.position?.[1] ?? 0.86;
  if (firstHipY <= 0.05 || !hipsNode) return;

  const scale = avatarHipY / firstHipY;
  const scaled = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) scaled[i] = v[i] * scale;
  console.info(
    `[fbx-import] hip position rescaled: firstHipY=${firstHipY.toFixed(2)} → ` +
    `avatarHipY=${avatarHipY.toFixed(2)} (×${scale.toFixed(4)})`,
  );
  tracks.push(new THREE.VectorKeyframeTrack(
    `${hipsNode.name}.position`,
    Array.from(hipsPosTrack.times),
    Array.from(scaled),
  ));
}
