import * as THREE from 'three';
import { STAT_LANDMARKS } from './mocap/mocapDebugViz';
import { buildMainPanelHtml, buildTuningPanelHtml } from './debugPanelHtml';
import { mountSkelModal } from './debugPanelSkelModal';
import { mountBvhModal } from './debugPanelBvhModal';
import { mountBvhVerifyModal } from './debugPanelBvhVerifyModal';
import { wireDebugPanelTools } from './debugPanelTools';
import { wireDebugPanelStats } from './debugPanelStats';
import { wireDebugPanelCalibration } from './debugPanelCalibration';
import { wireMocapControls } from './debugPanelMocapControls';
import { wireDebugPanelMocapParams } from './debugPanelMocapParams';
import type { PlaybackSystems, MocapSystems, ToolingSystems } from './playerSystems';

export function mountDebugPanel(
  playback: PlaybackSystems,
  mocapSys: MocapSystems,
  tooling: ToolingSystems,
  setModelVisible: (v: boolean) => void,
  onAnimFile?: (file: File) => Promise<void> | void,
): () => void {
  const { pa, micro, idle, controller } = playback;
  const { mocap, debugViz: mocapDebugViz, dbgRecorder } = mocapSys;
  const { skelViz, validator, boneDrag, hipForce, hipBalance, skeletonLogger } = tooling;
  const getController = () => controller;
  const getMocap = () => mocap;
  const root = document.getElementById('debug-panel');
  if (!root) return () => {};

  const listenerAbort = new AbortController();
  const intervalIds: number[] = [];
  const timeoutIds: number[] = [];
  const rememberInterval = (fn: () => void, ms: number): number => {
    const id = window.setInterval(fn, ms);
    intervalIds.push(id);
    return id;
  };
  const rememberTimeout = (fn: () => void, ms: number): number => {
    const id = window.setTimeout(fn, ms);
    timeoutIds.push(id);
    return id;
  };

  root.innerHTML = buildMainPanelHtml(idle);

  // ── Right-side mocap tuning panel ────────────────────────────────────────
  const tuningRoot = document.getElementById('mocap-tuning-panel');
  if (tuningRoot) {
    tuningRoot.innerHTML = buildTuningPanelHtml();
  }

  // ── Persist <details class="dbg-fold"> open/closed state ─────────────────
  // Same pattern as the panel-title collapse mechanism in index.html, but per
  // foldable subgroup. Hidden by default — only opens if the user previously
  // expanded that group.
  {
    const FOLD_KEY = 'vrm-player.dbg-fold';
    let foldState: Record<string, boolean> = {};
    try { foldState = JSON.parse(localStorage.getItem(FOLD_KEY) || '{}') || {}; } catch { /* ignore */ }
    const saveFolds = (): void => {
      try { localStorage.setItem(FOLD_KEY, JSON.stringify(foldState)); } catch { /* ignore */ }
    };
    const folds = [
      ...root.querySelectorAll<HTMLDetailsElement>('details.dbg-fold[id]'),
      ...(tuningRoot?.querySelectorAll<HTMLDetailsElement>('details.dbg-fold[id]') ?? []),
    ];
    for (const d of folds) {
      if (foldState[d.id]) d.open = true;
      d.addEventListener('toggle', () => {
        foldState[d.id] = d.open;
        saveFolds();
      });
    }
  }

  // ── Tab switcher ─────────────────────────────────────────────────────────
  root.querySelectorAll<HTMLButtonElement>('.dbg-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.tab!;
      root.querySelectorAll<HTMLElement>('.dbg-tab').forEach((b) => {
        b.classList.toggle('active', b.dataset.tab === name);
      });
      root.querySelectorAll<HTMLElement>('.dbg-tab-panel').forEach((p) => {
        p.classList.toggle('active', p.dataset.panel === name);
      });
    });
  });

  // ── Demo mode ─────────────────────────────────────────────────────────────

  let demoMode = false;
  const demoBtn = root.querySelector<HTMLButtonElement>('#dbg-demo')!;
  const hint    = root.querySelector<HTMLElement>('#dbg-hint')!;

  demoBtn.addEventListener('click', () => {
    demoMode = !demoMode;
    demoBtn.textContent = demoMode ? 'ON' : 'OFF';
    demoBtn.classList.toggle('off', !demoMode);
    const ctrl = getController();
    if (ctrl) ctrl.setMuted(demoMode);
    if (!demoMode) pa.reset();
    hint.style.opacity = demoMode ? '0' : '0.5';
  });

  // ── Layer toggles ─────────────────────────────────────────────────────────

  const states: Record<string, boolean> = {
    idle: false, breathing: false, headSway: false,
    eyeSaccades: false, blink: false, weightShift: false,
  };

  root.querySelectorAll<HTMLButtonElement>('.dbg-toggle[data-key]').forEach((btn) => {
    const key = btn.dataset.key!;
    btn.addEventListener('click', () => {
      states[key] = !states[key];
      btn.textContent = states[key] ? 'ON' : 'OFF';
      btn.classList.toggle('off', !states[key]);
      if (key === 'idle') { idle.enabled = states[key]; if (!states[key]) pa.reset(); }
      else (micro as any)[key] = states[key];
    });
  });

  // ── Per-frame readouts (priority bars + hip force). Pure poll-and-update,
  //    no event handlers — see debugPanelStats.ts.
  wireDebugPanelStats({ pa, hipForce, hipBalance, rememberInterval });

  // ── Mocap controls + capture-source state machine ────────────────────────
  // All record/stop, source switching, and file-input handling lives in
  // debugPanelMocapControls. Returns updateMocapUI + statusLbl that the
  // tuning section below threads into mocap.onStateChange / .onError.
  const { updateMocapUI, statusLbl } = wireMocapControls({
    mocap, mocapVrm: mocap.vrm, getMocap, getController, dbgRecorder,
    rememberInterval, rememberTimeout, onAnimFile,
  });

  // ── Mocap parameter toggles + sliders (quality, mirror, face, hip,
  //    handprio, spread, filter, depth). See debugPanelMocapParams.ts.
  wireDebugPanelMocapParams({ root, getMocap });

  // ── Debug skeleton + visibility stats ───────────────────────────────────────

  const dbgSkelBtn  = root.querySelector<HTMLButtonElement>('#mocap-dbgskel-btn')!;
  const visStatsEl  = root.querySelector<HTMLElement>('#mocap-vis-stats')!;

  // Build a grid of per-landmark visibility badges
  visStatsEl.style.cssText =
    'display:none;font-size:10px;font-family:ui-monospace,monospace;' +
    'display:grid;grid-template-columns:1fr 1fr;gap:2px 6px;margin-top:4px';
  const visBadges = new Map<number, HTMLElement>();
  for (const { idx, label } of STAT_LANDMARKS) {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;justify-content:space-between;gap:4px';
    el.innerHTML = `<span style="opacity:.45">${label}</span><span id="vis-${idx}">—</span>`;
    visStatsEl.appendChild(el);
    visBadges.set(idx, el.querySelector(`#vis-${idx}`)!);
  }

  const scalarStatsEl = root.querySelector<HTMLElement>('#mocap-scalar-stats')!;

  let dbgSkelOn = false;
  let fps = 0;
  dbgSkelBtn.addEventListener('click', () => {
    dbgSkelOn = !dbgSkelOn;
    mocapDebugViz.setVisible(dbgSkelOn);
    dbgSkelBtn.textContent = dbgSkelOn ? 'ON' : 'OFF';
    dbgSkelBtn.classList.toggle('off', !dbgSkelOn);
    visStatsEl.style.display = dbgSkelOn ? 'grid' : 'none';
    scalarStatsEl.style.display = dbgSkelOn ? 'block' : 'none';
  });

  // Approximate detector fps by counting latestFrame identity changes.
  let prevFrameRef: unknown = null;
  let fpsFrames = 0;
  let fpsWindowStart = performance.now();
  rememberInterval(() => {
    const m = getMocap();
    const frame = m?.latestFrame;
    if (frame && frame !== prevFrameRef) {
      fpsFrames++;
      prevFrameRef = frame;
    }
    const now = performance.now();
    const dt = now - fpsWindowStart;
    if (dt >= 500) {
      fps = (fpsFrames * 1000) / dt;
      fpsFrames = 0;
      fpsWindowStart = now;
    }
  }, 100);

  // Update all stats every 200ms when debug skeleton is on
  rememberInterval(() => {
    if (!dbgSkelOn) return;
    const m     = getMocap();
    const frame = m?.latestFrame;
    if (!frame) return;

    // Per-landmark visibility badges
    let visSum = 0, visCount = 0;
    for (const { idx } of STAT_LANDMARKS) {
      const lm  = frame.landmarks[idx];
      const vis = lm?.visibility ?? null;
      const el  = visBadges.get(idx)!;
      if (vis === null) { el.textContent = '—'; el.style.color = ''; continue; }
      visSum += vis; visCount++;
      const pct = Math.round(vis * 100);
      el.textContent = `${pct}%`;
      el.style.color = vis >= 0.6 ? '#4ade80' : vis >= 0.3 ? '#fbbf24' : '#f87171';
    }
    const avgVis = visCount ? (visSum / visCount) : 0;

    // Scalar stats block
    if (!m) { scalarStatsEl.textContent = ''; return; }
    const cal = m.calibration;
    const st  = cal.status();
    const handsDetected = frame.hands.map((h) => h.side).sort().join('+') || '—';
    const face = frame.faceLandmarks?.length ?? 0;
    const hasFace = face > 0 ? `${face}` : '—';

    const row = (label: string, value: string): string =>
      `<div style="display:flex;justify-content:space-between;gap:6px"><span style="opacity:.5">${label}</span><span>${value}</span></div>`;

    const armL = (st.leftArmScale * 100).toFixed(0);
    const armR = (st.rightArmScale * 100).toFixed(0);
    const body = (st.bodyScale * 100).toFixed(0);
    const legScale = (cal.legScale() * 100).toFixed(0);
    const shoulder = (st.shoulderWidthScale * 100).toFixed(0);

    // ── Skeleton-fit metrics ──────────────────────────────────────────────
    // Target-reach % = distance(target, shoulder/hip anchor) / avatarLimbLength.
    //   <90%   green  — comfortable reach, IK bends freely.
    //   90–100% amber — near max extension (nearly straight limb).
    //   >100%  red    — target beyond avatar's reach; limb locks straight.
    // More useful than distance(target, actual bone), which is ~0 by
    // construction (targets get scaled to fit avatar length).
    const dt    = m.debugTargets;
    const reach = m.getReachPercent();
    const fitColor = (pct: number): string =>
      pct < 90 ? '#4ade80' : pct <= 100 ? '#fbbf24' : '#f87171';
    const fitRow = (label: string, have: boolean, pct: number): string =>
      have
        ? row(label, `<span style="color:${fitColor(pct)}">${pct.toFixed(0)}%</span>`)
        : row(label, '—');

    // Proportions: performer / avatar, as fraction (100% = same length).
    const avLArm = cal.avatarLeftUpperArm  + cal.avatarLeftLowerArm;
    const avRArm = cal.avatarRightUpperArm + cal.avatarRightLowerArm;
    // armScale = avatar / performer → inverse = performer / avatar proportion
    const propL = st.leftArmScale  > 0 ? (1 / st.leftArmScale)  * 100 : 0;
    const propR = st.rightArmScale > 0 ? (1 / st.rightArmScale) * 100 : 0;
    const propBody = st.bodyScale  > 0 ? (1 / st.bodyScale)  * 100 : 0;
    void avLArm; void avRArm;

    scalarStatsEl.innerHTML = [
      row('🧭 Calibrated',    st.calibrated ? '<span style="color:#4ade80">yes</span>' : '<span style="color:#f87171">no</span>'),
      row('📏 Body scale',    `${body}%`),
      row('📐 Shoulder scl',  `${shoulder}%`),
      row('🦾 Arm L / R',     `${armL}% / ${armR}%`),
      row('🦵 Leg scale',     `${legScale}%`),
      '<div style="margin-top:6px;opacity:.5;font-size:9px">— proportions (perf/avatar) —</div>',
      row('🧍 Body',          `${propBody.toFixed(0)}%`),
      row('🦾 Arm L / R',     `${propL.toFixed(0)}% / ${propR.toFixed(0)}%`),
      '<div style="margin-top:6px;opacity:.5;font-size:9px">— target reach (% of limb) —</div>',
      fitRow('✋ L arm',       dt.hasArm, reach.armL),
      fitRow('✋ R arm',       dt.hasArm, reach.armR),
      fitRow('🦶 L leg',       dt.hasLeg, reach.legL),
      fitRow('🦶 R leg',       dt.hasLeg, reach.legR),
      '<div style="margin-top:6px;opacity:.5;font-size:9px">— input —</div>',
      row('✋ Hands',         handsDetected),
      row('😶 Face pts',      hasFace),
      row('👁 Avg vis',       `${Math.round(avgVis * 100)}%`),
      row('⏱ Detector fps',  fps.toFixed(1)),
      row('📼 BVH rec/grab', `${m.recordingFrameCount}/${m.grabbedFrameCount}`),
      row('▶ State',          m.state),
    ].join('');
  }, 200);

  // ── Tuning-panel wiring (all elements live in #mocap-tuning-panel) ───────
  // Calibration column extracted to debugPanelCalibration. Hips=shoulders +
  // diag modal stay here — they share too much nested state to extract
  // cleanly.
  const { calibStat } = wireDebugPanelCalibration({ getMocap, rememberInterval });

  // ── Hips = shoulders width override ────────────────────────────────────────
  // The straightforward approach (translating leftUpperLeg/rightUpperLeg roots
  // on the normalized rig) DOES NOT WORK on @pixiv/three-vrm: the rendered
  // mesh is skinned to the RAW bone hierarchy whose positions are fixed at
  // load time. Modifying normalized positions widens the IK pivot but the raw
  // upper-legs still pivot from their original (narrower) roots — applying
  // the same rotations from a narrower pivot lands the feet inward of where
  // IK intended, sometimes far enough to visually cross past the centerline.
  //
  // Instead this toggle now drives the same `legSpreadX` knob the slider
  // exposes, with an auto-computed ratio = avatarShoulderWidth / avatarHipWidth.
  // That fans the foot IK targets outward without touching any bone geometry,
  // so the rendered mesh stays consistent with its rest pose.
  {
    const hipEqualBtn = document.querySelector<HTMLButtonElement>('#rig-hip-equal-btn')!;
    const spreadSlider  = document.querySelector<HTMLInputElement>('#mocap-legspread-slider');
    const spreadValEl   = document.querySelector<HTMLElement>('#mocap-legspread-val');
    let active = false;
    let prevSpread: number | null = null;

    const setSpread = (v: number): void => {
      const m = getMocap();
      m?.setLegSpreadX(v);
      // Reflect into the slider/readout so the user can see what the toggle
      // applied and tweak it from there if needed.
      if (spreadSlider) spreadSlider.value = String(Math.max(0.5, Math.min(2, v)));
      if (spreadValEl)  spreadValEl.textContent = v.toFixed(2);
    };

    hipEqualBtn.addEventListener('click', () => {
      const m = getMocap();
      if (!m) return;
      const vrm = m.vrm;
      const sL = vrm.humanoid.getNormalizedBoneNode('leftUpperArm' as any);
      const sR = vrm.humanoid.getNormalizedBoneNode('rightUpperArm' as any);
      if (!sL || !sR) {
        const missing = [!sL && 'leftUpperArm', !sR && 'rightUpperArm'].filter(Boolean).join(', ');
        console.warn(`[hip-equal] missing humanoid bone(s): ${missing}`);
        hipEqualBtn.title = `Disabled — VRM missing: ${missing}`;
        hipEqualBtn.disabled = true;
        return;
      }

      active = !active;
      if (active) {
        // Compensate for performer↔avatar hip-width mismatch. The leg solver
        // computes target.x as `avatarHipRoot.x + (performerAnkle.x -
        // performerHip.x) * legScale * legSpreadX`. legScale is a *length*
        // ratio, so the X-offset is carried over in absolute MediaPipe metres.
        // If performer's hip half-width is bigger than the avatar's, even a
        // narrow performer stance overshoots the avatar's leg root past the
        // centerline → legs cross. Scaling the offset by the hip-width ratio
        // preserves "foot displacement relative to hip width" between rigs:
        // performer narrow → avatar narrow on its own scale, never crossed.
        const cal = m.calibration as any;
        const performerHipWidth = cal.performerHipWidth as number;
        const avatarHipWidth    = m.calibration.avatarHipWidth;
        if (performerHipWidth < 1e-4 || avatarHipWidth < 1e-4) {
          console.warn('[hip-equal] hip width measurement unavailable; skipping');
          active = false;
          return;
        }
        const ratio = avatarHipWidth / performerHipWidth;
        prevSpread = m.legSpreadX;
        setSpread(ratio);
      } else if (prevSpread != null) {
        setSpread(prevSpread);
        prevSpread = null;
      }

      hipEqualBtn.textContent = active ? 'ON' : 'OFF';
      hipEqualBtn.classList.toggle('off', !active);
    });

    // ── Hip / leg diagnostics modal ──────────────────────────────────────────
    const diagBtn       = document.querySelector<HTMLButtonElement>('#hip-diag-btn')!;
    const diagOverlay   = document.getElementById('hip-diag-modal-overlay')!;
    const diagBody      = document.getElementById('hip-diag-modal-body')!;
    const diagCopyBtn   = document.getElementById('hip-diag-modal-copy')!;
    const diagRefreshBtn = document.getElementById('hip-diag-modal-refresh')!;
    const diagCloseBtn  = document.getElementById('hip-diag-modal-close')!;

    const r3 = (n: number): number => Math.round(n * 1000) / 1000;
    const vec3 = (v: THREE.Vector3): { x: number; y: number; z: number } => ({ x: r3(v.x), y: r3(v.y), z: r3(v.z) });
    const lm = (l: { x: number; y: number; z: number; visibility?: number } | undefined) =>
      l ? { x: r3(l.x), y: r3(l.y), z: r3(l.z), vis: l.visibility != null ? r3(l.visibility) : undefined } : null;

    const buildDiag = (): string => {
      const m = getMocap();
      if (!m) return '(mocap not initialised)';
      const vrm = m.vrm;
      const get = (n: string) => vrm.humanoid.getNormalizedBoneNode(n as any);
      const getRaw = (n: string) => vrm.humanoid.getRawBoneNode(n as any);
      vrm.scene.updateMatrixWorld(true);

      const boneRow = (name: string) => {
        const norm = get(name);
        const raw = getRaw(name);
        if (!norm) return { name, missing: true };
        const wp = norm.getWorldPosition(new THREE.Vector3());
        return {
          name,
          parent: norm.parent?.name || '(none)',
          localPos: vec3(norm.position),
          localQuat: { x: r3(norm.quaternion.x), y: r3(norm.quaternion.y), z: r3(norm.quaternion.z), w: r3(norm.quaternion.w) },
          worldPos: vec3(wp),
          rawSameAsNorm: raw === norm,
          rawWorldPos: raw && raw !== norm ? vec3(raw.getWorldPosition(new THREE.Vector3())) : null,
        };
      };

      const cal = m.calibration as any;
      const frame = m.latestFrame;
      const dt = m.debugTargets as any;

      const data = {
        timestamp: new Date().toISOString(),
        rig: {
          leftUpperLeg:   boneRow('leftUpperLeg'),
          rightUpperLeg:  boneRow('rightUpperLeg'),
          leftLowerLeg:   boneRow('leftLowerLeg'),
          rightLowerLeg:  boneRow('rightLowerLeg'),
          leftFoot:       boneRow('leftFoot'),
          rightFoot:      boneRow('rightFoot'),
          leftUpperArm:   boneRow('leftUpperArm'),
          rightUpperArm:  boneRow('rightUpperArm'),
          hips:           boneRow('hips'),
          spine:          boneRow('spine'),
          chest:          boneRow('chest'),
          upperChest:     boneRow('upperChest'),
        },
        hipsEqualsShoulders: {
          buttonState: hipEqualBtn.textContent,
          prevSpreadBeforeToggle: prevSpread,
        },
        calibration: {
          calibrated:           cal._calibrated ?? null,
          avatarHipWidth:       r3(cal.avatarHipWidth ?? NaN),
          avatarLeftUpperArm:   r3(cal.avatarLeftUpperArm ?? NaN),
          avatarLeftUpperLeg:   r3(cal.avatarLeftUpperLeg ?? NaN),
          avatarLeftLowerLeg:   r3(cal.avatarLeftLowerLeg ?? NaN),
          avatarRightUpperLeg:  r3(cal.avatarRightUpperLeg ?? NaN),
          avatarRightLowerLeg:  r3(cal.avatarRightLowerLeg ?? NaN),
          performerHipWidth:    r3(cal.performerHipWidth ?? NaN),
          performerShoulderWidth: r3(cal.performerShoulderWidth ?? NaN),
          performerLegLen:      r3(cal.performerLegLen ?? NaN),
          bodyScale:             r3(m.calibration.bodyScale()),
          legScale:              r3(m.calibration.legScale()),
          armScaleL:             r3(m.calibration.armScale('left')),
          armScaleR:             r3(m.calibration.armScale('right')),
          scaleRef:              m.calibration.scaleRef,
          hipVisGate:            r3(m.calibration.hipVisGate),
          readiness:             m.calibration.readiness(),
        },
        applier: {
          mirrorX:        (m as any).applier?._mirrorX ?? null,
          legSpreadX:     r3(m.legSpreadX),
          shoulderSpread: r3(m.shoulderSpread),
        },
        latestFrame: frame ? {
          // MediaPipe BlazePose landmark indices: 23=LH, 24=RH, 25=LK, 26=RK, 27=LA, 28=RA
          // Note: MediaPipe is camera-side ("their LEFT is on viewer's RIGHT") — we mirror in mpDeltaToVrm.
          worldLandmarks: {
            leftHip:    lm(frame.worldLandmarks[23]),
            rightHip:   lm(frame.worldLandmarks[24]),
            leftKnee:   lm(frame.worldLandmarks[25]),
            rightKnee:  lm(frame.worldLandmarks[26]),
            leftAnkle:  lm(frame.worldLandmarks[27]),
            rightAnkle: lm(frame.worldLandmarks[28]),
            leftShoulder:  lm(frame.worldLandmarks[11]),
            rightShoulder: lm(frame.worldLandmarks[12]),
          },
          normLandmarks: {
            leftHip:    lm(frame.landmarks[23]),
            rightHip:   lm(frame.landmarks[24]),
            leftAnkle:  lm(frame.landmarks[27]),
            rightAnkle: lm(frame.landmarks[28]),
          },
        } : null,
        ikDebugTargets: {
          leftFootTarget:  dt?.leftFootTarget  ? vec3(dt.leftFootTarget)  : null,
          rightFootTarget: dt?.rightFootTarget ? vec3(dt.rightFootTarget) : null,
          leftKneeTarget:  dt?.leftKneeTarget  ? vec3(dt.leftKneeTarget)  : null,
          rightKneeTarget: dt?.rightKneeTarget ? vec3(dt.rightKneeTarget) : null,
          leftFootLocked:  dt?.leftFootLocked  ?? null,
          rightFootLocked: dt?.rightFootLocked ?? null,
        },
      };

      return JSON.stringify(data, null, 2);
    };

    const refreshDiag = (): void => { diagBody.textContent = buildDiag(); };
    diagBtn.addEventListener('click', () => {
      refreshDiag();
      diagOverlay.style.display = 'flex';
    });
    diagRefreshBtn.addEventListener('click', refreshDiag);
    diagCloseBtn.addEventListener('click', () => { diagOverlay.style.display = 'none'; });
    diagOverlay.addEventListener('click', (e) => {
      if (e.target === diagOverlay) diagOverlay.style.display = 'none';
    });
    let diagCopyResetId = 0;
    diagCopyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(diagBody.textContent ?? '').then(() => {
        diagCopyBtn.textContent = '✓ copied!';
        diagCopyBtn.classList.add('copied');
        clearTimeout(diagCopyResetId);
        diagCopyResetId = rememberTimeout(() => {
          diagCopyBtn.textContent = '📋 copy';
          diagCopyBtn.classList.remove('copied');
        }, 2000);
      });
    });
  }

  // Wire state-change callback
  const originalMocap = getMocap();
  if (originalMocap) {
    originalMocap.onStateChange = updateMocapUI;
    originalMocap.onError = (err) => {
      statusLbl.textContent = `❌ ${err.message.slice(0, 30)}`;
    };
    originalMocap.onCalibrationChange = (s) => {
      if (s.calibrated) {
        const body = (s.bodyScale * 100).toFixed(0);
        const l = (s.leftArmScale * 100).toFixed(0);
        const r = (s.rightArmScale * 100).toFixed(0);
        calibStat.textContent = `✓ body ${body}%  L ${l}%  R ${r}%`;
      } else {
        calibStat.textContent = 'waiting for hip landmarks…';
      }
    };
  }

  // ── Bottom-of-panel tooling rows (validation, skel-logger, skel toggles,
  //    bone-drag, debug recorder). See debugPanelTools.ts for details.
  wireDebugPanelTools({
    root, validator, skelViz, boneDrag, skeletonLogger, dbgRecorder, mocap,
    getController, setModelVisible, rememberInterval,
  });

  // ── Skeleton info modal ───────────────────────────────────────────────────

  const cleanupSkelModal = mountSkelModal({
    getMocap,
    validator,
    signal: listenerAbort.signal,
    rememberInterval,
    rememberTimeout,
  });

  // ── BVH diagnostic modal ──────────────────────────────────────────────────

  const cleanupBvhModal = mountBvhModal({
    getMocap,
    signal: listenerAbort.signal,
    rememberTimeout,
  });

  const cleanupBvhVerifyModal = mountBvhVerifyModal({
    getMocap,
    signal: listenerAbort.signal,
    rememberTimeout,
  });

  return () => {
    cleanupSkelModal();
    cleanupBvhModal();
    cleanupBvhVerifyModal();
    for (const id of intervalIds) clearInterval(id);
    for (const id of timeoutIds) clearTimeout(id);
    listenerAbort.abort();
    if ((window as any).dumpSkeleton) delete (window as any).dumpSkeleton;
    root.innerHTML = '';
  };
}
