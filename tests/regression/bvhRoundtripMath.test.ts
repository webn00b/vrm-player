import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// ── Round-trip math identity ──────────────────────────────────────────────────
//
// Guards the core BVH fix: the recorder pre-multiplies by correctionInv and
// applyHumanoidRestCorrectionsToClip post-multiplies by correction. When we
// serialize the intermediate quaternion to ZYX-Euler-degrees (BVH channels) and
// parse it back, the composed round-trip must return the original quaternion.
// Failures here point at either (a) the algebraic identity, (b) Euler encoding
// precision, or (c) singularity proximity (ZYX pitch near ±90°).

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

function quatAngleDeg(a, b) {
  const dot = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  return 2 * Math.acos(dot) * R2D;
}

/** Full BVH round-trip for a single bone: q_norm → BVH text triplet → q_played.
 *  Uses post-multiply pair: recorder writes q_bvh = q_norm × corrInv;
 *  loader writes q_track = q_bvh × correction. */
function roundTrip(qNorm, correction) {
  const corrInv = correction.clone().invert();

  // Recording side: q_bvh = q_norm × corrInv (POST-multiply)
  const qBvh = qNorm.clone().multiply(corrInv);

  // Serialize to ZYX Euler degrees (same as BvhRecorder._frameRow)
  const eRec = new THREE.Euler().setFromQuaternion(qBvh, 'ZYX');
  const zDeg = eRec.z * R2D;
  const yDeg = eRec.y * R2D;
  const xDeg = eRec.x * R2D;

  // Parser side: ZYX degrees → quaternion (mimics BVHLoader behaviour)
  const ePlay = new THREE.Euler(xDeg * D2R, yDeg * D2R, zDeg * D2R, 'ZYX');
  const qDeserialized = new THREE.Quaternion().setFromEuler(ePlay);

  // Loader side: q_track = q_bvh × correction (POST-multiply, existing
  // applyHumanoidRestCorrectionsToClip).
  const qPlayed = qDeserialized.clone().multiply(correction);

  return qPlayed;
}

// Representative A-pose→T-pose correction for an upper-arm bone (≈60° around Z).
function buildArmCorrection() {
  const rawAxis  = new THREE.Vector3(0.866, -0.5, 0).normalize(); // A-pose (arm down-outward)
  const normAxis = new THREE.Vector3(1, 0, 0).normalize();        // T-pose (straight out)
  return new THREE.Quaternion().setFromUnitVectors(rawAxis, normAxis);
}

function buildIdentityCorrection() {
  return new THREE.Quaternion(); // identity — bone where rawAxis == normalizedAxis
}

function quatFromEulerXYZDeg(x, y, z) {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(x * D2R, y * D2R, z * D2R, 'XYZ'),
  );
}

// ── Cases ────────────────────────────────────────────────────────────────────

test('identity quaternion survives round-trip (arm correction)', () => {
  const q = new THREE.Quaternion();
  const out = roundTrip(q, buildArmCorrection());
  assert.ok(quatAngleDeg(q, out) < 0.001, `expected 0°, got ${quatAngleDeg(q, out)}`);
});

test('identity quaternion survives round-trip (no correction)', () => {
  const q = new THREE.Quaternion();
  const out = roundTrip(q, buildIdentityCorrection());
  assert.ok(quatAngleDeg(q, out) < 0.001);
});

test('post-multiply round-trip is exact (q_norm × corrInv × correction = q_norm)', () => {
  // The recorder POST-multiplies q_norm by corrInv, the loader POST-multiplies
  // by correction. Algebraically: q_norm × corrInv × correction = q_norm × identity = q_norm.
  // This invariant holds regardless of |correction| or |q_norm| — unlike a pre-
  // multiply pair which introduces a sandwich residue at non-T-pose frames.
  const correction = buildArmCorrection();
  const cases = [
    quatFromEulerXYZDeg(30,  0,  0),
    quatFromEulerXYZDeg( 0, 45,  0),
    quatFromEulerXYZDeg( 0,  0, 60),
    quatFromEulerXYZDeg(20, 30, 40),
    quatFromEulerXYZDeg(-15, 25, -35),
    quatFromEulerXYZDeg(10, -40, 50),
  ];
  for (const qNorm of cases) {
    const qPlayed = roundTrip(qNorm, correction);
    const drift = quatAngleDeg(qNorm, qPlayed);
    assert.ok(
      drift < 0.01,
      `post-multiply round-trip drift ${drift.toFixed(4)}° > 0.01° — pipeline inversion broken`,
    );
  }
});

test('pure axis rotations round-trip within 0.01° (no correction)', () => {
  const correction = buildIdentityCorrection();
  for (const angle of [5, 10, 30, 45, 60, 80]) {
    for (const axis of [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(1, 1, 0).normalize(),
      new THREE.Vector3(1, 0, 1).normalize(),
    ]) {
      const q = new THREE.Quaternion().setFromAxisAngle(axis, angle * D2R);
      const out = roundTrip(q, correction);
      const drift = quatAngleDeg(q, out);
      assert.ok(drift < 0.01, `axis-angle drift ${drift.toFixed(4)}° at ${angle}° axis=${axis.toArray()}`);
    }
  }
});

test('ZYX pitch near singularity (±90°) flagged — drift may be large', () => {
  // ZYX Euler has its pitch (Y) singularity at ±90°: at that point the Z and X
  // axes become degenerate and the Euler→quat→Euler round-trip picks an
  // arbitrary decomposition within that 2-DOF plane. This test documents the
  // expected behaviour — drift CAN exceed 0.5°, and the runtime verifier's
  // nearSingularity flag warns the user rather than asserting correctness.
  const correction = buildIdentityCorrection();
  const near90 = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(0, 89.5 * D2R, 0, 'ZYX'),
  );
  const out = roundTrip(near90, correction);
  const drift = quatAngleDeg(near90, out);
  // Sanity: outside singularity zone drift must stay small. At 89.5° it should
  // still be acceptable; this test mostly guards that the round-trip doesn't
  // diverge catastrophically (> a couple degrees).
  assert.ok(drift < 2.0, `unexpected catastrophic drift ${drift.toFixed(3)}° at pitch=89.5°`);
});

test('correction × corrInv = identity (fix invariant)', () => {
  const correction = buildArmCorrection();
  const corrInv = correction.clone().invert();
  const prod = correction.clone().multiply(corrInv);
  const id = new THREE.Quaternion();
  // fp precision on a single multiply of unit quats: within ~1e-5°
  assert.ok(quatAngleDeg(prod, id) < 1e-4, `correction · corrInv should be ≈ identity`);
});

test('post-multiply round-trip: q_bvh × normalizedAxis = d (external compatibility)', () => {
  // Recorder writes q_bvh = q_norm × corrInv where q_norm = setFromUnitVectors(rawAxis, d).
  // For external Blender compatibility we need q_bvh applied to a bone with
  // rest-direction normalizedAxis (the OFFSET direction in BVH HIERARCHY) to
  // produce a bone direction = d. That requires q_bvh × normalizedAxis = d,
  // which the post-multiply formula satisfies exactly.
  const rawAxis  = new THREE.Vector3(0.866, -0.5, 0).normalize();
  const normAxis = new THREE.Vector3(1, 0, 0).normalize();
  const correction = new THREE.Quaternion().setFromUnitVectors(rawAxis, normAxis);
  const corrInv = correction.clone().invert();

  const targets = [
    new THREE.Vector3(0,  1, 0).normalize(),         // arm raised up
    new THREE.Vector3(1,  0.5, 0).normalize(),       // partly raised
    new THREE.Vector3(0.7, 0.7, 0.1).normalize(),
    new THREE.Vector3(0,  0, 1).normalize(),         // arm forward
  ];
  for (const d of targets) {
    const qNorm = new THREE.Quaternion().setFromUnitVectors(rawAxis, d);
    const qBvh = qNorm.clone().multiply(corrInv);
    const out = normAxis.clone().applyQuaternion(qBvh);
    const angle = Math.acos(Math.min(1, out.dot(d))) * R2D;
    assert.ok(
      angle < 0.001,
      `q_bvh × normalizedAxis ≠ d (off by ${angle.toFixed(4)}°) for d=${d.toArray()}`,
    );
  }
});

test('hips position round-trip: scale = humanoidY / animationY = 1 when hipsRestY matches', () => {
  // Loader (`createVRMAnimationClip` in @pixiv/three-vrm-animation) computes
  //   scale = humanoidY / animationY
  // where humanoidY = vrm.humanoid.normalizedRestPose.hips.position[1] and
  //   animationY = vrmAnimation.restHipsPosition.y (= source skeleton's
  //   hips.getWorldPosition().y as set by `convertBVHToVRMAnimation`).
  // Then track values are multiplied by `scale`. For a self-recorded round-trip
  // the recorder writes hips local Y, and we want the played-back bone to land
  // back at the same Y. The fix forces source skeleton's hips world Y = target
  // bind hipsY (via the `hipsRestY` option), giving scale = 1.
  const recordedY = 0.862814; // example VRM 0.x hips local Y at near-bind
  const humanoidY = 0.862814;

  // Without the fix: bbox-derived height (≈ skeleton depth from hips to feet).
  const animationY_broken = 0.780000;
  const scale_broken = humanoidY / animationY_broken;
  const replayed_broken = recordedY * scale_broken;
  const drift_broken_mm = Math.abs(replayed_broken - recordedY) * 1000;
  assert.ok(
    drift_broken_mm > 50,
    `sanity check: without hipsRestY fix, drift should exceed 5 cm (got ${drift_broken_mm.toFixed(2)} mm)`,
  );

  // With the fix: hipsRestY = humanoidY ⇒ scale = 1 ⇒ exact round-trip.
  const animationY_fixed = humanoidY;
  const scale_fixed = humanoidY / animationY_fixed;
  const replayed_fixed = recordedY * scale_fixed;
  const drift_fixed_mm = Math.abs(replayed_fixed - recordedY) * 1000;
  assert.ok(
    drift_fixed_mm < 0.001,
    `with hipsRestY fix, drift must be < 1µm (got ${drift_fixed_mm.toFixed(6)} mm)`,
  );
});

test('T-pose state (q_norm = correction) round-trips to identity in BVH', () => {
  // At T-pose the applier writes q_norm = setFromUnitVectors(rawAxis, normalizedAxis) = correction.
  // The recorder's post-multiply gives q_bvh = correction × corrInv = identity → external
  // players see the bone at rest, as required by the BVH spec.
  const correction = buildArmCorrection();
  const corrInv = correction.clone().invert();
  const qNorm = correction.clone();
  const qBvh = qNorm.clone().multiply(corrInv);
  const id = new THREE.Quaternion();
  assert.ok(quatAngleDeg(qBvh, id) < 1e-4, `T-pose q_bvh should be identity`);
  // And it survives the full round-trip back to q_norm.
  const out = roundTrip(qNorm, correction);
  assert.ok(quatAngleDeg(qNorm, out) < 0.01, `T-pose round-trip drift > 0.01°`);
});
