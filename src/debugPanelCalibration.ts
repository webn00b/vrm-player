import type { MocapController } from './mocap/mocapController';

export interface DebugPanelCalibrationDeps {
  getMocap: () => MocapController | null;
  rememberInterval: (fn: () => void, ms: number) => number;
}

export interface DebugPanelCalibrationHandles {
  /** Status label in the recalibrate row — driven by mocap.onCalibrationChange
   *  registered later in mountDebugPanel after updateMocapUI is in scope. */
  calibStat: HTMLElement;
}

/**
 * Wire the calibration column of the right-side mocap tuning panel:
 * recalibrate trigger + status label, manual skeleton dump, per-metric
 * readiness bars, unify-arm-max toggle, and the override / smoothing /
 * reset slider rack.
 *
 * Hips-equals-shoulders toggle and the hip/leg diagnostics modal stay in
 * mountDebugPanel — they share ~200 LOC of nested state (hipEqualBtn,
 * prevSpread, the modal's diag-builder closures) that wouldn't survive a
 * clean parameter cut.
 */
export function wireDebugPanelCalibration(
  deps: DebugPanelCalibrationDeps,
): DebugPanelCalibrationHandles {
  const calibStat = document.querySelector<HTMLElement>('#mocap-calib-stat')!;
  wireRecalibrate(deps);
  wireDumpSkeleton(deps);
  wireReadinessIndicator(deps);
  wireUnifyArmMax(deps);
  wireOverrideSliders(deps);
  return { calibStat };
}

function wireRecalibrate({ getMocap }: DebugPanelCalibrationDeps): void {
  const recalBtn = document.querySelector<HTMLButtonElement>('#mocap-recal-btn')!;
  recalBtn.addEventListener('click', () => {
    getMocap()?.recalibrate();
  });
}

function wireDumpSkeleton({ getMocap }: DebugPanelCalibrationDeps): void {
  const btn = document.querySelector<HTMLButtonElement>('#cal-dump-btn');
  const doDump = (): void => {
    const m = getMocap();
    if (!m) { console.warn('[mocap] not initialised'); return; }
    m.dumpSkeleton();
  };
  btn?.addEventListener('click', doDump);
  // Also exposed globally so it can be triggered from the browser console.
  (window as any).dumpSkeleton = doDump;
}

function wireReadinessIndicator({
  getMocap, rememberInterval,
}: DebugPanelCalibrationDeps): void {
  const readinessEl = document.querySelector<HTMLElement>('#cal-readiness')!;
  const readinessRows: Array<{ key: string; fill: HTMLElement; value: HTMLElement }> = [];
  const rows: [string, string][] = [
    ['shoulders', '📐 Shoulders'],
    ['hips',      '🦴 Hips'],
    ['armL',      '🦾 Arm L'],
    ['armR',      '🦾 Arm R'],
    ['legs',      '🦵 Legs'],
  ];
  for (const [key, label] of rows) {
    const row = document.createElement('div');
    row.className = 'cal-r-row';
    row.innerHTML = `
      <span class="cal-r-label">${label}</span>
      <div class="cal-r-bar"><div class="cal-r-fill" style="width:0%"></div></div>
      <span class="cal-r-value">0%</span>
    `;
    readinessEl.appendChild(row);
    readinessRows.push({
      key,
      fill:  row.querySelector<HTMLElement>('.cal-r-fill')!,
      value: row.querySelector<HTMLElement>('.cal-r-value')!,
    });
  }

  rememberInterval(() => {
    const m = getMocap();
    if (!m) return;
    const r = m.calibration.readiness() as Record<string, number>;
    for (const row of readinessRows) {
      const v = r[row.key] ?? 0;
      const pct = Math.round(v * 100);
      row.fill.style.width = `${pct}%`;
      row.value.textContent = `${pct}%`;
      row.fill.classList.toggle('ready',   v >= 0.9);
      row.fill.classList.toggle('partial', v >= 0.2 && v < 0.9);
    }
  }, 200);
}

function wireUnifyArmMax({ getMocap }: DebugPanelCalibrationDeps): void {
  const unifyBtn = document.querySelector<HTMLButtonElement>('#cal-unify-btn')!;
  unifyBtn.addEventListener('click', () => {
    const m = getMocap();
    if (!m) return;
    const next = !m.calibration.unifyArmMax;
    m.calibration.setUnifyArmMax(next);
    unifyBtn.textContent = next ? 'ON' : 'OFF';
    unifyBtn.classList.toggle('off', !next);
  });
}

function wireOverrideSliders({ getMocap }: DebugPanelCalibrationDeps): void {
  const wireScaledOverride = (
    sliderId: string,
    valueId: string,
    kind: 'shoulder' | 'leftArm' | 'rightArm',
  ): void => {
    const slider = document.querySelector<HTMLInputElement>(sliderId)!;
    const valEl  = document.querySelector<HTMLElement>(valueId)!;
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      valEl.textContent = v.toFixed(2);
      getMocap()?.calibration.setOverride(kind, v);
    });
  };
  wireScaledOverride('#cal-sh-slider', '#cal-sh-val', 'shoulder');
  wireScaledOverride('#cal-la-slider', '#cal-la-val', 'leftArm');
  wireScaledOverride('#cal-ra-slider', '#cal-ra-val', 'rightArm');

  // Scale-ref mode (auto / median / head / shoulders / hips).
  {
    const btns = document.querySelectorAll<HTMLButtonElement>('button[data-ref]');
    btns.forEach((b) => b.addEventListener('click', () => {
      const ref = b.dataset.ref as 'auto' | 'shoulders' | 'hips' | 'head' | 'median';
      getMocap()?.calibration.setScaleRef(ref);
      btns.forEach((x) => x.classList.toggle('off', x.dataset.ref !== ref));
    }));
  }

  // Hip visibility gate — standalone slider (not an override multiplier).
  {
    const s = document.querySelector<HTMLInputElement>('#cal-hipgate-slider')!;
    const v = document.querySelector<HTMLElement>('#cal-hipgate-val')!;
    s.addEventListener('input', () => {
      const val = parseFloat(s.value);
      v.textContent = val.toFixed(2);
      getMocap()?.calibration.setHipVisGate(val);
    });
  }

  // Plain (non-override) parameter sliders that just call a setter on mocap.
  const wirePlainSlider = (
    sliderId: string,
    valueId: string,
    decimals: number,
    setter: (m: NonNullable<ReturnType<typeof getMocap>>, v: number) => void,
  ): void => {
    const slider = document.querySelector<HTMLInputElement>(sliderId)!;
    const valEl  = document.querySelector<HTMLElement>(valueId)!;
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      valEl.textContent = v.toFixed(decimals);
      const m = getMocap();
      if (m) setter(m, v);
    });
  };
  wirePlainSlider('#mocap-spine-slider',     '#mocap-spine-val',     2, (m, v) => m.setSpineSmoothing(v));
  wirePlainSlider('#mocap-smooth-slider',    '#mocap-smooth-val',    2, (m, v) => m.setBodySmoothing(v));
  wirePlainSlider('#mocap-armz-slider',      '#mocap-armz-val',      2, (m, v) => m.setArmZAttenuation(v));
  wirePlainSlider('#mocap-pole-slider',      '#mocap-pole-val',      2, (m, v) => m.setPoleSmoothing(v));
  wirePlainSlider('#mocap-polez-slider',     '#mocap-polez-val',     2, (m, v) => m.setArmPoleZ(v));
  wirePlainSlider('#mocap-vis-slider',       '#mocap-vis-val',       2, (m, v) => m.setVisibilityThreshold(v));
  wirePlainSlider('#mocap-legspread-slider', '#mocap-legspread-val', 2, (m, v) => m.setLegSpreadX(v));

  // Reset button — restores the three calibration overrides + leg spread to 1.
  const resetSliders = document.querySelector<HTMLButtonElement>('#cal-reset-btn')!;
  resetSliders.addEventListener('click', () => {
    const trios: [string, string, 'shoulder'|'leftArm'|'rightArm'][] = [
      ['#cal-sh-slider', '#cal-sh-val', 'shoulder'],
      ['#cal-la-slider', '#cal-la-val', 'leftArm'],
      ['#cal-ra-slider', '#cal-ra-val', 'rightArm'],
    ];
    for (const [sId, vId, kind] of trios) {
      const s = document.querySelector<HTMLInputElement>(sId)!;
      const v = document.querySelector<HTMLElement>(vId)!;
      s.value = '1';
      v.textContent = '1.00';
      getMocap()?.calibration.setOverride(kind, 1);
    }
    // Reset leg spread too — sits next to the calibration multipliers in the
    // UI and resets feel like one logical action.
    const ls = document.querySelector<HTMLInputElement>('#mocap-legspread-slider');
    const lv = document.querySelector<HTMLElement>('#mocap-legspread-val');
    if (ls && lv) {
      ls.value = '1';
      lv.textContent = '1.00';
      getMocap()?.setLegSpreadX(1);
    }
  });
}
