import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { AnimationController } from './animationController';
import { downloadBvh } from './mocap/bvhRecorder';
import { createBvhRecorderForVrm } from './mocap/bvhRecorderFactory';
import { renderLoopHooks } from './renderLoopHooks';

/**
 * Plays the queue item at `queuePos` from the start, captures every render
 * frame into a fresh BvhRecorder, and downloads the result when the clip
 * completes one loop. Reuses the live render path (so mocap, bonePanel, and
 * validator clamp all participate exactly as they would for any other
 * playback) — the recorded BVH matches what's on screen.
 *
 * Returns a Promise that resolves with the filename once the file is saved,
 * or rejects on error / abort.
 */
export function exportClipAsBvh(
  queuePos: number,
  controller: AnimationController,
  vrm: VRM,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (queuePos < 0 || queuePos >= controller.queueLength) {
      reject(new Error('Invalid queue position'));
      return;
    }

    if (renderLoopHooks.poseCaptureSink) {
      reject(new Error('Another BVH export is already in progress'));
      return;
    }

    const recorder = createBvhRecorderForVrm(vrm);

    // Snapshot per-frame: read every supported bone's quaternion and the hips'
    // local position. Using getNormalizedBoneNode mirrors how mocap recording
    // captures the same fields → identical encode path.
    const _qScratch = new THREE.Quaternion();
    const getQuaternion = (boneName: string): [number, number, number, number] | null => {
      const node = vrm.humanoid.getNormalizedBoneNode(boneName as any);
      if (!node) return null;
      _qScratch.copy(node.quaternion);
      return [_qScratch.x, _qScratch.y, _qScratch.z, _qScratch.w];
    };
    const getHipsPosition = (): [number, number, number] | null => {
      const hips = vrm.humanoid.getNormalizedBoneNode('hips' as any);
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

    let elapsed = 0;
    let finished = false;

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
  });
}
