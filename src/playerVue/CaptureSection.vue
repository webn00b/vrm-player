<script setup lang="ts">
/**
 * Replaces `wireMocapControls` (440 LOC) — the entire Capture section of
 * the right-side tuning panel. Owns:
 *   - Source segmented control (camera / video / animfile, localStorage-persisted)
 *   - Primary CTA (Start camera / Record / Choose video / Choose animation / Stop)
 *   - Stop-camera button
 *   - Playback row (pause / step / grab / flush)
 *   - "Advanced" fold with Export-pose .bvh button
 *   - Anim-file BVH recording sub-state machine
 *   - Mocap state-change + error wiring (registers itself on mount)
 *
 * `#mocap-preview-panel` and `#mocap-canvas` remain in index.html — they're
 * positioned absolutely (fixed) on the page and don't belong inside the
 * tuning-panel scroll area. We toggle their `display` style from here and
 * pass the canvas to `mocap.setCanvas()` during recording / live preview.
 */

import { computed, ref, onMounted, onUnmounted } from 'vue';
import Button from 'primevue/button';
import type { VRM } from '@pixiv/three-vrm';
import type { MocapController, MocapState } from '../mocap/pipeline/mocapController';
import type { AnimationController } from '../animationController';
import type { MocapDebugRecorder } from '../mocap/diagnostics/mocapDebugRecorder';
import { exportClipAsBvh, type BvhExportHandle } from '../bvhExportRecorder';
import { notify } from '../ui';
import { generateBrowserMultiviewMotion } from '../mocap/offline/multiviewMediapipe';

const props = defineProps<{
  mocap: MocapController;
  mocapVrm: VRM;
  getMocap: () => MocapController | null;
  getController: () => AnimationController | null;
  dbgRecorder: MocapDebugRecorder;
  /** Wired in main.ts. When user picks a .bvh/.vrma/.fbx/.motion.json via the anim-file
   *  input, this loads + retargets it onto the queue. */
  onAnimFile?: (file: File) => Promise<void> | void;
}>();

// ── Reactive UI state ──────────────────────────────────────────────────────
type CaptureSource = 'camera' | 'video' | 'animfile' | 'multiview';
const SOURCE_KEY = 'vrm-player.capture-source';
const validSource = (s: string | null): CaptureSource =>
  s === 'video' || s === 'animfile' || s === 'multiview' ? s : 'camera';
const sourceOptions: Array<{ label: string; value: CaptureSource }> = [
  { label: 'Live', value: 'camera' },
  { label: 'Video BVH', value: 'video' },
  { label: 'Multi-view', value: 'multiview' },
  { label: 'Anim export', value: 'animfile' },
];

const currentSource = ref<CaptureSource>(validSource(localStorage.getItem(SOURCE_KEY)));
const statusText    = ref('📷 Camera off');
const framesText    = ref('');
const sourceInfo    = ref('');
const primaryLabel  = ref('Start camera');
const primaryDisabled = ref(false);
const primaryRecording = ref(false);
const showStopCam   = ref(false);
const showPlayback  = ref(false);
const pauseLabel    = ref('⏸');
const paused        = ref(false);
const presetCaption = computed(() => {
  if (currentSource.value === 'camera') return 'Camera preview and recording';
  if (currentSource.value === 'video') return 'Video file to mocap BVH';
  if (currentSource.value === 'multiview') return 'Two videos to motion JSON';
  return 'Loaded animation to BVH';
});

const fileInputRef     = ref<HTMLInputElement | null>(null);
const animFileInputRef = ref<HTMLInputElement | null>(null);
const mvFrontInputRef  = ref<HTMLInputElement | null>(null);
const mvSideInputRef   = ref<HTMLInputElement | null>(null);

// ── Browser multi-view state ───────────────────────────────────────────────
const mvFrontFile = ref<File | null>(null);
const mvSideFile = ref<File | null>(null);
const mvProcessing = ref(false);
const mvFps = ref(6);
const mvSideOffset = ref(0);
const mvDepthAxis = ref<'x' | 'z' | '-x' | '-z'>('x');
const mvDepthScale = ref(1);
const mvSmoothing = ref(0.65);
const mvProgressText = ref('');
const canGenerateMultiview = computed(() => !!mvFrontFile.value && !!mvSideFile.value && !mvProcessing.value);

// ── Anim-file Record/Stop state (independent of MocapState) ────────────────
let animExportHandle: BvhExportHandle | null = null;
const activeTimers = new Set<number>();

function trackInterval(fn: () => void, ms: number): number {
  const id = window.setInterval(fn, ms);
  activeTimers.add(id);
  return id;
}
function trackTimeout(fn: () => void, ms: number): number {
  const id = window.setTimeout(() => { activeTimers.delete(id); fn(); }, ms);
  activeTimers.add(id);
  return id;
}

let animProgressTimer = 0;
let framesTimer = 0;

// ── Source info (resolution + aspect ratio) ────────────────────────────────
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const formatSourceInfo = (w: number, h: number): string => {
  if (!w || !h) return '';
  const d = gcd(w, h);
  const aw = w / d, ah = h / d;
  const ratio = aw <= 32 && ah <= 32 ? `${aw}:${ah}` : (w / h).toFixed(2) + ':1';
  return `📐 ${w}×${h} (${ratio})`;
};
function refreshSourceInfo(): void {
  const m = props.getMocap();
  if (!m) { sourceInfo.value = ''; return; }
  sourceInfo.value = formatSourceInfo(m.videoElement.videoWidth, m.videoElement.videoHeight);
}

// ── Anim-file sub-state machine ────────────────────────────────────────────
function updateAnimUI(): void {
  if (currentSource.value !== 'animfile') return;
  const ctrl = props.getController();
  const queueLen = ctrl?.queueLength ?? 0;
  const recording = animExportHandle !== null;

  primaryRecording.value = recording;
  primaryDisabled.value = false;

  if (recording) {
    primaryLabel.value = '⏹ Stop';
    // status / progress filled by animProgressTimer
  } else if (queueLen === 0) {
    primaryLabel.value = 'Choose animation…';
    statusText.value = '🎬 Pick animation / motion JSON';
    framesText.value = '';
  } else {
    primaryLabel.value = '⏺ Record BVH';
    const name = ctrl?.currentName || '';
    const dur  = ctrl?.currentDuration ?? 0;
    statusText.value = name
      ? `🎬 ready · ${name} (${dur.toFixed(1)}s)`
      : '🎬 ready';
    framesText.value = '';
  }
}

function updateMultiviewUI(): void {
  if (currentSource.value !== 'multiview') return;
  primaryRecording.value = mvProcessing.value;
  primaryDisabled.value = !canGenerateMultiview.value;
  primaryLabel.value = mvProcessing.value ? 'Generating…' : 'Generate motion JSON';
  showStopCam.value = false;
  showPlayback.value = false;
  sourceInfo.value = '';
  statusText.value = mvProcessing.value
    ? (mvProgressText.value || '🎥 Processing two videos…')
    : mvFrontFile.value && mvSideFile.value
      ? '🎥 ready · front + side selected'
      : '🎥 Pick front and side videos';
  framesText.value = [
    mvFrontFile.value ? `front: ${mvFrontFile.value.name}` : 'front: none',
    mvSideFile.value ? `side: ${mvSideFile.value.name}` : 'side: none',
  ].join(' · ');
}

function startAnimProgressTimer(): void {
  clearInterval(animProgressTimer);
  animProgressTimer = trackInterval(() => {
    if (!animExportHandle) return;
    const ctrl = props.getController();
    const dur = ctrl?.currentDuration ?? 0;
    const elapsed = animExportHandle.elapsed();
    const pct = dur > 0 ? Math.min(100, Math.round((elapsed / dur) * 100)) : 0;
    statusText.value = `⏺ recording ${pct}%`;
    framesText.value = `${animExportHandle.frameCount()} frames`;
  }, 200);
}

function startAnimRecord(): void {
  const ctrl = props.getController();
  if (!ctrl || ctrl.queueLength === 0) return;
  if (animExportHandle) return;
  const qi = ctrl.currentQueuePos >= 0 ? ctrl.currentQueuePos : 0;
  try {
    const handle = exportClipAsBvh(qi, ctrl, props.mocapVrm);
    animExportHandle = handle;
    updateAnimUI();
    startAnimProgressTimer();
    handle.promise
      .then((filename) => {
        statusText.value = `✓ saved ${filename}`;
        framesText.value = '';
        notify({ severity: 'success', summary: 'BVH saved', detail: filename });
      })
      .catch((e) => {
        const msg = (e as Error).message;
        statusText.value = `❌ ${msg.slice(0, 60)}`;
        notify({ severity: 'error', summary: 'BVH export failed', detail: msg, life: 4200 });
      })
      .finally(() => {
        animExportHandle = null;
        clearInterval(animProgressTimer);
        updateAnimUI();
      });
  } catch (e) {
    const msg = (e as Error).message;
    statusText.value = `❌ ${msg.slice(0, 60)}`;
    notify({ severity: 'error', summary: 'BVH export failed', detail: msg, life: 4200 });
    animExportHandle = null;
  }
}

function cancelAnimRecord(): void {
  animExportHandle?.cancel();
  // .finally() in startAnimRecord clears the handle + repaints UI.
}

// ── Mocap-state-driven UI ──────────────────────────────────────────────────
let previewPanel: HTMLElement | null = null;
let previewCvs: HTMLCanvasElement | null = null;

function setPreviewVisible(visible: boolean): void {
  if (previewPanel) previewPanel.style.display = visible ? 'flex' : 'none';
}

function updateMocapUI(state: MocapState): void {
  clearInterval(framesTimer);
  const m = props.getMocap();
  framesText.value = '';
  primaryRecording.value = false;
  primaryDisabled.value = false;
  if (state === 'off') sourceInfo.value = '';
  else refreshSourceInfo();

  // Anim-file and multiview sources have their own state machines.
  if (currentSource.value === 'animfile') {
    showStopCam.value  = false;
    showPlayback.value = false;
    setPreviewVisible(false);
    m?.setCanvas(null);
    updateAnimUI();
    return;
  }
  if (currentSource.value === 'multiview') {
    showStopCam.value  = false;
    showPlayback.value = false;
    setPreviewVisible(false);
    m?.setCanvas(null);
    updateMultiviewUI();
    return;
  }

  if (state === 'off') {
    const hasFrozenFrame = !!m?.latestFrame;
    if (currentSource.value === 'camera') {
      statusText.value  = hasFrozenFrame ? '📷 Camera off (last frame)' : '📷 Camera off';
      primaryLabel.value = 'Start camera';
    } else if (currentSource.value === 'video') {
      statusText.value  = '📁 Pick a video to process';
      primaryLabel.value = 'Choose video…';
    } else {
      statusText.value  = '🎬 Pick animation / motion JSON';
      primaryLabel.value = 'Choose animation…';
    }
    showStopCam.value  = false;
    showPlayback.value = false;
    setPreviewVisible(hasFrozenFrame);
    m?.setCanvas(null);
    // Auto-stop debug recorder when file processing completes.
    if (props.dbgRecorder.active) props.dbgRecorder.stop();
  } else if (state === 'live') {
    statusText.value   = '📷 Live preview';
    primaryLabel.value = '⏺ Record';
    showStopCam.value  = true;
    showPlayback.value = true;
    setPreviewVisible(true);
    if (previewCvs) m?.setCanvas(previewCvs);
  } else if (state === 'recording') {
    const isFile = (m?.duration ?? 0) > 0;
    statusText.value   = isFile ? '🎬 Processing video…' : '📷 Recording…';
    primaryLabel.value = isFile ? '⏹ Cancel' : '⏹ Stop';
    primaryRecording.value = true;
    showStopCam.value  = false;
    showPlayback.value = true;
    setPreviewVisible(true);
    if (previewCvs) m?.setCanvas(previewCvs);
    framesTimer = trackInterval(() => {
      const mm = props.getMocap();
      if (!mm) return;
      const dur = mm.duration;
      framesText.value = dur > 0
        ? `${mm.currentTime.toFixed(1)}s / ${dur.toFixed(1)}s`
        : `${mm.recordingFrameCount} frames`;
    }, 200);
  }
}

// ── Primary CTA / Stop camera ──────────────────────────────────────────────
async function onPrimaryClick(): Promise<void> {
  const m = props.getMocap();
  if (!m) return;

  if (m.state === 'recording') {
    const isFile = m.duration > 0;
    if (isFile) m.stop();
    else        m.stopRecording();
    return;
  }

  if (currentSource.value === 'camera') {
    if (m.state === 'off') {
      primaryLabel.value = '…';
      primaryDisabled.value = true;
      try { await m.startLive(); }
      catch (e) {
        const msg = e instanceof Error ? e.message : 'Camera permission or device error';
        statusText.value = '❌ Camera error';
        notify({ severity: 'error', summary: 'Camera error', detail: msg, life: 4200 });
      }
      finally { primaryDisabled.value = false; }
    } else if (m.state === 'live') {
      m.startRecording();
    }
  } else if (currentSource.value === 'video') {
    if (m.state === 'off') fileInputRef.value?.click();
  } else {
    // Anim file / multiview offline processing
    if (currentSource.value === 'multiview') {
      await generateMultiview();
      return;
    }
    if (animExportHandle) {
      cancelAnimRecord();
    } else if ((props.getController()?.queueLength ?? 0) === 0) {
      animFileInputRef.value?.click();
    } else {
      startAnimRecord();
    }
  }
}

function onStopCam(): void {
  const m = props.getMocap();
  if (!m) return;
  if (m.state === 'recording') m.stopRecording();
  m.stop();
}

// ── Source switch ──────────────────────────────────────────────────────────
function setSource(next: CaptureSource): void {
  if (next === currentSource.value) return;
  if (currentSource.value === 'animfile' && animExportHandle) cancelAnimRecord();
  const m = props.getMocap();
  if (m && m.state !== 'off') {
    if (m.state === 'recording') m.stopRecording();
    m.stop();
  }
  currentSource.value = next;
  try { localStorage.setItem(SOURCE_KEY, currentSource.value); } catch { /* quota */ }
  updateMocapUI(props.getMocap()?.state ?? 'off');
}

// ── File inputs ────────────────────────────────────────────────────────────
async function onAnimFileChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // allow re-selecting same file
  if (!file) return;
  if (!props.onAnimFile) {
    statusText.value = '❌ animation import not wired';
    notify({ severity: 'error', summary: 'Animation import unavailable' });
    return;
  }
  statusText.value = `🎬 loading ${file.name}…`;
  notify({ severity: 'info', summary: 'Loading animation', detail: file.name, life: 1800 });
  try {
    await props.onAnimFile(file);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)) || 'unknown error';
    statusText.value = `❌ ${msg.slice(0, 60)}`;
    notify({ severity: 'error', summary: 'Animation load failed', detail: msg, life: 4200 });
  }
  updateAnimUI();
}

async function onVideoFileChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const m = props.getMocap();
  if (!m || m.state !== 'off') return;
  // Auto-start debug recorder for full file capture (no frame cap).
  props.dbgRecorder.start(Infinity);
  notify({ severity: 'info', summary: 'Processing video', detail: file.name, life: 2200 });
  try {
    await m.startFromFile(file);
  } catch (e) {
    props.dbgRecorder.stop();
    const msg = (e instanceof Error ? e.message : String(e)) || 'unknown error';
    statusText.value = `❌ ${msg.slice(0, 28)}`;
    notify({ severity: 'error', summary: 'Video processing failed', detail: msg, life: 4200 });
  }
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

function multiviewOutputName(): string {
  const front = mvFrontFile.value?.name.replace(/\.[^.]+$/, '') || 'front';
  const side = mvSideFile.value?.name.replace(/\.[^.]+$/, '') || 'side';
  return `${front}_${side}.browser.multiview.motion.json`;
}

function onMultiviewFrontChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  mvFrontFile.value = input.files?.[0] ?? null;
  input.value = '';
  updateMultiviewUI();
}

function onMultiviewSideChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  mvSideFile.value = input.files?.[0] ?? null;
  input.value = '';
  updateMultiviewUI();
}

async function generateMultiview(): Promise<void> {
  if (!mvFrontFile.value || !mvSideFile.value || mvProcessing.value) return;
  if (!props.onAnimFile) {
    notify({ severity: 'error', summary: 'Animation import unavailable' });
    return;
  }

  mvProcessing.value = true;
  mvProgressText.value = '🎥 Initializing MediaPipe…';
  updateMultiviewUI();
  notify({ severity: 'info', summary: 'Generating multi-view motion', detail: 'Processing front + side videos', life: 2200 });
  let finalStatus: string | null = null;
  let finalFrames = '';

  try {
    const result = await generateBrowserMultiviewMotion({
      front: mvFrontFile.value,
      side: mvSideFile.value,
      fps: Math.max(1, mvFps.value || 6),
      sideOffsetFrames: Math.trunc(mvSideOffset.value || 0),
      frontMirrorX: true,
      sideMirrorX: true,
      sideDepthAxis: mvDepthAxis.value,
      depthScale: mvDepthScale.value,
      depthOffset: 0,
      smoothingAlpha: mvSmoothing.value,
      visibility: 0.35,
      onProgress: (message) => {
        mvProgressText.value = `🎥 ${message}`;
        statusText.value = mvProgressText.value;
      },
    });
    const filename = multiviewOutputName();
    downloadJson(result.motion, filename);
    downloadJson(result.report, filename.replace(/\.json$/, '.fusion.report.json'));
    await props.onAnimFile(jsonFile(result.motion, filename));
    const frames = Array.isArray(result.motion.frames) ? result.motion.frames.length : 0;
    finalStatus = `✓ multiview loaded · ${frames} frames`;
    finalFrames = filename;
    notify({ severity: 'success', summary: 'Multi-view motion ready', detail: `${frames} frames`, life: 3600 });
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)) || 'unknown error';
    statusText.value = `❌ ${msg.slice(0, 60)}`;
    notify({ severity: 'error', summary: 'Multi-view failed', detail: msg, life: 5200 });
  } finally {
    mvProcessing.value = false;
    mvProgressText.value = '';
    updateMultiviewUI();
    if (finalStatus) {
      statusText.value = finalStatus;
      framesText.value = finalFrames;
    }
  }
}

// ── Playback row ───────────────────────────────────────────────────────────
function syncPauseBtn(): void {
  const m = props.getMocap();
  paused.value = m?.isPaused ?? false;
  pauseLabel.value = paused.value ? '▶' : '⏸';
}
function onPauseClick(): void {
  const m = props.getMocap();
  if (!m) return;
  if (m.isPaused) m.resume(); else m.pause();
  syncPauseBtn();
}
async function onStepBack(): Promise<void> {
  const m = props.getMocap();
  if (!m || !m.isPaused) return;
  await m.stepFrame(-1 / 30);
}
async function onStepFwd(): Promise<void> {
  const m = props.getMocap();
  if (!m || !m.isPaused) return;
  await m.stepFrame(1 / 30);
}
function onGrab(): void {
  const m = props.getMocap();
  if (!m) return;
  m.grabFrame();
  framesText.value = `${m.grabbedFrameCount} frames`;
}
function onFlush(): void {
  const m = props.getMocap();
  if (!m) return;
  m.flushGrabbed();
  framesText.value = `${m.grabbedFrameCount} frames`;
}

// ── Export pose (single-frame BVH) ─────────────────────────────────────────
const exportPoseLabel    = ref('Export .bvh');
const exportPoseTitle    = ref('Download current avatar pose as a 1-frame BVH');
const exportPoseDisabled = ref(false);

function onExportPose(): void {
  const m = props.getMocap();
  if (!m) return;
  const prev = exportPoseLabel.value;
  exportPoseLabel.value = '…';
  exportPoseDisabled.value = true;
  try {
    const name = m.exportCurrentPoseBvh();
    exportPoseLabel.value = 'Saved';
    exportPoseTitle.value = `Downloaded ${name}.bvh`;
    notify({ severity: 'success', summary: 'Pose exported', detail: `${name}.bvh` });
  } finally {
    trackTimeout(() => {
      exportPoseLabel.value = prev;
      exportPoseTitle.value = 'Download current avatar pose as a 1-frame BVH';
      exportPoseDisabled.value = false;
    }, 900);
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────
const onLoadedMetadata = (): void => { refreshSourceInfo(); };

onMounted(() => {
  previewPanel = document.getElementById('mocap-preview-panel');
  previewCvs   = document.getElementById('mocap-canvas') as HTMLCanvasElement | null;
  // 4:3 at 2x panel width for sharpness.
  if (previewCvs) {
    previewCvs.width = 440;
    previewCvs.height = 330;
  }

  // Video element only knows its dimensions after metadata is loaded.
  props.mocap.videoElement.addEventListener('loadedmetadata', onLoadedMetadata);

  // Register mocap state callbacks — single-slot, so we own them while
  // mounted. Parent (debugPanel.ts) sets onCalibrationChange separately
  // (different channel, no conflict).
  props.mocap.onStateChange = updateMocapUI;
  props.mocap.onError = (err) => {
    statusText.value = `❌ ${err.message.slice(0, 30)}`;
    notify({ severity: 'error', summary: 'Mocap error', detail: err.message, life: 4200 });
  };

  // Paint initial UI based on current source + mocap state.
  updateMocapUI(props.mocap.state);
});

onUnmounted(() => {
  props.mocap.videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
  for (const id of activeTimers) {
    clearTimeout(id);
    clearInterval(id);
  }
  activeTimers.clear();
});
</script>

<template>
  <div class="dbg-section">
    <div
      class="capture-source"
      role="group"
      aria-label="Capture source"
      data-testid="capture-source"
    >
      <button
        v-for="option in sourceOptions"
        :key="option.value"
        type="button"
        class="capture-src-btn"
        :aria-pressed="currentSource === option.value"
        :data-testid="`capture-src-${option.value}`"
        @click="setSource(option.value)"
      >
        {{ option.label }}
      </button>
    </div>
    <div class="capture-preset-caption">{{ presetCaption }}</div>

    <div v-if="currentSource === 'multiview'" class="multiview-box">
      <div class="multiview-file-row">
        <Button
          class="dbg-toggle multiview-file-btn"
          :label="mvFrontFile ? 'Front ✓' : 'Front…'"
          text
          size="small"
          @click="mvFrontInputRef?.click()"
        />
        <Button
          class="dbg-toggle multiview-file-btn"
          :label="mvSideFile ? 'Side ✓' : 'Side…'"
          text
          size="small"
          @click="mvSideInputRef?.click()"
        />
      </div>
      <div class="multiview-controls">
        <label>
          <span>FPS</span>
          <input v-model.number="mvFps" type="number" min="1" max="60" step="1">
        </label>
        <label>
          <span>Offset</span>
          <input v-model.number="mvSideOffset" type="number" step="1">
        </label>
        <label>
          <span>Depth</span>
          <select v-model="mvDepthAxis">
            <option value="x">x</option>
            <option value="-x">-x</option>
            <option value="z">z</option>
            <option value="-z">-z</option>
          </select>
        </label>
        <label>
          <span>Scale</span>
          <input v-model.number="mvDepthScale" type="number" min="0.05" max="4" step="0.05">
        </label>
      </div>
    </div>

    <Button
      class="capture-primary"
      data-testid="capture-primary"
      :class="{ recording: primaryRecording }"
      :disabled="primaryDisabled"
      :label="primaryLabel"
      size="small"
      @click="onPrimaryClick"
    />
    <input ref="fileInputRef"     type="file" accept="video/*"          hidden @change="onVideoFileChange">
    <input ref="animFileInputRef" type="file" accept=".bvh,.vrma,.fbx,.json,.motion.json,.wham.json,.gvhmr.json" hidden @change="onAnimFileChange">
    <input ref="mvFrontInputRef"  type="file" accept="video/*" hidden @change="onMultiviewFrontChange">
    <input ref="mvSideInputRef"   type="file" accept="video/*" hidden @change="onMultiviewSideChange">

    <div class="capture-status">
      <span data-testid="mocap-status">{{ statusText }}</span>
      <span style="opacity:.55" data-testid="mocap-frames">{{ framesText }}</span>
    </div>
    <div class="capture-status" style="margin-top:-2px">
      <span style="opacity:.45;font-size:10px">{{ sourceInfo }}</span>
    </div>

    <Button
      v-show="showStopCam"
      class="dbg-toggle off"
      data-testid="capture-stop-cam"
      label="Stop camera"
      text
      size="small"
      style="width:100%"
      @click="onStopCam"
    />

    <div
      v-show="showPlayback"
      class="dbg-row"
      style="gap:3px;justify-content:flex-start;margin-top:4px"
    >
      <Button class="dbg-toggle"
              :class="{ off: paused }"
              title="Pause / resume"
              :label="pauseLabel"
              text
              size="small"
              @click="onPauseClick"
      />
      <Button class="dbg-toggle off" icon="pi pi-step-backward" text size="small" title="Step -1 frame" @click="onStepBack" />
      <Button class="dbg-toggle off" icon="pi pi-step-forward" text size="small" title="Step +1 frame" @click="onStepFwd" />
      <Button class="dbg-toggle off" icon="pi pi-save" text size="small" title="Grab current pose" @click="onGrab" />
      <Button class="dbg-toggle off" icon="pi pi-download" text size="small" title="Download captured BVH" @click="onFlush" />
    </div>

    <details class="capture-advanced">
      <summary>Advanced…</summary>
      <div class="dbg-row">
        <span class="dbg-label">📤 Single pose</span>
        <Button
          class="dbg-toggle off"
          :disabled="exportPoseDisabled"
          :label="exportPoseLabel"
          :title="exportPoseTitle"
          text
          size="small"
          @click="onExportPose"
        />
      </div>
    </details>
  </div>
</template>

<style scoped>
.capture-source {
  display: flex;
  width: 100%;
  margin-bottom: 5px;
}
.capture-src-btn {
  flex: 1;
  border-radius: 0;
  background: transparent;
  color: #ccc;
  border: 1px solid #2a2a2a;
  border-right: 0;
  font-size: 11px;
  font-family: var(--font-ui);
  padding: 6px;
  cursor: pointer;
  transition: background 100ms, color 100ms;
}
.capture-src-btn:first-child {
  border-radius: 5px 0 0 5px;
}
.capture-src-btn:last-child {
  border-radius: 0 5px 5px 0;
  border-right: 1px solid #2a2a2a;
}
.capture-src-btn:hover {
  background: #1c1c1c;
}
.capture-src-btn[aria-pressed="true"] {
  background: #2a3550;
  color: #fff;
}
.capture-preset-caption {
  margin-bottom: 8px;
  font-size: 10px;
  line-height: 1.35;
  color: rgba(255, 255, 255, 0.42);
}
:deep(.p-button.capture-primary) {
  width: 100%;
  justify-content: center;
  margin-bottom: 6px;
  background: #3b5bdb;
  border-color: #3b5bdb;
  color: #fff;
  font-family: var(--font-ui);
  font-size: 13px;
  font-weight: 600;
  padding: 10px;
}
:deep(.p-button.capture-primary:hover) {
  background: #4c6ce8;
  border-color: #4c6ce8;
}
:deep(.p-button.capture-primary.recording) {
  background: #c92a2a;
  border-color: #c92a2a;
}
:deep(.p-button.dbg-toggle) {
  min-width: 34px;
  justify-content: center;
  padding: 2px 8px;
}
.multiview-box {
  margin-bottom: 8px;
}
.multiview-file-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 6px;
}
:deep(.p-button.multiview-file-btn) {
  width: 100%;
  min-height: 30px;
}
.multiview-controls {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 5px;
}
.multiview-controls label {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  font-size: 9px;
  line-height: 1.2;
  color: rgba(255,255,255,.48);
}
.multiview-controls input,
.multiview-controls select {
  width: 100%;
  min-width: 0;
  height: 26px;
  border: 1px solid #2a2a2a;
  border-radius: 5px;
  background: #111;
  color: #eee;
  font-family: var(--font-ui);
  font-size: 11px;
  padding: 2px 4px;
}
</style>
