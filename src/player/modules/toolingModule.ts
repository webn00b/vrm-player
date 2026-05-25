/**
 * Owns diagnostic tooling setup for the player bootstrap.
 * Keeps skeleton and motion trace tooling out of main.ts and cleans up everything it registers.
 */
import { BoneDragController } from '../../boneDragController';
import { BonePosePanel } from '../../bonePosePanel';
import { createSkeletonLogger } from '../../diagnostics/skeletonLogger';
import { MotionTraceRecorder } from '../../diagnostics/motionTraceRecorder';
import { HipBalanceCorrector } from '../../physics/hipBalanceCorrector';
import { HipForceTracker } from '../../physics/hipForce';
import type { ToolingSystems } from '../../playerSystems';
import { sceneControlsState } from '../../playerVue/sceneControlsState';
import { renderLoopHooks } from '../../renderLoopHooks';
import { SkeletonVisualizer } from '../../skeletonVisualizer';
import { BoneValidator } from '../../validation/boneValidator';
import { requirePlayback, requireScene, requireVrm } from '../assertions';
import type { PlayerModule } from '../types';

const VIEWPORT_COMPACT_KEY = 'vrm-player.viewport-compact';

export const toolingModule: PlayerModule = {
  name: 'tooling',
  setup(ctx) {
    const scene = requireScene(ctx);
    const vrm = requireVrm(ctx);
    const playback = requirePlayback(ctx);
    const controller = playback.controller;
    if (!controller) throw new Error('Player playback controller is required before tooling runs');

    const validator = new BoneValidator(vrm);
    const skelViz = new SkeletonVisualizer(vrm, scene.scene);
    const bonePanel = new BonePosePanel(vrm);
    const boneDrag = new BoneDragController(
      vrm, scene.scene, scene.camera, scene.renderer.domElement, scene.controls,
    );
    const hipForce = new HipForceTracker(vrm, { isPaused: () => controller.paused });
    const hipBalance = new HipBalanceCorrector(vrm);
    const skeletonLogger = createSkeletonLogger(vrm, validator);
    const motionTraceRecorder = new MotionTraceRecorder(vrm);

    const forceSkeletonVisibleForCompact = (): void => {
      sceneControlsState.skeletonOn = true;
      sceneControlsState.skelBodyOn = true;
      sceneControlsState.skelFingersOn = true;
      skelViz.setVisible(true);
      skelViz.setShowBody(true);
      skelViz.setShowFingers(true);
    };

    try {
      if (localStorage.getItem(VIEWPORT_COMPACT_KEY) === '1') {
        forceSkeletonVisibleForCompact();
      }
    } catch { /* ignore */ }

    const onViewportCompactChanged = (event: Event): void => {
      const compact = !!(event as CustomEvent<boolean>).detail;
      if (!compact) return;

      forceSkeletonVisibleForCompact();
    };
    window.addEventListener('vrm-player:viewport-compact-changed', onViewportCompactChanged);

    renderLoopHooks.skeletonLoggerTick = () => skeletonLogger.tick();
    renderLoopHooks.motionTraceCaptureSink = () => motionTraceRecorder.capture();
    window.__skelLog = skeletonLogger;
    window.__motionTrace = motionTraceRecorder;

    const tooling: ToolingSystems = {
      skelViz,
      validator,
      bonePanel,
      boneDrag,
      hipForce,
      hipBalance,
      skeletonLogger,
      motionTraceRecorder,
    };
    ctx.tooling = tooling;

    return () => {
      window.removeEventListener('vrm-player:viewport-compact-changed', onViewportCompactChanged);
      renderLoopHooks.skeletonLoggerTick = null;
      renderLoopHooks.motionTraceCaptureSink = null;
      if (window.__motionTrace === motionTraceRecorder) {
        if (motionTraceRecorder.active) motionTraceRecorder.stop();
        delete window.__motionTrace;
      }
      if (window.__skelLog === skeletonLogger) delete window.__skelLog;
      if (ctx.tooling === tooling) ctx.tooling = undefined;
      skelViz.dispose();
      boneDrag.dispose();
    };
  },
};
