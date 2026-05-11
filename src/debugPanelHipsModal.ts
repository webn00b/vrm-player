import * as THREE from 'three';
import type { MocapController } from './mocap/pipeline/mocapController';

export interface DebugPanelHipsModalDeps {
  getMocap: () => MocapController | null;
  rememberTimeout: (fn: () => void, ms: number) => number;
}

/**
 * Wire the hips-equals-shoulders width-override toggle + the hip/leg
 * diagnostics modal that sits next to it in the tuning panel.
 *
 * The toggle and the modal share two pieces of state (`active`/`prevSpread`
 * for the toggle; the modal reads them via `hipEqualBtn.textContent` and
 * `prevSpread` directly when building its JSON dump), so they live in one
 * module rather than splitting hairs.
 *
 * Why this isn't pixel-translation of the leg roots:
 * The straightforward approach (translating leftUpperLeg/rightUpperLeg
 * roots on the normalized rig) DOES NOT WORK on @pixiv/three-vrm — the
 * rendered mesh is skinned to the RAW bone hierarchy whose positions are
 * fixed at load time. Modifying normalized positions widens the IK pivot
 * but the raw upper-legs still pivot from their original (narrower) roots,
 * so applying the same rotations from a narrower pivot lands the feet
 * inward of where IK intended — sometimes far enough to cross past the
 * centerline. Instead we drive the same `legSpreadX` knob the slider
 * exposes, with an auto-computed ratio = avatarHipWidth / performerHipWidth.
 * That fans the foot IK targets outward without touching any bone
 * geometry, so the rendered mesh stays consistent with its rest pose.
 */
export function wireHipsEqualsAndDiagModal(deps: DebugPanelHipsModalDeps): void {
  const { getMocap, rememberTimeout } = deps;

  const hipEqualBtn   = document.querySelector<HTMLButtonElement>('#rig-hip-equal-btn')!;
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

  wireDiagModal({ getMocap, rememberTimeout, hipEqualBtn, getPrevSpread: () => prevSpread });
}

interface DiagModalDeps extends DebugPanelHipsModalDeps {
  hipEqualBtn: HTMLButtonElement;
  getPrevSpread: () => number | null;
}

/**
 * The hip/leg diagnostics modal — collects every quantity that influences
 * leg IK (rig pose, calibration scales, IK debug targets, raw landmarks)
 * into a single JSON dump for offline diffing. Triggered via the "?"
 * button next to the hips=shoulders toggle.
 */
function wireDiagModal({
  getMocap, rememberTimeout, hipEqualBtn, getPrevSpread,
}: DiagModalDeps): void {
  const diagBtn        = document.querySelector<HTMLButtonElement>('#hip-diag-btn')!;
  const diagOverlay    = document.getElementById('hip-diag-modal-overlay')!;
  const diagBody       = document.getElementById('hip-diag-modal-body')!;
  const diagCopyBtn    = document.getElementById('hip-diag-modal-copy')!;
  const diagRefreshBtn = document.getElementById('hip-diag-modal-refresh')!;
  const diagCloseBtn   = document.getElementById('hip-diag-modal-close')!;

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
        prevSpreadBeforeToggle: getPrevSpread(),
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
