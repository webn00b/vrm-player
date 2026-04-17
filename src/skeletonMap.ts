/**
 * Structure-based skeleton → VRM humanoid mapping.
 *
 * Adapted from pixiv's bvh2vrma (https://github.com/pixiv/bvh2vrma) — auto-detects
 * bones by hierarchy and bone length rather than by name, so it works with any
 * bipedal BVH skeleton (Mixamo, MMD, custom rigs) regardless of naming.
 */
import * as THREE from 'three';
import { VRMHumanBoneName } from '@pixiv/three-vrm';

const _v3A = new THREE.Vector3();

type BoneNode = THREE.Object3D;

interface Evaluator<T> {
  func: (obj: T) => number;
  weight: number;
}

function pickByProbability<T>(array: readonly T[], evaluators: Evaluator<T>[]): T | null {
  if (array.length < 1) return null;
  const scores = new Array<number>(array.length).fill(0);
  for (const { func, weight } of evaluators) {
    let min = Infinity;
    let max = -Infinity;
    const values = array.map((v) => {
      const r = func(v);
      if (r < min) min = r;
      if (r > max) max = r;
      return r;
    });
    const range = max - min;
    if (range > 0) {
      for (let i = 0; i < values.length; i++) {
        scores[i] += (weight * (values[i] - min)) / range;
      }
    }
  }
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > bestScore) {
      bestScore = scores[i];
      bestIdx = i;
    }
  }
  return array[bestIdx] ?? null;
}

function objectBFS(root: BoneNode, fn: (obj: BoneNode) => boolean): BoneNode | null {
  const queue: BoneNode[] = [root];
  while (queue.length > 0) {
    const obj = queue.shift()!;
    if (fn(obj)) return obj;
    queue.push(...obj.children);
  }
  return null;
}

function objectTraverseFilter(root: BoneNode, fn: (obj: BoneNode) => boolean): BoneNode[] {
  const result: BoneNode[] = [];
  root.traverse((obj) => {
    if (fn(obj)) result.push(obj);
  });
  return result;
}

function objectSearchAncestors(obj: BoneNode | null, fn: (obj: BoneNode) => boolean): BoneNode | null {
  while (obj != null) {
    if (fn(obj)) return obj;
    obj = obj.parent;
  }
  return null;
}

const evalName = (obj: BoneNode, substring: string): number =>
  obj.name.toLowerCase().includes(substring) ? 1 : 0;

const evalEqual = (obj: BoneNode, other: BoneNode | null): number => (obj === other ? 1 : 0);

function determineSpineBones(hips: BoneNode, chestCand: BoneNode): [BoneNode, BoneNode, BoneNode | null] {
  const chain: BoneNode[] = [];
  objectSearchAncestors(chestCand, (obj) => {
    chain.unshift(obj);
    return obj === hips;
  });
  if (chain.length < 3) throw new Error('not enough spine bones');
  if (chain.length === 3) return [chain[1], chain[2], null];
  if (chain.length === 4) return [chain[1], chain[2], chain[3]];
  // more than upperChest — distribute
  return [
    chain[Math.floor((chain.length - 1) / 3)],
    chain[Math.floor(((chain.length - 1) / 3) * 2)],
    chain[chain.length - 1],
  ];
}

interface BoneDepth {
  bone: BoneNode;
  depth: number;
  len: number;
}

function collectChain(root: BoneNode): BoneDepth[] {
  const result: BoneDepth[] = [];
  let current: BoneNode | undefined = root;
  let depth = 0;
  while (current) {
    const firstChild: BoneNode | undefined = current.children[0];
    result.push({ bone: current, depth, len: firstChild?.position.length() ?? 0 });
    current = firstChild;
    depth++;
  }
  return result;
}

function determineLegBones(root: BoneNode): [BoneNode, BoneNode, BoneNode, BoneNode | null] {
  const chain = collectChain(root);
  if (chain.length < 3) throw new Error('not enough leg bones');
  const [upperLeg, lowerLeg] = chain
    .slice()
    .sort((a, b) => b.len - a.len)
    .slice(0, 2)
    .sort((a, b) => a.depth - b.depth);
  const foot = chain[lowerLeg.depth + 1];
  if (!foot) throw new Error('foot bone missing');
  const toes = chain[foot.depth + 1];
  return [upperLeg.bone, lowerLeg.bone, foot.bone, toes?.bone ?? null];
}

function determineArmBones(root: BoneNode): [BoneNode | null, BoneNode, BoneNode, BoneNode] {
  const chain = collectChain(root);
  if (chain.length < 3) throw new Error('not enough arm bones');
  const [upperArm, lowerArm] = chain
    .slice()
    .sort((a, b) => b.len - a.len)
    .slice(0, 2)
    .sort((a, b) => a.depth - b.depth);
  const hand = chain[lowerArm.depth + 1];
  if (!hand) throw new Error('hand bone missing');
  const shoulder = upperArm.depth !== 0 ? chain[upperArm.depth - 1] : null;
  return [shoulder?.bone ?? null, upperArm.bone, lowerArm.bone, hand.bone];
}

function determineHeadBones(headRoot: BoneNode): [BoneNode | null, BoneNode] {
  let head = headRoot;
  while (head.children.length === 1) head = head.children[0];
  const neck = headRoot === head ? null : headRoot;
  return [neck, head];
}

export type VrmBoneMap = Map<VRMHumanBoneName, BoneNode>;

export function mapSkeletonToVRM(root: BoneNode): VrmBoneMap {
  const result: VrmBoneMap = new Map();

  const hips = objectBFS(root, (obj) => obj.children.length >= 3);
  if (!hips) throw new Error('cannot find hips (no bone with 3+ children)');
  result.set(VRMHumanBoneName.Hips, hips);

  const chestCands = objectTraverseFilter(hips, (obj) => obj !== hips && obj.children.length >= 3);
  const chestCand = pickByProbability(chestCands, [
    { func: (o) => evalName(o, 'upperchest'), weight: 1.0 },
    { func: (o) => evalName(o, 'chest'), weight: 1.0 },
    { func: (o) => evalName(o, 'spine'), weight: 0.5 },
  ]);
  if (!chestCand) throw new Error('cannot find chest');

  const [spine, chest, upperChest] = determineSpineBones(hips, chestCand);
  result.set(VRMHumanBoneName.Spine, spine);
  result.set(VRMHumanBoneName.Chest, chest);
  if (upperChest) result.set(VRMHumanBoneName.UpperChest, upperChest);

  // Identify leg roots among hips' direct children by name + world x.
  const leftLegRoot = pickByProbability(hips.children, [
    { func: (o) => evalName(o, 'leftupperleg'), weight: 10.0 },
    { func: (o) => evalName(o, 'l_upperleg'), weight: 10.0 },
    { func: (o) => evalName(o, 'leftupleg'), weight: 10.0 },
    { func: (o) => evalName(o, 'leg'), weight: 1.0 },
    { func: (o) => o.getWorldPosition(_v3A).x, weight: 1.0 },
  ]);
  const rightLegRoot = pickByProbability(hips.children, [
    { func: (o) => evalEqual(o, leftLegRoot), weight: -100.0 },
    { func: (o) => evalName(o, 'rightupperleg'), weight: 10.0 },
    { func: (o) => evalName(o, 'r_upperleg'), weight: 10.0 },
    { func: (o) => evalName(o, 'rightupleg'), weight: 10.0 },
    { func: (o) => evalName(o, 'leg'), weight: 1.0 },
    { func: (o) => -o.getWorldPosition(_v3A).x, weight: 1.0 },
  ]);
  if (!leftLegRoot || !rightLegRoot) throw new Error('cannot find legs');

  const [lUp, lLo, lFoot, lToes] = determineLegBones(leftLegRoot);
  result.set(VRMHumanBoneName.LeftUpperLeg, lUp);
  result.set(VRMHumanBoneName.LeftLowerLeg, lLo);
  result.set(VRMHumanBoneName.LeftFoot, lFoot);
  if (lToes) result.set(VRMHumanBoneName.LeftToes, lToes);

  const [rUp, rLo, rFoot, rToes] = determineLegBones(rightLegRoot);
  result.set(VRMHumanBoneName.RightUpperLeg, rUp);
  result.set(VRMHumanBoneName.RightLowerLeg, rLo);
  result.set(VRMHumanBoneName.RightFoot, rFoot);
  if (rToes) result.set(VRMHumanBoneName.RightToes, rToes);

  const leftArmRoot = pickByProbability(chestCand.children, [
    { func: (o) => evalName(o, 'leftshoulder'), weight: 10.0 },
    { func: (o) => evalName(o, 'l_shoulder'), weight: 10.0 },
    { func: (o) => evalName(o, 'leftupperarm'), weight: 10.0 },
    { func: (o) => evalName(o, 'leftarm'), weight: 10.0 },
    { func: (o) => evalName(o, 'shoulder'), weight: 1.0 },
    { func: (o) => evalName(o, 'arm'), weight: 1.0 },
    { func: (o) => o.getWorldPosition(_v3A).x, weight: 1.0 },
  ]);
  const rightArmRoot = pickByProbability(chestCand.children, [
    { func: (o) => evalEqual(o, leftArmRoot), weight: -100.0 },
    { func: (o) => evalName(o, 'rightshoulder'), weight: 10.0 },
    { func: (o) => evalName(o, 'r_shoulder'), weight: 10.0 },
    { func: (o) => evalName(o, 'rightupperarm'), weight: 10.0 },
    { func: (o) => evalName(o, 'rightarm'), weight: 10.0 },
    { func: (o) => evalName(o, 'shoulder'), weight: 1.0 },
    { func: (o) => evalName(o, 'arm'), weight: 1.0 },
    { func: (o) => -o.getWorldPosition(_v3A).x, weight: 1.0 },
  ]);
  if (!leftArmRoot || !rightArmRoot) throw new Error('cannot find arms');

  const headRoot = pickByProbability(chestCand.children, [
    { func: (o) => evalEqual(o, leftArmRoot), weight: -100.0 },
    { func: (o) => evalEqual(o, rightArmRoot), weight: -100.0 },
    { func: (o) => evalName(o, 'neck'), weight: 1.0 },
    { func: (o) => evalName(o, 'head'), weight: 1.0 },
    { func: (o) => Math.abs(o.getWorldPosition(_v3A).x), weight: -1.0 },
  ]);

  const [lSh, lUpA, lLoA, lHand] = determineArmBones(leftArmRoot);
  if (lSh) result.set(VRMHumanBoneName.LeftShoulder, lSh);
  result.set(VRMHumanBoneName.LeftUpperArm, lUpA);
  result.set(VRMHumanBoneName.LeftLowerArm, lLoA);
  result.set(VRMHumanBoneName.LeftHand, lHand);

  const [rSh, rUpA, rLoA, rHand] = determineArmBones(rightArmRoot);
  if (rSh) result.set(VRMHumanBoneName.RightShoulder, rSh);
  result.set(VRMHumanBoneName.RightUpperArm, rUpA);
  result.set(VRMHumanBoneName.RightLowerArm, rLoA);
  result.set(VRMHumanBoneName.RightHand, rHand);

  if (headRoot) {
    const [neck, head] = determineHeadBones(headRoot);
    if (neck) result.set(VRMHumanBoneName.Neck, neck);
    result.set(VRMHumanBoneName.Head, head);
  }

  return result;
}
