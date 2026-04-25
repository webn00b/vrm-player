import type { MocapController } from './mocap/mocapController';
import {
  clearDiagBuffer,
  compareSnapshots,
  flushDiagBuffer,
  formatReport,
  replayClipWithSnapshots,
  type PoseSnapshot,
} from './mocap/bvhRoundtripVerifier';
import { runProductionReplay } from './mocap/bvhRoundtripProductionReplay';
import { parseBVH } from './bvhLoader';
import { retargetBvhToVrm } from './retarget';

export interface BvhVerifyModalContext {
  getMocap: () => MocapController | null;
  signal: AbortSignal;
  rememberTimeout: (fn: () => void, ms: number) => number;
}

const CAPTURE_DURATION_MS = 3000;

type State = 'idle' | 'capturing' | 'retargeting' | 'replaying' | 'reporting';
type Source = { kind: 'live' } | { kind: 'file'; file: File };
type ReplayMode = 'prod' | 'iso';

export function mountBvhVerifyModal(ctx: BvhVerifyModalContext): () => void {
  const { getMocap, signal, rememberTimeout } = ctx;

  const btn      = document.querySelector<HTMLButtonElement>('#bvh-verify-btn');
  const fileBtn  = document.querySelector<HTMLButtonElement>('#bvh-verify-file-btn');
  const fileIn   = document.querySelector<HTMLInputElement>('#bvh-verify-file-input');
  const stateSp  = document.querySelector<HTMLSpanElement>('#bvh-verify-state');
  const overlay  = document.getElementById('bvh-verify-modal-overlay');
  const body     = document.getElementById('bvh-verify-modal-body');
  const copyBtn  = document.getElementById('bvh-verify-modal-copy');
  const closeBtn = document.getElementById('bvh-verify-modal-close');

  if (!btn || !overlay || !body || !copyBtn || !closeBtn) {
    return () => {};
  }

  let state: State = 'idle';
  let replayMode: ReplayMode = 'prod';
  let lastText = '';
  let copyResetTimer = 0;
  let captureTimer = 0;
  let tickTimer = 0;

  const modeBtns = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-verify-mode]'),
  );
  const paintModeBtns = (): void => {
    for (const b of modeBtns) {
      const isActive = b.dataset.verifyMode === replayMode;
      b.classList.toggle('off', !isActive);
    }
  };
  paintModeBtns();

  const setState = (s: State): void => {
    state = s;
    if (stateSp) {
      stateSp.textContent = s === 'idle' ? '' : `(${s}…)`;
    }
    const busy = s !== 'idle';
    btn.textContent = s === 'idle' ? 'Live' : '…';
    btn.disabled    = busy;
    if (fileBtn) {
      fileBtn.textContent = s === 'idle' ? 'Video…' : '…';
      fileBtn.disabled    = busy;
    }
  };

  const openModal = (text: string): void => {
    lastText = text;
    body.textContent = text;
    overlay.style.display = 'flex';
  };

  const setModalText = (text: string): void => {
    lastText = text;
    body.textContent = text;
  };

  const appendModalLine = (line: string): void => {
    lastText = lastText ? `${lastText}\n${line}` : line;
    body.textContent = lastText;
    body.scrollTop = body.scrollHeight;
  };

  const closeModal = (): void => {
    overlay.style.display = 'none';
  };

  const fail = (err: string): void => {
    setState('idle');
    console.warn('[verify] fail:', err);
    if (overlay.style.display === 'flex') appendModalLine(`\n❌ ${err}`);
    else openModal(`❌ ${err}`);
  };

  const runLive = async (mocap: MocapController): Promise<{ bvh: string; expected: PoseSnapshot[] } | null> => {
    if (mocap.state !== 'live') {
      fail(`Need mocap state === 'live'; current: '${mocap.state}'. Start the camera first.`);
      return null;
    }
    setState('capturing');
    mocap.startVerifyRecording();
    mocap.startVerifyCapture();

    tickTimer = window.setInterval(() => {
      if (state !== 'capturing') return;
      if (stateSp) stateSp.textContent = `(capturing ${mocap.verifyCapturedCount} frames…)`;
    }, 150);

    await new Promise<void>((resolve) => {
      captureTimer = rememberTimeout(resolve, CAPTURE_DURATION_MS);
    });

    clearInterval(tickTimer);
    tickTimer = 0;

    const expected = mocap.stopVerifyCapture();
    const bvh = mocap.stopVerifyRecording();
    return { bvh, expected };
  };

  const runFile = async (mocap: MocapController, file: File): Promise<{ bvh: string; expected: PoseSnapshot[] } | null> => {
    if (mocap.state !== 'off') {
      fail(`Need mocap state === 'off' for file verification; current '${mocap.state}'. Stop the camera first.`);
      return null;
    }
    setState('capturing');
    if (stateSp) stateSp.textContent = `(processing ${file.name}…)`;
    try {
      return await mocap.startVerifyFromFile(file, (frames) => {
        if (state === 'capturing' && stateSp) {
          stateSp.textContent = `(processing ${file.name}, ${frames} frames…)`;
        }
      });
    } catch (e) {
      fail(`file processing failed: ${(e as Error).message}`);
      return null;
    }
  };

  const run = async (source: Source): Promise<void> => {
    const mocap = getMocap();
    if (!mocap) { fail('Mocap not initialized'); return; }

    clearDiagBuffer();
    openModal(`🧪 BVH round-trip verification — ${replayMode === 'prod' ? 'PRODUCTION' : 'ISOLATED'} replay
Source: ${source.kind === 'live' ? 'live camera (3s)' : `video file "${source.file.name}"`}
`);
    console.info('[verify] run start', { mode: replayMode, source: source.kind });

    // ── Capture phase ────────────────────────────────────────────────────────
    appendModalLine(`[1/4] Capturing…`);
    const cap = source.kind === 'live'
      ? await runLive(mocap)
      : await runFile(mocap, source.file);
    if (!cap) return;
    const { bvh: bvhText, expected } = cap;
    appendModalLine(`      ✓ captured ${expected.length} frames, BVH ${bvhText.length} chars`);
    console.info('[verify] capture done', expected.length, 'frames');

    if (expected.length < 2) { fail(`captured only ${expected.length} frame(s)`); return; }
    if (!bvhText)            { fail('BVH generation returned empty'); return; }

    // ── Retarget phase ───────────────────────────────────────────────────────
    setState('retargeting');
    appendModalLine(`[2/4] Retargeting BVH → VRMA → clip…`);
    let clip;
    try {
      const parsed = parseBVH(bvhText);
      clip = await retargetBvhToVrm(mocap.vrm, parsed, 'verify-roundtrip');
    } catch (e) {
      fail(`retarget failed: ${(e as Error).message}`);
      return;
    }
    appendModalLine(`      ✓ clip duration=${clip.duration.toFixed(3)}s, tracks=${clip.tracks.length}`);
    console.info('[verify] retarget done; duration=', clip.duration, 'tracks=', clip.tracks.length);

    // ── Replay phase ─────────────────────────────────────────────────────────
    setState('replaying');
    appendModalLine(`[3/4] Replaying (${replayMode})… this may take up to ${expected.length}/30 = ${(expected.length / 30).toFixed(1)}s`);

    // Yield one tick so the label updates before the replay kicks in.
    await new Promise((r) => rememberTimeout(r as () => void, 50));

    let actual: PoseSnapshot[];
    let lastProg = 0;
    try {
      if (replayMode === 'iso') {
        actual = replayClipWithSnapshots(mocap.vrm, clip, expected.length);
      } else {
        actual = await runProductionReplay(mocap.vrm, clip, expected.length, (i) => {
          if (i - lastProg >= 15 || i === expected.length) {
            appendModalLine(`      … ${i}/${expected.length} frames`);
            lastProg = i;
          }
          if (state === 'replaying' && stateSp) {
            stateSp.textContent = `(prod replay ${i}/${expected.length}…)`;
          }
        });
      }
    } catch (e) {
      fail(`replay failed: ${(e as Error).message}`);
      return;
    }
    appendModalLine(`      ✓ captured ${actual.length} actual snapshots`);
    console.info('[verify] replay done');

    // ── Diff phase ───────────────────────────────────────────────────────────
    setState('reporting');
    appendModalLine(`[4/4] Comparing expected vs actual…`);
    const report = compareSnapshots(expected, actual);
    const header = `=== Replay mode: ${replayMode === 'prod' ? 'PRODUCTION (renderLoop + clamp + vrm.update)' : 'ISOLATED (scratch mixer)'} ===\n\n`;
    const diagLines = flushDiagBuffer();
    const diagSection = diagLines.length > 0
      ? `--- Diagnostics (per-stage trace, copy-friendly) ---\n${diagLines.join('\n')}\n\n`
      : '';
    setModalText(header + diagSection + formatReport(report));
    setState('idle');
    console.info('[verify] report ready');
  };

  const opts: AddEventListenerOptions = { signal };

  for (const b of modeBtns) {
    b.addEventListener('click', () => {
      if (state !== 'idle') return;
      const m = b.dataset.verifyMode as ReplayMode | undefined;
      if (m !== 'prod' && m !== 'iso') return;
      replayMode = m;
      paintModeBtns();
    }, opts);
  }

  btn.addEventListener('click', () => {
    if (state !== 'idle') return;
    run({ kind: 'live' }).catch((e) => fail((e as Error).message));
  }, opts);

  if (fileBtn && fileIn) {
    fileBtn.addEventListener('click', () => {
      if (state !== 'idle') return;
      fileIn.click();
    }, opts);
    fileIn.addEventListener('change', () => {
      const f = fileIn.files?.[0];
      fileIn.value = '';
      if (!f || state !== 'idle') return;
      run({ kind: 'file', file: f }).catch((e) => fail((e as Error).message));
    }, opts);
  }

  closeBtn.addEventListener('click', closeModal, opts);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); }, opts);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.style.display === 'flex') closeModal();
  }, opts);

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
    clearTimeout(captureTimer);
    clearInterval(tickTimer);
    closeModal();
  };
}
