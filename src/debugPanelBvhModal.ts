import { createApp, ref, type App } from 'vue';
import BvhDiagModal from './playerVue/BvhDiagModal.vue';
import { installPrimeVueOn } from './playerVue/plugin';
import type { MocapController } from './mocap/pipeline/mocapController';

export interface BvhModalContext {
  getMocap: () => MocapController | null;
  signal: AbortSignal;
  /** Kept for API parity with the previous version (no longer used). */
  rememberTimeout?: (fn: () => void, ms: number) => number;
}

/**
 * Mounts the BVH-diagnostic modal as a PrimeVue Dialog inside a tiny Vue app.
 *
 * The previous version owned a hand-rolled overlay (manual ESC handler,
 * click-outside listener, copy-button text mutation). PrimeVue Dialog gives
 * us ESC / focus-trap / dismissable-mask for free.
 *
 * The `#bvh-diag-btn` button (inside the Mocap-advanced fold rendered by
 * DebugPanelRoot.vue) still uses `document.querySelector` for binding —
 * it's a leaf interaction with no business logic, not worth wiring up
 * an event bus or prop chain for.
 */
export function mountBvhModal(ctx: BvhModalContext): () => void {
  const { getMocap, signal } = ctx;

  const isOpen  = ref(false);
  const content = ref('');

  const refresh = (): void => {
    const m = getMocap();
    if (!m) { content.value = 'Mocap not initialized.'; return; }
    try {
      content.value = m.getBvhDiagnosticText();
    } catch (e) {
      content.value = `Error: ${(e as Error).message}`;
    }
  };

  // Vue host (Dialog teleports itself to <body>, the host just anchors lifecycle).
  const host = document.createElement('div');
  host.id = 'bvh-modal-host';
  document.body.appendChild(host);

  const app: App = createApp({
    components: { BvhDiagModal },
    setup() {
      return { isOpen, content, refresh };
    },
    template: `
      <BvhDiagModal
        v-model="isOpen"
        :content="content"
        @refresh="refresh"
      />
    `,
  });
  installPrimeVueOn(app);
  app.mount(host);

  // Open-on-click wiring for the trigger button in the Mocap-advanced fold.
  const diagBtn = document.querySelector<HTMLButtonElement>('#bvh-diag-btn');
  diagBtn?.addEventListener('click', () => {
    refresh();
    isOpen.value = true;
  }, { signal });

  return () => {
    isOpen.value = false;
    app.unmount();
    host.remove();
  };
}
