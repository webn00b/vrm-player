/**
 * Minimal VRM-like fixture for integration testing.
 *
 * The real VRM produced by `@pixiv/three-vrm` is huge — meshes, materials,
 * morph targets, spring bones, hit-box helpers. The DirectPoseApplier only
 * touches a small subset: humanoid bones (via `getNormalizedBoneNode` /
 * `getRawBoneNode`), the scene root (for updateMatrixWorld), and meta.
 *
 * This fixture builds just enough of that surface area to exercise the
 * applier without needing to load a .vrm file:
 *
 *   - Hips at (0, 1, 0) — ~1 m hip height
 *   - Spine / chest / neck / head stacked up the Y axis
 *   - Symmetric clavicles + arm chains extended along ±X
 *   - Symmetric legs extending down the Y axis
 *   - Hands / feet as terminal bones
 *
 * All bones face +X (left) / −X (right) at rest with no twist applied. The
 * "normalized" and "raw" trees are the SAME object3D tree in this fixture —
 * the applier's rest-axis builder still works correctly because all parent /
 * child relationships are present.
 */

import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

export interface MockVRM extends VRM {
  /** Quick test-side access to a bone by name. */
  bones: Map<string, THREE.Object3D>;
}

/**
 * Build a humanoid Object3D tree and the VRM-like wrapper.
 *
 * @param meta.version  '0' or '1' — controls `vrm.meta.metaVersion`.
 *                       VRM 0.x triggers the applier's x/z flip for clip
 *                       round-trips; default '1' keeps things straightforward.
 */
export function buildMockVRM(meta: { version?: '0' | '1' } = {}): MockVRM {
  const bones = new Map<string, THREE.Object3D>();

  /** Make + register a bone with given local position relative to parent. */
  const makeBone = (name: string, x: number, y: number, z: number,
                    parent?: THREE.Object3D): THREE.Object3D => {
    const node = new THREE.Object3D();
    node.name = name;
    node.position.set(x, y, z);
    if (parent) parent.add(node);
    bones.set(name, node);
    return node;
  };

  // Scene root
  const scene = new THREE.Object3D();
  scene.name = 'mockVRMScene';

  // ── Torso ──────────────────────────────────────────────────────────────
  const hips    = makeBone('hips',    0,   1.0,  0, scene);
  const spine   = makeBone('spine',   0,   0.2,  0, hips);
  const chest   = makeBone('chest',   0,   0.2,  0, spine);
  const neck    = makeBone('neck',    0,   0.2,  0, chest);
  const head    = makeBone('head',    0,   0.15, 0, neck);
  makeBone('leftEye',  0.03, 0.05, 0.05, head);
  makeBone('rightEye', -0.03, 0.05, 0.05, head);

  // ── Arms (left = +X, right = −X) ───────────────────────────────────────
  const leftShoulder  = makeBone('leftShoulder',   0.05, 0.15, 0, chest);
  const leftUpperArm  = makeBone('leftUpperArm',   0.15, 0,    0, leftShoulder);
  const leftLowerArm  = makeBone('leftLowerArm',   0.25, 0,    0, leftUpperArm);
  const leftHand      = makeBone('leftHand',       0.25, 0,    0, leftLowerArm);

  const rightShoulder = makeBone('rightShoulder', -0.05, 0.15, 0, chest);
  const rightUpperArm = makeBone('rightUpperArm', -0.15, 0,    0, rightShoulder);
  const rightLowerArm = makeBone('rightLowerArm', -0.25, 0,    0, rightUpperArm);
  const rightHand     = makeBone('rightHand',     -0.25, 0,    0, rightLowerArm);

  // ── Legs ───────────────────────────────────────────────────────────────
  const leftUpperLeg  = makeBone('leftUpperLeg',   0.1,  0,    0, hips);
  const leftLowerLeg  = makeBone('leftLowerLeg',   0,   -0.4,  0, leftUpperLeg);
  const leftFoot      = makeBone('leftFoot',       0,   -0.4,  0, leftLowerLeg);
  makeBone('leftToes',                              0,   -0.05, 0.1, leftFoot);

  const rightUpperLeg = makeBone('rightUpperLeg', -0.1,  0,    0, hips);
  const rightLowerLeg = makeBone('rightLowerLeg',  0,   -0.4,  0, rightUpperLeg);
  const rightFoot     = makeBone('rightFoot',      0,   -0.4,  0, rightLowerLeg);
  makeBone('rightToes',                             0,   -0.05, 0.1, rightFoot);

  // Bake initial world matrices.
  scene.updateMatrixWorld(true);

  // Build humanBones record in VRM 1.x shape: { boneName: { node } }.
  const humanBones: Record<string, { node: THREE.Object3D }> = {};
  for (const [name, node] of bones) humanBones[name] = { node };

  const vrm = {
    scene,
    bones,
    meta: { metaVersion: meta.version ?? '1' },
    humanoid: {
      humanBones,
      getNormalizedBoneNode: (name: string): THREE.Object3D | null =>
        bones.get(name) ?? null,
      getRawBoneNode: (name: string): THREE.Object3D | null =>
        bones.get(name) ?? null,
      // Stubs for the rare branches the applier might touch.
      restPose: {},
      normalizedHumanBones: humanBones,
      rawHumanBones: humanBones,
    },
    update: () => {},
    expressionManager: null,
    lookAt: null,
    firstPerson: null,
    springBoneManager: null,
  } as unknown as MockVRM;

  return vrm;
}

/** Build a synthetic PoseFrame with all-visible landmarks at default rest
 *  positions. Use the returned `mutate` callback to tweak specific landmarks. */
export function buildMockPoseFrame(opts: {
  /** Optional visibility override per index (defaults to 1.0). */
  visibility?: Record<number, number>;
} = {}) {
  // 33 MediaPipe pose landmarks (BlazePose). Approximate metric world-space
  // values for a person standing upright facing the camera at ~1 m distance.
  // World-frame: origin at hips, X right, Y up, Z forward (toward camera).
  //
  // We mimic MediaPipe's hip-centric worldLandmarks convention, NOT
  // camera-centric. Indices match LM constants in directPoseConfig.
  const lm = (x: number, y: number, z: number, vis = 1.0) => ({ x, y, z, visibility: vis });

  const visOverride = (idx: number, base = 1.0) =>
    opts.visibility?.[idx] ?? base;

  const worldLandmarks = [
    lm(0,     0.55,   0,    visOverride(0)),   // 0 nose
    lm(0.02,  0.58,   0.02, visOverride(1)),
    lm(0.03,  0.58,   0.02, visOverride(2)),
    lm(0.04,  0.58,   0.02, visOverride(3)),
    lm(-0.02, 0.58,   0.02, visOverride(4)),
    lm(-0.03, 0.58,   0.02, visOverride(5)),
    lm(-0.04, 0.58,   0.02, visOverride(6)),
    lm(0.07,  0.55,   0,    visOverride(7)),   // 7 left ear
    lm(-0.07, 0.55,   0,    visOverride(8)),   // 8 right ear
    lm(0.03,  0.45,   0.04, visOverride(9)),
    lm(-0.03, 0.45,   0.04, visOverride(10)),
    lm(0.2,   0.3,    0,    visOverride(11)),  // 11 left shoulder
    lm(-0.2,  0.3,    0,    visOverride(12)),  // 12 right shoulder
    lm(0.4,   0.3,    0,    visOverride(13)),  // 13 left elbow
    lm(-0.4,  0.3,    0,    visOverride(14)),  // 14 right elbow
    lm(0.6,   0.3,    0,    visOverride(15)),  // 15 left wrist
    lm(-0.6,  0.3,    0,    visOverride(16)),  // 16 right wrist
    lm(0.65,  0.3,    0,    visOverride(17)),
    lm(-0.65, 0.3,    0,    visOverride(18)),
    lm(0.7,   0.3,    0,    visOverride(19)),
    lm(-0.7,  0.3,    0,    visOverride(20)),
    lm(0.62,  0.3,    0,    visOverride(21)),
    lm(-0.62, 0.3,    0,    visOverride(22)),
    lm(0.1,   0,      0,    visOverride(23)),  // 23 left hip
    lm(-0.1,  0,      0,    visOverride(24)),  // 24 right hip
    lm(0.1,  -0.45,   0,    visOverride(25)),  // 25 left knee
    lm(-0.1, -0.45,   0,    visOverride(26)),  // 26 right knee
    lm(0.1,  -0.9,    0,    visOverride(27)),  // 27 left ankle
    lm(-0.1, -0.9,    0,    visOverride(28)),  // 28 right ankle
    lm(0.12, -0.95,   0,    visOverride(29)),
    lm(-0.12, -0.95,  0,    visOverride(30)),
    lm(0.13, -0.92,   0.1,  visOverride(31)),  // 31 left foot index
    lm(-0.13, -0.92,  0.1,  visOverride(32)),  // 32 right foot index
  ];

  // Normalized image-space landmarks (0..1). Just use a similar layout but
  // remapped: x ∈ [0,1] left-to-right, y ∈ [0,1] top-to-bottom.
  const landmarks = worldLandmarks.map((p) => ({
    x: 0.5 + p.x * 0.5,
    y: 0.5 - p.y * 0.5,
    z: p.z,
    visibility: p.visibility,
  }));

  return {
    landmarks,
    worldLandmarks,
    faceLandmarks: [],
    hands: [],
  };
}
