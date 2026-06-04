<script setup lang="ts">
import RetargetLabContainer from './retargetLab/RetargetLabContainer.vue';
import type { RetargetLabProps } from './retargetLab/retargetLabProps';

defineProps<RetargetLabProps>();
</script>

<template>
  <RetargetLabContainer
    :vrm="vrm"
    :on-import="onImport"
    :on-preview="onPreview"
    :on-preview-seek="onPreviewSeek"
    :on-preview-stop="onPreviewStop"
  />
</template>
