import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { renderLoopHooks } from '../../renderLoopHooks';
import { BVH_FRAME_TIME } from './bvhRecorder';
import { captureSnapshot, type PoseSnapshot } from './bvhRoundtripVerifier';

/**
 * Play `clip` through the production render loop (validator.clampAll + vrm.update
 * + any constraint systems) and snapshot pose after each `vrm.update()`. Unlike
 * `replayClipWithSnapshots`, this measures what the USER sees on screen, not a
 * clean-room evaluation of the clip tracks.
 *
 * Flow:
 *   1. Create a scratch mixer playing the clip from t=0.
 *   2. Register it as the loop's `extraMixer` + suspend overlays (idle, mocap,
 *      bonePanel, micro) so they don't compete for bones. Also suspend the
 *      runtime ROM clamp so the replay sees the same exclusion behaviour as
 *      the capture phase (mocap-driven bones aren't clamped while live).
 *   3. Install `onAfterVrmUpdate` hook; every tick, snapshot one frame until
 *      we have `frameCount` frames, then resolve.
 *   4. Restore hook state + uncache clip.
 *
 * Requires the production render loop to be running (i.e. app fully booted).
 * Reject on timeout (30s) so a missed tick doesn't hang the UI.
 */
export function runProductionReplay(
  vrm: VRM,
  clip: THREE.AnimationClip,
  frameCount: number,
  onProgress?: (i: number) => void,
): Promise<PoseSnapshot[]> {
  return new Promise((resolve, reject) => {
    if (renderLoopHooks.suspendOverlays || renderLoopHooks.extraMixer || renderLoopHooks.onAfterVrmUpdate) {
      reject(new Error('renderLoopHooks busy — another verify pass is active'));
      return;
    }

    const mixer = new THREE.AnimationMixer(vrm.scene);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    mixer.setTime(0);

    const snapshots: PoseSnapshot[] = [];
    let done = false;

    const cleanup = (): void => {
      renderLoopHooks.suspendOverlays = false;
      renderLoopHooks.extraMixer = null;
      renderLoopHooks.suspendValidatorClamp = false;
      renderLoopHooks.onAfterVrmUpdate = null;
      clearTimeout(timeoutId);
      try {
        action.stop();
        mixer.uncacheClip(clip);
        mixer.uncacheRoot(vrm.scene);
      } catch (_e) { /* ignore */ }
    };

    const timeoutId = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error(`production replay timed out at frame ${snapshots.length}/${frameCount}`));
    }, 30_000);

    renderLoopHooks.suspendOverlays = true;
    renderLoopHooks.extraMixer = mixer;
    renderLoopHooks.suspendValidatorClamp = true;
    renderLoopHooks.onAfterVrmUpdate = (_delta) => {
      if (done) return;

      // Sample by mixer.time rounded to BVH frame index. At RAF rate (60+ Hz)
      // we'd otherwise oversample; when RAF lags, we backfill missed frames.
      const targetIdx = Math.min(
        frameCount - 1,
        Math.floor(mixer.time / BVH_FRAME_TIME + 1e-6),
      );
      while (snapshots.length <= targetIdx) {
        snapshots.push(captureSnapshot(vrm, snapshots.length));
      }

      // If the clip clamped (mixer.time stuck at clip.duration), fill any
      // still-missing tail frames with the final pose so we don't hang.
      if (mixer.time >= clip.duration - 1e-6 && snapshots.length < frameCount) {
        while (snapshots.length < frameCount) {
          snapshots.push(captureSnapshot(vrm, snapshots.length));
        }
      }

      onProgress?.(snapshots.length);

      if (snapshots.length >= frameCount) {
        done = true;
        cleanup();
        resolve(snapshots);
      }
    };
  });
}
