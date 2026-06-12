#!/usr/bin/env node
/**
 * Empirical ROM analyzer for Mixamo FBX animations.
 *
 * For every humanoid-mapped bone, computes the rotation each frame as it
 * would appear on a three-vrm NORMALIZED bone (world-aligned T-pose frames):
 *
 *   D(b)  = Qpose_world(b) * Qrest_world(b)^-1     // world delta from rest
 *   qn(b) = D(parent(b))^-1 * D(b)                 // normalized local rotation
 *
 * then folds qn into Euler angles using the same per-bone order as
 * src/validation/boneConstraints.ts and tracks min/max across all frames and
 * files. Output: per-bone empirical range vs the active constraint table.
 *
 * Usage: node tools/analyze-fbx-rom.mjs <file.fbx> [more.fbx ...]
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

// Minimal copy of src/retargeting/mixamoReference.ts (tools are plain .mjs).
const normalizeName = (n) => n.replace(/^mixamorig[:_\s-]?/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
const MIXAMO_TO_HUMANOID = {
  hips: 'hips', spine: 'spine', spine1: 'chest', spine2: 'upperChest', neck: 'neck', head: 'head',
  leftshoulder: 'leftShoulder', leftarm: 'leftUpperArm', leftforearm: 'leftLowerArm', lefthand: 'leftHand',
  rightshoulder: 'rightShoulder', rightarm: 'rightUpperArm', rightforearm: 'rightLowerArm', righthand: 'rightHand',
  leftupleg: 'leftUpperLeg', leftleg: 'leftLowerLeg', leftfoot: 'leftFoot', lefttoebase: 'leftToes',
  rightupleg: 'rightUpperLeg', rightleg: 'rightLowerLeg', rightfoot: 'rightFoot', righttoebase: 'rightToes',
  lefthandthumb1: 'leftThumbMetacarpal', lefthandthumb2: 'leftThumbProximal', lefthandthumb3: 'leftThumbDistal',
  lefthandindex1: 'leftIndexProximal', lefthandindex2: 'leftIndexIntermediate', lefthandindex3: 'leftIndexDistal',
  lefthandmiddle1: 'leftMiddleProximal', lefthandmiddle2: 'leftMiddleIntermediate', lefthandmiddle3: 'leftMiddleDistal',
  lefthandring1: 'leftRingProximal', lefthandring2: 'leftRingIntermediate', lefthandring3: 'leftRingDistal',
  lefthandpinky1: 'leftLittleProximal', lefthandpinky2: 'leftLittleIntermediate', lefthandpinky3: 'leftLittleDistal',
  righthandthumb1: 'rightThumbMetacarpal', righthandthumb2: 'rightThumbProximal', righthandthumb3: 'rightThumbDistal',
  righthandindex1: 'rightIndexProximal', righthandindex2: 'rightIndexIntermediate', righthandindex3: 'rightIndexDistal',
  righthandmiddle1: 'rightMiddleProximal', righthandmiddle2: 'rightMiddleIntermediate', righthandmiddle3: 'rightMiddleDistal',
  righthandring1: 'rightRingProximal', righthandring2: 'rightRingIntermediate', righthandring3: 'rightRingDistal',
  righthandpinky1: 'rightLittleProximal', righthandpinky2: 'rightLittleIntermediate', righthandpinky3: 'rightLittleDistal',
};
const toHumanoid = (n) => MIXAMO_TO_HUMANOID[normalizeName(n)] ?? null;

// Euler order per humanoid bone — keep in sync with boneConstraints.ts.
const BONE_ORDER = {
  spine: 'YXZ', chest: 'YXZ', upperChest: 'YXZ', neck: 'YXZ', head: 'YXZ',
  leftShoulder: 'YXZ', rightShoulder: 'YXZ',
  leftUpperArm: 'YXZ', rightUpperArm: 'YXZ',
  leftLowerArm: 'YZX', rightLowerArm: 'YZX',
  leftHand: 'XYZ', rightHand: 'XYZ',
  leftUpperLeg: 'XYZ', rightUpperLeg: 'XYZ',
  leftLowerLeg: 'XYZ', rightLowerLeg: 'XYZ',
  leftFoot: 'XYZ', rightFoot: 'XYZ',
  leftToes: 'XYZ', rightToes: 'XYZ',
};
const DEFAULT_ORDER = 'XYZ';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node tools/analyze-fbx-rom.mjs <file.fbx> [...]');
  process.exit(1);
}

const loader = new FBXLoader();
const ranges = new Map(); // humanoidBone -> {min:[x,y,z], max:[x,y,z], frames}

const _qPose = new THREE.Quaternion();
const _qTmp = new THREE.Quaternion();
const _euler = new THREE.Euler();

function accumulate(boneName, qn) {
  const order = BONE_ORDER[boneName] ?? DEFAULT_ORDER;
  _euler.setFromQuaternion(qn, order);
  let r = ranges.get(boneName);
  if (!r) {
    r = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], frames: 0 };
    ranges.set(boneName, r);
  }
  const vals = [_euler.x, _euler.y, _euler.z];
  for (let i = 0; i < 3; i++) {
    if (vals[i] < r.min[i]) r.min[i] = vals[i];
    if (vals[i] > r.max[i]) r.max[i] = vals[i];
  }
  r.frames++;
}

for (const file of files) {
  const buf = readFileSync(file);
  const group = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const clip = group.animations?.[0];
  if (!clip) { console.error(`!! no animation in ${file}`); continue; }

  // Collect bones + rest world quaternions (node transforms at load = rest).
  const bones = [];
  const byName = new Map();
  group.updateMatrixWorld(true);
  group.traverse((n) => {
    if (toHumanoid(n.name) != null) { bones.push(n); byName.set(n.name, n); }
  });
  const restWorld = new Map();
  for (const b of bones) {
    restWorld.set(b.name, b.getWorldQuaternion(new THREE.Quaternion()).clone());
  }
  // Nearest mapped ancestor per bone.
  const mappedParent = new Map();
  for (const b of bones) {
    let p = b.parent;
    while (p && toHumanoid(p.name) == null) p = p.parent;
    mappedParent.set(b.name, p && toHumanoid(p.name) != null ? p.name : null);
  }

  const mixer = new THREE.AnimationMixer(group);
  const action = mixer.clipAction(clip);
  action.play();

  const fps = 30;
  const frameCount = Math.max(1, Math.round(clip.duration * fps));
  let processed = 0;
  for (let f = 0; f <= frameCount; f++) {
    mixer.setTime(Math.min(clip.duration, f / fps));
    group.updateMatrixWorld(true);

    // World deltas from rest.
    const delta = new Map();
    for (const b of bones) {
      b.getWorldQuaternion(_qPose);
      _qTmp.copy(restWorld.get(b.name)).invert().premultiply(_qPose); // D = pose * rest^-1
      delta.set(b.name, _qTmp.clone());
    }
    for (const b of bones) {
      const human = toHumanoid(b.name);
      const parent = mappedParent.get(b.name);
      const d = delta.get(b.name);
      const qn = parent
        ? delta.get(parent).clone().invert().multiply(d) // parentD^-1 * D
        : d.clone();
      accumulate(human, qn);
    }
    processed++;
  }
  console.error(`ok ${basename(file)}: ${bones.length} bones, ${processed} frames @${fps}fps, ${clip.duration.toFixed(1)}s`);
}

// Report.
const r2d = (v) => THREE.MathUtils.radToDeg(v);
const fmt = (v) => String(Math.round(r2d(v))).padStart(5);
console.log('\nbone                     order  axis  empirical [min..max]°  frames');
const orderOf = (b) => BONE_ORDER[b] ?? DEFAULT_ORDER;
for (const [bone, r] of [...ranges.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  for (let i = 0; i < 3; i++) {
    const axis = 'xyz'[i];
    console.log(`${bone.padEnd(24)} ${orderOf(bone).padEnd(6)} ${axis}    [${fmt(r.min[i])} ..${fmt(r.max[i])}]   ${r.frames}`);
  }
}
