<script setup lang="ts">
/**
 * Vue replacement for the legacy `mountTransport()` DOM wiring plus the
 * status text node in index.html.
 */

import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { CSSProperties } from 'vue';
import Button from 'primevue/button';
import type { AnimationController } from '../animationController';
import { formatLibraryName, statusText } from '../ui';
import {
  clampTrimHandleDrag,
  pointerPercentToSeconds,
  type TrimEdge,
} from './bottomBarTrimRange';

const MIN_TRIM_DURATION = 0.05;
const TIMELINE_KEY_STEP = 0.1;

const props = defineProps<{
  controller: AnimationController;
  onSaveTrim?: (start: number, end: number) => void | Promise<void>;
}>();

const hasActive = ref(false);
const currentName = ref('—');
const currentTime = ref('0:00 / 0:00');
const progressPct = ref(0);
const paused = ref(true);
const currentSeconds = ref(0);
const durationSeconds = ref(0);
const trimStart = ref(0);
const trimEnd = ref(0);
const loopSegment = ref(false);
const savingTrim = ref(false);
const timelineRef = ref<HTMLElement | null>(null);
const activeDrag = ref<'seek' | TrimEdge | null>(null);

let timer = 0;
let lastClipSignature = '';
let activePointerId: number | null = null;

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function refresh(): void {
  hasActive.value = props.controller.hasBvhActive;
  if (!hasActive.value) {
    currentName.value = '—';
    currentTime.value = '0:00 / 0:00';
    progressPct.value = 0;
    paused.value = true;
    currentSeconds.value = 0;
    durationSeconds.value = 0;
    trimStart.value = 0;
    trimEnd.value = 0;
    loopSegment.value = false;
    lastClipSignature = '';
    return;
  }

  const t = props.controller.currentTime;
  const dur = props.controller.currentDuration;
  const name = props.controller.currentName;
  const signature = `${name}:${dur.toFixed(4)}`;
  if (signature !== lastClipSignature) {
    lastClipSignature = signature;
    trimStart.value = 0;
    trimEnd.value = dur;
    loopSegment.value = false;
    props.controller.clearPlaybackRange();
  }
  currentName.value = formatLibraryName(props.controller.currentName);
  currentTime.value = `${formatTime(t)} / ${formatTime(dur)}`;
  progressPct.value = dur > 0 ? Math.min(t / dur, 1) * 100 : 0;
  paused.value = props.controller.paused;
  currentSeconds.value = t;
  durationSeconds.value = dur;
}

function togglePaused(): void {
  props.controller.togglePaused();
  refresh();
}

function seekToSeconds(seconds: number): void {
  const dur = props.controller.currentDuration;
  if (dur <= 0) return;
  props.controller.seek(Math.max(0, Math.min(seconds, dur)));
  refresh();
}

function pointerPercent(event: PointerEvent): number {
  const el = timelineRef.value;
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  return ((event.clientX - rect.left) / rect.width) * 100;
}

function pointerSeconds(event: PointerEvent): number {
  return pointerPercentToSeconds(pointerPercent(event), durationSeconds.value);
}

const trimValid = computed(() =>
  hasActive.value
  && durationSeconds.value > 0
  && trimEnd.value - trimStart.value >= 0.05,
);

const trimLabel = computed(() =>
  `${formatTime(trimStart.value)}-${formatTime(trimEnd.value)}`,
);

const trimStartPct = computed(() =>
  durationSeconds.value > 0 ? Math.min(trimStart.value / durationSeconds.value, 1) * 100 : 0,
);

const trimEndPct = computed(() =>
  durationSeconds.value > 0 ? Math.min(trimEnd.value / durationSeconds.value, 1) * 100 : 0,
);

const timelineProgressStyle = computed<CSSProperties>(() => ({
  width: `${progressPct.value}%`,
}));

const trimSelectionStyle = computed<CSSProperties>(() => ({
  left: `${trimStartPct.value}%`,
  width: `${Math.max(0, trimEndPct.value - trimStartPct.value)}%`,
}));

const trimStartHandleStyle = computed<CSSProperties>(() => ({
  left: `${trimStartPct.value}%`,
}));

const trimEndHandleStyle = computed<CSSProperties>(() => ({
  left: `${trimEndPct.value}%`,
}));

const playheadStyle = computed<CSSProperties>(() => ({
  left: `${progressPct.value}%`,
}));

function syncLoopRange(): void {
  if (!loopSegment.value) {
    props.controller.clearPlaybackRange();
    return;
  }
  if (!trimValid.value) {
    loopSegment.value = false;
    props.controller.clearPlaybackRange();
    return;
  }
  props.controller.setPlaybackRange(trimStart.value, trimEnd.value);
}

function setTrimEdge(edge: TrimEdge, seconds: number): void {
  if (!hasActive.value || durationSeconds.value <= 0) return;
  const range = clampTrimHandleDrag({
    edge,
    seconds,
    start: trimStart.value,
    end: trimEnd.value,
    duration: durationSeconds.value,
    minDuration: MIN_TRIM_DURATION,
  });
  trimStart.value = range.start;
  trimEnd.value = range.end;
  syncLoopRange();
}

function beginSeekDrag(event: PointerEvent): void {
  if (!hasActive.value) return;
  event.preventDefault();
  activeDrag.value = 'seek';
  activePointerId = event.pointerId;
  seekToSeconds(pointerSeconds(event));
}

function beginTrimDrag(edge: TrimEdge, event: PointerEvent): void {
  if (!hasActive.value) return;
  event.preventDefault();
  activeDrag.value = edge;
  activePointerId = event.pointerId;
  setTrimEdge(edge, pointerSeconds(event));
}

function onPointerMove(event: PointerEvent): void {
  if (!activeDrag.value) return;
  if (activePointerId !== null && event.pointerId !== activePointerId) return;
  event.preventDefault();
  if (activeDrag.value === 'seek') {
    seekToSeconds(pointerSeconds(event));
    return;
  }
  setTrimEdge(activeDrag.value, pointerSeconds(event));
}

function endPointerDrag(event?: PointerEvent): void {
  if (event && activePointerId !== null && event.pointerId !== activePointerId) return;
  activeDrag.value = null;
  activePointerId = null;
}

function onTimelineKeydown(event: KeyboardEvent): void {
  if (!hasActive.value) return;
  const step = event.shiftKey ? 1 : TIMELINE_KEY_STEP;
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    seekToSeconds(currentSeconds.value - step);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    seekToSeconds(currentSeconds.value + step);
  } else if (event.key === 'Home') {
    event.preventDefault();
    seekToSeconds(0);
  } else if (event.key === 'End') {
    event.preventDefault();
    seekToSeconds(durationSeconds.value);
  }
}

function onTrimHandleKeydown(edge: TrimEdge, event: KeyboardEvent): void {
  if (!hasActive.value) return;
  const step = event.shiftKey ? 1 : TIMELINE_KEY_STEP;
  const current = edge === 'start' ? trimStart.value : trimEnd.value;
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    setTrimEdge(edge, current - step);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    setTrimEdge(edge, current + step);
  } else if (event.key === 'Home') {
    event.preventDefault();
    setTrimEdge(edge, 0);
  } else if (event.key === 'End') {
    event.preventDefault();
    setTrimEdge(edge, durationSeconds.value);
  }
}

function toggleLoopSegment(): void {
  loopSegment.value = !loopSegment.value;
  syncLoopRange();
}

async function saveTrim(): Promise<void> {
  if (!trimValid.value || savingTrim.value) return;
  savingTrim.value = true;
  try {
    await props.onSaveTrim?.(trimStart.value, trimEnd.value);
    loopSegment.value = false;
    props.controller.clearPlaybackRange();
    refresh();
  } finally {
    savingTrim.value = false;
  }
}

onMounted(() => {
  refresh();
  timer = window.setInterval(refresh, 100);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', endPointerDrag);
  window.addEventListener('pointercancel', endPointerDrag);
});

onUnmounted(() => {
  clearInterval(timer);
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', endPointerDrag);
  window.removeEventListener('pointercancel', endPointerDrag);
});
</script>

<template>
  <div id="status">{{ statusText }}</div>
  <div id="transport" :class="{ empty: !hasActive }">
    <span id="tp-name">{{ currentName }}</span>
    <Button
      id="tp-prev"
      class="tp-btn"
      icon="pi pi-step-backward"
      text
      rounded
      size="small"
      aria-label="Previous"
      @click="controller.prev()"
    />
    <Button
      id="tp-play"
      class="tp-btn tp-play"
      :icon="paused ? 'pi pi-play' : 'pi pi-pause'"
      text
      rounded
      size="small"
      aria-label="Play / Pause"
      @click="togglePaused"
    />
    <Button
      id="tp-next"
      class="tp-btn"
      icon="pi pi-step-forward"
      text
      rounded
      size="small"
      aria-label="Next"
      @click="controller.next()"
    />
    <div
      id="tp-timeline"
      ref="timelineRef"
      role="group"
      tabindex="0"
      aria-label="Timeline"
      @pointerdown="beginSeekDrag"
      @keydown="onTimelineKeydown"
    >
      <div class="timeline-track">
        <div class="timeline-progress" :style="timelineProgressStyle" />
        <div class="timeline-trim-selection" :style="trimSelectionStyle" />
      </div>
      <span class="timeline-playhead" :style="playheadStyle" aria-hidden="true" />
      <button
        class="timeline-trim-handle timeline-trim-start"
        type="button"
        role="slider"
        title="Trim start"
        aria-label="Trim start"
        :aria-valuemin="0"
        :aria-valuemax="Number(durationSeconds.toFixed(2))"
        :aria-valuenow="Number(trimStart.toFixed(2))"
        :style="trimStartHandleStyle"
        :disabled="!hasActive"
        @pointerdown.stop="beginTrimDrag('start', $event)"
        @keydown.stop="onTrimHandleKeydown('start', $event)"
      />
      <button
        class="timeline-trim-handle timeline-trim-end"
        type="button"
        role="slider"
        title="Trim end"
        aria-label="Trim end"
        :aria-valuemin="0"
        :aria-valuemax="Number(durationSeconds.toFixed(2))"
        :aria-valuenow="Number(trimEnd.toFixed(2))"
        :style="trimEndHandleStyle"
        :disabled="!hasActive"
        @pointerdown.stop="beginTrimDrag('end', $event)"
        @keydown.stop="onTrimHandleKeydown('end', $event)"
      />
    </div>
    <span id="tp-time">{{ currentTime }}</span>
    <div class="trim-tools" aria-label="Trim segment">
      <span class="trim-range">{{ trimLabel }}</span>
      <Button
        class="tp-btn trim-btn"
        :class="{ active: loopSegment }"
        icon="pi pi-refresh"
        text
        size="small"
        title="Loop selected trim segment"
        :disabled="!trimValid"
        @click="toggleLoopSegment"
      />
      <Button
        class="tp-btn trim-btn trim-save"
        icon="pi pi-save"
        text
        size="small"
        title="Save selected trim segment"
        :disabled="!trimValid || !props.onSaveTrim || savingTrim"
        @click="saveTrim"
      />
    </div>
  </div>
</template>

<style scoped>
:deep(.tp-btn.p-button) {
  width: 30px;
  height: 30px;
  padding: 0;
  color: rgba(245, 250, 252, 0.72);
}

:deep(.tp-play.p-button) {
  width: 34px;
  height: 34px;
  background: rgba(30, 188, 196, 0.2);
  color: #b9fbff;
}

:deep(.tp-btn.p-button:hover) {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

.trim-tools {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding-left: 2px;
}

#tp-timeline {
  isolation: isolate;
  touch-action: none;
  overflow: visible;
}

.timeline-track {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
}

.timeline-progress,
.timeline-trim-selection {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  pointer-events: none;
}

.timeline-progress {
  background: linear-gradient(90deg, #3b5bdb, #6186ff);
  box-shadow: 0 0 5px rgba(59, 91, 219, 0.35);
}

.timeline-trim-selection {
  background: rgba(30, 188, 196, 0.32);
  box-shadow: inset 0 0 0 1px rgba(185, 251, 255, 0.32);
  z-index: 1;
}

.timeline-playhead,
.timeline-trim-handle {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 3;
}

.timeline-playhead {
  width: 2px;
  height: 16px;
  border-radius: 999px;
  background: #f8fbff;
  box-shadow: 0 0 8px rgba(248, 251, 255, 0.45);
  pointer-events: none;
}

.timeline-trim-handle {
  width: 11px;
  height: 20px;
  padding: 0;
  border: 1px solid rgba(185, 251, 255, 0.78);
  border-radius: 4px;
  background: #102a30;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.38);
  cursor: ew-resize;
}

.timeline-trim-handle::before {
  content: "";
  position: absolute;
  inset: 4px 4px;
  border-left: 1px solid rgba(185, 251, 255, 0.55);
  border-right: 1px solid rgba(185, 251, 255, 0.55);
}

.timeline-trim-handle:hover,
.timeline-trim-handle:focus-visible {
  border-color: #b9fbff;
  background: #12363d;
  outline: none;
}

.timeline-trim-start {
  z-index: 4;
}

.timeline-trim-end {
  z-index: 5;
}

.timeline-trim-handle:disabled {
  cursor: default;
  opacity: 0;
}

.trim-range {
  width: 70px;
  color: rgba(245, 250, 252, 0.58);
  font-size: 10px;
  line-height: 1;
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

:deep(.trim-btn.p-button) {
  width: auto;
  min-width: 30px;
  height: 28px;
  gap: 4px;
  padding: 0 6px;
}

:deep(.trim-btn.p-button .p-button-label) {
  font-size: 10px;
  font-weight: 650;
}

:deep(.trim-btn.active.p-button),
:deep(.trim-btn.active.p-button:hover) {
  background: rgba(30, 188, 196, 0.2);
  color: #b9fbff;
}

:deep(.trim-save.p-button) {
  min-width: 28px;
}

@media (max-width: 560px) {
  #status {
    display: none;
  }

  #transport {
    flex-wrap: wrap;
    gap: 6px;
    padding: 7px 8px;
  }

  #tp-name {
    display: none;
  }

  #tp-timeline {
    order: 2;
    flex: 1 1 120px;
  }

  #tp-time {
    order: 2;
    min-width: 66px;
  }

  .trim-tools {
    order: 3;
    flex: 1 0 100%;
    justify-content: flex-end;
  }

  .trim-range {
    flex: 1 1 auto;
    text-align: left;
  }
}
</style>
