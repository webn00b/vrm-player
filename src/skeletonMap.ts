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

function determineSpineBones(hips: BoneNode, spineApex: BoneNode): [BoneNode, BoneNode, BoneNode | null] {
  const chain: BoneNode[] = [];
  objectSearchAncestors(spineApex, (obj) => {
    chain.unshift(obj);
    return obj === hips;
  });
  if (chain.length < 3) throw new Error('not enough spine bones');
  if (chain.length === 3) return [chain[1], chain[2], null];
  if (chain.length === 4) return [chain[1], chain[2], chain[3]];
  // More spine bones than VRM requires — distribute evenly.
  console.warn('[skeletonMap] more spine bones than VRM requires — result may be approximate');
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

function determineHeadBones(
  headRoot: BoneNode,
): [BoneNode | null, BoneNode, BoneNode | null, BoneNode | null] {
  let head = headRoot;
  while (head.children.length === 1) head = head.children[0];
  const neck = headRoot === head ? null : headRoot;

  let leftEye: BoneNode | null = null;
  let rightEye: BoneNode | null = null;

  if (head.children.length > 0) {
    leftEye = pickByProbability(head.children, [
      { func: (o) => evalName(o, 'lefteye'), weight: 10.0 },
      { func: (o) => evalName(o, 'l_faceeye'), weight: 10.0 },
      { func: (o) => evalName(o, 'eye'), weight: 1.0 },
      { func: (o) => o.getWorldPosition(_v3A).x, weight: 1.0 },
    ]);
    rightEye = pickByProbability(head.children, [
      { func: (o) => evalEqual(o, leftEye), weight: -100.0 },
      { func: (o) => evalName(o, 'righteye'), weight: 10.0 },
      { func: (o) => evalName(o, 'r_faceeye'), weight: 10.0 },
      { func: (o) => evalName(o, 'eye'), weight: 1.0 },
      { func: (o) => -o.getWorldPosition(_v3A).x, weight: 1.0 },
    ]);
  }

  return [neck, head, leftEye, rightEye];
}

// ── Finger bone name tables ────────────────────────────────────────────────────

const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'little'] as const;
type FingerName = (typeof FINGER_NAMES)[number];

const FINGER_BONE_NAMES: Record<
  'left' | 'right',
  Record<FingerName, [VRMHumanBoneName, VRMHumanBoneName, VRMHumanBoneName]>
> = {
  left: {
    thumb:  [VRMHumanBoneName.LeftThumbMetacarpal,  VRMHumanBoneName.LeftThumbProximal,       VRMHumanBoneName.LeftThumbDistal],
    index:  [VRMHumanBoneName.LeftIndexProximal,    VRMHumanBoneName.LeftIndexIntermediate,   VRMHumanBoneName.LeftIndexDistal],
    middle: [VRMHumanBoneName.LeftMiddleProximal,   VRMHumanBoneName.LeftMiddleIntermediate,  VRMHumanBoneName.LeftMiddleDistal],
    ring:   [VRMHumanBoneName.LeftRingProximal,     VRMHumanBoneName.LeftRingIntermediate,    VRMHumanBoneName.LeftRingDistal],
    little: [VRMHumanBoneName.LeftLittleProximal,   VRMHumanBoneName.LeftLittleIntermediate,  VRMHumanBoneName.LeftLittleDistal],
  },
  right: {
    thumb:  [VRMHumanBoneName.RightThumbMetacarpal, VRMHumanBoneName.RightThumbProximal,      VRMHumanBoneName.RightThumbDistal],
    index:  [VRMHumanBoneName.RightIndexProximal,   VRMHumanBoneName.RightIndexIntermediate,  VRMHumanBoneName.RightIndexDistal],
    middle: [VRMHumanBoneName.RightMiddleProximal,  VRMHumanBoneName.RightMiddleIntermediate, VRMHumanBoneName.RightMiddleDistal],
    ring:   [VRMHumanBoneName.RightRingProximal,    VRMHumanBoneName.RightRingIntermediate,   VRMHumanBoneName.RightRingDistal],
    little: [VRMHumanBoneName.RightLittleProximal,  VRMHumanBoneName.RightLittleIntermediate, VRMHumanBoneName.RightLittleDistal],
  },
};

function determineFingerBones(result: VrmBoneMap): void {
  for (const side of ['left', 'right'] as const) {
    const handKey = side === 'left' ? VRMHumanBoneName.LeftHand : VRMHumanBoneName.RightHand;
    const handBone = result.get(handKey);
    if (!handBone) continue;

    const fingerRoots = [...handBone.children];
    for (const fingerName of FINGER_NAMES) {
      const boneNames = FINGER_BONE_NAMES[side][fingerName];
      const fingerRoot = pickByProbability(fingerRoots, [
        { func: (o) => evalName(o, fingerName), weight: 10.0 },
        { func: (o) => o.getWorldPosition(_v3A).z, weight: 1.0 },
      ]);
      if (!fingerRoot) continue;
      fingerRoots.splice(fingerRoots.indexOf(fingerRoot), 1);
      result.set(boneNames[0], fingerRoot);
      const child1 = fingerRoot.children[0];
      if (child1) {
        result.set(boneNames[1], child1);
        const child2 = child1.children[0];
        if (child2) result.set(boneNames[2], child2);
      }
    }
  }
}

// ── Arm evaluator helper ───────────────────────────────────────────────────────

function makeArmEvaluators(side: 'left' | 'right', exclude?: BoneNode | null): Evaluator<BoneNode>[] {
  const s = side;
  const p = s[0]; // 'l' or 'r'
  const xSign = s === 'left' ? 1 : -1;
  const evals: Evaluator<BoneNode>[] = [];
  if (exclude) evals.push({ func: (o) => evalEqual(o, exclude), weight: -100.0 });
  evals.push(
    { func: (o) => evalName(o, `${s}shoulder`),  weight: 10.0 },
    { func: (o) => evalName(o, `${p}_shoulder`), weight: 10.0 },
    { func: (o) => evalName(o, `${s}upperarm`),  weight: 10.0 },
    { func: (o) => evalName(o, `${p}_upperarm`), weight: 10.0 },
    { func: (o) => evalName(o, `${s}arm`),       weight: 5.0  },
    { func: (o) => evalName(o, 'shoulder'),       weight: 1.0  },
    { func: (o) => evalName(o, 'arm'),            weight: 1.0  },
    { func: (o) => xSign * o.getWorldPosition(_v3A).x, weight: 1.0 },
  );
  return evals;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export type VrmBoneMap = Map<VRMHumanBoneName, BoneNode>;

export function mapSkeletonToVRM(root: BoneNode): VrmBoneMap {
  const result: VrmBoneMap = new Map();

  const hips = objectBFS(root, (obj) => obj.children.length >= 3);
  if (!hips) throw new Error('cannot find hips (no bone with 3+ children)');
  result.set(VRMHumanBoneName.Hips, hips);

  // spineApex = deepest descendant of hips with 3+ children; this is where
  // arms and head branch off from the spine chain.
  const spineApexCands = objectTraverseFilter(hips, (obj) => obj !== hips && obj.children.length >= 3);
  const spineApex = pickByProbability(spineApexCands, [
    { func: (o) => evalName(o, 'upperchest'), weight: 1.0 },
    { func: (o) => evalName(o, 'chest'),      weight: 1.0 },
    { func: (o) => evalName(o, 'spine'),      weight: 0.5 },
  ]);
  if (!spineApex) throw new Error('cannot find chest (no branching spine bone)');

  const [spine, chest, upperChest] = determineSpineBones(hips, spineApex);
  result.set(VRMHumanBoneName.Spine, spine);
  result.set(VRMHumanBoneName.Chest, chest);
  if (upperChest) result.set(VRMHumanBoneName.UpperChest, upperChest);

  // Legs
  const leftLegRoot = pickByProbability(hips.children, [
    { func: (o) => evalName(o, 'leftupperleg'), weight: 10.0 },
    { func: (o) => evalName(o, 'l_upperleg'),   weight: 10.0 },
    { func: (o) => evalName(o, 'leftupleg'),    weight: 10.0 },
    { func: (o) => evalName(o, 'leg'),          weight: 1.0  },
    { func: (o) => o.getWorldPosition(_v3A).x,  weight: 1.0  },
  ]);
  const rightLegRoot = pickByProbability(hips.children, [
    { func: (o) => evalEqual(o, leftLegRoot),    weight: -100.0 },
    { func: (o) => evalName(o, 'rightupperleg'), weight: 10.0 },
    { func: (o) => evalName(o, 'r_upperleg'),    weight: 10.0 },
    { func: (o) => evalName(o, 'rightupleg'),    weight: 10.0 },
    { func: (o) => evalName(o, 'leg'),           weight: 1.0  },
    { func: (o) => -o.getWorldPosition(_v3A).x,  weight: 1.0  },
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

  // Arms
  const leftArmRoot  = pickByProbability(spineApex.children, makeArmEvaluators('left'));
  const rightArmRoot = pickByProbability(spineApex.children, makeArmEvaluators('right', leftArmRoot));
  if (!leftArmRoot || !rightArmRoot) throw new Error('cannot find arms');

  const headRoot = pickByProbability(spineApex.children, [
    { func: (o) => evalEqual(o, leftArmRoot),  weight: -100.0 },
    { func: (o) => evalEqual(o, rightArmRoot), weight: -100.0 },
    { func: (o) => evalName(o, 'neck'),        weight: 1.0    },
    { func: (o) => evalName(o, 'head'),        weight: 1.0    },
    { func: (o) => -Math.abs(o.getWorldPosition(_v3A).x), weight: 1.0 },
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

  // Fingers
  determineFingerBones(result);

  // Head, neck, eyes
  if (headRoot) {
    const [neck, head, leftEye, rightEye] = determineHeadBones(headRoot);
    if (neck) result.set(VRMHumanBoneName.Neck, neck);
    result.set(VRMHumanBoneName.Head, head);
    if (leftEye)  result.set(VRMHumanBoneName.LeftEye,  leftEye);
    if (rightEye) result.set(VRMHumanBoneName.RightEye, rightEye);
  }

  return result;
}
