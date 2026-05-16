<script setup lang="ts">
import { onMounted, ref } from 'vue';
import Button from 'primevue/button';
import type { SkeletonVisualizer } from '../skeletonVisualizer';
import type { BoneDragController } from '../boneDragController';
import { sceneControlsState as scene } from './sceneControlsState';

const props = defineProps<{
  skelViz: SkeletonVisualizer;
  boneDrag: BoneDragController;
  setModelVisible: (v: boolean) => void;
}>();
const vrmInputRef = ref<HTMLInputElement | null>(null);

function applySceneControls(): void {
  props.setModelVisible(scene.modelOn);
  props.skelViz.setVisible(scene.skeletonOn);
  props.skelViz.setShowBody(scene.skelBodyOn);
  props.skelViz.setShowFingers(scene.skelFingersOn);
  props.boneDrag.setEnabled(scene.dragOn);
}

onMounted(applySceneControls);

function toggleModel(): void {
  scene.modelOn = !scene.modelOn;
  props.setModelVisible(scene.modelOn);
}

function toggleSkeleton(): void {
  scene.skeletonOn = !scene.skeletonOn;
  props.skelViz.setVisible(scene.skeletonOn);
}

function toggleDrag(): void {
  scene.dragOn = !scene.dragOn;
  props.boneDrag.setEnabled(scene.dragOn);
  if (scene.dragOn && !scene.skeletonOn) {
    scene.skeletonOn = true;
    props.skelViz.setVisible(true);
  }
}

function resetDrag(): void {
  props.boneDrag.resetAll();
}

function openVrmPicker(): void {
  vrmInputRef.value?.click();
}

function onVrmFileChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  window.dispatchEvent(new CustomEvent<File>('vrm-player:load-vrm-file', { detail: file }));
}
</script>

<template>
  <div class="scene-toolbar" aria-label="Scene controls">
    <Button
      class="scene-tool"
      icon="pi pi-upload"
      text
      rounded
      size="small"
      aria-label="Load VRM"
      title="Load VRM"
      @click="openVrmPicker"
    />
    <div class="scene-tool-divider"></div>
    <Button
      class="scene-tool"
      :class="{ active: scene.modelOn }"
      icon="pi pi-user"
      text
      rounded
      size="small"
      :aria-pressed="scene.modelOn"
      aria-label="Show model"
      title="Show model (M)"
      @click="toggleModel"
    />
    <Button
      class="scene-tool"
      :class="{ active: scene.skeletonOn }"
      icon="pi pi-share-alt"
      text
      rounded
      size="small"
      :aria-pressed="scene.skeletonOn"
      aria-label="Show skeleton"
      title="Show skeleton (S)"
      @click="toggleSkeleton"
    />
    <Button
      class="scene-tool"
      :class="{ active: scene.dragOn }"
      icon="pi pi-arrows-alt"
      text
      rounded
      size="small"
      :aria-pressed="scene.dragOn"
      aria-label="Drag bones"
      title="Drag bones (D)"
      @click="toggleDrag"
    />
    <div class="scene-tool-divider"></div>
    <Button
      class="scene-tool"
      icon="pi pi-refresh"
      text
      rounded
      size="small"
      aria-label="Reset dragged bones"
      title="Reset dragged bones (R)"
      @click="resetDrag"
    />
    <input
      ref="vrmInputRef"
      type="file"
      accept=".vrm"
      hidden
      @change="onVrmFileChange"
    />
  </div>
</template>

<style scoped>
.scene-toolbar {
  align-self: start;
  justify-self: center;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  pointer-events: auto;
  background: linear-gradient(180deg, rgba(18, 23, 27, 0.9), rgba(8, 10, 13, 0.86));
  border: 1px solid rgba(169, 210, 215, 0.12);
  backdrop-filter: blur(14px);
  box-shadow: 0 14px 38px rgba(0, 0, 0, 0.26);
}

:deep(.scene-tool.p-button) {
  width: 30px;
  height: 30px;
  color: rgba(255, 255, 255, 0.58);
}

:deep(.scene-tool.p-button:hover) {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

:deep(.scene-tool.p-button.active) {
  background: rgba(30, 188, 196, 0.2);
  color: #b9fbff;
}

.scene-tool-divider {
  width: 1px;
  height: 18px;
  margin: 0 2px;
  background: rgba(255, 255, 255, 0.08);
}
</style>
