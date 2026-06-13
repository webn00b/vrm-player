#!/usr/bin/env node
/**
 * anatomy-check — reference-free plausibility audit of a BVH animation.
 *
 *   node tools/anatomy-check.mjs <recording.bvh>
 *
 * No video, no ground truth: catches the defect CLASSES this pipeline has
 * actually shipped — from the skeleton alone. Forward kinematics via stock
 * BVHLoader; VRM humanoids face -Z, up is +Y.
 *
 * Checks:
 *   - backward knee  : knee sits behind the hip→ankle chord (hinge bends the
 *                      wrong way) while the leg is meaningfully bent.
 *   - torso lean back: hips→chest tilts backward beyond a threshold, held.
 *   - foot skate     : planted foot (near ground) slides horizontally.
 *   - pose jump      : any tracked joint's frame-to-frame angular speed spikes.
 *
 * (No elbow hinge check: unlike the knee, the whole arm rotates freely, so an
 * elbow "behind" the shoulder→wrist chord is normal in countless poses — the
 * test fired on ~all frames and carried no signal.)
 *
 * Output: per-check violation rate + worst frames, and an overall anatomy
 * score (mean violations per frame; 0 = clean). Use for automated regression
 * detection on any video's output.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';

const bvhPath = process.argv[2];
if (!bvhPath) { console.log('Usage: node tools/anatomy-check.mjs <recording.bvh>'); process.exit(1); }

const result = new BVHLoader().parse(readFileSync(bvhPath, 'utf8'));
const root = new THREE.Group();
root.add(result.skeleton.bones[0]);
const mixer = new THREE.AnimationMixer(root);
mixer.clipAction(result.clip).play();
const byName = new Map(result.skeleton.bones.map((b) => [b.name, b]));
const n = Number(readFileSync(bvhPath, 'utf8').match(/Frames:\s*(\d+)/)[1]);
const frameTime = result.clip.duration / Math.max(1, n - 1);

const pos = (name, out) => byName.get(name).getWorldPosition(out);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3();

// Knee/elbow "behind the chord" depth offset (+ = behind in VRM -Z forward).
// chord = far - root; offset = mid - root projected off the chord; return z.
function hingeBackOffset(rootP, midP, farP) {
  _t.subVectors(farP, rootP);
  const len2 = _t.lengthSq();
  if (len2 < 1e-9) return { back: 0, bend: 0 };
  _b.subVectors(midP, rootP);
  const proj = _b.dot(_t) / len2;
  _c.copy(_t).multiplyScalar(proj);
  _b.sub(_c); // perpendicular offset of the mid joint from the chord
  // +z is backward for a VRM facing -Z, so back-offset = +_b.z.
  return { back: _b.z, bend: _b.length() };
}

const KNEE_BEND_MIN = 0.05;   // m perpendicular — ignore near-straight legs
const KNEE_BACK_MIN = 0.04;   // m behind the chord to count as a wrong-way bend
const LEAN_BACK_DEG = 8;      // hips→chest backward tilt to flag
const SKATE_GROUND = 0.03;    // m above lowest foot rest to count as planted
const SKATE_SPEED = 0.025;    // m/frame horizontal slide while planted
const JUMP_DEG = 35;          // deg/frame joint angular speed spike

// Capture per-frame world data.
const frames = [];
const up = new THREE.Vector3(0, 1, 0);
let groundY = Infinity;
for (let i = 0; i < n; i++) {
  mixer.setTime(i * frameTime);
  root.updateMatrixWorld(true);
  const g = {};
  for (const nm of ['hips', 'chest', 'leftFoot', 'rightFoot',
    'leftUpperLeg', 'leftLowerLeg', 'rightUpperLeg', 'rightLowerLeg',
    'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand']) {
    const v = new THREE.Vector3(); pos(nm, v); g[nm] = v;
  }
  groundY = Math.min(groundY, g.leftFoot.y, g.rightFoot.y);
  frames.push(g);
}

const checks = {
  'backward knee': [], 'torso lean back': [],
  'foot skate': [], 'pose jump': [],
};

for (let i = 0; i < n; i++) {
  const g = frames[i];
  // Knees.
  for (const [hip, knee, ankle] of [
    ['leftUpperLeg', 'leftLowerLeg', 'leftFoot'],
    ['rightUpperLeg', 'rightLowerLeg', 'rightFoot'],
  ]) {
    const h = hingeBackOffset(g[hip], g[knee], g[ankle]);
    if (h.bend > KNEE_BEND_MIN && h.back > KNEE_BACK_MIN) checks['backward knee'].push({ frame: i, v: h.back });
  }
  // Torso lean back: hips→chest direction tilt; +z = back.
  _a.subVectors(g.chest, g.hips).normalize();
  const leanDeg = (Math.atan2(_a.z, _a.y) * 180) / Math.PI;
  if (leanDeg > LEAN_BACK_DEG) checks['torso lean back'].push({ frame: i, v: leanDeg });
  // Foot skate + pose jump need the previous frame.
  if (i > 0) {
    const p = frames[i - 1];
    for (const foot of ['leftFoot', 'rightFoot']) {
      if (g[foot].y - groundY < SKATE_GROUND) {
        const dx = g[foot].x - p[foot].x, dz = g[foot].z - p[foot].z;
        const slide = Math.hypot(dx, dz);
        if (slide > SKATE_SPEED) checks['foot skate'].push({ frame: i, v: slide });
      }
    }
    for (const limb of ['leftLowerArm', 'rightLowerArm', 'leftLowerLeg', 'rightLowerLeg', 'chest']) {
      // segment angular speed via its parent-relative direction change
      const parent = { leftLowerArm: 'leftUpperArm', rightLowerArm: 'rightUpperArm',
        leftLowerLeg: 'leftUpperLeg', rightLowerLeg: 'rightUpperLeg', chest: 'hips' }[limb];
      _a.subVectors(g[limb], g[parent]); _b.subVectors(p[limb], p[parent]);
      if (_a.lengthSq() > 1e-9 && _b.lengthSq() > 1e-9) {
        const d = THREE.MathUtils.radToDeg(_a.angleTo(_b));
        if (d > JUMP_DEG) checks['pose jump'].push({ frame: i, v: d });
      }
    }
  }
}

console.log(`anatomy-check: ${bvhPath}  (${n} frames)\n`);
let totalViol = 0;
for (const [name, hits] of Object.entries(checks)) {
  totalViol += hits.length;
  const rate = ((hits.length / n) * 100).toFixed(1);
  if (!hits.length) { console.log(`  ${name.padEnd(16)} clean`); continue; }
  const worst = [...hits].sort((a, b) => b.v - a.v).slice(0, 3)
    .map((w) => `#${w.frame}(${w.v.toFixed(2)})`).join(' ');
  console.log(`  ${name.padEnd(16)} ${hits.length} hits ${rate.padStart(5)}%  worst: ${worst}`);
}
console.log(`\nanatomy score: ${(totalViol / n).toFixed(3)} violations/frame (0 = clean)`);
