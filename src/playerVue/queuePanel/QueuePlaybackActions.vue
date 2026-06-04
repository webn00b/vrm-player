<script setup lang="ts">
import Button from 'primevue/button';

defineProps<{
  queueIndex: number;
  canRetarget: boolean;
}>();

const emit = defineEmits<{
  jump: [queueIndex: number];
  duplicate: [queueIndex: number];
  retarget: [queueIndex: number];
  remove: [queueIndex: number];
}>();
</script>

<template>
  <Button
    class="q-action q-play"
    icon="pi pi-play"
    text
    rounded
    size="small"
    aria-label="Play this clip"
    title="Play this clip"
    @click.stop="emit('jump', queueIndex)"
  />
  <Button
    class="q-action q-duplicate"
    icon="pi pi-copy"
    text
    rounded
    size="small"
    aria-label="Duplicate in queue"
    title="Duplicate this clip in the queue"
    @click.stop="emit('duplicate', queueIndex)"
  />
  <Button
    v-if="canRetarget"
    class="q-action q-retarget"
    icon="pi pi-sliders-h"
    text
    rounded
    size="small"
    aria-label="Open in Retarget Lab"
    title="Open this clip in Retarget Lab"
    @click.stop="emit('retarget', queueIndex)"
  />
  <Button
    class="q-action q-remove"
    icon="pi pi-times"
    text
    rounded
    size="small"
    aria-label="Remove from queue"
    title="Remove this clip from the queue"
    @click.stop="emit('remove', queueIndex)"
  />
</template>

<style scoped>
.q-action {
  flex-shrink: 0;
  background: transparent;
  border: 1px solid #444;
  color: #aaa;
  border-radius: 3px;
  padding: 0 6px;
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
  font-family: inherit;
}

:deep(.q-action.p-button) {
  min-width: 0;
  height: 18px;
}

.q-action:hover {
  background: #2a3550;
  color: #fff;
  border-color: #3b5bdb;
}

.q-remove {
  border: none;
  color: rgba(255, 255, 255, 0.2);
  padding: 2px 3px;
  font-size: 9px;
  line-height: 1;
}

:deep(.q-remove.p-button) {
  width: 18px;
}

.q-remove:hover {
  color: #f87171;
  background: rgba(248, 113, 113, 0.1);
  border-color: transparent;
}

:deep(.q-play.p-button),
:deep(.q-duplicate.p-button),
:deep(.q-retarget.p-button) {
  width: 18px;
}

.q-play:hover,
.q-duplicate:hover,
.q-retarget:hover {
  color: #fff;
  background: rgba(30, 188, 196, 0.2);
  border-color: transparent;
}
</style>
