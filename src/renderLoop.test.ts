import { afterEach, describe, expect, test, vi } from 'vitest';
import { selectValidationClampPlan, startRenderLoop } from './renderLoop';
import {
  DEFAULT_VALIDATION_SETTINGS,
  validationSettings,
} from './validation/validationSettings';

// Validators are off by default; the clamp-order tests below opt in explicitly.
afterEach(() => {
  Object.assign(validationSettings, DEFAULT_VALIDATION_SETTINGS);
});

describe('selectValidationClampPlan', () => {
  test('safe recording mode clamps all bones softly during live mocap', () => {
    expect(selectValidationClampPlan({
      hasBvhActive: false,
      mocapState: 'live',
      validatorEnabled: true,
      settings: { ...DEFAULT_VALIDATION_SETTINGS, recordingClampMode: 'safe' },
    })).toEqual({ shouldClamp: true, soft: true });
  });

  test('defaults leave both playback and recording unclamped', () => {
    for (const [mocapState, hasBvhActive] of [['recording', false], ['off', true]] as const) {
      expect(selectValidationClampPlan({
        hasBvhActive,
        mocapState,
        validatorEnabled: true,
        settings: DEFAULT_VALIDATION_SETTINGS,
      })).toEqual({ shouldClamp: false, soft: false });
    }
  });

  test('full recording mode clamps hard during capture', () => {
    expect(selectValidationClampPlan({
      hasBvhActive: false,
      mocapState: 'recording',
      validatorEnabled: true,
      settings: { ...DEFAULT_VALIDATION_SETTINGS, recordingClampMode: 'full' },
    })).toEqual({ shouldClamp: true, soft: false });
  });

  test('recording validation can be disabled independently', () => {
    expect(selectValidationClampPlan({
      hasBvhActive: false,
      mocapState: 'recording',
      validatorEnabled: true,
      settings: { ...DEFAULT_VALIDATION_SETTINGS, recordingClampMode: 'off' },
    })).toEqual({ shouldClamp: false, soft: false });
  });

  test('active BVH playback follows the playback mode even while mocap is live', () => {
    expect(selectValidationClampPlan({
      hasBvhActive: true,
      mocapState: 'live',
      validatorEnabled: true,
      settings: {
        ...DEFAULT_VALIDATION_SETTINGS,
        playbackClampMode: 'full',
        recordingClampMode: 'off',
      },
    })).toEqual({ shouldClamp: true, soft: false });
  });

  test('playback validation supports soft, hard, and off', () => {
    const base = { hasBvhActive: true, mocapState: 'off' as const, validatorEnabled: true };
    expect(selectValidationClampPlan({
      ...base,
      settings: { ...DEFAULT_VALIDATION_SETTINGS, playbackClampMode: 'safe' },
    })).toEqual({ shouldClamp: true, soft: true });
    expect(selectValidationClampPlan({
      ...base,
      settings: { ...DEFAULT_VALIDATION_SETTINGS, playbackClampMode: 'full' },
    })).toEqual({ shouldClamp: true, soft: false });
    expect(selectValidationClampPlan({
      ...base,
      settings: { ...DEFAULT_VALIDATION_SETTINGS, playbackClampMode: 'off' },
    })).toEqual({ shouldClamp: false, soft: false });
  });

  test('disabled validator short-circuits the plan', () => {
    expect(selectValidationClampPlan({
      hasBvhActive: true,
      mocapState: 'recording',
      validatorEnabled: false,
      settings: DEFAULT_VALIDATION_SETTINGS,
    })).toEqual({ shouldClamp: false, soft: false });
  });
});

test('render loop captures the red skeleton pose before validation clamps the frame', () => {
  const order: string[] = [];
  const clampArgs: unknown[][] = [];
  validationSettings.playbackClampMode = 'safe';
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
      faceTrackPlayer: { hasTrack: false, applyAt() {} },
    } as never,
    {
      skelViz: {
        captureUnclampedPose: () => order.push('skelViz.captureUnclampedPose'),
        update: () => order.push('skelViz.update'),
      },
      validator: {
        enabled: true,
        clampAll: (...args: unknown[]) => {
          order.push('validator.clampAll');
          clampArgs.push(args);
        },
      },
      poseValidator: {
        enabled: true,
        validateAndClamp: () => {
          order.push('poseValidator.validateAndClamp');
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
  // Playback mode 'safe' (set above) → soft clamp of all bones, no mask.
  expect(clampArgs).toEqual([[undefined, { soft: true, deltaSeconds: 1 / 60 }]]);
});

test('render loop soft-clamps all bones while recording mocap', () => {
  const boneClampArgs: unknown[][] = [];
  const poseClampArgs: unknown[][] = [];
  validationSettings.recordingClampMode = 'safe';
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
      faceTrackPlayer: { hasTrack: false, applyAt() {} },
    } as never,
    {
      skelViz: {
        captureUnclampedPose: () => undefined,
        update: () => undefined,
      },
      validator: {
        enabled: true,
        clampAll: (...args: unknown[]) => {
          boneClampArgs.push(args);
        },
      },
      poseValidator: {
        enabled: true,
        validateAndClamp: (...args: unknown[]) => {
          poseClampArgs.push(args);
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

  expect(boneClampArgs).toEqual([[undefined, { soft: true, deltaSeconds: 1 / 60 }]]);
  expect(poseClampArgs).toEqual([[]]);
});
