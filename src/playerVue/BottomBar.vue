<script setup lang="ts">
/**
 * Vue replacement for the legacy `mountTransport()` DOM wiring plus the
 * status text node in index.html.
 */

import { onMounted, onUnmounted, ref } from 'vue';
import Button from 'primevue/button';
import Slider from 'primevue/slider';
import type { AnimationController } from '../animationController';
import { formatLibraryName, statusText } from '../ui';

const props = defineProps<{
  controller: AnimationController;
}>();

const hasActive = ref(false);
const currentName = ref('—');
const currentTime = ref('0:00 / 0:00');
const progressPct = ref(0);
const paused = ref(true);

let timer = 0;

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
    return;
  }

  const t = props.controller.currentTime;
  const dur = props.controller.currentDuration;
  currentName.value = formatLibraryName(props.controller.currentName);
  currentTime.value = `${formatTime(t)} / ${formatTime(dur)}`;
  progressPct.value = dur > 0 ? Math.min(t / dur, 1) * 100 : 0;
  paused.value = props.controller.paused;
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
</style>
