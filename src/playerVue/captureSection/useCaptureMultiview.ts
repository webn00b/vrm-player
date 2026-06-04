import { computed, ref, type Ref } from 'vue';
import { generateBrowserMultiviewMotion } from '../../mocap/offline/multiviewMediapipe';
import { notify } from '../../ui';
import type { MultiviewDepthAxis } from './captureSectionTypes';

interface CaptureMultiviewOptions {
  statusText: Ref<string>;
  framesText: Ref<string>;
  onAnimFile?: (file: File) => Promise<void> | void;
  refreshUi: () => void;
}

function jsonFile(payload: Record<string, unknown>, filename: string): File {
  return new File([JSON.stringify(payload, null, 2)], filename, { type: 'application/json' });
}

function downloadJson(payload: Record<string, unknown>, filename: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function useCaptureMultiview(options: CaptureMultiviewOptions) {
  const frontFile = ref<File | null>(null);
  const sideFile = ref<File | null>(null);
  const processing = ref(false);
  const fps = ref(6);
  const sideOffset = ref(0);
  const depthAxis = ref<MultiviewDepthAxis>('x');
  const depthScale = ref(1);
  const smoothing = ref(0.65);
  const progressText = ref('');
  const canGenerate = computed(() => !!frontFile.value && !!sideFile.value && !processing.value);
  const frontLabel = computed(() => (frontFile.value ? 'Front ✓' : 'Front…'));
  const sideLabel = computed(() => (sideFile.value ? 'Side ✓' : 'Side…'));

  function outputName(): string {
    const front = frontFile.value?.name.replace(/\.[^.]+$/, '') || 'front';
    const side = sideFile.value?.name.replace(/\.[^.]+$/, '') || 'side';
    return `${front}_${side}.browser.multiview.motion.json`;
  }

  function onFrontChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    frontFile.value = input.files?.[0] ?? null;
    input.value = '';
    options.refreshUi();
  }

  function onSideChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    sideFile.value = input.files?.[0] ?? null;
    input.value = '';
    options.refreshUi();
  }

  async function generate(): Promise<void> {
    if (!frontFile.value || !sideFile.value || processing.value) return;
    if (!options.onAnimFile) {
      notify({ severity: 'error', summary: 'Animation import unavailable' });
      return;
    }

    processing.value = true;
    progressText.value = '🎥 Initializing MediaPipe…';
    options.refreshUi();
    notify({
      severity: 'info',
      summary: 'Generating multi-view motion',
      detail: 'Processing front + side videos',
      life: 2200,
    });
    let finalStatus: string | null = null;
    let finalFrames = '';

    try {
      const result = await generateBrowserMultiviewMotion({
        front: frontFile.value,
        side: sideFile.value,
        fps: Math.max(1, fps.value || 6),
        sideOffsetFrames: Math.trunc(sideOffset.value || 0),
        frontMirrorX: true,
        sideMirrorX: true,
        sideDepthAxis: depthAxis.value,
        depthScale: depthScale.value,
        depthOffset: 0,
        smoothingAlpha: smoothing.value,
        visibility: 0.35,
        onProgress: (message) => {
          progressText.value = `🎥 ${message}`;
          options.statusText.value = progressText.value;
        },
      });
      const filename = outputName();
      downloadJson(result.motion, filename);
      downloadJson(result.report, filename.replace(/\.json$/, '.fusion.report.json'));
      await options.onAnimFile(jsonFile(result.motion, filename));
      const frames = Array.isArray(result.motion.frames) ? result.motion.frames.length : 0;
      finalStatus = `✓ multiview loaded · ${frames} frames`;
      finalFrames = filename;
      notify({ severity: 'success', summary: 'Multi-view motion ready', detail: `${frames} frames`, life: 3600 });
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)) || 'unknown error';
      options.statusText.value = `❌ ${msg.slice(0, 60)}`;
      notify({ severity: 'error', summary: 'Multi-view failed', detail: msg, life: 5200 });
    } finally {
      processing.value = false;
      progressText.value = '';
      options.refreshUi();
      if (finalStatus) {
        options.statusText.value = finalStatus;
        options.framesText.value = finalFrames;
      }
    }
  }

  return {
    frontFile,
    sideFile,
    processing,
    fps,
    sideOffset,
    depthAxis,
    depthScale,
    progressText,
    canGenerate,
    frontLabel,
    sideLabel,
    onFrontChange,
    onSideChange,
    generate,
  };
}
