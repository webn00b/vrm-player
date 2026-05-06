import * as THREE from 'three';
import { buildMainPanelHtml, buildTuningPanelHtml } from './debugPanelHtml';
import { mountSkelModal } from './debugPanelSkelModal';
import { mountBvhModal } from './debugPanelBvhModal';
import { mountBvhVerifyModal } from './debugPanelBvhVerifyModal';
import { wireDebugPanelTools } from './debugPanelTools';
import { wireDebugPanelStats } from './debugPanelStats';
import { wireDebugPanelCalibration } from './debugPanelCalibration';
import { wireMocapControls } from './debugPanelMocapControls';
import { wireDebugPanelMocapParams } from './debugPanelMocapParams';
import { wireDebugPanelMocapStats } from './debugPanelMocapStats';
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

  // ── Debug skeleton overlay toggle + visibility/scalar stats grid.
  //    See debugPanelMocapStats.ts.
  wireDebugPanelMocapStats({ root, getMocap, mocapDebugViz, rememberInterval });

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
