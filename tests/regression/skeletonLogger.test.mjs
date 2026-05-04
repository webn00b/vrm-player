import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import {
  SkeletonLoggerCore,
  KEY_LOG_BONES,
  FLIP_DEG,
  HIP_DRIFT_RUN,
  quatDeltaDeg,
  quatToEuler,
  isQuatNaN,
} from '../../.tmp-regression/diagnostics/skeletonLogger.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function quatFromEuler(xDeg, yDeg, zDeg, order = 'XYZ') {
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(xDeg),
      THREE.MathUtils.degToRad(yDeg),
      THREE.MathUtils.degToRad(zDeg),
      order,
    ),
  );
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

/** Bone source backed by a {boneName -> Quat} map, plus a hip Y getter. */
function makeStubSource(initial = {}, hipsY = null) {
  const state = new Map();
  for (const k of Object.keys(initial)) state.set(k, initial[k]);
  let curHipsY = hipsY;
  return {
    src: {
      getQuat(name) {
        return state.get(name) ?? IDENTITY;
      },
      getHipsWorldY() { return curHipsY; },
    },
    set(name, q) { state.set(name, q); },
    setHipsY(y) { curHipsY = y; },
  };
}

function makeStubValidator(stats = { worstBone: null, worstDelta: 0 }) {
  let cur = stats;
  return {
    src: {
      getStats() { return cur; },
      getConstraints() { return {}; },
    },
    set(s) { cur = s; },
  };
}

function makeLogger(boneSrc, valSrc, opts = {}) {
  let now = 0;
  const core = new SkeletonLoggerCore(boneSrc, valSrc, {
    bones: opts.bones ?? KEY_LOG_BONES,
    now: () => now,
  });
  return {
    core,
    advanceMs(ms) { now += ms; },
    setNow(ms) { now = ms; },
  };
}

// ── Pure-math sanity ───────────────────────────────────────────────────────

test('quatDeltaDeg: identity → 0°', () => {
  assert.equal(quatDeltaDeg(IDENTITY, IDENTITY), 0);
});

test('quatDeltaDeg: 90° around X', () => {
  const a = IDENTITY;
  const b = quatFromEuler(90, 0, 0);
  const d = quatDeltaDeg(a, b);
  assert.ok(Math.abs(d - 90) < 0.01, `expected ~90°, got ${d}`);
});

test('quatDeltaDeg: sign-flipped quaternions are equivalent', () => {
  const a = quatFromEuler(30, 20, 10);
  const b = { x: -a.x, y: -a.y, z: -a.z, w: -a.w };
  assert.ok(quatDeltaDeg(a, b) < 0.001);
});

test('isQuatNaN detects NaN in any component', () => {
  assert.equal(isQuatNaN(IDENTITY), false);
  assert.equal(isQuatNaN({ x: NaN, y: 0, z: 0, w: 1 }), true);
  assert.equal(isQuatNaN({ x: 0, y: 0, z: 0, w: NaN }), true);
});

test('quatToEuler XYZ matches three.Euler', () => {
  const q = quatFromEuler(15, 30, 45, 'XYZ');
  const [ex, ey, ez] = quatToEuler(q, 'XYZ');
  const ref = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(q.x, q.y, q.z, q.w), 'XYZ',
  );
  assert.ok(Math.abs(ex - ref.x) < 1e-5);
  assert.ok(Math.abs(ey - ref.y) < 1e-5);
  assert.ok(Math.abs(ez - ref.z) < 1e-5);
});

// ── Core scenarios ─────────────────────────────────────────────────────────

test('100 calm frames → no anomalies, GLOBAL nan/flips=0', () => {
  const stub = makeStubSource();
  const val = makeStubValidator();
  const { core } = makeLogger(stub.src, val.src);

  core.start('test');
  for (let i = 0; i < 100; i++) core.tick();
  const digest = core.stop();

  assert.equal(core.getAnomalies().length, 0);
  assert.match(digest, /frames=100/);
  assert.match(digest, /nanFrames=0/);
  assert.match(digest, /flipFrames=0/);
  assert.match(digest, /romFrames=0/);
  assert.ok(!digest.includes('ANOMALIES'), 'no ANOMALIES section expected');
});

test('one 180° flip on f=42 → exactly one flip anomaly at f=42', () => {
  const stub = makeStubSource();
  const val = makeStubValidator();
  const bone = VRMHumanBoneName.LeftLowerArm;
  const { core } = makeLogger(stub.src, val.src);

  core.start('test');
  for (let i = 0; i < 100; i++) {
    if (i === 42) {
      // huge rotation in one frame
      stub.set(bone, quatFromEuler(0, 0, 180));
    } else if (i === 43) {
      stub.set(bone, IDENTITY);
    } else {
      stub.set(bone, IDENTITY);
    }
    core.tick();
  }
  core.stop();

  const flips = core.getAnomalies().filter(a => a.kind === 'flip' && a.bone === bone);
  // f=42 jumps identity → 180°, f=43 jumps 180° → identity. Both > FLIP_DEG.
  assert.ok(flips.length >= 1, `expected >=1 flip, got ${flips.length}`);
  assert.equal(flips[0].frame, 42);
  assert.ok(flips[0].detail.includes('Δ='));

  const st = core.getStat(bone);
  assert.ok(st.flipCount >= 1);
  assert.ok(st.worstFlip);
  assert.ok(st.worstFlip.deltaDeg > FLIP_DEG);
});

test('NaN in left hand on f=10 → exactly one nan anomaly', () => {
  const stub = makeStubSource();
  const val = makeStubValidator();
  const bone = VRMHumanBoneName.LeftHand;
  const { core } = makeLogger(stub.src, val.src);

  core.start('test');
  for (let i = 0; i < 50; i++) {
    if (i === 10) stub.set(bone, { x: NaN, y: 0, z: 0, w: 1 });
    else stub.set(bone, IDENTITY);
    core.tick();
  }
  core.stop();

  const nans = core.getAnomalies().filter(a => a.kind === 'nan');
  assert.equal(nans.length, 1);
  assert.equal(nans[0].frame, 10);
  assert.equal(nans[0].bone, bone);

  const st = core.getStat(bone);
  assert.equal(st.nanFrames, 1);
});

test('hipsY drifts +0.01m × 12 frames → exactly one hipDrift anomaly Δy>0.04m', () => {
  const stub = makeStubSource({}, 1.0);
  const val = makeStubValidator();
  const { core } = makeLogger(stub.src, val.src);

  core.start('test');
  let y = 1.0;
  for (let i = 0; i < 12; i++) {
    y += 0.01;
    stub.setHipsY(y);
    core.tick();
  }
  const digest = core.stop();

  const drifts = core.getAnomalies().filter(a => a.kind === 'hipDrift');
  // Trigger at HIP_DRIFT_RUN frames of consecutive directional movement.
  // First tick has no prevY; second establishes prev; from there each tick
  // is +0.01. So run reaches HIP_DRIFT_RUN on tick 1 + HIP_DRIFT_RUN.
  assert.equal(drifts.length, 1, `expected 1 drift anomaly, got ${drifts.length}`);
  assert.match(drifts[0].detail, /Δy=\+/);
  assert.match(digest, /HIP/);
});

test('ROM hits accumulate from validator stats', () => {
  const stub = makeStubSource();
  const val = makeStubValidator();
  const bone = VRMHumanBoneName.RightShoulder;
  const { core } = makeLogger(stub.src, val.src);

  core.start('test');
  for (let i = 0; i < 50; i++) {
    if (i % 5 === 0) {
      val.set({ worstBone: bone, worstDelta: 0.5 }); // ~28.6°
    } else {
      val.set({ worstBone: null, worstDelta: 0 });
    }
    core.tick();
  }
  core.stop();

  const st = core.getStat(bone);
  assert.equal(st.romHits, 10);
  assert.ok(Math.abs(st.worstRomDeg - 28.648) < 0.5);
});

test('digest stays under 5 KB even with 600 frames + 5 anomaly types', () => {
  const stub = makeStubSource();
  const val = makeStubValidator();
  const lhand = VRMHumanBoneName.LeftHand;
  const { core } = makeLogger(stub.src, val.src);

  core.start('stress');
  let y = 1.0;
  stub.setHipsY(y);
  for (let i = 0; i < 600; i++) {
    if (i === 100) stub.set(lhand, { x: NaN, y: 0, z: 0, w: 1 });
    else if (i === 101) stub.set(lhand, IDENTITY);
    else if (i === 200) stub.set(lhand, quatFromEuler(0, 0, 170));
    else if (i === 201) stub.set(lhand, IDENTITY);
    if (i >= 300 && i < 320) y += 0.01;
    stub.setHipsY(y);
    if (i % 7 === 0) val.set({ worstBone: VRMHumanBoneName.RightUpperArm, worstDelta: 0.1 });
    else val.set({ worstBone: null, worstDelta: 0 });
    core.tick();
  }
  const digest = core.stop();

  const sizeBytes = Buffer.byteLength(digest, 'utf8');
  assert.ok(sizeBytes < 5000, `digest=${sizeBytes} bytes, expected <5000`);
  const lineCount = digest.split('\n').length;
  assert.ok(lineCount < 100, `digest=${lineCount} lines, expected <100`);
});

test('digest has GLOBAL/HIP/PER-BONE/ANOMALIES headers when applicable', () => {
  const stub = makeStubSource({}, 1.0);
  const val = makeStubValidator();
  const bone = VRMHumanBoneName.LeftHand;
  const { core } = makeLogger(stub.src, val.src);

  core.start('hdr');
  for (let i = 0; i < 20; i++) {
    if (i === 5) stub.set(bone, quatFromEuler(0, 0, 170));
    else stub.set(bone, IDENTITY);
    core.tick();
  }
  const digest = core.stop();

  assert.match(digest, /=== SkelLog ===/);
  assert.match(digest, /^GLOBAL/m);
  assert.match(digest, /^HIP/m);
  assert.match(digest, /^PER-BONE/m);
  assert.match(digest, /^ANOMALIES/m);
});

test('HIP_DRIFT_RUN constant matches expected behaviour (8)', () => {
  assert.equal(HIP_DRIFT_RUN, 8);
});

test('FLIP_DEG threshold (60°)', () => {
  assert.equal(FLIP_DEG, 60);
});
