<script setup lang="ts">
/**
 * Priority-animator activity bars + active bones / idle clips readout.
 *
 * Replaces `wirePriorityBars` from the old debugPanelStats.ts. Polls
 * `pa.levelSnapshot` every 100 ms, mutates reactive refs — Vue diffs
 * the DOM. The original was setInterval + manual textContent + style.width;
 * ~50 LOC of imperative DOM mutation.
 */

import { ref, onMounted, onUnmounted, computed } from 'vue';
import type { PriorityAnimator } from '../priorityAnimator';

const props = defineProps<{
  pa: PriorityAnimator;
  idleClips: number;
}>();

const MAX_BONES = 15;

const lv1Count    = ref(0);
const lv2Count    = ref(0);
const lv5Count    = ref(0);
const activeBones = ref(0);

const lv1Pct = computed(() => Math.min(100, (lv1Count.value / MAX_BONES) * 100));
const lv2Pct = computed(() => Math.min(100, (lv2Count.value / MAX_BONES) * 100));
const lv5Pct = computed(() => Math.min(100, (lv5Count.value / MAX_BONES) * 100));

let timer = 0;
function refresh(): void {
  let lv1 = 0, lv2 = 0, lv5 = 0;
  for (const [, level] of props.pa.levelSnapshot) {
    if (level >= 5) lv5++; else if (level === 2) lv2++; else if (level === 1) lv1++;
  }
  lv1Count.value = lv1;
  lv2Count.value = lv2;
  lv5Count.value = lv5;
  activeBones.value = props.pa.activeBoneCount;
}

onMounted(() => {
  refresh();
  timer = window.setInterval(refresh, 100);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="dbg-levels">
    <div class="dbg-level-row">
      <span class="dbg-lv-label">Lv 1 – lower body</span>
      <div class="dbg-bar-wrap">
        <div class="dbg-bar"
             :style="{ width: lv1Pct + '%', opacity: lv1Count > 0 ? 1 : 0.2 }"></div>
      </div>
    </div>
    <div class="dbg-level-row">
      <span class="dbg-lv-label">Lv 2 – upper body</span>
      <div class="dbg-bar-wrap">
        <div class="dbg-bar"
             :style="{ width: lv2Pct + '%', opacity: lv2Count > 0 ? 1 : 0.2 }"></div>
      </div>
    </div>
    <div class="dbg-level-row">
      <span class="dbg-lv-label">Lv 5+ – gesture</span>
      <div class="dbg-bar-wrap">
        <div class="dbg-bar"
             :style="{ width: lv5Pct + '%', opacity: lv5Count > 0 ? 1 : 0.2 }"></div>
      </div>
    </div>
  </div>
  <div class="dbg-stat">Active bones: {{ activeBones }}</div>
  <div class="dbg-stat">Idle clips: {{ idleClips }}</div>
</template>
