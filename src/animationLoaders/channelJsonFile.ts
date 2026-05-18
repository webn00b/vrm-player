import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';

interface ChannelJsonTrack {
  times?: unknown;
  values?: unknown;
}

export interface ChannelAnimationJson {
  duration?: unknown;
  channels?: Record<string, ChannelJsonTrack>;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

export function isChannelAnimationJson(value: unknown): value is ChannelAnimationJson {
  if (!value || typeof value !== 'object') return false;
  const channels = (value as ChannelAnimationJson).channels;
  return !!channels && typeof channels === 'object' && !Array.isArray(channels);
}

function getTrackTargetName(vrm: VRM, boneName: string): string | null {
  const node = vrm.humanoid.getNormalizedBoneNode(boneName as VRMHumanBoneName);
  return node?.name || null;
}

export function channelAnimationJsonToClip(
  payload: ChannelAnimationJson,
  vrm: VRM,
  clipName = 'channel-json',
): THREE.AnimationClip {
  if (!payload.channels) {
    throw new Error('Channel animation JSON needs a channels object');
  }

  const tracks: THREE.KeyframeTrack[] = [];

  for (const [boneName, channel] of Object.entries(payload.channels)) {
    const times = channel.times;
    const values = channel.values;
    if (!isNumberArray(times) || !isNumberArray(values) || times.length === 0) continue;

    const targetName = getTrackTargetName(vrm, boneName);
    if (!targetName) continue;

    if (values.length === times.length * 4) {
      tracks.push(new THREE.QuaternionKeyframeTrack(
        `${targetName}.quaternion`,
        times,
        values,
      ));
    } else if (boneName === 'hips' && values.length === times.length * 3) {
      tracks.push(new THREE.VectorKeyframeTrack(
        `${targetName}.position`,
        times,
        values,
      ));
    }
  }

  if (tracks.length === 0) {
    throw new Error('Channel animation JSON contains no playable VRM humanoid tracks');
  }

  const duration = typeof payload.duration === 'number' && Number.isFinite(payload.duration)
    ? payload.duration
    : -1;
  return new THREE.AnimationClip(clipName, duration, tracks);
}

export function loadChannelJsonFromText(
  text: string,
  vrm: VRM,
  clipName = 'channel-json',
): THREE.AnimationClip {
  const payload = JSON.parse(text) as unknown;
  if (!isChannelAnimationJson(payload)) {
    throw new Error('Channel animation JSON needs a channels object');
  }
  return channelAnimationJsonToClip(payload, vrm, clipName);
}
