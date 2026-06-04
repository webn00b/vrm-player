import { ref, type Ref } from 'vue';
import type { MocapController } from '../../mocap/pipeline/mocapController';

interface CapturePlaybackOptions {
  getMocap: () => MocapController | null;
  framesText: Ref<string>;
}

export function useCapturePlayback(options: CapturePlaybackOptions) {
  const pauseLabel = ref('⏸');
  const paused = ref(false);

  function syncPauseButton(): void {
    const mocap = options.getMocap();
    paused.value = mocap?.isPaused ?? false;
    pauseLabel.value = paused.value ? '▶' : '⏸';
  }

  function onPauseClick(): void {
    const mocap = options.getMocap();
    if (!mocap) return;
    if (mocap.isPaused) mocap.resume();
    else mocap.pause();
    syncPauseButton();
  }

  async function onStepBack(): Promise<void> {
    const mocap = options.getMocap();
    if (!mocap || !mocap.isPaused) return;
    await mocap.stepFrame(-1 / 30);
  }

  async function onStepFwd(): Promise<void> {
    const mocap = options.getMocap();
    if (!mocap || !mocap.isPaused) return;
    await mocap.stepFrame(1 / 30);
  }

  function onGrab(): void {
    const mocap = options.getMocap();
    if (!mocap) return;
    mocap.grabFrame();
    options.framesText.value = `${mocap.grabbedFrameCount} frames`;
  }

  function onFlush(): void {
    const mocap = options.getMocap();
    if (!mocap) return;
    mocap.flushGrabbed();
    options.framesText.value = `${mocap.grabbedFrameCount} frames`;
  }

  return {
    paused,
    pauseLabel,
    onPauseClick,
    onStepBack,
    onStepFwd,
    onGrab,
    onFlush,
  };
}
