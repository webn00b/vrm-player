/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from 'vue';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import ValidationControlsPanel from './ValidationControlsPanel.vue';
import { DEFAULT_VALIDATION_SETTINGS, validationSettings } from '../validation/validationSettings';

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  localStorage.clear();
  Object.assign(validationSettings, DEFAULT_VALIDATION_SETTINGS);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

test('dumps active validation state from the top controls', async () => {
  const stats = {
    clampedThisFrame: 1,
    worstBone: VRMHumanBoneName.LeftUpperArm,
    worstDelta: 0.25,
    armPosture: {
      left: {
        available: true,
        upperArmLocalDeg: [0, 10, 0],
        lowerArmLocalDeg: [20, 0, 0],
        upperArmForwardDeg: 170,
        forearmForwardDeg: 150,
      },
      right: {
        available: true,
        upperArmLocalDeg: [0, -10, 0],
        lowerArmLocalDeg: [20, 0, 0],
        upperArmForwardDeg: 90,
        forearmForwardDeg: 90,
      },
    },
  };
  const validator = {
    enabled: true,
    profileId: 'mixamoLive',
    setEnabled: vi.fn(),
    setProfile: vi.fn(),
    getStats: vi.fn(() => stats),
    getConstraints: vi.fn(() => ({ [VRMHumanBoneName.LeftUpperArm]: { order: 'YXZ' } })),
  };
  const poseStats = {
    clampedThisFrame: 2,
    violations: ['leftUpperArm.backwardChain', 'rightUpperArm.backwardChain'],
    arms: { left: { poseClass: 'behindBack' }, right: { poseClass: 'behindBack' } },
  };
  const poseValidator = {
    getStats: vi.fn(() => poseStats),
  };
  validationSettings.profileId = 'mixamoLive';
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});

  const app = createApp(ValidationControlsPanel, { validator, poseValidator });
  app.mount('#app');

  const button = document.querySelector<HTMLButtonElement>('[aria-label="Dump validation state"]');
  expect(button).toBeTruthy();
  button?.click();
  await Promise.resolve();

  expect(log).toHaveBeenCalledWith('[validator] controls dump', {
    enabled: true,
    profileId: 'mixamoLive',
    settings: validationSettings,
    stats,
    poseStats,
    constraints: { [VRMHumanBoneName.LeftUpperArm]: { order: 'YXZ' } },
  });

  app.unmount();
});
