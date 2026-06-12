import { test } from 'vitest';
import assert from 'node:assert/strict';
import { measureAvatarMetrics } from './avatarMetrics';
import { buildMockVRM } from '../tests/fixtures/mockVrm';

// Mock VRM geometry (see tests/fixtures/mockVrm.ts):
//   hips at (0, 1.0, 0); upper legs at ±0.1 X; upper arms at world ±0.2 X;
//   eyes ±0.03 X; arm bones 0.25 long; leg bones 0.4 long.

test('hipsHeight falls back to hips world Y when normalizedRestPose is absent', () => {
  const m = measureAvatarMetrics(buildMockVRM() as never);
  assert.ok(Math.abs(m.hipsHeight - 1.0) < 1e-6, `hipsHeight=${m.hipsHeight}`);
});

test('hipsHeight prefers normalizedRestPose when present', () => {
  const vrm = buildMockVRM();
  (vrm.humanoid as { normalizedRestPose?: unknown }).normalizedRestPose = {
    hips: { position: [0, 0.86, 0] },
  };
  const m = measureAvatarMetrics(vrm as never);
  assert.ok(Math.abs(m.hipsHeight - 0.86) < 1e-6, `hipsHeight=${m.hipsHeight}`);
});

test('widths measured as world distances', () => {
  const m = measureAvatarMetrics(buildMockVRM() as never);
  assert.ok(Math.abs(m.hipWidth - 0.2) < 1e-6, `hipWidth=${m.hipWidth}`);
  assert.ok(Math.abs(m.shoulderWidth - 0.4) < 1e-6, `shoulderWidth=${m.shoulderWidth}`);
  // eyes 0.06 apart × 1.8
  assert.ok(Math.abs(m.headWidth - 0.108) < 1e-6, `headWidth=${m.headWidth}`);
});

test('limb bone lengths from child local offsets', () => {
  const m = measureAvatarMetrics(buildMockVRM() as never);
  assert.ok(Math.abs(m.leftUpperArm - 0.25) < 1e-6);
  assert.ok(Math.abs(m.rightLowerArm - 0.25) < 1e-6);
  assert.ok(Math.abs(m.leftUpperLeg - 0.4) < 1e-6);
  assert.ok(Math.abs(m.rightLowerLeg - 0.4) < 1e-6);
});

test('metrics are cached per VRM (pinned to first measurement)', () => {
  const vrm = buildMockVRM();
  const first = measureAvatarMetrics(vrm as never);
  // Mutate the rig after the first measurement — cache must shield us.
  vrm.bones.get('leftUpperLeg')!.position.x = 0.5;
  vrm.scene.updateMatrixWorld(true);
  const second = measureAvatarMetrics(vrm as never);
  assert.equal(first, second, 'same object returned');
  assert.ok(Math.abs(second.hipWidth - 0.2) < 1e-6, 'pre-mutation value retained');
});

test('matches MocapCalibration legacy expectations: zero for missing bones', () => {
  const vrm = buildMockVRM();
  vrm.bones.delete('leftEye');
  vrm.bones.delete('rightEye');
  vrm.bones.delete('head');
  const m = measureAvatarMetrics(vrm as never);
  assert.equal(m.headWidth, 0, 'head-based scaling disabled when no usable bones');
});
