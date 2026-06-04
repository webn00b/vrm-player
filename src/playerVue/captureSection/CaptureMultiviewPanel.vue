<script setup lang="ts">
import Button from 'primevue/button';
import type { MultiviewDepthAxis } from './captureSectionTypes';

defineProps<{
  frontLabel: string;
  sideLabel: string;
}>();

const fps = defineModel<number>('fps', { required: true });
const sideOffset = defineModel<number>('sideOffset', { required: true });
const depthAxis = defineModel<MultiviewDepthAxis>('depthAxis', { required: true });
const depthScale = defineModel<number>('depthScale', { required: true });

const emit = defineEmits<{
  chooseFront: [];
  chooseSide: [];
}>();
</script>

<template>
  <div class="multiview-box">
    <div class="multiview-file-row">
      <Button
        class="dbg-toggle multiview-file-btn"
        :label="frontLabel"
        text
        size="small"
        @click="emit('chooseFront')"
      />
      <Button
        class="dbg-toggle multiview-file-btn"
        :label="sideLabel"
        text
        size="small"
        @click="emit('chooseSide')"
      />
    </div>
    <div class="multiview-controls">
      <label>
        <span>FPS</span>
        <input v-model.number="fps" type="number" min="1" max="60" step="1">
      </label>
      <label>
        <span>Offset</span>
        <input v-model.number="sideOffset" type="number" step="1">
      </label>
      <label>
        <span>Depth</span>
        <select v-model="depthAxis">
          <option value="x">x</option>
          <option value="-x">-x</option>
          <option value="z">z</option>
          <option value="-z">-z</option>
        </select>
      </label>
      <label>
        <span>Scale</span>
        <input v-model.number="depthScale" type="number" min="0.05" max="4" step="0.05">
      </label>
    </div>
  </div>
</template>

<style scoped>
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
  color: rgba(255, 255, 255, .48);
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
