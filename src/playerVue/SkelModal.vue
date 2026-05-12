<script setup lang="ts">
/**
 * PrimeVue Dialog wrapper for the skeleton-info modal.
 *
 * The heavy 600-line content builder (`buildModalContent` in
 * debugPanelSkelModal.ts) stays vanilla — it does a LOT of geometry
 * + format computation and returns one HTML string. This component
 * just provides the Dialog shell + copy button + handles open state.
 *
 * Why this is a real upgrade vs. the previous bespoke overlay:
 *   ✓ ESC to close (free from PrimeVue)
 *   ✓ Focus trap (accessibility)
 *   ✓ Click-outside-to-dismiss (via :dismissable-mask)
 *   ✓ Smooth fade/scale animation
 *   ✓ Consistent theme with the rest of the player
 *   ✓ No manual z-index / backdrop / overlay CSS in index.html
 */

import { computed } from 'vue';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import { useToast } from 'primevue/usetoast';

const props = defineProps<{
  /** Two-way bound visibility flag. */
  modelValue: boolean;
  /** Pre-rendered HTML content (built by the imperative content builder). */
  content: string;
  /** Plain-text version for clipboard copy. */
  clipboardText: string;
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
    await navigator.clipboard.writeText(props.clipboardText);
    toast.add({
      severity: 'success',
      summary: 'Copied',
      detail: 'Skeleton info → clipboard',
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
    :style="{ width: '760px', maxWidth: '92vw' }"
    :content-style="{ maxHeight: '80vh', overflow: 'auto', padding: '0' }"
    :pt="{ root: { class: 'skel-modal-root' } }"
  >
    <template #header>
      <div class="header-flex">
        <span class="title">🦴 Skeleton info</span>
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

    <div class="body" v-html="content"></div>
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
  font-size: 11px;
  line-height: 1.5;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  padding: 12px 18px 16px;
}
/* The body content uses class names .skel-section / .skel-cols / .skel-row /
   .skel-divider / .skel-cal / .skel-uncal — these are styled globally in
   index.html. We don't restyle them here to keep the look identical. */
</style>
