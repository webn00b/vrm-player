<script setup lang="ts">
/**
 * PrimeVue Dialog wrapper for the BVH round-trip verification modal.
 *
 * Same shape as BvhDiagModal — plain-text body, copy button, v-model.
 * Driven by BvhVerifyFold which streams progress text into the
 * `content` prop as the capture / retarget / replay / report stages
 * run.
 */

import { computed } from 'vue';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import { useToast } from 'primevue/usetoast';

const props = defineProps<{
  modelValue: boolean;
  /** Plain-text body content (rolling report from BvhVerifyFold). */
  content: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

const visible = computed<boolean>({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const toast = useToast();

async function copyToClipboard(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.content);
    toast.add({
      severity: 'success',
      summary: 'Copied',
      detail: 'Verify report → clipboard',
      life: 2000,
    });
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Copy failed',
      detail: (e as Error).message,
      life: 3000,
    });
  }
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    dismissable-mask
    :draggable="false"
    :style="{ width: '680px', maxWidth: '92vw' }"
    :content-style="{ maxHeight: '82vh', overflow: 'auto', padding: '0' }"
  >
    <template #header>
      <div class="header-flex">
        <span class="title">🧪 BVH round-trip verification</span>
        <Button
          icon="pi pi-copy"
          label="copy"
          severity="secondary"
          size="small"
          text
          @click="copyToClipboard"
        />
      </div>
    </template>

    <pre class="body">{{ content }}</pre>
  </Dialog>
</template>

<style scoped>
.header-flex {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.03em;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
}
.body {
  margin: 0;
  padding: 12px 18px 16px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 10px;
  line-height: 1.55;
  color: #e0e0e0;
  white-space: pre;
}
</style>
