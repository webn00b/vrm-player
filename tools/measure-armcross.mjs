// Measure forearm interpenetration in a BVH. For each frame, the minimum
// distance between the left and right forearm segments (elbow→wrist). Reports
// how often that distance drops below clearance thresholds — i.e. how often the
// avatar's forearms overlap (pass through each other). Avatar forearm radius is
// ~4-5cm, so a segment-to-segment distance under ~8cm already means the meshes
// touch; under ~3cm they clearly interpenetrate.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';

const bvhPath = process.argv[2];
if (!bvhPath) { console.log('Usage: node tools/measure-armcross.mjs <recording.bvh>'); process.exit(1); }

const text = readFileSync(bvhPath, 'utf8');
const result = new BVHLoader().parse(text);
const root = new THREE.Group();
root.add(result.skeleton.bones[0]);
const mixer = new THREE.AnimationMixer(root);
mixer.clipAction(result.clip).play();
const byName = new Map(result.skeleton.bones.map((b) => [b.name, b]));
const n = Number(text.match(/Frames:\s*(\d+)/)[1]);
const frameTime = result.clip.duration / Math.max(1, n - 1);

const wp = (name, out) => byName.get(name).getWorldPosition(out);

// Closest distance between segments [p1,p2] and [p3,p4].
function segDist(p1, p2, p3, p4) {
  const d1 = p2.clone().sub(p1), d2 = p4.clone().sub(p3), r = p1.clone().sub(p3);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r), c = d1.dot(r), b = d1.dot(d2);
  const den = a * e - b * b;
  let s = den > 1e-9 ? THREE.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0;
  let t = (b * s + f) / e;
  if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
  else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
  return p1.clone().add(d1.multiplyScalar(s)).distanceTo(p3.clone().add(d2.multiplyScalar(t)));
}

const le = new THREE.Vector3(), lw = new THREE.Vector3(), re = new THREE.Vector3(), rw = new THREE.Vector3();
const dists = [];
let minD = 1e9, minI = -1;
for (let i = 0; i < n; i++) {
  mixer.setTime(i * frameTime);
  root.updateMatrixWorld(true);
  wp('leftLowerArm', le); wp('leftHand', lw); wp('rightLowerArm', re); wp('rightHand', rw);
  const d = segDist(le.clone(), lw.clone(), re.clone(), rw.clone());
  dists.push(d);
  if (d < minD) { minD = d; minI = i; }
}

const pct = (thr) => (100 * dists.filter((d) => d < thr).length / dists.length).toFixed(1);
console.log(`${bvhPath}: frames=${n} dur=${result.clip.duration.toFixed(1)}s`);
console.log(`forearm-forearm min=${minD.toFixed(3)}m @frame${minI} (t=${(minI * frameTime).toFixed(2)}s)`);
console.log(`overlap frames: <8cm=${pct(0.08)}%  <5cm=${pct(0.05)}%  <3cm=${pct(0.03)}%  <1.5cm=${pct(0.015)}%`);
