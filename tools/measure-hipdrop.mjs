// Measure spurious hip-height drops correlated with arm raises. Reads a BVH,
// reports hips world-Y range + frames where hips dropped sharply while a wrist
// is raised above the shoulder (the bug: arm up → pelvis sinks).
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
const p = process.argv[2];
if (!p) { console.log('Usage: node tools/measure-hipdrop.mjs <recording.bvh>'); process.exit(1); }
const text = readFileSync(p, 'utf8');
const r = new BVHLoader().parse(text);
const root = new THREE.Group(); root.add(r.skeleton.bones[0]);
const mx = new THREE.AnimationMixer(root); mx.clipAction(r.clip).play();
const by = new Map(r.skeleton.bones.map((b) => [b.name, b]));
const n = Number(text.match(/Frames:\s*(\d+)/)[1]);
const ft = r.clip.duration / Math.max(1, n - 1);
const hp = new THREE.Vector3(), lw = new THREE.Vector3(), rw = new THREE.Vector3(), ls = new THREE.Vector3();
const ys = [], up = [];
for (let i = 0; i < n; i++) {
  mx.setTime(i * ft); root.updateMatrixWorld(true);
  by.get('hips').getWorldPosition(hp);
  by.get('leftHand').getWorldPosition(lw); by.get('rightHand').getWorldPosition(rw);
  by.get('leftUpperArm').getWorldPosition(ls);
  ys.push(hp.y); up.push(Math.max(lw.y, rw.y) - ls.y);
}
const min = Math.min(...ys), max = Math.max(...ys);
// hips Y range only over frames where an arm is RAISED (wrist above shoulder)
const armUpYs = ys.filter((_, i) => up[i] > 0.1);
const auMin = armUpYs.length ? Math.min(...armUpYs) : NaN;
const auMax = armUpYs.length ? Math.max(...armUpYs) : NaN;
let maxStep = 0; for (let i = 1; i < n; i++) maxStep = Math.max(maxStep, Math.abs(ys[i] - ys[i - 1]));
console.log(`${p}: frames=${n}`);
console.log(`hips Y range (all)=${(max - min).toFixed(3)}m  max step=${maxStep.toFixed(3)}m/frame`);
console.log(`hips Y range (arm-raised frames)=${(auMax - auMin).toFixed(3)}m  (${armUpYs.length} frames)`);
