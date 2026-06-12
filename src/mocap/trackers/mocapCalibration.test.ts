/**
 * Tests for MocapCalibration chain-based limb scaling.
 *
 * Coverage:
 *   - armScale: chain ratio (segment sums) when measurements exist
 *   - bent arm does NOT shrink the chain estimate (the old max-distance
 *     reference under-observes reach unless the performer fully extends)
 *   - legScale: mean of side chains
 *   - toggle falls back to the legacy max-based path
 *   - mirror mapping: character left ← performer right
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MocapCalibration } from './mocapCalibration';
import { measureAvatarMetrics } from '../../avatarMetrics';
import { buildMockVRM } from '../../../tests/fixtures/mockVrm';
import type { Landmark3D, PoseFrame } from '../pipeline/poseDetector';

function lm(x: number, y: number, z = 0): Landmark3D {
  return { x, y, z, visibility: 1 };
}

/**
 * Performer frame in world (hip-centred metres) coordinates:
 * arms with given segment lengths, optionally bent at the elbow.
 */
function performerFrame(upperLen: number, lowerLen: number, bentDeg = 0): PoseFrame {
  const world: Landmark3D[] = Array.from({ length: 33 }, () => lm(0, 0));
  // Torso anchors.
  world[11] = lm(0.2, -0.5);  // left shoulder
  world[12] = lm(-0.2, -0.5); // right shoulder
  world[23] = lm(0.12, 0);    // left hip
  world[24] = lm(-0.12, 0);
  world[7] = lm(0.08, -0.65); // ears
  world[8] = lm(-0.08, -0.65);
  // Left arm: shoulder → elbow straight down, forearm bent by bentDeg.
  const bend = (bentDeg * Math.PI) / 180;
  world[13] = lm(0.2, -0.5 + upperLen);
  world[15] = lm(0.2 + Math.sin(bend) * lowerLen, -0.5 + upperLen + Math.cos(bend) * lowerLen);
  // Right arm mirrored.
  world[14] = lm(-0.2, -0.5 + upperLen);
  world[16] = lm(-0.2 - Math.sin(bend) * lowerLen, -0.5 + upperLen + Math.cos(bend) * lowerLen);
  // Legs straight down: hip → knee → ankle, 0.4 + 0.4.
  world[25] = lm(0.12, 0.4);
  world[27] = lm(0.12, 0.8);
  world[26] = lm(-0.12, 0.4);
  world[28] = lm(-0.12, 0.8);
  return { landmarks: world.map((l) => ({ ...l })), worldLandmarks: world, faceLandmarks: [], hands: [] };
}

function feedFrames(cal: MocapCalibration, frame: PoseFrame, n = 40): void {
  for (let i = 0; i < n; i++) cal.feed(frame);
}

test('armScale: chain ratio from segment sums', () => {
  const vrm = buildMockVRM();
  const cal = new MocapCalibration(vrm as never);
  const metrics = measureAvatarMetrics(vrm as never);
  feedFrames(cal, performerFrame(0.3, 0.25));
  // Character left arm ← performer RIGHT arm chain (0.55 m).
  const expected = (metrics.leftUpperArm + metrics.leftLowerArm) / 0.55;
  assert.ok(Math.abs(cal.armScale('left') - expected) < 0.02,
    `chain armScale; got ${cal.armScale('left')}, want ${expected}`);
});

test('armScale: bent elbow gives the same chain estimate as straight', () => {
  const vrm = buildMockVRM();
  const straight = new MocapCalibration(vrm as never);
  const bent = new MocapCalibration(vrm as never);
  feedFrames(straight, performerFrame(0.3, 0.25, 0));
  feedFrames(bent, performerFrame(0.3, 0.25, 90)); // forearm at 90°
  assert.ok(Math.abs(straight.armScale('left') - bent.armScale('left')) < 0.02,
    `bend must not change chain scale; straight=${straight.armScale('left')} bent=${bent.armScale('left')}`);
});

test('armScale: legacy max-based path under-estimates reach on a bent arm', () => {
  const vrm = buildMockVRM();
  const cal = new MocapCalibration(vrm as never);
  cal.setChainScaleEnabled(false);
  feedFrames(cal, performerFrame(0.3, 0.25, 90));
  const metrics = measureAvatarMetrics(vrm as never);
  const avatarLen = metrics.leftUpperArm + metrics.leftLowerArm;
  // Max shoulder→wrist distance of the 90°-bent arm: √(0.3² + 0.25²) ≈ 0.39.
  const legacy = cal.armScale('left');
  assert.ok(legacy > avatarLen / 0.55 * 1.2,
    `legacy scale should overshoot on bent arm (chain would be ${avatarLen / 0.55}); got ${legacy}`);
});

test('legScale: mean of side chains', () => {
  const vrm = buildMockVRM();
  const cal = new MocapCalibration(vrm as never);
  const metrics = measureAvatarMetrics(vrm as never);
  feedFrames(cal, performerFrame(0.3, 0.25));
  const avatarLeg = (metrics.leftUpperLeg + metrics.leftLowerLeg +
                     metrics.rightUpperLeg + metrics.rightLowerLeg) / 2;
  const expected = avatarLeg / 0.8; // chain = 0.4 + 0.4
  assert.ok(Math.abs(cal.legScale() - expected) < 0.02,
    `chain legScale; got ${cal.legScale()}, want ${expected}`);
});

test('recalibrate clears chain measurements', () => {
  const vrm = buildMockVRM();
  const cal = new MocapCalibration(vrm as never);
  feedFrames(cal, performerFrame(0.3, 0.25));
  const before = cal.armScale('left');
  cal.recalibrate();
  feedFrames(cal, performerFrame(0.36, 0.3), 60); // longer arms → smaller scale
  assert.ok(cal.armScale('left') < before * 0.95,
    `recalibrated scale must track new proportions; before=${before} after=${cal.armScale('left')}`);
});
