import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import {
  channelAnimationJsonToClip,
  isChannelAnimationJson,
} from '../../src/animationLoaders/channelJsonFile';

function fakeVrm(): any {
  const nodes = new Map<string, THREE.Object3D>();
  for (const name of [
    VRMHumanBoneName.Hips,
    VRMHumanBoneName.RightUpperArm,
  ]) {
    const node = new THREE.Object3D();
    node.name = `${name}Node`;
    nodes.set(name, node);
  }
  return {
    humanoid: {
      getNormalizedBoneNode: (name: VRMHumanBoneName) => nodes.get(name) ?? null,
    },
  };
}

describe('channelAnimationJsonToClip', () => {
  it('converts channels JSON into normalized humanoid tracks', () => {
    const payload = {
      duration: 1,
      channels: {
        hips: {
          times: [0, 1],
          values: [0, 0, 0, 1, 0, 0, 0, 1],
        },
        rightUpperArm: {
          times: [0, 1],
          values: [0, 0, 0, 1, 0.1, 0, 0, 0.995],
        },
        missingBone: {
          times: [0, 1],
          values: [0, 0, 0, 1, 0, 0, 0, 1],
        },
      },
    };

    expect(isChannelAnimationJson(payload)).toBe(true);
    const clip = channelAnimationJsonToClip(payload, fakeVrm(), 'idle');

    expect(clip.name).toBe('idle');
    expect(clip.duration).toBe(1);
    expect(clip.tracks).toHaveLength(2);
    expect(clip.tracks.map(track => track.name).sort()).toEqual([
      'hipsNode.quaternion',
      'rightUpperArmNode.quaternion',
    ]);
  });
});
