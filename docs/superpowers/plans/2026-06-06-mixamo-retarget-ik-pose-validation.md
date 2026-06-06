# Mixamo Retarget IK Pose Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ad hoc arm Euler corrections with a Mixamo-informed retarget/pose-validation path that uses known Mixamo mapping ideas, explicit pose profiles, and two-bone IK guardrails for shoulder-elbow-wrist chains.

**Architecture:** Keep the existing BVH/VRMA retarget path, local ROM validator, and diagnostic UI, but split Mixamo-specific knowledge into explicit profile modules. Add a reference-comparison harness for Mixamo retarget assumptions, move pose limits out of `PoseValidator`, and change arm correction from fixed Euler nudges to target/pole-based two-bone IK using the existing `applyTwoBoneChain` solver. `PoseValidator` remains the diagnostic/guardrail layer, not the primary retargeter.

**Tech Stack:** TypeScript, Three.js `Object3D`/quaternions, `@pixiv/three-vrm`, existing `solveTwoBoneIK` and `applyTwoBoneChain`, Vitest, Vue debug panels.

---

## File Structure

- Create `src/validation/poseConstraints.ts`
  - Owns named pose profiles (`default`, `mixamoLive`) for chain/world-space rules.
  - Exports typed arm thresholds, allowed pose classes, and IK correction parameters.

- Modify `src/validation/boneConstraints.ts`
  - Keep local ROM profiles here.
  - Re-export shared profile ids from a single place if needed.
  - Remove any new pose-chain constants from this file.

- Modify `src/validation/poseValidator.ts`
  - Consume `poseConstraints.ts`.
  - Replace hardcoded Euler target constants with two-bone IK correction.
  - Keep stats shape stable enough for UI dump.

- Modify `src/validation/poseValidator.test.ts`
  - Add tests for profile lookup, Mixamo backward-arm dumps, normal side reach, overhead reach, cross-body reach, and lower-arm backward chains.

- Create `src/retargeting/mixamoReference.ts`
  - Centralizes Mixamo bone-name normalization and mapping notes from V-Sekai / `vrm-mixamo-retarget` style examples.
  - Does not import external packages.

- Create `src/retargeting/mixamoReference.test.ts`
  - Pins known Mixamo names like `mixamorigLeftArm`, `mixamorig:LeftForeArm`, `LeftHandIndex1`.

- Modify `src/animationLoaders/fbxBoneMap.ts`
  - Reuse `mixamoReference.ts` normalization/mapping where it overlaps.

- Modify `src/humanoidRestPose.ts`
  - Add optional diagnostics for rest-pose correction per humanoid bone.
  - Do not change math in the first pass unless comparison tests prove a mismatch.

- Modify `src/retarget.ts`
  - Add structured `mixamoReference` diagnostics to `[animation:retarget]`.
  - Keep existing BVH → VRMA → clip flow.

- Modify `src/playerVue/ValidationControlsPanel.vue`
  - Include active pose profile and `poseStats` in top Dump.

- Modify `src/playerVue/ValidationFoldContent.vue`
  - Show pose profile, pose class, and last violations.

---

## Task 1: Extract Pose Constraint Profiles

**Files:**
- Create: `src/validation/poseConstraints.ts`
- Modify: `src/validation/poseValidator.ts`
- Test: `src/validation/poseValidator.test.ts`

- [ ] **Step 1: Write the failing profile test**

Add this test to `src/validation/poseValidator.test.ts`:

```ts
import { MIXAMO_LIVE_POSE_CONSTRAINTS, getPoseConstraints } from './poseConstraints';

test('Mixamo Live pose profile exposes arm chain thresholds', () => {
  const constraints = getPoseConstraints('mixamoLive');

  expect(constraints).toBe(MIXAMO_LIVE_POSE_CONSTRAINTS);
  expect(constraints.arms.backward.upperArmMaxDeg).toBe(120);
  expect(constraints.arms.backward.forearmMaxDeg).toBe(120);
  expect(constraints.arms.allowedPoseClasses).toContain('overhead');
  expect(constraints.arms.allowedPoseClasses).toContain('crossBody');
  expect(constraints.arms.ik.maxReachFraction).toBeCloseTo(0.98);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/validation/poseValidator.test.ts
```

Expected: FAIL because `./poseConstraints` does not exist.

- [ ] **Step 3: Create pose constraints module**

Create `src/validation/poseConstraints.ts`:

```ts
import type { ArmPoseClass } from './poseValidator';

export type PoseConstraintProfileId = 'default' | 'mixamoLive';

export interface ArmBackwardConstraints {
  upperArmMaxDeg: number;
  forearmMaxDeg: number;
}

export interface ArmIkCorrectionConstraints {
  maxReachFraction: number;
  correctionLerp: number;
  sidePole: {
    left: [number, number, number];
    right: [number, number, number];
  };
  safeTargetBias: {
    forward: number;
    lateral: number;
    upward: number;
  };
}

export interface ArmPoseConstraints {
  backward: ArmBackwardConstraints;
  allowedPoseClasses: ArmPoseClass[];
  ik: ArmIkCorrectionConstraints;
}

export interface PoseConstraints {
  profileId: PoseConstraintProfileId;
  arms: ArmPoseConstraints;
}

export const DEFAULT_POSE_CONSTRAINTS: PoseConstraints = {
  profileId: 'default',
  arms: {
    backward: {
      upperArmMaxDeg: 135,
      forearmMaxDeg: 135,
    },
    allowedPoseClasses: ['sideReach', 'frontReach', 'overhead', 'crossBody'],
    ik: {
      maxReachFraction: 0.98,
      correctionLerp: 1,
      sidePole: {
        left: [0, -1, 0.35],
        right: [0, -1, 0.35],
      },
      safeTargetBias: {
        forward: 0.22,
        lateral: 0.45,
        upward: 0,
      },
    },
  },
};

export const MIXAMO_LIVE_POSE_CONSTRAINTS: PoseConstraints = {
  profileId: 'mixamoLive',
  arms: {
    backward: {
      upperArmMaxDeg: 120,
      forearmMaxDeg: 120,
    },
    allowedPoseClasses: ['sideReach', 'frontReach', 'overhead', 'crossBody'],
    ik: {
      maxReachFraction: 0.98,
      correctionLerp: 1,
      sidePole: {
        left: [0, -1, 0.45],
        right: [0, -1, 0.45],
      },
      safeTargetBias: {
        forward: 0.28,
        lateral: 0.5,
        upward: 0,
      },
    },
  },
};

export const POSE_CONSTRAINT_PROFILES: Record<PoseConstraintProfileId, PoseConstraints> = {
  default: DEFAULT_POSE_CONSTRAINTS,
  mixamoLive: MIXAMO_LIVE_POSE_CONSTRAINTS,
};

export function getPoseConstraints(profileId: PoseConstraintProfileId): PoseConstraints {
  return POSE_CONSTRAINT_PROFILES[profileId] ?? DEFAULT_POSE_CONSTRAINTS;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- src/validation/poseValidator.test.ts
```

Expected: PASS for the new profile test, or fail only on unrelated existing behavior that this task has not touched.

- [ ] **Step 5: Commit**

```bash
git add src/validation/poseConstraints.ts src/validation/poseValidator.test.ts
git commit -m "feat: add pose constraint profiles"
```

---

## Task 2: Centralize Mixamo Reference Mapping

**Files:**
- Create: `src/retargeting/mixamoReference.ts`
- Create: `src/retargeting/mixamoReference.test.ts`
- Modify: `src/animationLoaders/fbxBoneMap.ts`

- [ ] **Step 1: Write failing mapping tests**

Create `src/retargeting/mixamoReference.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { mixamoBoneToHumanoid, normalizeMixamoBoneName } from './mixamoReference';

describe('Mixamo reference mapping', () => {
  test('normalizes common Mixamo prefixes and punctuation', () => {
    expect(normalizeMixamoBoneName('mixamorig:LeftArm')).toBe('leftarm');
    expect(normalizeMixamoBoneName('mixamorigLeftForeArm')).toBe('leftforearm');
    expect(normalizeMixamoBoneName('MixamoRig_RightHandIndex1')).toBe('righthandindex1');
  });

  test('maps core Mixamo arm bones to VRM humanoid bones', () => {
    expect(mixamoBoneToHumanoid('mixamorigLeftArm')).toBe(VRMHumanBoneName.LeftUpperArm);
    expect(mixamoBoneToHumanoid('mixamorig:LeftForeArm')).toBe(VRMHumanBoneName.LeftLowerArm);
    expect(mixamoBoneToHumanoid('mixamorigRightHand')).toBe(VRMHumanBoneName.RightHand);
  });

  test('maps Mixamo fingers used by FBX imports', () => {
    expect(mixamoBoneToHumanoid('mixamorigLeftHandIndex1')).toBe(VRMHumanBoneName.LeftIndexProximal);
    expect(mixamoBoneToHumanoid('mixamorigRightHandThumb3')).toBe(VRMHumanBoneName.RightThumbDistal);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/retargeting/mixamoReference.test.ts
```

Expected: FAIL because `mixamoReference.ts` does not exist.

- [ ] **Step 3: Implement Mixamo reference mapping**

Create `src/retargeting/mixamoReference.ts`:

```ts
import { VRMHumanBoneName } from '@pixiv/three-vrm';

export function normalizeMixamoBoneName(name: string): string {
  return name
    .replace(/^mixamorig[:_\s-]?/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

const MIXAMO_TO_HUMANOID: Record<string, VRMHumanBoneName> = {
  hips: VRMHumanBoneName.Hips,
  spine: VRMHumanBoneName.Spine,
  spine1: VRMHumanBoneName.Chest,
  spine2: VRMHumanBoneName.UpperChest,
  neck: VRMHumanBoneName.Neck,
  head: VRMHumanBoneName.Head,

  leftshoulder: VRMHumanBoneName.LeftShoulder,
  leftarm: VRMHumanBoneName.LeftUpperArm,
  leftforearm: VRMHumanBoneName.LeftLowerArm,
  lefthand: VRMHumanBoneName.LeftHand,
  rightshoulder: VRMHumanBoneName.RightShoulder,
  rightarm: VRMHumanBoneName.RightUpperArm,
  rightforearm: VRMHumanBoneName.RightLowerArm,
  righthand: VRMHumanBoneName.RightHand,

  leftupleg: VRMHumanBoneName.LeftUpperLeg,
  leftleg: VRMHumanBoneName.LeftLowerLeg,
  leftfoot: VRMHumanBoneName.LeftFoot,
  lefttoebase: VRMHumanBoneName.LeftToes,
  rightupleg: VRMHumanBoneName.RightUpperLeg,
  rightleg: VRMHumanBoneName.RightLowerLeg,
  rightfoot: VRMHumanBoneName.RightFoot,
  righttoebase: VRMHumanBoneName.RightToes,

  lefthandthumb1: VRMHumanBoneName.LeftThumbMetacarpal,
  lefthandthumb2: VRMHumanBoneName.LeftThumbProximal,
  lefthandthumb3: VRMHumanBoneName.LeftThumbDistal,
  lefthandindex1: VRMHumanBoneName.LeftIndexProximal,
  lefthandindex2: VRMHumanBoneName.LeftIndexIntermediate,
  lefthandindex3: VRMHumanBoneName.LeftIndexDistal,
  righthandthumb1: VRMHumanBoneName.RightThumbMetacarpal,
  righthandthumb2: VRMHumanBoneName.RightThumbProximal,
  righthandthumb3: VRMHumanBoneName.RightThumbDistal,
  righthandindex1: VRMHumanBoneName.RightIndexProximal,
  righthandindex2: VRMHumanBoneName.RightIndexIntermediate,
  righthandindex3: VRMHumanBoneName.RightIndexDistal,
};

export function mixamoBoneToHumanoid(name: string): VRMHumanBoneName | null {
  return MIXAMO_TO_HUMANOID[normalizeMixamoBoneName(name)] ?? null;
}
```

- [ ] **Step 4: Reuse mapping in FBX bone map**

Modify `src/animationLoaders/fbxBoneMap.ts` so its lookup first calls `mixamoBoneToHumanoid(name)` and falls back to existing local logic:

```ts
import { mixamoBoneToHumanoid } from '../retargeting/mixamoReference';

export function fbxBoneToHumanoid(name: string): VRMHumanBoneName | null {
  const mixamo = mixamoBoneToHumanoid(name);
  if (mixamo) return mixamo;
  return existingFbxBoneToHumanoidFallback(name);
}
```

Use the actual existing exported function name in `fbxBoneMap.ts`; keep the fallback body unchanged by moving it into `existingFbxBoneToHumanoidFallback`.

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- src/retargeting/mixamoReference.test.ts src/playerVue/retargetMappingModel.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/retargeting/mixamoReference.ts src/retargeting/mixamoReference.test.ts src/animationLoaders/fbxBoneMap.ts
git commit -m "feat: centralize mixamo bone mapping"
```

---

## Task 3: Add Retarget Comparison Diagnostics

**Files:**
- Modify: `src/retarget.ts`
- Modify: `src/humanoidRestPose.ts`
- Test: `tests/regression/bvhPlaybackBinding.test.ts`

- [ ] **Step 1: Write failing diagnostic test**

Add this assertion to `tests/regression/bvhPlaybackBinding.test.ts` after the clip is built:

```ts
const retargetInfo = clip.userData?.retargetInfo;
assert.equal(retargetInfo?.source, 'bvh-vrma');
assert.ok(Number.isFinite(retargetInfo?.restCorrectionTracks));
assert.ok(Number.isFinite(retargetInfo?.signFlips));
assert.ok(Number.isFinite(retargetInfo?.validationViolations));
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/regression/bvhPlaybackBinding.test.ts
```

Expected: FAIL because `clip.userData.retargetInfo` is missing.

- [ ] **Step 3: Attach structured retarget diagnostics**

In `src/retarget.ts`, after validation report creation and before `return clip`, add:

```ts
clip.userData = {
  ...clip.userData,
  retargetInfo: {
    source: 'bvh-vrma',
    name,
    sourceBones: bvh.skeleton.bones.length,
    sourceTracks: bvh.clip.tracks.length,
    clipTracks: clip.tracks.length,
    clipTargets: uniqueTrackTargets(clip),
    restCorrectionTracks: correctedTracks,
    signFlips,
    signFlipTracks,
    validationViolations: report.violationCount,
    validationWorstBone: report.worstBone ?? null,
    profileId: opts.profileId ?? 'default',
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/regression/bvhPlaybackBinding.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/retarget.ts tests/regression/bvhPlaybackBinding.test.ts
git commit -m "test: expose retarget diagnostics on clips"
```

---

## Task 4: Replace PoseValidator Euler Nudges With Two-Bone IK Guardrail

**Files:**
- Modify: `src/validation/poseValidator.ts`
- Modify: `src/validation/poseValidator.test.ts`
- Uses existing: `src/mocap/solvers/twoBoneChainApplication.ts`

- [ ] **Step 1: Write failing test that confirms IK preserves chain length**

Add to `src/validation/poseValidator.test.ts`:

```ts
test('IK guardrail preserves upper and lower arm segment lengths while correcting backward pose', () => {
  const vrm = buildMockVRM();
  const validator = new PoseValidator(vrm, { profileId: 'mixamoLive' });
  setEuler(vrm.bones.get('leftUpperArm'), 22.873734256102377, 23.999999077874545, -29.999999999999996);
  setEuler(vrm.bones.get('leftLowerArm'), 38.87501093621991, 74.99999999999984, -6.000000000000001);
  vrm.scene.updateMatrixWorld(true);

  const before = validator.getArmWorldSnapshot('left');
  const stats = validator.validateAndClamp();
  const after = validator.getArmWorldSnapshot('left');

  expect(stats.violations).toContain('leftUpperArm.backwardChain');
  expect(stats.clampedThisFrame).toBeGreaterThan(0);
  expect(after.upperLength).toBeCloseTo(before.upperLength, 5);
  expect(after.lowerLength).toBeCloseTo(before.lowerLength, 5);
  expect(after.upperArmForwardDeg).toBeLessThanOrEqual(120);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/validation/poseValidator.test.ts
```

Expected: FAIL because `PoseValidator` does not accept constructor options and does not expose `getArmWorldSnapshot`.

- [ ] **Step 3: Add PoseValidator constructor options and snapshots**

In `src/validation/poseValidator.ts`, add:

```ts
import { applyTwoBoneChain } from '../mocap/solvers/twoBoneChainApplication';
import { getPoseConstraints, type PoseConstraintProfileId } from './poseConstraints';

export interface PoseValidatorOptions {
  profileId?: PoseConstraintProfileId;
}

export interface ArmWorldSnapshot {
  upperLength: number;
  lowerLength: number;
  upperArmForwardDeg: number | null;
  forearmForwardDeg: number | null;
}
```

Change constructor:

```ts
constructor(private readonly vrm: VRM, opts: PoseValidatorOptions = {}) {
  this.constraints = getPoseConstraints(opts.profileId ?? 'mixamoLive');
}
```

Add a public snapshot method:

```ts
getArmWorldSnapshot(side: 'left' | 'right'): ArmWorldSnapshot {
  this.vrm.scene?.updateMatrixWorld(true);
  const torso = this.computeTorsoBasis();
  const nodes = this.getArmNodes(side);
  if (!torso || !nodes) {
    return { upperLength: 0, lowerLength: 0, upperArmForwardDeg: null, forearmForwardDeg: null };
  }
  const stats = this.computeArmStats(side, torso);
  nodes.upper.getWorldPosition(_a);
  nodes.lower.getWorldPosition(_b);
  nodes.hand.getWorldPosition(_c);
  return {
    upperLength: _a.distanceTo(_b),
    lowerLength: _b.distanceTo(_c),
    upperArmForwardDeg: stats.upperArmForwardDeg,
    forearmForwardDeg: stats.forearmForwardDeg,
  };
}
```

- [ ] **Step 4: Replace Euler target correction with IK correction**

In `PoseValidator`, replace `clampUpperArmBackward` and `clampLowerArmBackward` with one method:

```ts
private applyArmIkGuardrail(side: 'left' | 'right', stats: PoseArmStats, torso: TorsoBasis): boolean {
  if (!stats.violations.some((v) => v.endsWith('.backwardChain'))) return false;
  const nodes = this.getArmNodes(side);
  if (!nodes) return false;

  nodes.upper.getWorldPosition(_a);
  nodes.lower.getWorldPosition(_b);
  nodes.hand.getWorldPosition(_c);

  const upperLength = _a.distanceTo(_b);
  const lowerLength = _b.distanceTo(_c);
  if (upperLength < 1e-6 || lowerLength < 1e-6) return false;

  const lateralSign = side === 'left' ? 1 : -1;
  const targetWorld = _a.clone()
    .addScaledVector(torso.left, this.constraints.arms.ik.safeTargetBias.lateral * lateralSign * (upperLength + lowerLength))
    .addScaledVector(torso.forward, this.constraints.arms.ik.safeTargetBias.forward * (upperLength + lowerLength))
    .addScaledVector(torso.up, this.constraints.arms.ik.safeTargetBias.upward * (upperLength + lowerLength));

  const poleTuple = this.constraints.arms.ik.sidePole[side];
  const poleWorld = new THREE.Vector3(poleTuple[0], poleTuple[1], poleTuple[2])
    .normalize()
    .add(torso.forward.clone().multiplyScalar(0.15));

  applyTwoBoneChain({
    rootWorld: _a.clone(),
    targetWorld,
    poleDirection: poleWorld,
    upperLength,
    lowerLength,
    upperNode: nodes.upper,
    lowerNode: nodes.lower,
    upperRestAxis: side === 'left' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(-1, 0, 0),
    lowerRestAxis: side === 'left' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(-1, 0, 0),
    lerp: this.constraints.arms.ik.correctionLerp,
  });
  return true;
}
```

Use this method inside `validateAndClamp()` instead of per-axis correction. Keep `PoseValidator` stats/violations unchanged.

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- src/validation/poseValidator.test.ts src/mocap/solvers/twoBoneChainApplication.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/validation/poseValidator.ts src/validation/poseValidator.test.ts
git commit -m "feat: correct arm pose guardrails with two-bone ik"
```

---

## Task 5: Thread Pose Profile Through Tooling and UI

**Files:**
- Modify: `src/player/modules/toolingModule.ts`
- Modify: `src/playerVue/ValidationControlsPanel.vue`
- Modify: `src/playerVue/ValidationFoldContent.vue`
- Test: `src/playerVue/ValidationControlsPanel.test.ts`

- [ ] **Step 1: Write failing UI dump assertion**

In `src/playerVue/ValidationControlsPanel.test.ts`, extend the existing dump test:

```ts
expect(log).toHaveBeenCalledWith('[validator] controls dump', expect.objectContaining({
  poseStats,
  poseProfileId: 'mixamoLive',
}));
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/playerVue/ValidationControlsPanel.test.ts
```

Expected: FAIL because `poseProfileId` is not included.

- [ ] **Step 3: Expose profile id on PoseValidator**

In `src/validation/poseValidator.ts`, add:

```ts
profileId: PoseConstraintProfileId;

constructor(private readonly vrm: VRM, opts: PoseValidatorOptions = {}) {
  this.profileId = opts.profileId ?? 'mixamoLive';
  this.constraints = getPoseConstraints(this.profileId);
}

setProfile(profileId: PoseConstraintProfileId): void {
  this.profileId = profileId;
  this.constraints = getPoseConstraints(profileId);
  this.stats = makeInitialStats();
}
```

- [ ] **Step 4: Keep PoseValidator profile in sync with validation settings**

In `src/playerVue/ValidationControlsPanel.vue`, update setup:

```ts
props.poseValidator?.setProfile(validationSettings.profileId);
```

In `setProfile(event)`, add:

```ts
props.poseValidator?.setProfile(next);
```

In `dumpValidationState()`, add:

```ts
poseProfileId: props.poseValidator?.profileId ?? null,
```

- [ ] **Step 5: Create PoseValidator with selected profile**

In `src/player/modules/toolingModule.ts`, initialize with current settings:

```ts
import { validationSettings } from '../../validation/validationSettings';

const poseValidator = new PoseValidator(vrm, {
  profileId: validationSettings.profileId,
});
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- src/playerVue/ValidationControlsPanel.test.ts src/validation/poseValidator.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/validation/poseValidator.ts src/player/modules/toolingModule.ts src/playerVue/ValidationControlsPanel.vue src/playerVue/ValidationControlsPanel.test.ts
git commit -m "feat: sync pose validation profile with validation controls"
```

---

## Task 6: Add Retarget Reference Comparison Notes to Docs

**Files:**
- Create: `docs/mixamo-retarget-reference.md`

- [ ] **Step 1: Write the documentation**

Create `docs/mixamo-retarget-reference.md`:

```md
# Mixamo Retarget Reference

This project does not vendor `vrm-mixamo-retarget` or the V-Sekai Mixamo sandbox.
Instead, it uses the same ideas as local, tested code:

- normalize Mixamo bone names (`mixamorig:LeftArm`, `mixamorigLeftArm`)
- map Mixamo arm/leg/finger bones to VRM humanoid names
- keep BVH/VRMA retarget diagnostics on generated clips
- apply local ROM first, then pose-chain guardrails
- correct obvious arm-chain failures with two-bone IK

## Reference Concepts

- Mixamo arm chain: `LeftArm -> LeftForeArm -> LeftHand`
- VRM arm chain: `leftUpperArm -> leftLowerArm -> leftHand`
- Two-bone IK chain: root/upper/lower/tip plus target and pole/hint

## Runtime Order

1. BVH/mocap/manual layers write the authored pose.
2. Red skeleton snapshots the authored pose.
3. `BoneValidator` clamps local ROM.
4. `PoseValidator` classifies and corrects arm-chain pose violations.
5. Debug/logger/recording/render see the corrected pose.

## Known Limits

The first pose validator release handles arms only. Legs should use the same
profile and two-bone IK shape in a later pass.
```

- [ ] **Step 2: Verify docs are present**

Run:

```bash
test -f docs/mixamo-retarget-reference.md
```

Expected: command exits 0.

- [ ] **Step 3: Commit**

```bash
git add docs/mixamo-retarget-reference.md
git commit -m "docs: document mixamo retarget reference strategy"
```

---

## Task 7: Full Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run unit tests**

Run:

```bash
npm test
```

Expected: all Vitest files pass.

- [ ] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: `vue-tsc --noEmit` passes and Vite build completes.

- [ ] **Step 3: Browser smoke test**

Start or reuse the dev server:

```bash
npm run dev -- --host 127.0.0.1 --port 5333
```

Open `http://127.0.0.1:5333/` and verify:

- The top validation bar still shows `ROM`, `Profile`, `Playback`, `Recording`, `Import`, and `Dump`.
- Clicking `Dump` logs an object containing `stats`, `poseStats`, and `poseProfileId`.
- Loading the previously problematic BVH no longer leaves `poseStats.clampedThisFrame: 0` when `poseStats.violations` includes `backwardChain`.

- [ ] **Step 4: Commit verification fixes if any**

If verification required small fixes:

```bash
git add <changed-files>
git commit -m "fix: stabilize mixamo pose validation verification"
```

If no fixes were required, do not create an empty commit.

---

## Self-Review

- Spec coverage: The plan covers comparing Mixamo retarget assumptions, centralizing mapping, keeping rest-pose diagnostics, moving constraints into profiles, replacing Euler nudges with two-bone IK, keeping `PoseValidator` as diagnostics/guardrail, and full verification.
- Placeholder scan: No TODO/TBD placeholders remain.
- Type consistency: Profile ids are `default | mixamoLive`; `PoseValidator` exposes `profileId`, `setProfile`, `getStats`, and `getArmWorldSnapshot`; UI dump uses `poseStats` and `poseProfileId`.
