<script setup lang="ts">
import { ref } from 'vue';
import Button from 'primevue/button';
import type { RetargetPreset } from './retargetPresetStore';

defineProps<{
  presets: RetargetPreset[];
  selectedPreset: RetargetPreset | null;
  mappedCount: number;
  slotCount: number;
}>();

const presetName = defineModel<string>('presetName', { required: true });
const selectedPresetId = defineModel<string>('selectedPresetId', { required: true });
const presetInput = ref<HTMLInputElement | null>(null);

const emit = defineEmits<{
  save: [];
  load: [];
  delete: [];
  export: [];
  importFile: [event: Event];
}>();
</script>

<template>
  <div class="preset-panel">
    <div class="preset-title">
      <span>Mapping Presets</span>
      <small>{{ presets.length }}</small>
    </div>
    <input
      v-model="presetName"
      class="preset-name"
      type="text"
      placeholder="Preset name"
    />
    <select v-model="selectedPresetId" class="preset-select">
      <option value="">No preset selected</option>
      <option v-for="preset in presets" :key="preset.id" :value="preset.id">
        {{ preset.name }} · {{ preset.mappedCount }}/{{ slotCount }}
      </option>
    </select>
    <div v-if="selectedPreset" class="preset-meta">
      {{ selectedPreset.format.toUpperCase() }} · {{ selectedPreset.sourceJointCount }} joints ·
      {{ new Date(selectedPreset.updatedAt).toLocaleDateString() }}
    </div>
    <div class="preset-actions">
      <Button label="Save" icon="pi pi-save" size="small" :disabled="mappedCount === 0" @click="emit('save')" />
      <Button label="Load" icon="pi pi-download" size="small" text :disabled="!selectedPreset" @click="emit('load')" />
      <Button label="Delete" icon="pi pi-trash" size="small" text severity="danger" :disabled="!selectedPreset" @click="emit('delete')" />
      <Button label="Export" icon="pi pi-file-export" size="small" text :disabled="!selectedPreset" @click="emit('export')" />
      <Button label="Import" icon="pi pi-file-import" size="small" text @click="presetInput?.click()" />
    </div>
    <input
      ref="presetInput"
      class="hidden-input"
      type="file"
      accept=".json,application/json"
      @change="emit('importFile', $event)"
    />
  </div>
</template>

<style scoped>
.preset-panel {
  margin-top: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
  padding: 10px;
}

.preset-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
}

.preset-title small,
.preset-meta {
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.48);
}

.preset-name,
.preset-select {
  width: 100%;
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: #0d0d0f;
  color: #e6e6e6;
  padding: 7px 8px;
  font-size: 12px;
}

.preset-select {
  margin-top: 7px;
}

.preset-meta {
  margin-top: 6px;
  line-height: 1.35;
}

.preset-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

.hidden-input {
  display: none;
}
</style>
