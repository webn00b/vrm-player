import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import type { AnimationController } from './animationController';
import { downloadBvh } from './mocap/bvh/bvhRecorder';
import { createBvhRecorderForVrm } from './mocap/bvh/bvhRecorderFactory';
import { renderLoopHooks } from './renderLoopHooks';

export interface BvhExportHandle {
  /** Resolves to filename when the file is saved (auto-finish or cancel). */
  readonly promise: Promise<string>;
  /** Stop early. Saves a partial BVH for whatever was captured so far. */
  cancel(): void;
  /** Number of frames written so far (live during recording). */
  readonly frameCount: () => number;
  /** Elapsed seconds since recording started (live during recording). */
  readonly elapsed: () => number;
}

/**
 * Plays the queue item at `queuePos` from the start, captures every render
 * frame into a fresh BvhRecorder, and downloads the result when the clip
 * completes one loop OR when the caller invokes `handle.cancel()`. Reuses the
 * live render path (so mocap, bonePanel, and validator clamp all participate
 * exactly as they would for any other playback) — the recorded BVH matches
 * what's on screen.
 *
 * Returns a `BvhExportHandle` exposing both the underlying Promise and a
 * `cancel()` for early termination. Cancelling still saves a partial BVH —
 * the format tolerates fewer Frames than the implied duration, so a
 * truncated file plays back cleanly in any BVH viewer.
 */
export function exportClipAsBvh(
  queuePos: number,
  controller: AnimationController,
  vrm: VRM,
): BvhExportHandle {
  let elapsed = 0;
  let finished = false;
  let cancelled = false;
  // Default no-op until the Promise executor wires the real implementation
  // synchronously below. A very-early cancel() (extremely unlikely — the
  // executor runs in the same tick) just flips the flag.
  let cancelImpl: () => void = () => { cancelled = true; };
  const recorder = createBvhRecorderForVrm(vrm);

  const promise = new Promise<string>((resolve, reject) => {
    if (queuePos < 0 || queuePos >= controller.queueLength) {
      reject(new Error('Invalid queue position'));
      return;
    }

    if (renderLoopHooks.poseCaptureSink) {
      reject(new Error('Another BVH export is already in progress'));
      return;
    }

    // Snapshot per-frame: read every supported bone's quaternion and the hips'
    // local position. Using getNormalizedBoneNode mirrors how mocap recording
    // captures the same fields → identical encode path.
    const _qScratch = new THREE.Quaternion();
    const getBone = (boneName: string): THREE.Object3D | null =>
      vrm.humanoid.getNormalizedBoneNode(boneName as VRMHumanBoneName);
    const getQuaternion = (boneName: string): [number, number, number, number] | null => {
      const node = getBone(boneName);
      if (!node) return null;
      _qScratch.copy(node.quaternion);
      return [_qScratch.x, _qScratch.y, _qScratch.z, _qScratch.w];
    };
    const getHipsPosition = (): [number, number, number] | null => {
      const hips = getBone('hips');
      if (!hips) return null;
      return [hips.position.x, hips.position.y, hips.position.z];
    };

    // Jump to the start of the requested clip and unpause so the mixer ticks.
    const wasPaused = controller.paused;
    controller.jumpTo(queuePos);
    if (wasPaused) controller.setPaused(false);

    const name = controller.currentName || 'export';
    const duration = controller.currentDuration;
    if (duration <= 0) {
      reject(new Error(`Clip "${name}" has zero duration`));
      return;
    }

    recorder.start();

    const finish = (): void => {
      if (finished) return;
      finished = true;
      renderLoopHooks.poseCaptureSink = null;
      try {
        const text = recorder.stop();
        downloadBvh(text, `${name}.bvh`);
        if (wasPaused) controller.setPaused(true);
        resolve(`${name}.bvh`);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };

    renderLoopHooks.poseCaptureSink = (delta: number): void => {
      // If cancel() flipped the flag between the previous tick and this one,
      // bail out immediately — finish() handles the BVH save itself.
      if (cancelled) {
        finish();
        return;
      }
      recorder.addFrame(getQuaternion, getHipsPosition);
      elapsed += delta;
      // Stop after one full clip duration. Auto-advance in the controller may
      // crossfade to the next item before we're done — guard with elapsed
      // independently of controller.currentTime since the latter resets on
      // queue advance.
      if (elapsed >= duration) {
        finish();
      }
    };

    // Hook up cancel() to do the same finish(). The render-loop sink will
    // observe `cancelled` on its next tick if we don't drain it here.
    cancelImpl = (): void => {
      if (finished) return;
      cancelled = true;
      finish();
    };
  });

  return {
    promise,
    cancel: () => cancelImpl(),
    frameCount: () => recorder.frameCount,
    elapsed: () => elapsed,
  };
}
