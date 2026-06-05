import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { buildMockVRM } from '../tests/fixtures/mockVrm';
import { animationClipToBvhText } from './animationClipBvhExport';

describe('animationClipToBvhText', () => {
  test('samples a clip directly into BVH text at the recorder frame rate', () => {
    const vrm = buildMockVRM();
    const times = new Float32Array([0, 1]);
    const start = new THREE.Quaternion();
    const end = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const clip = new THREE.AnimationClip('trimmed', 1, [
      new THREE.VectorKeyframeTrack(
        'hips.position',
        times,
        new Float32Array([
          0, 1, 0,
          0.5, 1.25, 0.25,
        ]),
      ),
      new THREE.QuaternionKeyframeTrack(
        'leftUpperArm.quaternion',
        times,
        new Float32Array([
          start.x, start.y, start.z, start.w,
          end.x, end.y, end.z, end.w,
        ]),
      ),
    ]);

    const text = animationClipToBvhText(vrm, clip);
    const lines = text.split('\n');
    const frameIndex = lines.findIndex((line) => line.startsWith('Frames:'));
    const motionRows = lines.slice(frameIndex + 2);
    const finalRow = motionRows[motionRows.length - 1].split(' ').map(Number);

    expect(text).toContain('ROOT hips');
    expect(text).toContain('JOINT leftUpperArm');
    expect(lines[frameIndex]).toBe('Frames: 31');
    expect(lines[frameIndex + 1]).toBe('Frame Time: 0.033333');
    expect(motionRows).toHaveLength(31);
    expect(finalRow[0]).toBeCloseTo(0.5, 4);
    expect(finalRow[1]).toBeCloseTo(1.25, 4);
    expect(finalRow[2]).toBeCloseTo(0.25, 4);
    expect(finalRow.some((value, index) => index >= 3 && Math.abs(value) > 1)).toBe(true);
  });
});
