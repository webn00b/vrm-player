import type { MocapController } from './mocap/mocapController';

export interface DebugPanelMocapParamsDeps {
  root: HTMLElement;
  getMocap: () => MocapController | null;
}

/**
 * Wire the assorted single-purpose mocap parameter controls in the main
 * panel: pose-model quality selector, mirror / face-tracking / hip-position
 * / hand-priority toggles, shoulder-spread slider, OneEuroFilter toggle, and
 * depth-scale segmented control.
 *
 * Each block is independent — no shared state — but small enough on its own
 * (5–10 LOC) that splitting them further would be more clutter than help.
 * They live together because they all just twiddle a single setter on the
 * MocapController instance and don't need any other dependencies.
 */
export function wireDebugPanelMocapParams(deps: DebugPanelMocapParamsDeps): void {
  wirePoseQuality(deps);
  wireMirrorToggle(deps);
  wireFaceToggle(deps);
  wireHipPositionToggle(deps);
  wireHandPriorityCheckbox(deps);
  wireShoulderSpreadSlider(deps);
  wireOneEuroFilterToggle(deps);
  wireDepthScale(deps);
}

// ── Pose model quality (lite / full / heavy) ──────────────────────────────
// Switching is async (loads a different pose-detection model). Buttons go
// disabled with "…" indicator while the swap is in flight; refuses to switch
// while mocap is non-idle so we don't tear down a live session mid-record.
function wirePoseQuality({ root, getMocap }: DebugPanelMocapParamsDeps): void {
  const buttons = root.querySelectorAll<HTMLButtonElement>('.dbg-toggle[data-quality]');
  buttons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const mocap = getMocap();
      if (!mocap || mocap.state !== 'off') return;
      const q = btn.dataset.quality as 'lite' | 'full' | 'heavy';
      btn.textContent = '…';
      btn.disabled = true;
      try {
        await mocap.setPoseQuality(q);
      } finally {
        btn.disabled = false;
      }
      buttons.forEach((b) => {
        const active = b.dataset.quality === q;
        b.textContent = b.dataset.quality!;
        b.classList.toggle('off', !active);
      });
    });
  });
}

// ── Mirror / face / hip-position / filter — same on/off pattern ───────────
function wireOnOffToggle(
  root: HTMLElement,
  getMocap: () => MocapController | null,
  selector: string,
  read: (m: MocapController) => boolean,
  write: (m: MocapController, v: boolean) => void,
): void {
  const btn = root.querySelector<HTMLButtonElement>(selector)!;
  btn.addEventListener('click', () => {
    const m = getMocap();
    if (!m) return;
    const next = !read(m);
    write(m, next);
    btn.textContent = next ? 'ON' : 'OFF';
    btn.classList.toggle('off', !next);
  });
}

const wireMirrorToggle = ({ root, getMocap }: DebugPanelMocapParamsDeps): void =>
  wireOnOffToggle(root, getMocap, '#mocap-mirror-btn', (m) => m.mirrorX, (m, v) => m.setMirrorX(v));

const wireFaceToggle = ({ root, getMocap }: DebugPanelMocapParamsDeps): void =>
  wireOnOffToggle(root, getMocap, '#mocap-face-btn', (m) => m.faceTrackingEnabled, (m, v) => m.setFaceTrackingEnabled(v));

const wireHipPositionToggle = ({ root, getMocap }: DebugPanelMocapParamsDeps): void =>
  wireOnOffToggle(root, getMocap, '#mocap-hip-btn', (m) => m.hipPositionEnabled, (m, v) => m.setHipPositionEnabled(v));

const wireOneEuroFilterToggle = ({ root, getMocap }: DebugPanelMocapParamsDeps): void =>
  wireOnOffToggle(root, getMocap, '#mocap-filter-btn', (m) => m.filterEnabled, (m, v) => m.setFilterEnabled(v));

// ── Hand priority — checkbox flavour, defaults to ON ──────────────────────
function wireHandPriorityCheckbox({ root, getMocap }: DebugPanelMocapParamsDeps): void {
  const box = root.querySelector<HTMLInputElement>('#mocap-handprio-box')!;
  box.checked = getMocap()?.handTrackingPriorityEnabled ?? true;
  box.addEventListener('change', () => {
    const m = getMocap();
    if (!m) {
      box.checked = true;
      return;
    }
    m.setHandTrackingPriorityEnabled(box.checked);
  });
}

// ── Shoulder spread slider (in tuning panel, queried from document) ───────
function wireShoulderSpreadSlider({ getMocap }: DebugPanelMocapParamsDeps): void {
  const slider = document.querySelector<HTMLInputElement>('#mocap-spread-slider')!;
  const valEl  = document.querySelector<HTMLElement>('#mocap-spread-val')!;
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    valEl.textContent = `${v}°`;
    getMocap()?.setShoulderSpread(v);
  });
}

// ── Depth scale (2D / mid / 3D segmented control) ─────────────────────────
function wireDepthScale({ root, getMocap }: DebugPanelMocapParamsDeps): void {
  const buttons = root.querySelectorAll<HTMLButtonElement>('.dbg-toggle[data-depth]');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = getMocap();
      if (!m) return;
      const v = parseFloat(btn.dataset.depth!);
      m.setDepthScale(v);
      buttons.forEach((b) => {
        b.classList.toggle('off', parseFloat(b.dataset.depth!) !== v);
      });
    });
  });
}
