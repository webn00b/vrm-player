// Measure hand-behind-shoulder angle from a BVH — the exact metric the
// arm-back-limit guard clamps. For each arm and frame: vector wrist-shoulder,
// project onto hips' horizontal forward (-Z for a VRM); the "back" angle is
// asin(behind / |vector|) when the wrist sits behind the shoulder's coronal
// plane. Reports median / p95 / max so we can confirm the clamp lowers the
// tail without touching the median.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';

const bvhPath = process.argv[2];
if (!bvhPath) { console.log('Usage: node tools/measure-armback.mjs <recording.bvh>'); process.exit(1); }

const text = readFileSync(bvhPath, 'utf8');
const result = new BVHLoader().parse(text);
const root = new THREE.Group();
root.add(result.skeleton.bones[0]);
const mixer = new THREE.AnimationMixer(root);
mixer.clipAction(result.clip).play();
const byName = new Map(result.skeleton.bones.map((b) => [b.name, b]));
const n = Number(text.match(/Frames:\s*(\d+)/)[1]);
const frameTime = result.clip.duration / Math.max(1, n - 1);

const pos = (name, out) => byName.get(name).getWorldPosition(out);
const _hipsQ = new THREE.Quaternion();
const fwd = new THREE.Vector3();
const sh = new THREE.Vector3(), wr = new THREE.Vector3(), v = new THREE.Vector3();

const angles = [];
for (let i = 0; i < n; i++) {
  mixer.setTime(i * frameTime);
  root.updateMatrixWorld(true);
  byName.get('hips').getWorldQuaternion(_hipsQ);
  fwd.set(0, 0, -1).applyQuaternion(_hipsQ); fwd.y = 0;
  if (fwd.lengthSq() < 1e-6) continue;
  fwd.normalize();
  for (const [shoulder, wrist] of [['leftUpperArm', 'leftHand'], ['rightUpperArm', 'rightHand']]) {
    pos(shoulder, sh); pos(wrist, wr);
    v.subVectors(wr, sh);
    const len = v.length();
    if (len < 1e-4) continue;
    const back = -v.dot(fwd); // >0 = behind the shoulder's coronal plane
    const deg = back > 0 ? THREE.MathUtils.radToDeg(Math.asin(Math.min(1, back / len))) : 0;
    angles.push(deg);
  }
}

angles.sort((a, b) => a - b);
const q = (p) => angles[Math.min(angles.length - 1, Math.floor(p * angles.length))];
console.log(`${bvhPath}: samples=${angles.length} median=${q(0.5).toFixed(1)} p95=${q(0.95).toFixed(1)} max=${angles[angles.length - 1].toFixed(1)}`);
