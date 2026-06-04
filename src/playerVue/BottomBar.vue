<script setup lang="ts">
/**
 * Vue replacement for the legacy `mountTransport()` DOM wiring plus the
 * status text node in index.html.
 */

import { computed, onMounted, onUnmounted, ref } from 'vue';
import Button from 'primevue/button';
import Slider from 'primevue/slider';
import type { AnimationController } from '../animationController';
import { formatLibraryName, statusText } from '../ui';

const props = defineProps<{
  controller: AnimationController;
  onSaveTrim?: (start: number, end: number) => void;
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

let timer = 0;
let lastClipSignature = '';

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

function seekToProgress(value: number | number[]): void {
  const dur = props.controller.currentDuration;
  if (dur <= 0) return;
  const pct = Array.isArray(value) ? value[0] : value;
  const frac = Math.max(0, Math.min(1, pct / 100));
  props.controller.seek(frac * dur);
  refresh();
}

const trimValid = computed(() =>
  hasActive.value
  && durationSeconds.value > 0
  && trimEnd.value - trimStart.value >= 0.05,
);

const trimLabel = computed(() =>
  `${formatTime(trimStart.value)}-${formatTime(trimEnd.value)}`,
);

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

function markTrimIn(): void {
  if (!hasActive.value) return;
  trimStart.value = Math.max(0, Math.min(currentSeconds.value, durationSeconds.value));
  if (trimEnd.value <= trimStart.value) trimEnd.value = durationSeconds.value;
  syncLoopRange();
}

function markTrimOut(): void {
  if (!hasActive.value) return;
  trimEnd.value = Math.max(0, Math.min(currentSeconds.value, durationSeconds.value));
  if (trimStart.value >= trimEnd.value) trimStart.value = 0;
  syncLoopRange();
}

function toggleLoopSegment(): void {
  loopSegment.value = !loopSegment.value;
  syncLoopRange();
}

function saveTrim(): void {
  if (!trimValid.value) return;
  props.onSaveTrim?.(trimStart.value, trimEnd.value);
  loopSegment.value = false;
  props.controller.clearPlaybackRange();
  refresh();
}

onMounted(() => {
  refresh();
  timer = window.setInterval(refresh, 100);
});

onUnmounted(() => clearInterval(timer));
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
    <Slider
      id="tp-timeline"
      v-model="progressPct"
      :min="0"
      :max="100"
      :step="0.1"
      aria-label="Timeline"
      @update:modelValue="seekToProgress"
    />
    <span id="tp-time">{{ currentTime }}</span>
    <div class="trim-tools" aria-label="Trim segment">
      <span class="trim-range">{{ trimLabel }}</span>
      <Button
        class="tp-btn trim-btn"
        icon="pi pi-sign-in"
        label="In"
        text
        size="small"
        title="Set trim start to current time"
        :disabled="!hasActive"
        @click="markTrimIn"
      />
      <Button
        class="tp-btn trim-btn"
        icon="pi pi-sign-out"
        label="Out"
        text
        size="small"
        title="Set trim end to current time"
        :disabled="!hasActive"
        @click="markTrimOut"
      />
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
        title="Save selected trim segment to queue"
        :disabled="!trimValid || !props.onSaveTrim"
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
