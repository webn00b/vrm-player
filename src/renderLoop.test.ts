import { describe, expect, test, vi } from 'vitest';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { selectValidationClampPlan, startRenderLoop } from './renderLoop';
import {
  CLIP_VALIDATION_EXCLUDED_BONES,
  MOCAP_VALIDATION_EXCLUDED_BONES,
} from './mocap/diagnostics/mocapValidationBones';
import { DEFAULT_VALIDATION_SETTINGS } from './validation/validationSettings';

describe('selectValidationClampPlan', () => {
  test('keeps current live mocap exclusions for safe recording validation', () => {
    expect(selectValidationClampPlan({
      hasBvhActive: false,
      mocapState: 'live',
      validatorEnabled: true,
      settings: DEFAULT_VALIDATION_SETTINGS,
    })).toEqual({
      shouldClamp: true,
      excludedBones: MOCAP_VALIDATION_EXCLUDED_BONES,
    });
  });

  test('does not exclude live mocap limbs for full recording validation', () => {
    expect(selectValidationClampPlan({
      hasBvhActive: false,
      mocapState: 'recording',
      validatorEnabled: true,
      settings: {
        ...DEFAULT_VALIDATION_SETTINGS,
        recordingClampMode: 'full',
      },
    })).toEqual({
      shouldClamp: true,
      excludedBones: undefined,
    });
  });

  test('can disable recording validation while leaving runtime validation enabled elsewhere', () => {
    expect(selectValidationClampPlan({
      hasBvhActive: false,
      mocapState: 'recording',
      validatorEnabled: true,
      settings: {
        ...DEFAULT_VALIDATION_SETTINGS,
        recordingClampMode: 'off',
      },
    })).toEqual({
      shouldClamp: false,
      excludedBones: undefined,
    });
  });

  test('preserves clip playback exclusions for safe playback validation', () => {
    const plan = selectValidationClampPlan({
      hasBvhActive: true,
      mocapState: 'live',
      validatorEnabled: true,
      settings: DEFAULT_VALIDATION_SETTINGS,
    });

    expect(plan.shouldClamp).toBe(true);
    expect(plan.excludedBones).toBe(CLIP_VALIDATION_EXCLUDED_BONES);
    expect(plan.excludedBones?.has(VRMHumanBoneName.Hips)).toBe(true);
  });

  test('can fully clamp or disable playback validation', () => {
    expect(selectValidationClampPlan({
      hasBvhActive: true,
      mocapState: 'off',
      validatorEnabled: true,
      settings: {
        ...DEFAULT_VALIDATION_SETTINGS,
        playbackClampMode: 'full',
      },
    })).toEqual({
      shouldClamp: true,
      excludedBones: undefined,
    });

    expect(selectValidationClampPlan({
      hasBvhActive: true,
      mocapState: 'off',
      validatorEnabled: true,
      settings: {
        ...DEFAULT_VALIDATION_SETTINGS,
        playbackClampMode: 'off',
      },
    })).toEqual({
      shouldClamp: false,
      excludedBones: undefined,
    });
  });
});

test('render loop captures the red skeleton pose before validation clamps the frame', () => {
  const order: string[] = [];
  const poseClampMasks: Array<ReadonlySet<VRMHumanBoneName> | undefined> = [];
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 7));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());

  const cleanup = startRenderLoop(
    {
      clock: { getDelta: () => 1 / 60 },
      controls: { update: () => order.push('controls') },
      renderer: { render: () => order.push('render') },
      scene: {},
      camera: {},
    } as never,
    {
      update: () => order.push('vrm.update'),
      humanoid: { getNormalizedBoneNode: () => null },
    } as never,
    {
      controller: { update: () => order.push('controller.update'), hasBvhActive: true, muted: false },
      idle: { update: () => order.push('idle.update') },
      pa: { applyAll: () => order.push('pa.applyAll') },
      micro: { update: () => order.push('micro.update') },
    } as never,
    {
      mocap: {
        state: 'off',
        applyLatestFrame: () => order.push('mocap.applyLatestFrame'),
        applyTrackedHandsOverlay: () => order.push('mocap.applyTrackedHandsOverlay'),
        captureRecordedFrame: () => order.push('mocap.captureRecordedFrame'),
        latestFrame: null,
        debugTargets: {},
        calibration: {},
        hipsBaseWorld: {},
      },
      debugViz: { visible: false },
      dbgRecorder: { active: false },
    } as never,
    {
      skelViz: {
        captureUnclampedPose: () => order.push('skelViz.captureUnclampedPose'),
        update: () => order.push('skelViz.update'),
      },
      validator: {
        enabled: true,
        clampAll: () => order.push('validator.clampAll'),
      },
      poseValidator: {
        enabled: true,
        validateAndClamp: (excludedBones?: ReadonlySet<VRMHumanBoneName>) => {
          order.push('poseValidator.validateAndClamp');
          poseClampMasks.push(excludedBones);
        },
      },
      bonePanel: { apply: () => order.push('bonePanel.apply') },
      boneDrag: {
        update: () => order.push('boneDrag.update'),
        apply: () => order.push('boneDrag.apply'),
      },
      hipForce: { update: () => order.push('hipForce.update') },
      hipBalance: { apply: () => order.push('hipBalance.apply') },
    } as never,
  );

  cleanup();

  expect(order.indexOf('controller.update')).toBeLessThan(order.indexOf('skelViz.captureUnclampedPose'));
  expect(order.indexOf('boneDrag.apply')).toBeLessThan(order.indexOf('skelViz.captureUnclampedPose'));
  expect(order.indexOf('skelViz.captureUnclampedPose')).toBeLessThan(order.indexOf('validator.clampAll'));
  expect(order.indexOf('validator.clampAll')).toBeLessThan(order.indexOf('poseValidator.validateAndClamp'));
  expect(poseClampMasks).toEqual([CLIP_VALIDATION_EXCLUDED_BONES]);
});

test('render loop passes mocap recording exclusions to pose validation', () => {
  const boneClampMasks: Array<ReadonlySet<VRMHumanBoneName> | undefined> = [];
  const poseClampMasks: Array<ReadonlySet<VRMHumanBoneName> | undefined> = [];
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 7));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());

  const cleanup = startRenderLoop(
    {
      clock: { getDelta: () => 1 / 60 },
      controls: { update: () => undefined },
      renderer: { render: () => undefined },
      scene: {},
      camera: {},
    } as never,
    {
      update: () => undefined,
      humanoid: { getNormalizedBoneNode: () => null },
    } as never,
    {
      controller: { update: () => undefined, hasBvhActive: false, muted: false },
      idle: { update: () => undefined },
      pa: { applyAll: () => undefined },
      micro: { update: () => undefined },
    } as never,
    {
      mocap: {
        state: 'recording',
        applyLatestFrame: () => undefined,
        applyTrackedHandsOverlay: () => undefined,
        captureRecordedFrame: () => undefined,
        latestFrame: null,
        debugTargets: {},
        calibration: {},
        hipsBaseWorld: {},
      },
      debugViz: { visible: false },
      dbgRecorder: { active: false },
    } as never,
    {
      skelViz: {
        captureUnclampedPose: () => undefined,
        update: () => undefined,
      },
      validator: {
        enabled: true,
        clampAll: (excludedBones?: ReadonlySet<VRMHumanBoneName>) => {
          boneClampMasks.push(excludedBones);
        },
      },
      poseValidator: {
        enabled: true,
        validateAndClamp: (excludedBones?: ReadonlySet<VRMHumanBoneName>) => {
          poseClampMasks.push(excludedBones);
        },
      },
      bonePanel: { apply: () => undefined },
      boneDrag: {
        update: () => undefined,
        apply: () => undefined,
      },
      hipForce: { update: () => undefined },
      hipBalance: { apply: () => undefined },
    } as never,
  );

  cleanup();

  expect(boneClampMasks).toEqual([MOCAP_VALIDATION_EXCLUDED_BONES]);
  expect(poseClampMasks).toEqual([MOCAP_VALIDATION_EXCLUDED_BONES]);
});
