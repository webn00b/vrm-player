#!/usr/bin/env node
/**
 * skeleton-overlay — see WHERE the avatar diverges from the video.
 *
 *   node tools/skeleton-overlay.mjs <recording.bvh.external.bvh> <recording.bvh.lifted.json>
 *        [--out overlay.png] [--cols 4] [--fps 1]
 *
 * Draws two body-frame skeletons per sampled frame on one contact-sheet PNG:
 *   GREEN  — the video's detected 2D pose (the retarget's input / truth)
 *   RED    — the avatar's BVH limbs, front-projected to 2D
 * Both are anchored at the hip midpoint and scaled to a common shoulder width,
 * so a red limb pointing away from its green twin is a retarget direction
 * error — visible at the exact joint and frame, not just a number.
 *
 * Pure Node (zlib PNG encoder, Bresenham lines); no native deps.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';

// ── tiny RGBA canvas + PNG ────────────────────────────────────────────────────
function makeCanvas(w, h) { return { w, h, buf: new Uint8Array(w * h * 4) }; }
function px(c, x, y, [r, g, b, a = 255]) {
  x |= 0; y |= 0; if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4; c.buf[i] = r; c.buf[i + 1] = g; c.buf[i + 2] = b; c.buf[i + 3] = a;
}
function line(c, x0, y0, x1, y1, col) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) px(c, x0 + ox, y0 + oy, col);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(c) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0); ihdr.writeUInt32BE(c.h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((c.w * 4 + 1) * c.h);
  for (let y = 0; y < c.h; y++) {
    raw[y * (c.w * 4 + 1)] = 0; // filter none
    c.buf.subarray(y * c.w * 4, (y + 1) * c.w * 4).forEach((v, i) => { raw[y * (c.w * 4 + 1) + 1 + i] = v; });
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const bvhPath = args.find((a) => !a.startsWith('-') && a.endsWith('.bvh'));
const dumpPath = args.find((a) => a.endsWith('.json'));
if (!bvhPath || !dumpPath) {
  console.log('Usage: node tools/skeleton-overlay.mjs <bvh> <lifted.json> [--out overlay.png] [--cols 4] [--fps 1] [--offset-frames 45]');
  process.exit(1);
}
const cols = Number(opt('--cols', 4));
const sheetFps = Number(opt('--fps', 1));
const offsetFrames = Number(opt('--offset-frames', 45));
const outPath = opt('--out', bvhPath.replace(/\.external\.bvh$/, '').replace(/\.bvh$/, '') + '.overlay.png');

// ── data ──────────────────────────────────────────────────────────────────────
const result = new BVHLoader().parse(readFileSync(bvhPath, 'utf8'));
const dump = JSON.parse(readFileSync(dumpPath, 'utf8'));
const raw = dump.rawNorm;
const root = new THREE.Group(); root.add(result.skeleton.bones[0]);
const mixer = new THREE.AnimationMixer(root); mixer.clipAction(result.clip).play();
const byName = new Map(result.skeleton.bones.map((b) => [b.name, b]));
const n = Number(readFileSync(bvhPath, 'utf8').match(/Frames:\s*(\d+)/)[1]);
const frameTime = result.clip.duration / Math.max(1, n - 1);
const srcFps = dump.fps || 30;

// Body-frame bones: [a, b] pairs. Avatar uses BVH bone names; video uses MP idx.
const BVH_BONES = [
  ['leftUpperArm', 'leftLowerArm'], ['leftLowerArm', 'leftHand'],
  ['rightUpperArm', 'rightLowerArm'], ['rightLowerArm', 'rightHand'],
  ['leftUpperLeg', 'leftLowerLeg'], ['leftLowerLeg', 'leftFoot'],
  ['rightUpperLeg', 'rightLowerLeg'], ['rightLowerLeg', 'rightFoot'],
  ['leftUpperArm', 'rightUpperArm'], ['leftUpperLeg', 'rightUpperLeg'],
];
const MP_BONES = [
  [12, 14], [14, 16], [11, 13], [13, 15],   // arms (mirrored to match avatar L/R)
  [24, 26], [26, 28], [23, 25], [25, 27],   // legs
  [11, 12], [23, 24],
];
const MP = { LSHO: 11, RSHO: 12, LHIP: 23, RHIP: 24 };

const CELL = 220, PAD = 8;
const nPairs = Math.max(1, Math.floor((n / srcFps) * sheetFps));
const step = Math.max(1, Math.floor(n / nPairs));
const frames = [];
for (let i = 0; i < n; i += step) frames.push(i);
const rows = Math.ceil(frames.length / cols);
const cv = makeCanvas(cols * CELL, rows * CELL);

// Body-frame projector: origin = hip midpoint, scale so shoulder width = S px.
// Kept small so a full body (~3× shoulder width tall) fits inside one cell.
const S = 42;
function drawSkeleton(cx, cy, pts, bones, col) {
  // pts: {idxOrName: [x,y]} already in body-frame px (centered). Draw bones.
  for (const [a, b] of bones) {
    const pa = pts[a], pb = pts[b];
    if (!pa || !pb) continue;
    line(cv, cx + pa[0], cy + pa[1], cx + pb[0], cy + pb[1], col);
  }
}

const v = new THREE.Vector3();
const GREEN = [60, 220, 90], RED = [235, 70, 70], GREY = [70, 74, 82];

frames.forEach((fi, k) => {
  const cellX = (k % cols) * CELL + CELL / 2;
  const cellY = Math.floor(k / cols) * CELL + CELL / 2;
  // cell border
  for (let xx = 0; xx < CELL - 1; xx++) { px(cv, cellX - CELL / 2 + xx, cellY - CELL / 2, GREY); px(cv, cellX - CELL / 2 + xx, cellY + CELL / 2 - 1, GREY); }

  // GREEN: detected 2D (video). Body-frame: origin midhip, y down, scale by shoulder width.
  const fd = raw[offsetFrames + fi];
  if (fd) {
    const hip = [(fd[MP.LHIP][0] + fd[MP.RHIP][0]) / 2, (fd[MP.LHIP][1] + fd[MP.RHIP][1]) / 2];
    const sw = Math.hypot(fd[MP.LSHO][0] - fd[MP.RSHO][0], fd[MP.LSHO][1] - fd[MP.RSHO][1]) || 0.1;
    const sc = S / sw;
    const pts = {};
    for (const idx of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      const lm = fd[idx]; if (!lm) continue;
      pts[idx] = [(lm[0] - hip[0]) * sc, (lm[1] - hip[1]) * sc];
    }
    drawSkeleton(cellX, cellY, pts, MP_BONES, GREEN);
  }

  // RED: avatar BVH front-projected (x screen, y up → flip). Mirror handled by
  // mapping avatar L bones against MP mirrored bones above.
  mixer.setTime(fi * frameTime); root.updateMatrixWorld(true);
  const wpos = {};
  for (const [a, b] of BVH_BONES) for (const nm of [a, b]) {
    if (wpos[nm]) continue; byName.get(nm).getWorldPosition(v); wpos[nm] = [v.x, v.y];
  }
  const hipA = [(wpos.leftUpperLeg[0] + wpos.rightUpperLeg[0]) / 2, (wpos.leftUpperLeg[1] + wpos.rightUpperLeg[1]) / 2];
  const swA = Math.hypot(wpos.leftUpperArm[0] - wpos.rightUpperArm[0], wpos.leftUpperArm[1] - wpos.rightUpperArm[1]) || 0.1;
  const scA = S / swA;
  const ptsA = {};
  for (const nm of Object.keys(wpos)) ptsA[nm] = [(wpos[nm][0] - hipA[0]) * scA, -(wpos[nm][1] - hipA[1]) * scA];
  drawSkeleton(cellX, cellY, ptsA, BVH_BONES, RED);
});

writeFileSync(outPath, encodePNG(cv));
console.log(`[skeleton-overlay] ${frames.length} frames → ${outPath}  (green=video, red=avatar)`);
