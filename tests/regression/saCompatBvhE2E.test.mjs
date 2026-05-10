import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import { BvhRecorder, BVH_JOINTS } from '../../.tmp-regression/mocap/bvhRecorder.js';
import { FIXTURE_OFFSETS } from './_fixtures/saSkeletonOffsets.mjs';

// ── End-to-end no-visual BVH-compat test ────────────────────────────────────
//
// Pairs `tests/regression/saCompatBvh.test.mjs` (which exercises the math
// conventions inline) with a true round-trip through the REAL `BvhRecorder`
// implementation and the stock three.js `BVHLoader.parse()` (which is
// functionally identical to SystemAnimator's `three.js/loaders/_BVHLoader.js`).
//
// Catches any divergence between our math test's inline helpers and the
// shipped code — channel order, Euler convention, OFFSET canonicalisation,
// hip-position scaling, end-site offsets — all observable on the BVH text
// itself, then on quaternions reconstructed by a stock loader.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

function quatAngleDeg(a, b) {
  const dot = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  return 2 * Math.acos(dot) * R2D;
}

function buildRecorder(systemAnimatorCompat) {
  return new BvhRecorder({
    getJointOffset: (name) => FIXTURE_OFFSETS[name] ?? [0, 0, 0],
    systemAnimatorCompat,
  });
}

/** Build a single Frame with all bones at identity except `boneName`. */
function makeFrame(boneName, q, hipsPos = [0, 0.9, 0]) {
  const bones = {};
  for (const j of BVH_JOINTS) bones[j.name] = [0, 0, 0, 1];
  bones[boneName] = [q.x, q.y, q.z, q.w];
  return { time: 0, bones, hipsPos };
}

/** Encode one pose, parse with stock BVHLoader, return parsed bone quaternion. */
function roundTrip(boneName, qInput, systemAnimatorCompat) {
  const rec = buildRecorder(systemAnimatorCompat);
  rec.pushFrame(makeFrame(boneName, qInput));
  const text = rec.stop();

  const loader = new BVHLoader();
  const { clip } = loader.parse(text);
  const track = clip.tracks.find((t) => t.name === `${boneName}.quaternion`);
  assert.ok(
    track && track.values.length >= 4,
    `bone ${boneName} quaternion track missing or empty in parsed clip`,
  );
  return new THREE.Quaternion(
    track.values[0], track.values[1], track.values[2], track.values[3],
  );
}

// Representative pose fixtures. Includes near-singular αX=±85° (YXZ has its
// gimbal-lock at αX=±90°) so we catch precision regressions in either Euler
// path. Tolerance is intentionally tight — float-precision drift only.
const POSE_FIXTURES = [
  { name: 'identity',         quat: new THREE.Quaternion(0, 0, 0, 1) },
  { name: '90° X',            quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0),  90 * D2R) },
  { name: '90° Y',            quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0),  90 * D2R) },
  { name: '90° Z',            quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1),  90 * D2R) },
  { name: '45° X',            quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0),  45 * D2R) },
  { name: '45° Y',            quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0),  45 * D2R) },
  { name: '45° Z',            quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1),  45 * D2R) },
  { name: '(3,-5,7)° XYZ',    quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(3 * D2R, -5 * D2R, 7 * D2R, 'XYZ')) },
  { name: 'composed YXZ',     quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(20 * D2R, 30 * D2R, 10 * D2R, 'YXZ')) },
  { name: 'arms-overhead 85°', quat: new THREE.Quaternion().setFromEuler(new THREE.Euler( 85 * D2R, 0, 0, 'YXZ')) },
  { name: 'arms-down -85°',    quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-85 * D2R, 0, 0, 'YXZ')) },
];

test('SA-compat E2E: real BvhRecorder + stock BVHLoader round-trip (leftUpperArm)', () => {
  // ~0.05° accounts for `.toFixed(4)` Euler serialisation in the writer
  // (0.0001° per channel, composed across 3 axes → ~0.03° accumulated drift
  // is normal). Stricter tolerance would force the writer to print full
  // double precision, bloating the file for no playback benefit.
  const TOLERANCE_DEG = 0.05;
  for (const { name, quat } of POSE_FIXTURES) {
    const qOut = roundTrip('leftUpperArm', quat, /*saCompat=*/true);
    const drift = quatAngleDeg(quat, qOut);
    assert.ok(
      drift < TOLERANCE_DEG,
      `[${name}] drift ${drift.toFixed(5)}° > ${TOLERANCE_DEG}° (expected round-trip identity)`,
    );
  }
});

test('SA-compat E2E: default-mode round-trip (leftUpperArm)', () => {
  // Identical fixture suite with the SA-compat flag OFF. Guards us against
  // accidentally regressing the default ZYX path while editing the SA branch.
  // ~0.05° accounts for `.toFixed(4)` Euler serialisation in the writer
  // (0.0001° per channel, composed across 3 axes → ~0.03° accumulated drift
  // is normal). Stricter tolerance would force the writer to print full
  // double precision, bloating the file for no playback benefit.
  const TOLERANCE_DEG = 0.05;
  for (const { name, quat } of POSE_FIXTURES) {
    const qOut = roundTrip('leftUpperArm', quat, /*saCompat=*/false);
    const drift = quatAngleDeg(quat, qOut);
    assert.ok(
      drift < TOLERANCE_DEG,
      `[default ${name}] drift ${drift.toFixed(5)}° > ${TOLERANCE_DEG}° (default ZYX round-trip broken)`,
    );
  }
});

test('SA-compat E2E: round-trip works for multiple bones (not just leftUpperArm)', () => {
  // ~0.05° accounts for `.toFixed(4)` Euler serialisation in the writer
  // (0.0001° per channel, composed across 3 axes → ~0.03° accumulated drift
  // is normal). Stricter tolerance would force the writer to print full
  // double precision, bloating the file for no playback benefit.
  const TOLERANCE_DEG = 0.05;
  const targetBones = ['hips', 'spine', 'leftUpperLeg', 'rightLowerArm', 'leftFoot', 'head'];
  const q45y = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 45 * D2R);
  for (const bone of targetBones) {
    const qOut = roundTrip(bone, q45y, /*saCompat=*/true);
    const drift = quatAngleDeg(q45y, qOut);
    assert.ok(
      drift < TOLERANCE_DEG,
      `[bone=${bone}] drift ${drift.toFixed(5)}° > ${TOLERANCE_DEG}°`,
    );
  }
});

// ── HIERARCHY text structure ────────────────────────────────────────────────
//
// Spot-checks on the BVH text itself so future regressions in the writer
// surface as concrete assertion failures rather than "round-trip drifted
// somewhere".

test('SA-compat E2E: HIERARCHY declares YXZ channel order on every joint', () => {
  const rec = buildRecorder(/*saCompat=*/true);
  rec.pushFrame(makeFrame('hips', new THREE.Quaternion(0, 0, 0, 1)));
  const text = rec.stop();

  // Every CHANNELS line in SA-compat mode must list Y X Z order. Match
  // both the root (6-channel with positions) and every child (3-channel).
  const channelLines = text.split('\n').filter((l) => l.trim().startsWith('CHANNELS'));
  assert.ok(channelLines.length > 0, 'no CHANNELS lines found at all?');
  for (const line of channelLines) {
    assert.match(
      line,
      /Yrotation Xrotation Zrotation\s*$/,
      `SA-compat CHANNELS line should END with "Yrotation Xrotation Zrotation": "${line.trim()}"`,
    );
  }
  // Negative guard: no ZYX-order channel lines should appear when SA-compat
  // is on. (Catches "what if both branches accidentally fire" scenarios.)
  assert.doesNotMatch(text, /Zrotation Yrotation Xrotation/);
});

test('SA-compat E2E: default mode declares ZYX channel order (regression for legacy path)', () => {
  const rec = buildRecorder(/*saCompat=*/false);
  rec.pushFrame(makeFrame('hips', new THREE.Quaternion(0, 0, 0, 1)));
  const text = rec.stop();
  const channelLines = text.split('\n').filter((l) => l.trim().startsWith('CHANNELS'));
  for (const line of channelLines) {
    assert.match(
      line,
      /Zrotation Yrotation Xrotation\s*$/,
      `default-mode CHANNELS line should END with "Zrotation Yrotation Xrotation": "${line.trim()}"`,
    );
  }
  assert.doesNotMatch(text, /Yrotation Xrotation Zrotation/);
});

test('SA-compat E2E: OFFSETs are scaled ×10 and canonicalised onto canonical axis', () => {
  const rec = buildRecorder(/*saCompat=*/true);
  rec.pushFrame(makeFrame('hips', new THREE.Quaternion(0, 0, 0, 1)));
  const text = rec.stop();

  // Helper: pull the OFFSET line that immediately follows a JOINT/ROOT
  // declaration of `boneName`.
  const lines = text.split('\n');
  function offsetOf(boneName) {
    const idx = lines.findIndex((l) => /^\s*(JOINT|ROOT)\s+/.test(l) && l.trim().endsWith(boneName));
    if (idx < 0) throw new Error(`bone ${boneName} not found in HIERARCHY`);
    // OFFSET line is `boneName { OFFSET …` — two lines after the JOINT line.
    const off = lines[idx + 2];
    const m = off.match(/OFFSET\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)/);
    assert.ok(m, `bad OFFSET line near ${boneName}: "${off}"`);
    return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
  }

  // Arm: input (-0.08, -0.01, -0.00) → length ≈ 0.0806, all on -X, scaled ×10
  const arm = offsetOf('leftUpperArm');
  assert.equal(arm[1], 0, `arm OFFSET y should be 0, got ${arm[1]}`);
  assert.equal(arm[2], 0, `arm OFFSET z should be 0, got ${arm[2]}`);
  assert.ok(arm[0] < 0, 'arm OFFSET x should preserve sign (negative for left)');
  const armLenMetres = Math.hypot(-0.08, -0.01, -0.00);
  assert.ok(
    Math.abs(Math.abs(arm[0]) - armLenMetres * 10) < 0.01,
    `arm OFFSET |x| ≈ ${armLenMetres * 10}, got ${Math.abs(arm[0])}`,
  );

  // Leg: input (0.01, -0.34, 0.01) → all on -Y, scaled ×10
  const leg = offsetOf('leftLowerLeg');
  assert.equal(leg[0], 0, `leg OFFSET x should be 0, got ${leg[0]}`);
  assert.equal(leg[2], 0, `leg OFFSET z should be 0, got ${leg[2]}`);
  assert.ok(leg[1] < 0, 'leg OFFSET y should be negative (downward)');

  // Spine: kept in XY plane (z = 0), unscaled to ×10
  const spine = offsetOf('spine');
  assert.equal(spine[2], 0, 'spine OFFSET z should be 0 (canonical XY plane)');

  // Hips: root, always (0, 0, 0) regardless of mode
  const hipsOffset = offsetOf('hips');
  assert.deepEqual(hipsOffset, [0, 0, 0], 'hips OFFSET should always be (0,0,0)');
});

test('SA-compat E2E: hip position scaled ×10 in MOTION row', () => {
  const rec = buildRecorder(/*saCompat=*/true);
  rec.pushFrame(makeFrame('hips', new THREE.Quaternion(0, 0, 0, 1), [0.12, 0.86, -0.05]));
  const text = rec.stop();

  // Locate the MOTION block and grab the single frame row.
  const motionIdx = text.indexOf('\nMOTION\n');
  assert.ok(motionIdx > 0, 'no MOTION section?');
  const lines = text.slice(motionIdx).split('\n').map((l) => l.trim()).filter(Boolean);
  // Expected layout: ["MOTION", "Frames: 1", "Frame Time: 0.0166...", "<frame>"]
  const frameRow = lines[3];
  const cols = frameRow.split(/\s+/).map(parseFloat);
  // First 3 columns are hips Xposition Yposition Zposition.
  assert.ok(Math.abs(cols[0] - 1.2)  < 0.01, `hips X ×10 should be 1.2, got ${cols[0]}`);
  assert.ok(Math.abs(cols[1] - 8.6)  < 0.01, `hips Y ×10 should be 8.6, got ${cols[1]}`);
  assert.ok(Math.abs(cols[2] + 0.5)  < 0.01, `hips Z ×10 should be -0.5, got ${cols[2]}`);
});

test('SA-compat E2E: flipBody180Y pre-rotates hips by 180° Y, leaves other bones untouched', () => {
  const TOLERANCE_DEG = 0.05;

  // Reference: hips quaternion = identity. Without flip, parsed hips should
  // also be identity. With flip ON, parsed hips should be R_Y(180°).
  const qIdentity = new THREE.Quaternion(0, 0, 0, 1);
  const qR180Y = new THREE.Quaternion(0, 1, 0, 0);

  // No flip — round-trip identity unchanged
  const recPlain = new BvhRecorder({
    getJointOffset: (name) => FIXTURE_OFFSETS[name] ?? [0, 0, 0],
    systemAnimatorCompat: true,
    flipBody180Y: false,
  });
  recPlain.pushFrame(makeFrame('hips', qIdentity));
  const textPlain = recPlain.stop();
  const hipsPlain = new BVHLoader().parse(textPlain).clip.tracks.find(
    (t) => t.name === 'hips.quaternion',
  );
  const qPlainOut = new THREE.Quaternion(
    hipsPlain.values[0], hipsPlain.values[1], hipsPlain.values[2], hipsPlain.values[3],
  );
  assert.ok(
    quatAngleDeg(qIdentity, qPlainOut) < TOLERANCE_DEG,
    `no-flip identity round-trip should stay identity, drift ${quatAngleDeg(qIdentity, qPlainOut).toFixed(4)}°`,
  );

  // Flip ON — identity input should come out as R_Y(180°)
  const recFlip = new BvhRecorder({
    getJointOffset: (name) => FIXTURE_OFFSETS[name] ?? [0, 0, 0],
    systemAnimatorCompat: true,
    flipBody180Y: true,
  });
  // Use a spine rotation too, to verify children are NOT also flipped (the
  // 180° Y inherits via forward kinematics — we shouldn't pre-rotate spine).
  const qSpine = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 10 * D2R);
  const frame = makeFrame('hips', qIdentity);
  frame.bones['spine'] = [qSpine.x, qSpine.y, qSpine.z, qSpine.w];
  recFlip.pushFrame(frame);
  const textFlip = recFlip.stop();
  const clipFlip = new BVHLoader().parse(textFlip).clip;
  const hipsFlip = clipFlip.tracks.find((t) => t.name === 'hips.quaternion');
  const qHipsOut = new THREE.Quaternion(
    hipsFlip.values[0], hipsFlip.values[1], hipsFlip.values[2], hipsFlip.values[3],
  );
  assert.ok(
    quatAngleDeg(qR180Y, qHipsOut) < TOLERANCE_DEG,
    `hips with flip should equal R_Y(180°), drift ${quatAngleDeg(qR180Y, qHipsOut).toFixed(4)}°`,
  );

  // Spine should remain its untouched 10° X rotation (NOT pre-rotated too)
  const spineFlip = clipFlip.tracks.find((t) => t.name === 'spine.quaternion');
  const qSpineOut = new THREE.Quaternion(
    spineFlip.values[0], spineFlip.values[1], spineFlip.values[2], spineFlip.values[3],
  );
  assert.ok(
    quatAngleDeg(qSpine, qSpineOut) < TOLERANCE_DEG,
    `spine should NOT be flipped (flipBody180Y is hips-only), drift ${quatAngleDeg(qSpine, qSpineOut).toFixed(4)}°`,
  );
});

test('SA-compat E2E: foot/toes End Site offset pulls leaf to ground', () => {
  const rec = buildRecorder(/*saCompat=*/true);
  rec.pushFrame(makeFrame('hips', new THREE.Quaternion(0, 0, 0, 1)));
  const text = rec.stop();
  const lines = text.split('\n');

  // Find leftFoot's End Site OFFSET. leftFoot has no children in BVH_JOINTS,
  // so the writer emits an End Site block immediately after its OFFSET +
  // CHANNELS lines, wrapping a single OFFSET row.
  const footIdx = lines.findIndex(
    (l) => /^\s*(JOINT|ROOT)\s+/.test(l) && l.trim().endsWith('leftFoot'),
  );
  assert.ok(footIdx > 0, 'leftFoot not in HIERARCHY');
  // Walk forward to End Site → OFFSET inside it
  const endSiteIdx = lines.findIndex((l, i) => i > footIdx && /^\s*End Site/.test(l));
  assert.ok(endSiteIdx > 0, 'leftFoot has no End Site');
  const offLine = lines[endSiteIdx + 2]; // skip the `{` line
  const m = offLine.match(/OFFSET\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)/);
  assert.ok(m, `bad End Site OFFSET line: "${offLine}"`);
  const [x, y, z] = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
  // leftFoot bone offset is (0.01, -0.40, 0.02) → End Site y should be
  // -bone.y × 10 = +4.0 (pulls toe up to where the body starts again),
  // x and z stay zero.
  assert.equal(x, 0, 'foot End Site x should be 0');
  assert.equal(z, 0, 'foot End Site z should be 0');
  assert.ok(Math.abs(y - 4.0) < 0.1, `foot End Site y ≈ 4.0 (-bone.y × 10), got ${y}`);
});
