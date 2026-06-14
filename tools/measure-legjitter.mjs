// Measure leg jitter from a BVH: per-frame angular speed (deg/frame) of the
// leg bones. On half-body footage MediaPipe hallucinates the hidden legs, so
// these bones jerk frame-to-frame even when the performer's legs don't move.
// High mean/p95 = noisy hallucinated legs; near-zero = held/steady.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';

const bvhPath = process.argv[2];
if (!bvhPath) { console.log('Usage: node tools/measure-legjitter.mjs <recording.bvh>'); process.exit(1); }

const text = readFileSync(bvhPath, 'utf8');
const result = new BVHLoader().parse(text);
const root = new THREE.Group();
root.add(result.skeleton.bones[0]);
const mixer = new THREE.AnimationMixer(root);
mixer.clipAction(result.clip).play();
const byName = new Map(result.skeleton.bones.map((b) => [b.name, b]));
const n = Number(text.match(/Frames:\s*(\d+)/)[1]);
const frameTime = result.clip.duration / Math.max(1, n - 1);

const legBones = ['leftUpperLeg', 'leftLowerLeg', 'rightUpperLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot']
  .filter((b) => byName.has(b));

const prev = new Map(legBones.map((b) => [b, new THREE.Quaternion()]));
const cur = new THREE.Quaternion();
const speeds = []; // deg/frame across all leg bones

for (let i = 0; i < n; i++) {
  mixer.setTime(i * frameTime);
  root.updateMatrixWorld(true);
  for (const b of legBones) {
    byName.get(b).getWorldQuaternion(cur);
    if (i > 0) {
      const dot = Math.min(1, Math.abs(prev.get(b).dot(cur)));
      speeds.push(THREE.MathUtils.radToDeg(2 * Math.acos(dot)));
    }
    prev.get(b).copy(cur);
  }
}

speeds.sort((a, b) => a - b);
const q = (p) => speeds[Math.min(speeds.length - 1, Math.floor(p * speeds.length))];
const mean = speeds.reduce((s, x) => s + x, 0) / Math.max(1, speeds.length);
console.log(`${bvhPath}: bones=[${legBones.join(',')}] samples=${speeds.length} ` +
  `mean=${mean.toFixed(2)} median=${q(0.5).toFixed(2)} p95=${q(0.95).toFixed(2)} max=${speeds[speeds.length - 1].toFixed(2)} deg/frame`);
