import type { MocapController } from './mocap/mocapController';

export interface BvhModalContext {
  getMocap: () => MocapController | null;
  signal: AbortSignal;
  rememberTimeout: (fn: () => void, ms: number) => number;
}

export function mountBvhModal(ctx: BvhModalContext): () => void {
  const { getMocap, signal, rememberTimeout } = ctx;

  const diagBtn     = document.querySelector<HTMLButtonElement>('#bvh-diag-btn');
  const overlay     = document.getElementById('bvh-modal-overlay')!;
  const body        = document.getElementById('bvh-modal-body')!;
  const copyBtn     = document.getElementById('bvh-modal-copy')!;
  const refreshBtn  = document.getElementById('bvh-modal-refresh')!;
  const closeBtn    = document.getElementById('bvh-modal-close')!;

  let lastText = '';

  const refresh = (): void => {
    const m = getMocap();
    if (!m) {
      body.textContent = 'Mocap not initialized.';
      return;
    }
    body.textContent = 'Computing…';
    try {
      lastText = m.getBvhDiagnosticText();
      body.textContent = lastText;
    } catch (e) {
      lastText = `Error: ${(e as Error).message}`;
      body.textContent = lastText;
    }
  };

  const open = (): void => {
    overlay.style.display = 'flex';
    refresh();
  };

  const close = (): void => {
    overlay.style.display = 'none';
  };

  const opts: AddEventListenerOptions = { signal };

  diagBtn?.addEventListener('click', open, opts);
  closeBtn.addEventListener('click', close, opts);
  refreshBtn.addEventListener('click', refresh, opts);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); }, opts);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.style.display === 'flex') close();
  }, opts);

  let copyResetTimer = 0;
  copyBtn.addEventListener('click', () => {
    if (!lastText) return;
    navigator.clipboard.writeText(lastText).then(() => {
      copyBtn.textContent = '✓ copied!';
      clearTimeout(copyResetTimer);
      copyResetTimer = rememberTimeout(() => { copyBtn.textContent = '📋 copy'; }, 2000);
    });
  }, opts);

  return () => {
    clearTimeout(copyResetTimer);
    close();
  };
}
