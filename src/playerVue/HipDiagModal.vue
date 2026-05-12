<script setup lang="ts">
/**
 * PrimeVue Dialog wrapper for the hip / leg rig diagnostics modal.
 *
 * Same pattern as BvhDiagModal: plain-text JSON body, copy + refresh
 * buttons, v-model:visible. Triggered by the "🔬 Diag" button next to
 * the hips=shoulders toggle inside CalibrationBlock.
 */

import { computed } from 'vue';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import { useToast } from 'primevue/usetoast';

const props = defineProps<{
  modelValue: boolean;
  /** JSON dump (plain text). */
  content: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'refresh'): void;
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
      detail: 'Hip diagnostics → clipboard',
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
        <span class="title">🦵 Hip / leg diagnostics</span>
        <span class="actions">
          <Button
            icon="pi pi-copy"
            label="copy"
            severity="secondary"
            size="small"
            text
            @click="copyToClipboard"
          />
          <Button
            icon="pi pi-refresh"
            label="refresh"
            severity="secondary"
            size="small"
            text
            @click="emit('refresh')"
          />
        </span>
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
.actions {
  display: flex;
  gap: 6px;
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
