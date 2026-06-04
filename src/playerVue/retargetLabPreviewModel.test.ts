import assert from 'node:assert/strict';
import { test } from 'vitest';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import {
  buildCorrectedTargetJoints,
  buildSkeletonPreview,
} from './retargetLab/retargetPreviewModel';
import type { SkeletonJointMeta } from '../retargetLabModel';
import type { QuaternionCorrection } from '../retargetCorrections';

const skeleton: SkeletonJointMeta[] = [
  { id: 'root', name: 'hips', parentId: null, trackCount: 0, position: [0, 0, 0] },
  { id: 'hand', name: 'leftHand', parentId: 'root', trackCount: 0, position: [1, 0, 0] },
];

test('buildSkeletonPreview marks active and missing joints', () => {
  const preview = buildSkeletonPreview(
    skeleton,
    new Set(['hips', 'leftHand']),
    new Set(['leftHand']),
  );

  assert.equal(preview.nodes.length, 2);
  assert.equal(preview.lines.length, 1);
  assert.equal(preview.lines[0].active, true);
  assert.equal(preview.nodes.find((node) => node.name === 'leftHand')?.missing, true);
});

test('buildCorrectedTargetJoints rotates child offsets by enabled parent corrections', () => {
  const corrections: QuaternionCorrection[] = [{
    id: 'rotate-hips',
    bone: VRMHumanBoneName.Hips,
    mode: 'post',
    q: [0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)],
    enabled: true,
  }];

  const corrected = buildCorrectedTargetJoints(skeleton, corrections);
  const hand = corrected.find((joint) => joint.id === 'hand');

  assert.ok(hand);
  assert.ok(Math.abs(hand.position[0]) < 0.000001);
  assert.ok(Math.abs(hand.position[1] - 1) < 0.000001);
});
