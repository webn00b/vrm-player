import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { validateClip, clampClip } from '../../src/validation/clipValidator';
import { DEFAULT_BONE_CONSTRAINTS, mergeConstraints } from '../../src/validation/boneConstraints';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Minimal VRM mock: each bone name maps to a node with the same name. */
function makeMockVrm(...boneNames) {
  const humanBones = Object.fromEntries(boneNames.map((n) => [n, {}]));
  return {
    humanoid: {
      humanBones,
      getNormalizedBoneNode(name) {
        return humanBones[name] ? { uuid: `uuid-${name}`, name } : null;
      },
    },
  };
}

/** Build a single-keyframe quaternion track from Euler angles (deg). */
function makeTrack(nodeName, xDeg, yDeg, zDeg, order = 'XYZ') {
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(xDeg),
      THREE.MathUtils.degToRad(yDeg),
      THREE.MathUtils.degToRad(zDeg),
      order,
    ),
  );
  const values = Float32Array.from([q.x, q.y, q.z, q.w]);
  const times  = Float32Array.from([0]);
  return new THREE.QuaternionKeyframeTrack(`${nodeName}.quaternion`, times, values);
}

// ── boneConstraints ────────────────────────────────────────────────────────────

test('DEFAULT_BONE_CONSTRAINTS covers major bones', () => {
  const requiredBones = [
    VRMHumanBoneName.Hips,
    VRMHumanBoneName.Spine,
    VRMHumanBoneName.Neck,
    VRMHumanBoneName.Head,
    VRMHumanBoneName.LeftUpperArm,
    VRMHumanBoneName.LeftLowerArm,
    VRMHumanBoneName.RightUpperArm,
    VRMHumanBoneName.RightLowerArm,
    VRMHumanBoneName.LeftUpperLeg,
    VRMHumanBoneName.LeftLowerLeg,
    VRMHumanBoneName.RightUpperLeg,
    VRMHumanBoneName.RightLowerLeg,
  ];
  for (const bone of requiredBones) {
    assert.ok(DEFAULT_BONE_CONSTRAINTS[bone], `missing constraint for ${bone}`);
  }
});

test('lowerArm constraint allows normal flexion (90°) on X', () => {
  const c = DEFAULT_BONE_CONSTRAINTS[VRMHumanBoneName.LeftLowerArm];
  const maxDeg = c.max[0] * 180 / Math.PI;
  assert.ok(maxDeg >= 90, `lowerArm max X should allow ≥90°, got ${maxDeg.toFixed(1)}°`);
});

test('lowerArm constraint prevents backward bend beyond -10° on X', () => {
  const c = DEFAULT_BONE_CONSTRAINTS[VRMHumanBoneName.LeftLowerArm];
  const minDeg = c.min[0] * 180 / Math.PI;
  assert.ok(minDeg >= -15, `lowerArm min X should be ≥-15°, got ${minDeg.toFixed(1)}°`);
});

test('lowerLeg constraint prevents forward hyperextension beyond -10° on X', () => {
  const c = DEFAULT_BONE_CONSTRAINTS[VRMHumanBoneName.LeftLowerLeg];
  const minDeg = c.min[0] * 180 / Math.PI;
  assert.ok(minDeg >= -10, `lowerLeg min X should be ≥-10° (knee locks straight), got ${minDeg.toFixed(1)}°`);
});

test('left/right arm constraints are symmetric', () => {
  const pairs = [
    [VRMHumanBoneName.LeftUpperArm,  VRMHumanBoneName.RightUpperArm],
    [VRMHumanBoneName.LeftLowerArm,  VRMHumanBoneName.RightLowerArm],
    [VRMHumanBoneName.LeftHand,      VRMHumanBoneName.RightHand],
  ];
  for (const [left, right] of pairs) {
    const L = DEFAULT_BONE_CONSTRAINTS[left];
    const R = DEFAULT_BONE_CONSTRAINTS[right];
    for (let i = 0; i < 3; i++) {
      assert.ok(
        Math.abs(L.min[i] - R.min[i]) < 1e-6 && Math.abs(L.max[i] - R.max[i]) < 1e-6,
        `${left}/${right} axis ${i} should be symmetric`,
      );
    }
  }
});

test('mergeConstraints: override replaces specific bone', () => {
  const custom = { order: 'XYZ', min: [-0.1, -0.1, -0.1], max: [0.1, 0.1, 0.1] };
  const merged = mergeConstraints({ [VRMHumanBoneName.Neck]: custom });
  assert.deepEqual(merged[VRMHumanBoneName.Neck], custom);
  // other bones should still have defaults
  assert.ok(merged[VRMHumanBoneName.Spine], 'spine should survive merge');
});

test('mergeConstraints: no override returns defaults', () => {
  const merged = mergeConstraints(undefined);
  assert.ok(merged === DEFAULT_BONE_CONSTRAINTS || merged[VRMHumanBoneName.Hips] != null);
});

// ── validateClip ───────────────────────────────────────────────────────────────

test('identity quaternion on valid bone → 0 violations', () => {
  const vrm  = makeMockVrm(VRMHumanBoneName.LeftLowerArm);
  const track = makeTrack(VRMHumanBoneName.LeftLowerArm, 0, 0, 0);
  const clip  = new THREE.AnimationClip('test', 1, [track]);
  const report = validateClip(clip, vrm);
  assert.equal(report.violationCount, 0, 'identity quat should not violate any constraint');
});

test('elbow hyperextension (175° flexion) → violation detected', () => {
  const vrm  = makeMockVrm(VRMHumanBoneName.LeftLowerArm);
  // lowerArm constraint max X ≈ 150°; 175° is beyond that
  const track = makeTrack(VRMHumanBoneName.LeftLowerArm, 175, 0, 0, 'XYZ');
  const clip  = new THREE.AnimationClip('test', 1, [track]);
  const report = validateClip(clip, vrm);
  assert.ok(report.violationCount > 0, 'extreme elbow flexion should be flagged');
  assert.equal(report.worstBone, VRMHumanBoneName.LeftLowerArm);
  assert.equal(report.violations[0].axis, 'x');
});

test('knee backward bend (-20° on X) → violation detected', () => {
  const vrm   = makeMockVrm(VRMHumanBoneName.LeftLowerLeg);
  // lowerLeg min X ≈ -5°; -20° is hyperextension
  const track = makeTrack(VRMHumanBoneName.LeftLowerLeg, -20, 0, 0, 'XYZ');
  const clip  = new THREE.AnimationClip('test', 1, [track]);
  const report = validateClip(clip, vrm);
  assert.ok(report.violationCount > 0, 'knee hyperextension should be flagged');
});

test('neck over-rotation (150° yaw) → violation detected', () => {
  const vrm   = makeMockVrm(VRMHumanBoneName.Neck);
  // neck max Y ≈ 70°; 150° is extreme
  const track = makeTrack(VRMHumanBoneName.Neck, 0, 150, 0, 'YXZ');
  const clip  = new THREE.AnimationClip('test', 1, [track]);
  const report = validateClip(clip, vrm);
  assert.ok(report.violationCount > 0, '150° neck yaw should be flagged');
});

test('track on unknown bone → ignored (0 violations)', () => {
  const vrm   = makeMockVrm();  // no bones registered
  const track = makeTrack('unknownBone', 175, 0, 0);
  const clip  = new THREE.AnimationClip('test', 1, [track]);
  const report = validateClip(clip, vrm);
  assert.equal(report.violationCount, 0, 'unmapped bone track should be silently ignored');
  assert.equal(report.trackedBones, 0);
});

test('clampClip: violation disappears after clamp', () => {
  const vrm   = makeMockVrm(VRMHumanBoneName.LeftLowerArm);
  const track = makeTrack(VRMHumanBoneName.LeftLowerArm, 175, 0, 0, 'XYZ');
  const clip  = new THREE.AnimationClip('test', 1, [track]);

  // pre-clamp: should have violation
  const before = validateClip(clip, vrm);
  assert.ok(before.violationCount > 0, 'pre-condition: violation must exist before clamp');

  // clamp in-place
  clampClip(clip, vrm);

  // post-clamp: violation should be gone
  const after = validateClip(clip, vrm);
  assert.equal(after.violationCount, 0, 'clamped clip should have 0 violations');
});

test('clampClip: clamped value stays within constraint bounds', () => {
  const vrm   = makeMockVrm(VRMHumanBoneName.LeftLowerArm);
  const track = makeTrack(VRMHumanBoneName.LeftLowerArm, 175, 0, 0, 'XYZ');
  const clip  = new THREE.AnimationClip('test', 1, [track]);
  clampClip(clip, vrm);

  // Read clamped quaternion back and convert to Euler
  const qt = track.values;
  const q  = new THREE.Quaternion(qt[0], qt[1], qt[2], qt[3]);
  const eu = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  const c  = DEFAULT_BONE_CONSTRAINTS[VRMHumanBoneName.LeftLowerArm];
  assert.ok(eu.x <= c.max[0] + 1e-4, `clamped X ${(eu.x * 180 / Math.PI).toFixed(1)}° should be ≤ max`);
});

test('worst bone reports the larger violation', () => {
  const vrm = makeMockVrm(
    VRMHumanBoneName.LeftLowerArm,
    VRMHumanBoneName.LeftLowerLeg,
  );
  // Elbow: slight overshoot; knee: extreme backward bend
  const clip = new THREE.AnimationClip('test', 1, [
    makeTrack(VRMHumanBoneName.LeftLowerArm, 155, 0, 0, 'XYZ'), // ~5° over max
    makeTrack(VRMHumanBoneName.LeftLowerLeg, -90, 0, 0, 'XYZ'), // large hyperextension
  ]);
  const report = validateClip(clip, vrm);
  assert.ok(report.violationCount >= 2, 'both violations must be detected');
  assert.equal(report.worstBone, VRMHumanBoneName.LeftLowerLeg, 'knee should be worst offender');
});
