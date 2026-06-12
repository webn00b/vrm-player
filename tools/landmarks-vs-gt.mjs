#!/usr/bin/env node
/**
 * Compare a lifted-landmarks dump (produced by video:bvh next to the BVH as
 * <output>.lifted.json) against AIST++ ground truth — bypassing the retarget
 * layer entirely. Isolates "how good is the 3D estimate" from "how good is
 * the IK/retarget".
 *
 *   node tools/landmarks-vs-gt.mjs <dump.lifted.json> <gt.json>
 *
 * Same method as bvh-vs-gt.mjs: root-relative, global Umeyama similarity
 * (reflection allowed), offset search 0.5–2.5 s, MPJPE. The alignment math is
 * duplicated from bvh-vs-gt.mjs — keep in sync.
 */
import { readFileSync } from 'node:fs';

// MediaPipe world landmark index ↔ COCO-17 joint.
const MAP = [
  [11, 'left_shoulder'], [12, 'right_shoulder'],
  [13, 'left_elbow'], [14, 'right_elbow'],
  [15, 'left_wrist'], [16, 'right_wrist'],
  [23, 'left_hip'], [24, 'right_hip'],
  [25, 'left_knee'], [26, 'right_knee'],
  [27, 'left_ankle'], [28, 'right_ankle'],
];

// ── Umeyama (copy of bvh-vs-gt.mjs) ──────────────────────────────────────────

function jacobiEigen3(S) {
  const a = S.map((r) => r.slice());
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
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
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: V };
}
const matMul = (A, B) => A.map((row, i) => row.map((_, j) => row.reduce((s, _v, k) => s + A[i][k] * B[k][j], 0)));
const transpose = (A) => A[0].map((_, j) => A.map((r) => r[j]));

function umeyama(ps, gs) {
  const n = ps.length;
  const H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let pVar = 0;
  for (let i = 0; i < n; i++) {
    const p = ps[i], g = gs[i];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) H[r][c] += g[r] * p[c];
    pVar += p[0] ** 2 + p[1] ** 2 + p[2] ** 2;
  }
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) H[r][c] /= n;
  pVar /= n;
  const { values, vectors } = jacobiEigen3(matMul(transpose(H), H));
  const order = [0, 1, 2].sort((a, b) => values[b] - values[a]);
  const sig = order.map((i) => Math.sqrt(Math.max(0, values[i])));
  const Vm = order.map((i) => vectors.map((row) => row[i]));
  const U = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    const vi = Vm[i];
    const hv = [0, 1, 2].map((r) => H[r][0] * vi[0] + H[r][1] * vi[1] + H[r][2] * vi[2]);
    const s = sig[i] > 1e-12 ? sig[i] : 1;
    for (let r = 0; r < 3; r++) U[r][i] = hv[r] / s;
  }
  const R = matMul(U, transpose(Vm));
  const scale = pVar > 1e-12 ? (sig[0] + sig[1] + sig[2]) / pVar : 1;
  return { R, scale };
}
const applySim = (R, s, p) => [0, 1, 2].map((r) => s * (R[r][0] * p[0] + R[r][1] * p[1] + R[r][2] * p[2]));

// ── Main ──────────────────────────────────────────────────────────────────────

const [dumpPath, gtPath] = process.argv.slice(2);
if (!gtPath) {
  console.log('Usage: node tools/landmarks-vs-gt.mjs <dump.lifted.json> <gt.json>');
  process.exit(1);
}
const dump = JSON.parse(readFileSync(dumpPath, 'utf8'));
const gt = JSON.parse(readFileSync(gtPath, 'utf8'));
const gtIdx = Object.fromEntries(gt.joints.map((n, i) => [n, i]));

function gtAt(t, j) {
  const f = t * gt.fps;
  const i0 = Math.floor(f);
  if (i0 < 0 || i0 >= gt.frames.length) return null;
  const i1 = Math.min(i0 + 1, gt.frames.length - 1);
  const u = f - i0;
  const a = gt.frames[i0][j], b = gt.frames[i1][j];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

function collect(offset, mirror) {
  const ps = [], gs = [], joints = [];
  for (let i = 0; i < dump.frames.length; i++) {
    const fr = dump.frames[i];
    if (!fr) continue;
    const t = offset + i / dump.fps;
    const g0 = gtAt(t, gtIdx.left_hip), g1 = gtAt(t, gtIdx.right_hip);
    if (!g0 || !g1) continue;
    const gRoot = [(g0[0] + g1[0]) / 2, (g0[1] + g1[1]) / 2, (g0[2] + g1[2]) / 2];
    // MediaPipe world is already hip-centred — use as-is.
    for (const [mp, cocoBase] of MAP) {
      const coco = mirror
        ? (cocoBase.startsWith('left_') ? cocoBase.replace('left_', 'right_') : cocoBase.replace('right_', 'left_'))
        : cocoBase;
      const g = gtAt(t, gtIdx[coco]);
      const p = fr[mp];
      if (!g || !p) continue;
      ps.push(p);
      gs.push([g[0] - gRoot[0], g[1] - gRoot[1], g[2] - gRoot[2]]);
      joints.push(cocoBase);
    }
  }
  return { ps, gs, joints };
}

// The dump covers the video from t=0 and AIST GT is frame-synchronized with
// the video — physical offset ≈ 0. A wide search locks onto dance-loop
// repeats and inflates the error ~2-3×; keep the window tight.
let best = null;
for (const mirror of [false, true]) {
  for (let k = 0; k <= 96; k++) {
    const offset = -0.2 + k / 240;
    const { ps, gs } = collect(offset, mirror);
    if (ps.length < 100) continue;
    const { R, scale } = umeyama(ps, gs);
    let sum = 0;
    for (let i = 0; i < ps.length; i++) {
      const q = applySim(R, scale, ps[i]);
      sum += Math.hypot(q[0] - gs[i][0], q[1] - gs[i][1], q[2] - gs[i][2]);
    }
    const mpjpe = sum / ps.length;
    if (!best || mpjpe < best.mpjpe) best = { mpjpe, offset, mirror, R, scale };
  }
}
if (!best) { console.error('no overlap'); process.exit(1); }

const { ps, gs, joints } = collect(best.offset, best.mirror);
const perJoint = new Map();
for (let i = 0; i < ps.length; i++) {
  const q = applySim(best.R, best.scale, ps[i]);
  const e = Math.hypot(q[0] - gs[i][0], q[1] - gs[i][1], q[2] - gs[i][2]);
  perJoint.set(joints[i], (perJoint.get(joints[i]) ?? []).concat(e));
}
console.log(`offset=${best.offset.toFixed(3)}s mirror=${best.mirror} scale=${best.scale.toFixed(3)}`);
console.log(`\nLandmark MPJPE (no retarget): ${(best.mpjpe * 1000).toFixed(1)} mm\n`);
for (const [name, errs] of [...perJoint.entries()].sort((a, b) =>
  (b[1].reduce((s, e) => s + e, 0) / b[1].length) - (a[1].reduce((s, e) => s + e, 0) / a[1].length))) {
  const mean = errs.reduce((s, e) => s + e, 0) / errs.length;
  console.log(`  ${name.padEnd(16)} ${(mean * 1000).toFixed(1).padStart(7)}`);
}
