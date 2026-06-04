import type { Ref } from 'vue';
import type { VRM } from '@pixiv/three-vrm';
import type { AnimationController } from '../../animationController';
import { exportClipAsBvh, type BvhExportHandle } from '../../bvhExportRecorder';
import { notify } from '../../ui';

interface CaptureAnimExportOptions {
  getController: () => AnimationController | null;
  mocapVrm: VRM;
  statusText: Ref<string>;
  framesText: Ref<string>;
  primaryLabel: Ref<string>;
  primaryDisabled: Ref<boolean>;
  primaryRecording: Ref<boolean>;
  trackInterval: (fn: () => void, ms: number) => number;
  clearTrackedTimer: (id: number) => void;
}

export function useCaptureAnimExport(options: CaptureAnimExportOptions) {
  let exportHandle: BvhExportHandle | null = null;
  let progressTimer = 0;

  function isRecording(): boolean {
    return exportHandle !== null;
  }

  function updateUi(): void {
    const ctrl = options.getController();
    const queueLen = ctrl?.queueLength ?? 0;
    const recording = isRecording();

    options.primaryRecording.value = recording;
    options.primaryDisabled.value = false;

    if (recording) {
      options.primaryLabel.value = '⏹ Stop';
    } else if (queueLen === 0) {
      options.primaryLabel.value = 'Choose animation…';
      options.statusText.value = '🎬 Pick animation / motion JSON';
      options.framesText.value = '';
    } else {
      options.primaryLabel.value = '⏺ Record BVH';
      const name = ctrl?.currentName || '';
      const dur = ctrl?.currentDuration ?? 0;
      options.statusText.value = name
        ? `🎬 ready · ${name} (${dur.toFixed(1)}s)`
        : '🎬 ready';
      options.framesText.value = '';
    }
  }

  function startProgressTimer(): void {
    options.clearTrackedTimer(progressTimer);
    progressTimer = options.trackInterval(() => {
      if (!exportHandle) return;
      const ctrl = options.getController();
      const dur = ctrl?.currentDuration ?? 0;
      const elapsed = exportHandle.elapsed();
      const pct = dur > 0 ? Math.min(100, Math.round((elapsed / dur) * 100)) : 0;
      options.statusText.value = `⏺ recording ${pct}%`;
      options.framesText.value = `${exportHandle.frameCount()} frames`;
    }, 200);
  }

  function startRecord(): void {
    const ctrl = options.getController();
    if (!ctrl || ctrl.queueLength === 0) return;
    if (exportHandle) return;
    const qi = ctrl.currentQueuePos >= 0 ? ctrl.currentQueuePos : 0;
    try {
      const handle = exportClipAsBvh(qi, ctrl, options.mocapVrm);
      exportHandle = handle;
      updateUi();
      startProgressTimer();
      handle.promise
        .then((filename) => {
          options.statusText.value = `✓ saved ${filename}`;
          options.framesText.value = '';
          notify({ severity: 'success', summary: 'BVH saved', detail: filename });
        })
        .catch((e) => {
          const msg = (e as Error).message;
          options.statusText.value = `❌ ${msg.slice(0, 60)}`;
          notify({ severity: 'error', summary: 'BVH export failed', detail: msg, life: 4200 });
        })
        .finally(() => {
          exportHandle = null;
          options.clearTrackedTimer(progressTimer);
          progressTimer = 0;
          updateUi();
        });
    } catch (e) {
      const msg = (e as Error).message;
      options.statusText.value = `❌ ${msg.slice(0, 60)}`;
      notify({ severity: 'error', summary: 'BVH export failed', detail: msg, life: 4200 });
      exportHandle = null;
    }
  }

  function cancelRecord(): void {
    exportHandle?.cancel();
  }

  return {
    isRecording,
    updateUi,
    startRecord,
    cancelRecord,
  };
}
