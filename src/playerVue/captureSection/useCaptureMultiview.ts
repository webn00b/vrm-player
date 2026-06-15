import { computed, ref, type Ref } from 'vue';
import { notify } from '../../ui';
import type { MocapController } from '../../mocap/pipeline/mocapController';
import type { MultiviewDepthAxis } from './captureSectionTypes';

interface CaptureMultiviewOptions {
  getMocap: () => MocapController | null;
  statusText: Ref<string>;
  framesText: Ref<string>;
  onAnimFile?: (file: File) => Promise<void> | void;
  refreshUi: () => void;
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
    const mocap = options.getMocap();
    if (!mocap || mocap.state !== 'off') return;

    processing.value = true;
    progressText.value = '🎥 Initializing MediaPipe…';
    options.refreshUi();
    notify({
      severity: 'info',
      summary: 'Generating multi-view motion',
      detail: 'Processing front + side videos',
      life: 2200,
    });

    try {
      // Route through the production applier (startFromMultiview), NOT the offline
      // canonical retargeter — same anatomical guards as video/live capture.
      await mocap.startFromMultiview({
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
      // startFromMultiview downloads the BVH + fires onBvhReady (queue + replay).
      options.statusText.value = '✓ multiview recorded';
      notify({ severity: 'success', summary: 'Multi-view BVH ready', life: 3600 });
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)) || 'unknown error';
      options.statusText.value = `❌ ${msg.slice(0, 60)}`;
      notify({ severity: 'error', summary: 'Multi-view failed', detail: msg, life: 5200 });
    } finally {
      processing.value = false;
      progressText.value = '';
      options.refreshUi();
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
