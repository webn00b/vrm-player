import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { normalizeQuaternionSignsAcrossClip } from './animationLoaders/quaternionContinuity';

export type QuaternionCorrectionMode = 'post' | 'pre' | 'absolute';

export interface QuaternionCorrection {
  id: string;
  bone: string;
  mode: QuaternionCorrectionMode;
  q: [number, number, number, number];
  enabled: boolean;
}

export interface QuaternionCorrectionReport {
  appliedCorrections: number;
  affectedTracks: number;
  affectedKeyframes: number;
  signFlips: number;
}

function trackTargetName(trackName: string): string {
  const dot = trackName.indexOf('.');
  return dot > 0 ? trackName.slice(0, dot) : trackName;
}

export function applyQuaternionCorrectionsToClip(
  clip: THREE.AnimationClip,
  vrm: VRM,
  corrections: QuaternionCorrection[] = [],
): QuaternionCorrectionReport {
  const enabled = corrections.filter((correction) => correction.enabled);
  if (enabled.length === 0) {
    return { appliedCorrections: 0, affectedTracks: 0, affectedKeyframes: 0, signFlips: 0 };
  }

  const byTrackTarget = new Map<string, QuaternionCorrection>();
  for (const correction of enabled) {
    const node = vrm.humanoid.getNormalizedBoneNode(correction.bone as VRMHumanBoneName);
    if (!node) continue;
    byTrackTarget.set(node.name, correction);
    byTrackTarget.set(correction.bone, correction);
  }

  let affectedTracks = 0;
  let affectedKeyframes = 0;
  const frameQ = new THREE.Quaternion();
  const correctionQ = new THREE.Quaternion();
  const outQ = new THREE.Quaternion();

  for (const track of clip.tracks) {
    if (!(track instanceof THREE.QuaternionKeyframeTrack)) continue;
    const correction = byTrackTarget.get(trackTargetName(track.name));
    if (!correction) continue;

    correctionQ.set(correction.q[0], correction.q[1], correction.q[2], correction.q[3]).normalize();
    const values = track.values;
    for (let i = 0; i < values.length; i += 4) {
      frameQ.set(values[i], values[i + 1], values[i + 2], values[i + 3]).normalize();
      if (correction.mode === 'absolute') {
        outQ.copy(correctionQ);
      } else if (correction.mode === 'pre') {
        outQ.copy(correctionQ).multiply(frameQ);
      } else {
        outQ.copy(frameQ).multiply(correctionQ);
      }
      outQ.normalize();
      values[i] = outQ.x;
      values[i + 1] = outQ.y;
      values[i + 2] = outQ.z;
      values[i + 3] = outQ.w;
      affectedKeyframes++;
    }
    affectedTracks++;
  }

  const signReport = affectedTracks > 0
    ? normalizeQuaternionSignsAcrossClip(clip)
    : { totalFlips: 0 };

  return {
    appliedCorrections: enabled.length,
    affectedTracks,
    affectedKeyframes,
    signFlips: signReport.totalFlips,
  };
}
