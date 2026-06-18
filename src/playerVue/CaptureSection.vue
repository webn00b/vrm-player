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
import type { HipCompensator } from '../physics/hipCompensation';
import type { HipComRotator } from '../physics/hipComRotation';
import { notify } from '../ui';
import CaptureAgentOptions from './captureSection/CaptureAgentOptions.vue';
import CaptureMultiviewPanel from './captureSection/CaptureMultiviewPanel.vue';
import CapturePlaybackRow from './captureSection/CapturePlaybackRow.vue';
import CaptureProgressBar from './captureSection/CaptureProgressBar.vue';
import CaptureConvertSettings from './captureSection/CaptureConvertSettings.vue';
import { friendlyCaptureError } from './captureSection/captureErrors';
import CapturePoseExportRow from './captureSection/CapturePoseExportRow.vue';
import CaptureSourceSelector from './captureSection/CaptureSourceSelector.vue';
import CaptureStatusLines from './captureSection/CaptureStatusLines.vue';
import type { CaptureSource } from './captureSection/captureSectionTypes';
import { formatSourceInfo } from './captureSection/captureSourceInfoModel';
import {
  CAPTURE_SOURCE_STORAGE_KEY,
  capturePresetCaption,
  captureSourceOptions,
  validCaptureSource,
} from './captureSection/captureSourceModel';
import { useCaptureAnimExport } from './captureSection/useCaptureAnimExport';
import { useCaptureMultiview } from './captureSection/useCaptureMultiview';
import { useCapturePlayback } from './captureSection/useCapturePlayback';
import { useCapturePoseExport } from './captureSection/useCapturePoseExport';
import { useCaptureVideoFile } from './captureSection/useCaptureVideoFile';
import { useTrackedTimers } from './captureSection/useTrackedTimers';

const props = defineProps<{
  mocap: MocapController;
  mocapVrm: VRM;
  getMocap: () => MocapController | null;
  getController: () => AnimationController | null;
  dbgRecorder: MocapDebugRecorder;
  /** Live hip balancers — surfaced in the conversion-settings fold. */
  hipCompensator: HipCompensator;
  hipComRotator: HipComRotator;
  /** Wired in main.ts. When user picks a .bvh/.vrma/.fbx/.motion.json via the anim-file
   *  input, this loads + retargets it onto the queue. */
  onAnimFile?: (file: File) => Promise<void> | void;
}>();

// ── Reactive UI state ──────────────────────────────────────────────────────
const currentSource = ref<CaptureSource>(
  validCaptureSource(localStorage.getItem(CAPTURE_SOURCE_STORAGE_KEY)),
);
const videoAgentOgiEnabled = ref(false);
/** Video staged for conversion — the picker stores it here so the user can
 *  review the conversion settings before starting the run. */
const pendingVideo  = ref<File | null>(null);
const saveCamVideo  = ref(true); // save webcam footage alongside the BVH
const SAVE_CAM_VIDEO_KEY = 'vrm-player.capture.saveCameraVideo';

// Visual progress for the multi-minute file→BVH conversion.
const progressActive = ref(false);
const progressPct    = ref(0);
const progressPhase  = ref('');
const progressStep   = ref(1);
const progressDetail = ref('');
const PROGRESS_PHASES = ['analyze', 'lift', 'smooth', 'replay'] as const;
const PHASE_LABEL: Record<string, string> = {
  analyze: 'Analyzing video',
  lift: 'Lifting to 3D',
  smooth: 'Smoothing motion',
  replay: 'Recording BVH',
};
const statusText    = ref('📷 Camera off');
const framesText    = ref('');
const sourceInfo    = ref('');
const primaryLabel  = ref('Start camera');
const primaryDisabled = ref(false);
const primaryRecording = ref(false);
const showStopCam   = ref(false);
const showPlayback  = ref(false);
const isIdle        = ref(true); // mocap state === 'off' (pre-run)
const presetCaption = computed(() => capturePresetCaption(currentSource.value));

const fileInputRef     = ref<HTMLInputElement | null>(null);
const animFileInputRef = ref<HTMLInputElement | null>(null);
const mvFrontInputRef  = ref<HTMLInputElement | null>(null);
const mvSideInputRef   = ref<HTMLInputElement | null>(null);
const {
  trackInterval,
  trackTimeout,
  clearTrackedTimer,
} = useTrackedTimers();
const {
  paused,
  pauseLabel,
  onPauseClick,
  onStepBack,
  onStepFwd,
  onGrab,
  onFlush,
} = useCapturePlayback({
  getMocap: props.getMocap,
  framesText,
});
const { convertVideo } = useCaptureVideoFile({
  getMocap: props.getMocap,
  dbgRecorder: props.dbgRecorder,
  agentOgiEnabled: videoAgentOgiEnabled,
  statusText,
});

// ── Video staging ───────────────────────────────────────────────────────────
// Picking a file no longer auto-converts: it stages the file and repaints the
// CTA to "Convert", so conversion settings can be reviewed first.
function onVideoFilePicked(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // allow re-selecting the same file
  if (!file) return;
  pendingVideo.value = file;
  updateMocapUI(props.getMocap()?.state ?? 'off');
}

// ── Browser multi-view state ───────────────────────────────────────────────
const {
  frontFile: mvFrontFile,
  sideFile: mvSideFile,
  processing: mvProcessing,
  fps: mvFps,
  sideOffset: mvSideOffset,
  depthAxis: mvDepthAxis,
  depthScale: mvDepthScale,
  progressText: mvProgressText,
  canGenerate: canGenerateMultiview,
  frontLabel: mvFrontLabel,
  sideLabel: mvSideLabel,
  onFrontChange: onMultiviewFrontChange,
  onSideChange: onMultiviewSideChange,
  generate: generateMultiview,
} = useCaptureMultiview({
  getMocap: props.getMocap,
  statusText,
  framesText,
  onAnimFile: props.onAnimFile,
  refreshUi: updateMultiviewUI,
});

// ── Anim-file Record/Stop state (independent of MocapState) ────────────────
let framesTimer = 0;
const {
  isRecording: isAnimRecording,
  updateUi: updateAnimUI,
  startRecord: startAnimRecord,
  cancelRecord: cancelAnimRecord,
} = useCaptureAnimExport({
  getController: props.getController,
  mocapVrm: props.mocapVrm,
  statusText,
  framesText,
  primaryLabel,
  primaryDisabled,
  primaryRecording,
  trackInterval,
  clearTrackedTimer,
});

function refreshSourceInfo(): void {
  const m = props.getMocap();
  if (!m) { sourceInfo.value = ''; return; }
  sourceInfo.value = formatSourceInfo(m.videoElement.videoWidth, m.videoElement.videoHeight);
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

// ── Mocap-state-driven UI ──────────────────────────────────────────────────
let previewPanel: HTMLElement | null = null;
let previewCvs: HTMLCanvasElement | null = null;

function setPreviewVisible(visible: boolean): void {
  if (previewPanel) previewPanel.style.display = visible ? 'flex' : 'none';
}

/** Show the live webcam feed as a corner thumbnail while capturing. */
function setVideoPreview(visible: boolean, recording: boolean): void {
  const v = props.getMocap()?.videoElement;
  if (!v) return;
  v.classList.toggle('preview', visible);
  v.classList.toggle('recording', visible && recording);
}

function updateMocapUI(state: MocapState): void {
  clearTrackedTimer(framesTimer);
  isIdle.value = state === 'off';
  const m = props.getMocap();
  framesText.value = '';
  if (state !== 'recording') progressActive.value = false;
  primaryRecording.value = false;
  primaryDisabled.value = false;
  // Live webcam thumbnail: visible only while the camera is on.
  setVideoPreview(
    currentSource.value === 'camera' && (state === 'live' || state === 'recording'),
    state === 'recording',
  );
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
      if (pendingVideo.value) {
        statusText.value   = `🎬 ${pendingVideo.value.name}`;
        primaryLabel.value = '▶ Convert to BVH';
      } else {
        statusText.value   = '📁 Pick a video to process';
        primaryLabel.value = 'Choose video…';
      }
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
    const isFile = m?.isFileCapture || (m?.duration ?? 0) > 0;
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
      const progress = mm.fileCaptureProgress;
      if (progress) {
        // Two-pass file conversion: drive the visual progress bar.
        const pct = progress.totalFrames > 0
          ? Math.min(100, Math.round((100 * progress.frameIndex) / progress.totalFrames))
          : 0;
        progressActive.value = true;
        progressPhase.value  = PHASE_LABEL[progress.phase] ?? progress.phase;
        progressStep.value   = Math.max(1, PROGRESS_PHASES.indexOf(progress.phase) + 1);
        progressPct.value    = pct;
        progressDetail.value = `${progress.frameIndex} / ${progress.totalFrames} frames`;
        framesText.value = '';
        return;
      }
      progressActive.value = false;
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
        const f = friendlyCaptureError(e);
        statusText.value = f.status;
        notify({ severity: 'error', summary: f.status.replace(/^\S+\s/, ''), detail: f.detail, life: 5000 });
      }
      finally { primaryDisabled.value = false; }
    } else if (m.state === 'live') {
      m.startRecording();
    }
  } else if (currentSource.value === 'video') {
    if (m.state !== 'off') return;
    if (pendingVideo.value) {
      const file = pendingVideo.value;
      pendingVideo.value = null;
      await convertVideo(file);
    } else {
      fileInputRef.value?.click();
    }
  } else {
    // Anim file / multiview offline processing
    if (currentSource.value === 'multiview') {
      await generateMultiview();
      return;
    }
    if (isAnimRecording()) {
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
  if (currentSource.value === 'animfile' && isAnimRecording()) cancelAnimRecord();
  const m = props.getMocap();
  if (m && m.state !== 'off') {
    if (m.state === 'recording') m.stopRecording();
    m.stop();
  }
  currentSource.value = next;
  pendingVideo.value = null; // staged file belongs to the previous source
  try { localStorage.setItem(CAPTURE_SOURCE_STORAGE_KEY, currentSource.value); } catch { /* quota */ }
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

// ── Export pose (single-frame BVH) ─────────────────────────────────────────
const {
  exportPoseLabel,
  exportPoseTitle,
  exportPoseDisabled,
  exportPoseJsonLabel,
  exportPoseJsonTitle,
  exportPoseJsonDisabled,
  singlePoseTitle,
  onExportPose,
  onExportPoseWithJson,
} = useCapturePoseExport({
  getMocap: props.getMocap,
  mocapVrm: props.mocapVrm,
  agentOgiEnabled: videoAgentOgiEnabled,
  trackTimeout,
});

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
    const f = friendlyCaptureError(err);
    progressActive.value = false;
    statusText.value = f.status;
    notify({ severity: 'error', summary: f.status.replace(/^\S+\s/, ''), detail: f.detail, life: 5000 });
  };

  // Save-camera-video preference (persisted), pushed into the controller.
  try {
    const s = localStorage.getItem(SAVE_CAM_VIDEO_KEY);
    if (s !== null) saveCamVideo.value = s === '1';
  } catch { /* ignore */ }
  props.mocap.saveCameraVideo = saveCamVideo.value;

  // Paint initial UI based on current source + mocap state.
  updateMocapUI(props.mocap.state);
});

function toggleSaveVideo(): void {
  saveCamVideo.value = !saveCamVideo.value;
  props.mocap.saveCameraVideo = saveCamVideo.value;
  try { localStorage.setItem(SAVE_CAM_VIDEO_KEY, saveCamVideo.value ? '1' : '0'); } catch { /* quota */ }
}

onUnmounted(() => {
  props.mocap.videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
  setVideoPreview(false, false); // drop the corner thumbnail
});
</script>

<template>
  <div class="dbg-section">
    <CaptureSourceSelector
      :options="captureSourceOptions"
      :current-source="currentSource"
      :caption="presetCaption"
      @select-source="setSource"
    />

    <CaptureAgentOptions
      v-if="currentSource === 'video'"
      v-model:agent-ogi-enabled="videoAgentOgiEnabled"
    />

    <div v-if="currentSource === 'camera'" class="dbg-row">
      <span class="dbg-label">💾 Save video</span>
      <Button
        class="dbg-toggle"
        data-testid="capture-save-video"
        :class="{ off: !saveCamVideo }"
        :label="saveCamVideo ? 'ON' : 'OFF'"
        text
        size="small"
        @click="toggleSaveVideo"
      />
    </div>

    <CaptureMultiviewPanel
      v-if="currentSource === 'multiview'"
      v-model:fps="mvFps"
      v-model:side-offset="mvSideOffset"
      v-model:depth-axis="mvDepthAxis"
      v-model:depth-scale="mvDepthScale"
      :front-label="mvFrontLabel"
      :side-label="mvSideLabel"
      @choose-front="mvFrontInputRef?.click()"
      @choose-side="mvSideInputRef?.click()"
    />

    <!-- Conversion settings come BEFORE the run trigger for the video source,
         so the user reviews quality knobs first, then converts. -->
    <CaptureConvertSettings
      v-if="currentSource === 'video' && isIdle"
      :get-mocap="getMocap"
      :hip-compensator="hipCompensator"
      :hip-com-rotator="hipComRotator"
    />

    <Button
      class="capture-primary"
      data-testid="capture-primary"
      :class="{ recording: primaryRecording, convert: currentSource === 'video' && !!pendingVideo && isIdle }"
      :disabled="primaryDisabled"
      :label="primaryLabel"
      size="small"
      @click="onPrimaryClick"
    />

    <Button
      v-if="currentSource === 'video' && !!pendingVideo && isIdle"
      class="dbg-toggle off"
      data-testid="capture-change-video"
      label="Choose another video…"
      text
      size="small"
      style="width:100%"
      @click="fileInputRef?.click()"
    />
    <input ref="fileInputRef"     type="file" accept="video/*" data-testid="capture-video-input" hidden @change="onVideoFilePicked">
    <input ref="animFileInputRef" type="file" accept=".bvh,.vrma,.fbx,.json,.motion.json,.wham.json,.gvhmr.json" data-testid="capture-anim-input" hidden @change="onAnimFileChange">
    <input ref="mvFrontInputRef"  type="file" accept="video/*" hidden @change="onMultiviewFrontChange">
    <input ref="mvSideInputRef"   type="file" accept="video/*" hidden @change="onMultiviewSideChange">

    <CaptureStatusLines
      :status-text="statusText"
      :frames-text="framesText"
      :source-info="sourceInfo"
    />

    <CaptureProgressBar
      v-if="progressActive"
      :pct="progressPct"
      :phase-label="progressPhase"
      :step="progressStep"
      :total-steps="PROGRESS_PHASES.length"
      :detail="progressDetail"
    />

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

    <CapturePlaybackRow
      v-show="showPlayback"
      :paused="paused"
      :pause-label="pauseLabel"
      @pause="onPauseClick"
      @step-back="onStepBack"
      @step-forward="onStepFwd"
      @grab="onGrab"
      @flush="onFlush"
    />

    <CapturePoseExportRow
      :title="singlePoseTitle"
      :bvh-label="exportPoseLabel"
      :bvh-title="exportPoseTitle"
      :bvh-disabled="exportPoseDisabled"
      :json-label="exportPoseJsonLabel"
      :json-title="exportPoseJsonTitle"
      :json-disabled="exportPoseJsonDisabled"
      @export-pose="onExportPose"
      @export-pose-with-json="onExportPoseWithJson"
    />
  </div>
</template>

<style scoped>
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
:deep(.p-button.capture-primary.convert) {
  background: #2f9e44;
  border-color: #2f9e44;
}
:deep(.p-button.capture-primary.convert:hover) {
  background: #37b24d;
  border-color: #37b24d;
}
:deep(.p-button.dbg-toggle) {
  min-width: 34px;
  justify-content: center;
  padding: 2px 8px;
}
</style>
