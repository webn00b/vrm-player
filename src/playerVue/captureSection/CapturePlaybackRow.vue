<script setup lang="ts">
import Button from 'primevue/button';

defineProps<{
  paused: boolean;
  pauseLabel: string;
}>();

const emit = defineEmits<{
  pause: [];
  stepBack: [];
  stepForward: [];
  grab: [];
  flush: [];
}>();
</script>

<template>
  <div class="dbg-row playback-row">
    <Button
      class="dbg-toggle"
      :class="{ off: paused }"
      title="Pause / resume"
      :label="pauseLabel"
      text
      size="small"
      @click="emit('pause')"
    />
    <Button class="dbg-toggle off" icon="pi pi-step-backward" text size="small" title="Step -1 frame" @click="emit('stepBack')" />
    <Button class="dbg-toggle off" icon="pi pi-step-forward" text size="small" title="Step +1 frame" @click="emit('stepForward')" />
    <Button class="dbg-toggle off" icon="pi pi-save" text size="small" title="Grab current pose" @click="emit('grab')" />
    <Button class="dbg-toggle off" icon="pi pi-download" text size="small" title="Download captured BVH" @click="emit('flush')" />
  </div>
</template>

<style scoped>
.playback-row {
  gap: 3px;
  justify-content: flex-start;
  margin-top: 4px;
}

:deep(.p-button.dbg-toggle) {
  min-width: 34px;
  justify-content: center;
  padding: 2px 8px;
}
</style>
