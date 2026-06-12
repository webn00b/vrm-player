import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { validateClip, clampClip } from '../../src/validation/clipValidator';
import { BONE_CONSTRAINT_PROFILES, DEFAULT_BONE_CONSTRAINTS, mergeConstraints } from '../../src/validation/boneConstraints';

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
  // Hips are deliberately absent: they carry global orientation, not an
  // anatomical joint angle, and clamping them mangles turns and floor poses.
  const requiredBones = [
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

// Normalized humanoid frames are world-aligned in T-pose: the left forearm
// rests along +X, so elbow flexion (palm-down hinge) is −Y and backward bend
// (hyperextension) is +Y. X carries pronation/supination twist.
test('lowerArm constraint allows normal flexion (≥90°) on Y', () => {
  const c = DEFAULT_BONE_CONSTRAINTS[VRMHumanBoneName.LeftLowerArm];
  const flexDeg = -c.min[1] * 180 / Math.PI;
  assert.ok(flexDeg >= 90, `lowerArm flexion (−minY) should allow ≥90°, got ${flexDeg.toFixed(1)}°`);
});

test('lowerArm constraint prevents backward bend beyond +15° on Y', () => {
  const c = DEFAULT_BONE_CONSTRAINTS[VRMHumanBoneName.LeftLowerArm];
  const maxDeg = c.max[1] * 180 / Math.PI;
  assert.ok(maxDeg <= 15, `lowerArm max Y should be ≤15°, got ${maxDeg.toFixed(1)}°`);
});

test('lowerLeg constraint prevents forward hyperextension beyond -10° on X', () => {
  const c = DEFAULT_BONE_CONSTRAINTS[VRMHumanBoneName.LeftLowerLeg];
  const minDeg = c.min[0] * 180 / Math.PI;
  assert.ok(minDeg >= -10, `lowerLeg min X should be ≥-10° (knee locks straight), got ${minDeg.toFixed(1)}°`);
});

test('right-side constraints mirror left across the sagittal plane in every profile', () => {
  // Mirrored rotation negates Y and Z Euler components, so right ranges must
  // be the left ranges with Y/Z bounds negated and swapped; X unchanged.
  const pairs = [
    [VRMHumanBoneName.LeftShoulder,  VRMHumanBoneName.RightShoulder],
    [VRMHumanBoneName.LeftUpperArm,  VRMHumanBoneName.RightUpperArm],
    [VRMHumanBoneName.LeftLowerArm,  VRMHumanBoneName.RightLowerArm],
    [VRMHumanBoneName.LeftHand,      VRMHumanBoneName.RightHand],
    [VRMHumanBoneName.LeftUpperLeg,  VRMHumanBoneName.RightUpperLeg],
    [VRMHumanBoneName.LeftLowerLeg,  VRMHumanBoneName.RightLowerLeg],
    [VRMHumanBoneName.LeftFoot,      VRMHumanBoneName.RightFoot],
    [VRMHumanBoneName.LeftToes,      VRMHumanBoneName.RightToes],
  ];
  for (const [profileId, table] of Object.entries(BONE_CONSTRAINT_PROFILES)) {
    for (const [left, right] of pairs) {
      const L = table[left];
      const R = table[right];
      assert.ok(L && R, `${profileId}: missing constraint for ${left}/${right}`);
      const expectedMin = [L.min[0], -L.max[1], -L.max[2]];
      const expectedMax = [L.max[0], -L.min[1], -L.min[2]];
      for (let i = 0; i < 3; i++) {
        assert.ok(
          Math.abs(expectedMin[i] - R.min[i]) < 1e-6 && Math.abs(expectedMax[i] - R.max[i]) < 1e-6,
          `${profileId}: ${right} axis ${i} should mirror ${left}`,
        );
      }
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
  assert.ok(merged === DEFAULT_BONE_CONSTRAINTS || merged[VRMHumanBoneName.Spine] != null);
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

test('clampClip: preserves quaternion hemisphere of the stored key', () => {
  // Retarget normalizes quaternion signs across the clip BEFORE clamping, so
  // a clamped key flipped to the canonical hemisphere would slerp the long way
  // around against its unclamped neighbours.
  const vrm   = makeMockVrm(VRMHumanBoneName.LeftLowerArm);
  const track = makeTrack(VRMHumanBoneName.LeftLowerArm, 0, 40, 0, 'YZX'); // backward bend, violates
  // Store the key in the negative hemisphere (−q), as sign normalization may.
  for (let i = 0; i < 4; i++) track.values[i] = -track.values[i];
  const stored = [...track.values];
  const clip = new THREE.AnimationClip('test', 1, [track]);

  clampClip(clip, vrm);

  const dot = stored[0] * track.values[0] + stored[1] * track.values[1]
    + stored[2] * track.values[2] + stored[3] * track.values[3];
  assert.ok(dot > 0, `clamped key flipped hemisphere (dot=${dot.toFixed(3)})`);
});

test('clampClip: uses the selected constraint profile when clamping imported clips', () => {
  // Backward elbow bend (+Y) of 12°: the default profile allows ≤10°, the
  // Mixamo Live profile is stricter and clamps to ≤6°.
  const vrm   = makeMockVrm(VRMHumanBoneName.LeftLowerArm);
  const track = makeTrack(VRMHumanBoneName.LeftLowerArm, 0, 12, 0, 'YZX');
  const clip  = new THREE.AnimationClip('test', 1, [track]);

  clampClip(clip, vrm, undefined, 'mixamoLive');

  const qt = track.values;
  const q  = new THREE.Quaternion(qt[0], qt[1], qt[2], qt[3]);
  const eu = new THREE.Euler().setFromQuaternion(q, 'YZX');
  const yDeg = eu.y * 180 / Math.PI;
  assert.ok(
    Math.abs(yDeg - 6) < 1e-3,
    `Mixamo Live import clamp should cap backward elbow bend at 6°, got ${yDeg.toFixed(1)}°`,
  );
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
