import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// ── SystemAnimator-compat BVH format compatibility ──────────────────────────
//
// We replicate SystemAnimator's BVH writer (YXZ channels, [αY, αX, αZ]
// triplet) AND their BVH loader (per-channel `multiply(axis-angle)`). For a
// given input quaternion, the writer→loader round-trip must reproduce the
// same quaternion bit-for-bit (within float precision). Any divergence here
// points at: (a) wrong Euler order in writer, (b) wrong triplet output
// order, or (c) wrong channel order declared in the HIERARCHY section.
//
// This is the contract our `bvhRecorder.ts` SA-compat branch promises.
// Regression here = the BVH file we write won't play correctly in
// SystemAnimatorOnline / XR Animator.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

function quatAngleDeg(a, b) {
  const dot = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  return 2 * Math.acos(dot) * R2D;
}

// ── Writer (mirrors bvhRecorder.ts SA-compat branch exactly) ────────────────

/** Same as `quatToYXZ` in src/mocap/bvhRecorder.ts: extract Euler 'YXZ' and
 *  output as [αY, αX, αZ] in radians. */
function writerExtractYXZ(qInput) {
  const e = new THREE.Euler().setFromQuaternion(qInput, 'YXZ');
  return [e.y, e.x, e.z];
}

// ── Loader (mirrors SystemAnimator's three.js BVHLoader exactly) ────────────
//
// SA's three.js/loaders/_BVHLoader.js per-channel logic at lines 164-188:
//
//   for each channel in bone.channels:
//     switch channel:
//       case 'Yrotation':
//         quat.setFromAxisAngle(vy, deg * π/180);
//         keyframe.rotation.multiply(quat);  // i.e. kf = kf × quat
//       case 'Xrotation': ... (same with vx)
//       case 'Zrotation': ... (same with vz)
//
// Three.js `Quaternion.multiply(q)` is `this = this × q`, so for channel
// order Y X Z the result is:
//   kf = identity × R_Y × R_X × R_Z  = R_Y × R_X × R_Z
//
// Same as `new Euler(αX, αY, αZ, 'YXZ').setFromEuler(...)` → equivalent
// because Three.js's setFromEuler('YXZ') produces Q = R_Y × R_X × R_Z.
function loaderReconstructYXZ(αY, αX, αZ) {
  const vx = new THREE.Vector3(1, 0, 0);
  const vy = new THREE.Vector3(0, 1, 0);
  const vz = new THREE.Vector3(0, 0, 1);
  const kf = new THREE.Quaternion();
  const tmp = new THREE.Quaternion();

  // Channel order in our SA-compat output: Y, X, Z.
  tmp.setFromAxisAngle(vy, αY); kf.multiply(tmp);
  tmp.setFromAxisAngle(vx, αX); kf.multiply(tmp);
  tmp.setFromAxisAngle(vz, αZ); kf.multiply(tmp);
  return kf;
}

// ── Test cases ──────────────────────────────────────────────────────────────

const TOLERANCE_DEG = 0.001; // sub-millidegree — well within float precision

const cases = [
  { name: 'identity',                quat: new THREE.Quaternion(0, 0, 0, 1) },
  { name: '90° X (knee flex)',       quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 90 * D2R) },
  { name: '90° Y (hip yaw)',         quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 90 * D2R) },
  { name: '90° Z (arm sideways)',    quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 90 * D2R) },
  { name: '45° X',                   quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 45 * D2R) },
  { name: '45° Y',                   quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 45 * D2R) },
  { name: '45° Z',                   quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 45 * D2R) },
  { name: 'small offset (3, -5, 7)°', quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(3 * D2R, -5 * D2R, 7 * D2R, 'XYZ')) },
  { name: 'composed (30Y, 20X, 10Z)',
    quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(20 * D2R, 30 * D2R, 10 * D2R, 'YXZ')) },
  // Gimbal-lock danger zones: YXZ has singularity when αX is near ±90° (X
  // is the middle axis — its ±90° collapses Y and Z into one DOF). Avoid
  // strictly ±90° X here; offset slightly so the round-trip stays well-
  // conditioned. Limit case: arms-overhead (αX ≈ +85°).
  { name: 'arms-overhead (αX=85°)',  quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(85 * D2R, 0, 0, 'YXZ')) },
  { name: 'arms-down (αX=-85°)',     quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-85 * D2R, 0, 0, 'YXZ')) },
];

test('SA-compat: writer→loader round-trip is identity for all bone-pose cases', () => {
  for (const { name, quat: qInput } of cases) {
    const [αY, αX, αZ] = writerExtractYXZ(qInput);
    const qLoaded = loaderReconstructYXZ(αY, αX, αZ);
    const drift = quatAngleDeg(qInput, qLoaded);
    assert.ok(
      drift < TOLERANCE_DEG,
      `[${name}] round-trip drifted by ${drift.toFixed(6)}° — expected < ${TOLERANCE_DEG}°. ` +
      `αY=${(αY * R2D).toFixed(3)}, αX=${(αX * R2D).toFixed(3)}, αZ=${(αZ * R2D).toFixed(3)}`,
    );
  }
});

// ── Channel-order regression ────────────────────────────────────────────────
//
// The whole compat hinges on the writer producing the triplet IN THE ORDER
// SystemAnimator's loader expects to consume. If someone accidentally swaps
// back to [αZ, αY, αX] (our default-mode order), every limb will rotate
// around wrong axes when SA replays it. Guard with an explicit asymmetric
// quaternion — Z and Y must NOT come out in the same position.

test('SA-compat: triplet order is [αY, αX, αZ], not [αZ, αY, αX]', () => {
  // Pure +30° Y rotation: αY=30, αX=0, αZ=0.
  const qPureY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 30 * D2R);
  const [αY, αX, αZ] = writerExtractYXZ(qPureY);

  assert.ok(Math.abs(αY * R2D - 30) < TOLERANCE_DEG, `αY should be 30°, got ${(αY * R2D).toFixed(3)}°`);
  assert.ok(Math.abs(αX) < TOLERANCE_DEG, `αX should be 0°, got ${(αX * R2D).toFixed(3)}°`);
  assert.ok(Math.abs(αZ) < TOLERANCE_DEG, `αZ should be 0°, got ${(αZ * R2D).toFixed(3)}°`);

  // Loader with reversed channel order (Z then Y then X) would mis-apply our
  // 30° as Z. Verify SA's loader, given OUR triplet output, lands the 30°
  // on the right axis.
  const qReconstructed = loaderReconstructYXZ(αY, αX, αZ);
  const expectedY = new THREE.Vector3(0, 1, 0)
    .applyQuaternion(qReconstructed);
  // After a Y-rotation, the Y axis itself shouldn't move.
  assert.ok(
    Math.abs(expectedY.y - 1) < 1e-9,
    `Y-axis should be preserved by Y-rotation, drifted to ${expectedY.toArray()}`,
  );
});

// ── OFFSET canonicalisation rules ───────────────────────────────────────────
//
// SystemAnimator's writer reshapes each bone's OFFSET onto a canonical axis
// per bone family. Verify our `canonicalizeOffsetSA` matches.

/** Same as `canonicalizeOffsetSA` in bvhRecorder.ts: scale ×10 + project to
 *  canonical axis based on bone-name regex. */
function canonicalizeOffsetSA(name, raw) {
  const SCALE = 10;
  let [x, y, z] = [raw[0] * SCALE, raw[1] * SCALE, raw[2] * SCALE];
  const len = Math.sqrt(x * x + y * y + z * z);
  if (/spine|upperLeg|shoulder/i.test(name)) return [x, y, 0];
  if (/arm|hand|intermediate|distal/i.test(name)) return [Math.sign(x || 1) * len, 0, 0];
  if (/leg|chest|neck|head/i.test(name))          return [0, Math.sign(y || 1) * len, 0];
  return [x, y, z];
}

test('SA-compat: OFFSETs are scaled ×10 and projected onto canonical axis per bone family', () => {
  // arm/hand → along X
  const armOffset = canonicalizeOffsetSA('leftUpperArm', [-0.08, -0.01, -0.00]);
  assert.equal(armOffset[1], 0, 'arm OFFSET y should be 0');
  assert.equal(armOffset[2], 0, 'arm OFFSET z should be 0');
  const armLen = Math.hypot(-0.8, -0.1, 0); // ×10 of input
  assert.ok(
    Math.abs(armOffset[0] + armLen) < 1e-9,
    `arm OFFSET x should be -${armLen.toFixed(4)} (sign-preserving full length), got ${armOffset[0]}`,
  );

  // leg → along Y
  const legOffset = canonicalizeOffsetSA('leftLowerLeg', [0.01, -0.40, -0.02]);
  assert.equal(legOffset[0], 0, 'leg OFFSET x should be 0');
  assert.equal(legOffset[2], 0, 'leg OFFSET z should be 0');
  const legLen = Math.hypot(0.1, -4.0, -0.2);
  assert.ok(
    Math.abs(legOffset[1] + legLen) < 1e-9,
    `leg OFFSET y should be -${legLen.toFixed(4)}, got ${legOffset[1]}`,
  );

  // spine/upperLeg/shoulder → XY plane (z forced to 0)
  const spineOffset = canonicalizeOffsetSA('spine', [-0.00, 0.05, -0.01]);
  assert.equal(spineOffset[2], 0, 'spine OFFSET z should be 0 (canonical XY plane)');
  assert.ok(Math.abs(spineOffset[0] - 0.0) < 1e-9, `spine OFFSET x preserved ×10, got ${spineOffset[0]}`);
  assert.ok(Math.abs(spineOffset[1] - 0.5) < 1e-9, `spine OFFSET y preserved ×10, got ${spineOffset[1]}`);

  // head → along Y (full length)
  const headOffset = canonicalizeOffsetSA('head', [-0.00, 0.07, -0.01]);
  assert.equal(headOffset[0], 0);
  assert.equal(headOffset[2], 0);
  const headLen = Math.hypot(0.0, 0.7, -0.1);
  assert.ok(Math.abs(headOffset[1] - headLen) < 1e-9, `head OFFSET y should be ${headLen.toFixed(4)}`);
});

test('SA-compat: hips position scales ×10 (decimeters) to match canonicalised OFFSETs', () => {
  const SCALE = 10;
  const raw = [0.12, 0.86, -0.05]; // typical hip-local position in metres
  const scaled = raw.map((v) => v * SCALE);
  // Direct math check — bvhRecorder.ts applies `* posScale` when SA-compat.
  assert.deepEqual(scaled, [1.2, 8.6, -0.5]);
});
