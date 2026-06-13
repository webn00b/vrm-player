#!/usr/bin/env node
/**
 * match-score — how faithfully the BVH animation reproduces the pose the
 * detector actually saw in the video. NO ground truth needed: the reference
 * is the video's own 2D landmarks (the retarget's input), so this measures
 * retarget fidelity on ANY video, not just AIST.
 *
 *   node tools/match-score.mjs <recording.bvh> <recording.bvh.lifted.json>
 *                              [--offset-frames 45]
 *
 * <lifted.json> is the dump video-to-bvh writes next to the output; its
 * rawNorm is the per-frame normalized 2D (x, y, visibility) MediaPipe saw.
 *
 * Method (screen-plane self-consistency):
 *   - FK the BVH -> avatar world joints -> front orthographic 2D (x, y).
 *   - Performer 2D from the dump (image plane, y down).
 *   - Compare BONE-DIRECTION angles in the image plane per limb segment.
 *     Direction is proportion- and position-invariant, so avatar != human
 *     body size/placement doesn't matter — only whether each limb points
 *     the way it pointed on screen.
 *   - Selfie mirror + x-reflection resolved by trying all four sign configs
 *     and keeping the global best (matches the capture's L<->R flip).
 *
 * Output: per-segment mean/p95 angular error (deg), overall score, worst
 * frames. Lower is better; ~0 = the avatar limb tracks the video exactly.
 *
 * Limitations:
 *   - The reference is MediaPipe's own 2D, so this cannot catch errors that
 *     originate in bad detection (garbage in).
 *   - It is a FRONT orthographic projection, so it is blind to DEPTH: a
 *     fix that only moves limbs toward/away from the camera (torso de-bias,
 *     wrist-Z recovery) barely changes the score. Depth correctness needs
 *     the AIST GT benchmark (tools/bvh-vs-gt.mjs) or anatomy-check.
 *   This tool's job is screen-plane fidelity: does each limb point the way
 *   it pointed on camera. Pair with the other two for the full picture.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';

// BVH bone-pair -> performer COCO/MediaPipe segment. Each segment is the
// child-bone origin minus the parent-bone origin (the limb direction).
const SEGMENTS = [
  ['upper arm L', 'leftUpperArm', 'leftLowerArm', 11, 13],
  ['upper arm R', 'rightUpperArm', 'rightLowerArm', 12, 14],
  ['forearm L', 'leftLowerArm', 'leftHand', 13, 15],
  ['forearm R', 'rightLowerArm', 'rightHand', 14, 16],
  ['thigh L', 'leftUpperLeg', 'leftLowerLeg', 23, 25],
  ['thigh R', 'rightUpperLeg', 'rightLowerLeg', 24, 26],
  ['shin L', 'leftLowerLeg', 'leftFoot', 25, 27],
  ['shin R', 'rightLowerLeg', 'rightFoot', 26, 28],
];
const VIS_GATE = 0.5;

function parseArgs(argv) {
  const o = { bvh: undefined, dump: undefined, offsetFrames: 45 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--offset-frames') o.offsetFrames = Number(argv[++i]);
    else if (!a.startsWith('-') && !o.bvh) o.bvh = a;
    else if (!a.startsWith('-') && !o.dump) o.dump = a;
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!o.dump) throw new Error('Usage: node tools/match-score.mjs <bvh> <lifted.json> [--offset-frames N]');
  return o;
}

const opts = parseArgs(process.argv.slice(2));
const result = new BVHLoader().parse(readFileSync(opts.bvh, 'utf8'));
const dump = JSON.parse(readFileSync(opts.dump, 'utf8'));
const raw = dump.rawNorm;

const root = new THREE.Group();
root.add(result.skeleton.bones[0]);
const mixer = new THREE.AnimationMixer(root);
mixer.clipAction(result.clip).play();
const byName = new Map(result.skeleton.bones.map((b) => [b.name, b]));
const frameCount = Number(readFileSync(opts.bvh, 'utf8').match(/Frames:\s*(\d+)/)[1]);
const frameTime = result.clip.duration / Math.max(1, frameCount - 1);

// Cache avatar 2D segment dirs (front ortho: x screen, y up) per frame.
const v = new THREE.Vector3();
const avatarSegs = []; // [frame][segIdx] = {x, y} screen dir or null
for (let i = 0; i < frameCount; i++) {
  mixer.setTime(i * frameTime);
  root.updateMatrixWorld(true);
  const segs = SEGMENTS.map(([, a, b]) => {
    byName.get(a).getWorldPosition(v);
    const ax = v.x, ay = v.y;
    byName.get(b).getWorldPosition(v);
    return { x: v.x - ax, y: v.y - ay };
  });
  avatarSegs.push(segs);
}

// Performer 2D segment dirs from the dump (image plane, y down).
function perfSeg(frameDump, aIdx, bIdx) {
  const a = frameDump[aIdx], b = frameDump[bIdx];
  if (!a || !b) return null;
  if ((a[2] ?? 1) < VIS_GATE || (b[2] ?? 1) < VIS_GATE) return null;
  return { x: b[0] - a[0], y: b[1] - a[1], vis: Math.min(a[2] ?? 1, b[2] ?? 1) };
}

const angle = (d) => Math.atan2(d.y, d.x);
const MIRROR = { 11: 12, 12: 11, 13: 14, 14: 13, 15: 16, 16: 15, 23: 24, 24: 23, 25: 26, 26: 25, 27: 28, 28: 27 };

// Four sign configs: mirror L<->R x off/on, avatar screen-x flip off/on.
// Avatar y is up, performer image y is down → flip avatar y to compare.
function evalConfig(mirror, xflip) {
  const perSeg = SEGMENTS.map(() => []);
  const perFrame = [];
  for (let i = 0; i < frameCount; i++) {
    const fd = raw[opts.offsetFrames + i];
    if (!fd) continue;
    let frameErr = 0, frameN = 0;
    for (let s = 0; s < SEGMENTS.length; s++) {
      const [, , , pa, pb] = SEGMENTS[s];
      const ps = perfSeg(fd, mirror ? MIRROR[pa] : pa, mirror ? MIRROR[pb] : pb);
      if (!ps) continue;
      const a = avatarSegs[i][s];
      const av = { x: xflip ? -a.x : a.x, y: -a.y }; // avatar y up -> image y down
      let d = Math.abs(angle(av) - angle(ps));
      if (d > Math.PI) d = 2 * Math.PI - d;
      const deg = (d * 180) / Math.PI;
      perSeg[s].push(deg);
      frameErr += deg; frameN++;
    }
    if (frameN) perFrame.push({ frame: i, deg: frameErr / frameN });
  }
  const all = perSeg.flat();
  const mean = all.length ? all.reduce((x, y) => x + y, 0) / all.length : Infinity;
  return { mean, perSeg, perFrame, mirror, xflip };
}

let best = null;
for (const mirror of [false, true]) for (const xflip of [false, true]) {
  const r = evalConfig(mirror, xflip);
  if (!best || r.mean < best.mean) best = r;
}

console.log(`config: mirror=${best.mirror} xflip=${best.xflip}  (auto-resolved L/R + reflection)`);
console.log(`\nMATCH SCORE — mean limb-direction error vs video: ${best.mean.toFixed(1)} deg`);
console.log(`(0 = avatar limbs track the video exactly; lower is better)\n`);
console.log('per segment (mean / p95 deg):');
SEGMENTS.forEach(([label], s) => {
  const e = best.perSeg[s];
  if (!e.length) { console.log(`  ${label.padEnd(14)}   (no visible frames)`); return; }
  e.sort((a, b) => a - b);
  const mean = e.reduce((a, b) => a + b, 0) / e.length;
  console.log(`  ${label.padEnd(14)} ${mean.toFixed(1).padStart(6)}  ${e[Math.floor(e.length * 0.95)].toFixed(1).padStart(6)}`);
});
const worst = [...best.perFrame].sort((a, b) => b.deg - a.deg).slice(0, 5);
console.log('\nworst frames (frame @sec → mean deg):');
for (const w of worst) console.log(`  #${w.frame} @${(w.frame * frameTime).toFixed(2)}s → ${w.deg.toFixed(1)}`);
