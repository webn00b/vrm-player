<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import Button from 'primevue/button';
import type { AnimationController } from '../animationController';
import { notify } from '../ui';
import { sceneControlsState as scene } from './sceneControlsState';

const props = defineProps<{
  controller: AnimationController;
  setModelVisible: (v: boolean) => void;
}>();

const addInputRef = ref<HTMLInputElement | null>(null);
const vrmInputRef = ref<HTMLInputElement | null>(null);
const queueLength = ref(0);
const hasActive = ref(false);
const paused = ref(true);
let timer = 0;

const visible = computed(() => !scene.modelOn || queueLength.value === 0);
const clipState = computed(() => (
  queueLength.value > 0 ? `${queueLength.value} in queue` : 'No animation'
));
const playbackLabel = computed(() => (!hasActive.value || paused.value ? 'Play' : 'Pause'));
const playbackIcon = computed(() => (!hasActive.value || paused.value ? 'pi pi-play' : 'pi pi-pause'));

function refresh(): void {
  queueLength.value = props.controller.queueLength;
  hasActive.value = props.controller.hasBvhActive;
  paused.value = props.controller.paused;
}

function showAvatar(): void {
  scene.modelOn = true;
  props.setModelVisible(true);
}

function openAddPicker(): void {
  addInputRef.value?.click();
}

function openVrmPicker(): void {
  vrmInputRef.value?.click();
}

function onAddFileChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (files.length === 0) return;
  window.dispatchEvent(new CustomEvent<File[]>('vrm-player:add-animation-files', { detail: files }));
}

function onVrmFileChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  window.dispatchEvent(new CustomEvent<File>('vrm-player:load-vrm-file', { detail: file }));
}

function togglePlayback(): void {
  if (!hasActive.value) {
    notify({ severity: 'warn', summary: 'No animation in queue' });
    return;
  }
  props.controller.togglePaused();
  refresh();
}

onMounted(() => {
  refresh();
  timer = window.setInterval(refresh, 250);
});

onUnmounted(() => clearInterval(timer));
</script>

<template>
  <section v-show="visible" class="start-panel" aria-label="Player start actions">
    <div class="start-head">
      <span>Assets</span>
      <small>{{ scene.modelOn ? 'Avatar visible' : 'Avatar hidden' }} · {{ clipState }}</small>
    </div>

    <div class="start-actions">
      <Button
        class="start-action"
        :class="{ done: scene.modelOn }"
        :icon="scene.modelOn ? 'pi pi-check' : 'pi pi-user'"
        :label="scene.modelOn ? 'Avatar on' : 'Show avatar'"
        size="small"
        @click="showAvatar"
      />
      <Button
        class="start-action"
        icon="pi pi-upload"
        label="Load VRM"
        size="small"
        data-testid="start-load-vrm"
        @click="openVrmPicker"
      />
      <Button
        class="start-action"
        icon="pi pi-plus"
        label="Add animation"
        size="small"
        data-testid="start-add-animation"
        @click="openAddPicker"
      />
      <Button
        class="start-action"
        :disabled="!hasActive"
        :icon="playbackIcon"
        :label="playbackLabel"
        size="small"
        @click="togglePlayback"
      />
    </div>

    <input
      ref="addInputRef"
      type="file"
      accept=".bvh,.vrma,.fbx"
      multiple
      hidden
      @change="onAddFileChange"
    />
    <input
      ref="vrmInputRef"
      type="file"
      accept=".vrm"
      hidden
      @change="onVrmFileChange"
    />
  </section>
</template>

<style scoped>
.start-panel {
  width: min(420px, 100%);
  align-self: start;
  justify-self: center;
  margin-top: 10px;
  padding: 12px;
  border-radius: 8px;
  pointer-events: auto;
  background: rgba(16, 16, 16, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.24);
}

.start-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  font-family: var(--font-ui);
}

.start-head span {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.66);
}

.start-head small {
  min-width: 0;
  color: rgba(255, 255, 255, 0.42);
  font-size: 10px;
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.start-actions {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

:deep(.start-action.p-button) {
  min-width: 0;
  justify-content: center;
  padding-inline: 10px;
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.82);
  font-family: var(--font-ui);
  font-size: 11px;
  font-weight: 700;
}

:deep(.start-action.p-button:hover) {
  background: rgba(59, 91, 219, 0.24);
  border-color: rgba(110, 168, 255, 0.3);
  color: #fff;
}

:deep(.start-action.p-button.done) {
  background: rgba(16, 185, 129, 0.18);
  border-color: rgba(16, 185, 129, 0.28);
  color: #9ff3d0;
}

@media (max-width: 520px) {
  .start-panel {
    width: min(360px, calc(100vw - 24px));
    margin-top: 6px;
  }

  .start-head {
    align-items: start;
    flex-direction: column;
    gap: 4px;
  }

  .start-actions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  :deep(.start-action.p-button) {
    min-height: 34px;
  }
}
</style>
