<script setup lang="ts">
import Button from 'primevue/button';
import type { QuaternionPreset } from './retargetPresetStore';

defineProps<{
  presets: QuaternionPreset[];
  selectedPreset: QuaternionPreset | null;
}>();

const presetName = defineModel<string>('presetName', { required: true });
const selectedPresetId = defineModel<string>('selectedPresetId', { required: true });

const emit = defineEmits<{
  save: [];
  load: [];
  delete: [];
}>();
</script>

<template>
  <div class="quat-presets">
    <input v-model="presetName" type="text" placeholder="Quaternion preset name" />
    <select v-model="selectedPresetId">
      <option value="">No quaternion preset</option>
      <option v-for="preset in presets" :key="preset.id" :value="preset.id">
        {{ preset.name }} · {{ preset.bone }}
      </option>
    </select>
    <div class="quat-actions">
      <Button label="Save" icon="pi pi-save" size="small" text @click="emit('save')" />
      <Button label="Load" icon="pi pi-download" size="small" text :disabled="!selectedPreset" @click="emit('load')" />
      <Button label="Delete" icon="pi pi-trash" size="small" text severity="danger" :disabled="!selectedPreset" @click="emit('delete')" />
    </div>
  </div>
</template>

<style scoped>
.quat-presets {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.quat-presets input,
.quat-presets select {
  width: 100%;
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: #0d0d0f;
  color: #e6e6e6;
  padding: 7px 8px;
  font-size: 12px;
}

.quat-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}
</style>
