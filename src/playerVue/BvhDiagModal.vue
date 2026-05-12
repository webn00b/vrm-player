<script setup lang="ts">
/**
 * PrimeVue Dialog wrapper for the BVH-diagnostic modal.
 *
 * Replaces the bespoke `#bvh-modal-overlay` + manual open/close + ESC +
 * click-outside listeners that lived in `mountBvhModal`. The content is
 * plain text (returned by `mocap.getBvhDiagnosticText()`) so we just
 * render it inside a `<pre>` — no v-html needed (unlike SkelModal).
 *
 * Why this is a real upgrade vs. the previous bespoke overlay:
 *   ✓ ESC to close (free from PrimeVue)
 *   ✓ Focus trap
 *   ✓ Click-outside-to-dismiss (via :dismissable-mask)
 *   ✓ Smooth fade/scale animation
 *   ✓ Theme-consistent with the rest of PrimeVue (Aura dark)
 *   ✓ Copy / refresh buttons use PrimeVue Button + Toast for feedback
 */

import { computed } from 'vue';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import { useToast } from 'primevue/usetoast';

const props = defineProps<{
  /** Two-way bound visibility flag. */
  modelValue: boolean;
  /** Plain-text body content (re-computed by the controller). */
  content: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  /** Bubbled to the controller so it recomputes content immediately. */
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
      detail: 'BVH diagnostic → clipboard',
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
    :style="{ width: '660px', maxWidth: '92vw' }"
    :content-style="{ maxHeight: '82vh', overflow: 'auto', padding: '0' }"
  >
    <template #header>
      <div class="header-flex">
        <span class="title">🔬 BVH диагностика</span>
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
