#!/usr/bin/env node
/**
 * Benchmark a recorded BVH against AIST++ ground-truth 3D keypoints.
 *
 *   node tools/bvh-vs-gt.mjs <recording.bvh> <gt.json> [--offset <sec>] [--self-test]
 *
 * <gt.json> comes from tools/convert-aist-gt.py (COCO-17 keypoints, metres).
 *
 * Method:
 *   1. Forward-kinematics over the BVH via three.js BVHLoader → world
 *      positions of the 12 limb joints (shoulders/elbows/wrists/hips/knees/
 *      ankles) per frame.
 *   2. Root-relative: subtract the hip midpoint per frame on both sides
 *      (removes global translation; avatar and performer differ in size).
 *   3. Time offset search: the recording starts at the calibration preroll,
 *      not at video t=0. Scan offsets, keep the best-aligned one.
 *   4. Global similarity alignment (Umeyama): one rotation+scale (reflection
 *      allowed — the capture pipeline mirrors the performer) over the whole
 *      sequence. NOT per-frame Procrustes: a single global transform keeps
 *      orientation errors visible in the score.
 *   5. Report MPJPE (mean per-joint position error, mm) overall, per joint,
 *      and the worst frames.
 *
 * Both L/R joint mappings (direct and mirrored) are evaluated; the better one
 * wins and is reported.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';

// ── Joint mappings ────────────────────────────────────────────────────────────

// BVH bone origin ↔ COCO-17 joint. Bone origins sit at the joint they rotate.
const DIRECT_MAP = [
  ['leftUpperArm', 'left_shoulder'], ['rightUpperArm', 'right_shoulder'],
  ['leftLowerArm', 'left_elbow'],    ['rightLowerArm', 'right_elbow'],
  ['leftHand', 'left_wrist'],        ['rightHand', 'right_wrist'],
  ['leftUpperLeg', 'left_hip'],      ['rightUpperLeg', 'right_hip'],
  ['leftLowerLeg', 'left_knee'],     ['rightLowerLeg', 'right_knee'],
  ['leftFoot', 'left_ankle'],        ['rightFoot', 'right_ankle'],
];
// The capture pipeline mirrors the performer (selfie convention): avatar left
// follows performer right. Swap GT sides for this mapping.
const MIRROR_MAP = DIRECT_MAP.map(([bvh, coco]) => [
  bvh,
  coco.startsWith('left_') ? coco.replace('left_', 'right_') : coco.replace('right_', 'left_'),
]);

const HIP_BONES = ['leftUpperLeg', 'rightUpperLeg'];
const HIP_GT = ['left_hip', 'right_hip'];

// ── BVH forward kinematics ────────────────────────────────────────────────────

function loadBvhPositions(bvhText, boneNames) {
  const result = new BVHLoader().parse(bvhText);
  const root = new THREE.Group();
  root.add(result.skeleton.bones[0]);
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(result.clip).play();

  const byName = new Map();
  for (const bone of result.skeleton.bones) byName.set(bone.name, bone);
  for (const name of boneNames) {
    if (!byName.has(name)) throw new Error(`BVH is missing bone ${name}`);
  }

  const frameTime = result.clip.duration / Math.max(1, frameCount(bvhText) - 1);
  const frames = [];
  const v = new THREE.Vector3();
  const n = frameCount(bvhText);
  for (let i = 0; i < n; i++) {
    mixer.setTime(i * frameTime);
    root.updateMatrixWorld(true);
    const row = {};
    for (const name of boneNames) {
      byName.get(name).getWorldPosition(v);
      row[name] = [v.x, v.y, v.z];
    }
    frames.push(row);
  }
  return { frames, fps: 1 / frameTime };
}

function frameCount(bvhText) {
  const m = bvhText.match(/Frames:\s*(\d+)/);
  if (!m) throw new Error('BVH has no Frames header');
  return Number(m[1]);
}

// ── GT sampling ───────────────────────────────────────────────────────────────

function gtAt(gt, timeSec, jointIdx) {
  const f = timeSec * gt.fps;
  const i0 = Math.floor(f);
  const i1 = Math.min(i0 + 1, gt.frames.length - 1);
  if (i0 < 0 || i0 >= gt.frames.length) return null;
  const t = f - i0;
  const a = gt.frames[i0][jointIdx];
  const b = gt.frames[i1][jointIdx];
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

// ── Umeyama similarity alignment (rotation + scale, reflection allowed) ───────

function jacobiEigen3(S) {
  // Symmetric 3x3 eigen-decomposition by cyclic Jacobi rotations.
  const a = S.map((row) => row.slice());
  let V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) off += a[p][q] * a[p][q];
    if (off < 1e-18) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-15) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq;
        V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: V };
}

function matMul(A, B) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) C[i][j] += A[i][k] * B[k][j];
  return C;
}
const transpose = (A) => A[0].map((_, j) => A.map((row) => row[j]));
const det3 = (A) =>
  A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
  A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
  A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);

/**
 * Find s, R minimizing Σ ||s·R·p − g||² over centred point pairs.
 * Reflection is permitted (det(R) may be −1) — mirrored captures align best
 * with a reflection, and we report when one was used.
 */
function umeyama(ps, gs) {
  const n = ps.length;
  // H = Σ g pᵀ / n
  const H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let pVar = 0;
  for (let i = 0; i < n; i++) {
    const p = ps[i], g = gs[i];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) H[r][c] += g[r] * p[c];
    pVar += p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
  }
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) H[r][c] /= n;
  pVar /= n;

  // SVD via eigen-decomposition of HᵀH = V Σ² Vᵀ, U = H V Σ⁻¹.
  const HtH = matMul(transpose(H), H);
  const { values, vectors } = jacobiEigen3(HtH);
  const order = [0, 1, 2].sort((a, b) => values[b] - values[a]);
  const sig = order.map((i) => Math.sqrt(Math.max(0, values[i])));
  const Vm = order.map((i) => vectors.map((row) => row[i])); // rows = v_i
  const V = transpose(Vm);
  const U = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    const vi = Vm[i];
    const hv = [
      H[0][0] * vi[0] + H[0][1] * vi[1] + H[0][2] * vi[2],
      H[1][0] * vi[0] + H[1][1] * vi[1] + H[1][2] * vi[2],
      H[2][0] * vi[0] + H[2][1] * vi[1] + H[2][2] * vi[2],
    ];
    const s = sig[i] > 1e-12 ? sig[i] : 1;
    for (let r = 0; r < 3; r++) U[r][i] = hv[r] / s;
  }
  // Reflection-allowed optimum: R = U Vᵀ as-is.
  const R = matMul(U, transpose(V));
  const trace = sig[0] + sig[1] + sig[2];
  const scale = pVar > 1e-12 ? trace / pVar : 1;
  return { R, scale, reflected: det3(R) < 0 };
}

const applySim = (R, s, p) => [
  s * (R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2]),
  s * (R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2]),
  s * (R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2]),
];

// ── Pair extraction ───────────────────────────────────────────────────────────

function collectPairs(bvh, gt, map, offsetSec, stride = 1) {
  const gtIdx = Object.fromEntries(gt.joints.map((name, i) => [name, i]));
  const hipGtIdx = HIP_GT.map((j) => gtIdx[j]);
  const pairs = []; // { joint, frame, p:[3], g:[3] }
  for (let i = 0; i < bvh.frames.length; i += stride) {
    const t = offsetSec + i / bvh.fps;
    const g0 = gtAt(gt, t, hipGtIdx[0]);
    const g1 = gtAt(gt, t, hipGtIdx[1]);
    if (!g0 || !g1) continue;
    const gRoot = [(g0[0] + g1[0]) / 2, (g0[1] + g1[1]) / 2, (g0[2] + g1[2]) / 2];
    const row = bvh.frames[i];
    const b0 = row[HIP_BONES[0]];
    const b1 = row[HIP_BONES[1]];
    const pRoot = [(b0[0] + b1[0]) / 2, (b0[1] + b1[1]) / 2, (b0[2] + b1[2]) / 2];
    for (const [bone, coco] of map) {
      const p = row[bone];
      const g = gtAt(gt, t, gtIdx[coco]);
      if (!g) continue;
      pairs.push({
        joint: bone,
        frame: i,
        p: [p[0] - pRoot[0], p[1] - pRoot[1], p[2] - pRoot[2]],
        g: [g[0] - gRoot[0], g[1] - gRoot[1], g[2] - gRoot[2]],
      });
    }
  }
  return pairs;
}

function evaluate(pairs) {
  const { R, scale, reflected } = umeyama(pairs.map((x) => x.p), pairs.map((x) => x.g));
  let sum = 0;
  const perJoint = new Map();
  const perFrame = new Map();
  for (const pair of pairs) {
    const q = applySim(R, scale, pair.p);
    const e = Math.hypot(q[0] - pair.g[0], q[1] - pair.g[1], q[2] - pair.g[2]);
    sum += e;
    perJoint.set(pair.joint, (perJoint.get(pair.joint) ?? []).concat(e));
    perFrame.set(pair.frame, (perFrame.get(pair.frame) ?? 0) + e);
  }
  return { mpjpeM: sum / pairs.length, R, scale, reflected, perJoint, perFrame };
}

// ── Self-test ─────────────────────────────────────────────────────────────────

function selfTest() {
  // Recover a known rotation+scale+reflection from synthetic points.
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, -1.1, 0.7));
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  const ps = [];
  const gs = [];
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
  for (let i = 0; i < 200; i++) {
    const p = new THREE.Vector3(rand(), rand(), rand());
    const g = p.clone().applyMatrix4(m).multiplyScalar(1.7);
    g.x = -g.x; // reflection
    ps.push([p.x, p.y, p.z]);
    gs.push([g.x, g.y, g.z]);
  }
  const { R, scale, reflected } = umeyama(ps, gs);
  let err = 0;
  for (let i = 0; i < ps.length; i++) {
    const t = applySim(R, scale, ps[i]);
    err = Math.max(err, Math.hypot(t[0] - gs[i][0], t[1] - gs[i][1], t[2] - gs[i][2]));
  }
  console.log(`self-test: scale=${scale.toFixed(4)} (want 1.7) reflected=${reflected} maxErr=${err.toExponential(2)}`);
  if (Math.abs(scale - 1.7) > 1e-3 || !reflected || err > 1e-6) {
    console.error('SELF-TEST FAILED');
    process.exit(1);
  }
  console.log('self-test OK');
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  selfTest();
  process.exit(0);
}
if (args.length < 2) {
  console.log('Usage: node tools/bvh-vs-gt.mjs <recording.bvh> <gt.json> [--offset <sec>] [--self-test]');
  process.exit(1);
}

const bvhText = readFileSync(args[0], 'utf8');
const gt = JSON.parse(readFileSync(args[1], 'utf8'));
const fixedOffset = args.includes('--offset') ? Number(args[args.indexOf('--offset') + 1]) : null;

const boneNames = [...new Set(DIRECT_MAP.map(([b]) => b).concat(HIP_BONES))];
const bvh = loadBvhPositions(bvhText, boneNames);
console.log(`BVH: ${bvh.frames.length} frames @ ${bvh.fps.toFixed(1)} fps;  GT: ${gt.frames.length} frames @ ${gt.fps} fps`);

// Offset search (coarse stride for speed), then full evaluation at the best.
// AIST videos and GT are frame-synchronized, and the recording starts at the
// calibration preroll (1.5 s) — so the physical offset is 1.5 ± a frame or
// two. Search ONLY a tight window around it at fine resolution: repetitive
// dance motion (AIST sBM loops) reliably pulls a wide search onto the wrong
// repeat, silently inflating MPJPE by ~3× (measured). Use --offset for
// non-default prerolls.
const offsets = fixedOffset !== null
  ? [fixedOffset]
  : Array.from({ length: 121 }, (_, i) => 1.25 + i / 240); // 1.25..1.75 s

console.warn('offset search window: 1.25..1.75s (preroll-anchored); pass --offset to override');
let best = null;
for (const map of [DIRECT_MAP, MIRROR_MAP]) {
  for (const offset of offsets) {
    const pairs = collectPairs(bvh, gt, map, offset, 5);
    if (pairs.length < 60) continue;
    const r = evaluate(pairs);
    if (!best || r.mpjpeM < best.mpjpeM) {
      best = { ...r, offset, map };
    }
  }
}
if (!best) {
  console.error('No overlapping frames between BVH and GT — check the offset range.');
  process.exit(1);
}

const full = evaluate(collectPairs(bvh, gt, best.map, best.offset, 1));
const mirrored = best.map === MIRROR_MAP;

console.log(`\noffset=${best.offset.toFixed(3)}s  mapping=${mirrored ? 'mirrored (L↔R)' : 'direct'}  ` +
  `scale=${full.scale.toFixed(3)}  reflection=${full.reflected}`);
console.log(`\nMPJPE (root-relative, global similarity aligned): ${(full.mpjpeM * 1000).toFixed(1)} mm\n`);

console.log('per joint (mean / p95, mm):');
const jointRows = [...full.perJoint.entries()].map(([name, errs]) => {
  errs.sort((a, b) => a - b);
  const mean = errs.reduce((s, e) => s + e, 0) / errs.length;
  const p95 = errs[Math.floor(errs.length * 0.95)];
  return { name, mean, p95 };
}).sort((a, b) => b.mean - a.mean);
for (const r of jointRows) {
  console.log(`  ${r.name.padEnd(16)} ${(r.mean * 1000).toFixed(1).padStart(7)}  ${(r.p95 * 1000).toFixed(1).padStart(7)}`);
}

const jointCount = best.map.length;
const worst = [...full.perFrame.entries()]
  .map(([frame, total]) => ({ frame, mm: (total / jointCount) * 1000 }))
  .sort((a, b) => b.mm - a.mm)
  .slice(0, 5);
console.log('\nworst frames (frame @sec → mean mm):');
for (const w of worst) {
  console.log(`  #${w.frame} @${(best.offset + w.frame / bvh.fps).toFixed(2)}s → ${w.mm.toFixed(1)}`);
}

// ── Segment-direction error ──────────────────────────────────────────────────
// MPJPE conflates pose error with avatar-vs-human PROPORTION mismatch: a
// correctly-posed avatar with shorter forearms still misses the GT wrist.
// Bone-direction angles are proportion-invariant — this is the honest measure
// of the retarget itself.
const SEGMENTS = [
  ['upper arm L', 'leftUpperArm', 'leftLowerArm', 'left_shoulder', 'left_elbow'],
  ['upper arm R', 'rightUpperArm', 'rightLowerArm', 'right_shoulder', 'right_elbow'],
  ['forearm L', 'leftLowerArm', 'leftHand', 'left_elbow', 'left_wrist'],
  ['forearm R', 'rightLowerArm', 'rightHand', 'right_elbow', 'right_wrist'],
  ['thigh L', 'leftUpperLeg', 'leftLowerLeg', 'left_hip', 'left_knee'],
  ['thigh R', 'rightUpperLeg', 'rightLowerLeg', 'right_hip', 'right_knee'],
  ['shin L', 'leftLowerLeg', 'leftFoot', 'left_knee', 'left_ankle'],
  ['shin R', 'rightLowerLeg', 'rightFoot', 'right_knee', 'right_ankle'],
];
const gtIdx2 = Object.fromEntries(gt.joints.map((name, i) => [name, i]));
const mirrorName = (n) => (mirrored
  ? (n.startsWith('left_') ? n.replace('left_', 'right_') : n.replace('right_', 'left_'))
  : n);
const segAngles = new Map(SEGMENTS.map((s) => [s[0], []]));
for (let i = 0; i < bvh.frames.length; i++) {
  const t = best.offset + i / bvh.fps;
  const row = bvh.frames[i];
  for (const [label, boneA, boneB, gtA, gtB] of SEGMENTS) {
    const ga = gtAt(gt, t, gtIdx2[mirrorName(gtA)]);
    const gb = gtAt(gt, t, gtIdx2[mirrorName(gtB)]);
    if (!ga || !gb) continue;
    const p = applySim(full.R, 1, [
      row[boneB][0] - row[boneA][0],
      row[boneB][1] - row[boneA][1],
      row[boneB][2] - row[boneA][2],
    ]);
    const g = [gb[0] - ga[0], gb[1] - ga[1], gb[2] - ga[2]];
    const pn = Math.hypot(...p);
    const gn = Math.hypot(...g);
    if (pn < 1e-9 || gn < 1e-9) continue;
    const dot = (p[0] * g[0] + p[1] * g[1] + p[2] * g[2]) / (pn * gn);
    segAngles.get(label).push(Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI);
  }
}
console.log('\nsegment DIRECTION error (proportion-invariant; mean° / p95°):');
let dirSum = 0, dirCount = 0;
for (const [label, angles] of segAngles) {
  if (!angles.length) continue;
  angles.sort((a, b) => a - b);
  const mean = angles.reduce((s, a) => s + a, 0) / angles.length;
  dirSum += mean; dirCount++;
  console.log(`  ${label.padEnd(14)} ${mean.toFixed(1).padStart(6)}  ${angles[Math.floor(angles.length * 0.95)].toFixed(1).padStart(6)}`);
}
console.log(`  ${'MEAN'.padEnd(14)} ${(dirSum / dirCount).toFixed(1).padStart(6)}`);
