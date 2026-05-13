<script setup lang="ts">
/**
 * Vue replacement for the old imperative `BonePosePanel.mount()`.
 * The BonePosePanel class remains the render-loop model: this component
 * edits its offsets and enabled state, while `apply()` still runs per frame.
 */

import { reactive, ref } from 'vue';
import Button from 'primevue/button';
import Slider from 'primevue/slider';
import ToggleSwitch from 'primevue/toggleswitch';
import type { BoneAxis, BonePosePanel } from '../bonePosePanel';

const props = defineProps<{
  bonePanel: BonePosePanel;
}>();

const enabled = ref(props.bonePanel.enabled);
const bones = props.bonePanel.getAvailableBones();
const values = reactive<Record<string, number>>({});

for (const bone of bones) {
  for (const axis of bone.axes) {
    values[keyOf(bone.vrm, axis.axis)] = props.bonePanel.getOffset(bone.vrm, axis.axis);
  }
}

function keyOf(bone: string, axis: BoneAxis['axis']): string {
  return `${bone}:${axis}`;
}

function onEnabledChange(): void {
  props.bonePanel.setEnabled(enabled.value);
  if (!enabled.value) syncFromPanel();
}

function resetAll(): void {
  props.bonePanel.resetAll();
  syncFromPanel();
}

function syncFromPanel(): void {
  for (const bone of bones) {
    for (const axis of bone.axes) {
      values[keyOf(bone.vrm, axis.axis)] = props.bonePanel.getOffset(bone.vrm, axis.axis);
    }
  }
}

function onOffsetInput(bone: string, axis: BoneAxis['axis']): void {
  props.bonePanel.setOffset(bone, axis, values[keyOf(bone, axis)]);
}

function onSliderUpdate(bone: string, axis: BoneAxis['axis'], value: number | number[]): void {
  values[keyOf(bone, axis)] = Array.isArray(value) ? value[0] : value;
  onOffsetInput(bone, axis);
}
</script>

<template>
  <div class="dbg-row">
    <span class="dbg-label">Manual offsets</span>
    <div class="bone-pose-actions">
      <ToggleSwitch
        v-model="enabled"
        aria-label="Enable manual bone offsets"
        @update:modelValue="onEnabledChange"
      />
      <Button
        label="Reset"
        icon="pi pi-refresh"
        text
        size="small"
        severity="secondary"
        @click="resetAll"
      />
    </div>
  </div>

  <div v-if="bones.length === 0" class="dbg-stat">No humanoid bones found.</div>

  <div v-for="bone in bones" :key="bone.vrm" class="bone-pose-group">
    <div class="bone-pose-title">{{ bone.label }}</div>
    <div v-for="axis in bone.axes" :key="axis.axis" class="bone-pose-row">
      <span class="bone-pose-axis">{{ axis.label }}</span>
      <Slider
        :modelValue="values[keyOf(bone.vrm, axis.axis)]"
        :min="axis.min"
        :max="axis.max"
        :step="1"
        class="dbg-slider bone-pose-slider"
        :aria-label="`${bone.label} ${axis.label}`"
        @update:modelValue="onSliderUpdate(bone.vrm, axis.axis, $event)"
      />
      <span class="bone-pose-value">{{ values[keyOf(bone.vrm, axis.axis)] }}°</span>
    </div>
  </div>
</template>

<style scoped>
.bone-pose-group {
  margin-top: 8px;
}

.bone-pose-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.bone-pose-title {
  font-size: 10px;
  opacity: 0.45;
  margin-bottom: 3px;
  font-weight: 600;
}

.bone-pose-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.bone-pose-axis {
  font-size: 10px;
  opacity: 0.55;
  width: 58px;
  flex-shrink: 0;
}

.bone-pose-slider {
  flex: 1;
  margin-left: 0;
}

:deep(.bone-pose-slider.p-slider) {
  height: 3px;
}

:deep(.bone-pose-slider .p-slider-handle) {
  width: 10px;
  height: 10px;
}

.bone-pose-value {
  font-size: 10px;
  font-family: ui-monospace, monospace;
  opacity: 0.6;
  width: 28px;
  text-align: right;
}
</style>
