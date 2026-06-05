import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { BVH_FRAME_TIME, BVH_JOINTS } from './mocap/bvh/bvhRecorder';
import { createBvhRecorderForVrm } from './mocap/bvh/bvhRecorderFactory';

interface SampledTrack {
  track: THREE.KeyframeTrack;
  stride: number;
  interpolant: THREE.Interpolant;
}

function findTrack(
  clip: THREE.AnimationClip,
  boneName: string,
  propertyName: 'position' | 'quaternion',
): SampledTrack | null {
  const suffix = `.${propertyName}`;
  const track = clip.tracks.find((candidate) => {
    if (!candidate.name.endsWith(suffix)) return false;
    const target = candidate.name.slice(0, -suffix.length);
    return target === boneName || target.endsWith(`.${boneName}`);
  });
  return track
    ? {
        track,
        stride: track.getValueSize(),
        interpolant: track.createInterpolant(),
      }
    : null;
}

function sampleQuaternion(sampled: SampledTrack | null, time: number): [number, number, number, number] | null {
  if (!sampled || sampled.stride < 4) return null;
  const values = sampled.interpolant.evaluate(time) as ArrayLike<number>;
  return [values[0], values[1], values[2], values[3]];
}

function samplePosition(sampled: SampledTrack | null, time: number): [number, number, number] | null {
  if (!sampled || sampled.stride < 3) return null;
  const values = sampled.interpolant.evaluate(time) as ArrayLike<number>;
  return [values[0], values[1], values[2]];
}

export function animationClipToBvhText(vrm: VRM, clip: THREE.AnimationClip): string {
  const duration = Math.max(0, clip.duration);
  if (duration <= 0) throw new Error(`Clip "${clip.name || 'animation'}" has zero duration`);

  const recorder = createBvhRecorderForVrm(vrm);
  const quaternionTracks = new Map<string, SampledTrack | null>();
  for (const joint of BVH_JOINTS) {
    quaternionTracks.set(joint.name, findTrack(clip, joint.name, 'quaternion'));
  }
  const hipsPositionTrack = findTrack(clip, 'hips', 'position');
  const frameCount = Math.max(1, Math.floor(duration / BVH_FRAME_TIME + 1e-6) + 1);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = Math.min(frame * BVH_FRAME_TIME, duration);
    recorder.captureFrame(
      (name) => sampleQuaternion(quaternionTracks.get(name) ?? null, time),
      () => samplePosition(hipsPositionTrack, time),
    );
  }

  return recorder.stop();
}
