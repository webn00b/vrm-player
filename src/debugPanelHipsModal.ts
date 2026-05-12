import * as THREE from 'three';
import { createApp, ref, type App } from 'vue';
import HipDiagModal from './playerVue/HipDiagModal.vue';
import { installPrimeVueOn } from './playerVue/plugin';
import type { MocapController } from './mocap/pipeline/mocapController';

export interface HipDiagModalDeps {
  getMocap: () => MocapController | null;
  /** Optional accessor for the hips-equals toggle state — shown in the dump. */
  getHipsEqualsState?: () => { buttonState: string; prevSpreadBeforeToggle: number | null };
}

export interface HipDiagModalHandle {
  /** Opens the modal and immediately refreshes its content. */
  open(): void;
  cleanup(): void;
}

/**
 * Mounts the hip/leg diagnostics modal as a PrimeVue Dialog.
 *
 * The previous version owned BOTH the diagnostics modal AND the `rig-hip-
 * equal-btn` width-override toggle. The toggle has since moved INTO
 * CalibrationBlock.vue (so it can mutate the `legSpread` slider ref
 * directly — the previous mirror-into-DOM hack stopped working when the
 * slider became a Vue v-model'd ref).
 *
 * What stays here: the JSON dump builder (collects every quantity that
 * influences leg IK: rig pose, calibration scales, IK debug targets,
 * raw landmarks) + the Vue mount.
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
export function mountHipDiagModal(deps: HipDiagModalDeps): HipDiagModalHandle {
  const { getMocap, getHipsEqualsState } = deps;

  const isOpen  = ref(false);
  const content = ref('');

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
      hipsEqualsShoulders: getHipsEqualsState
        ? getHipsEqualsState()
        : { buttonState: '(unknown)', prevSpreadBeforeToggle: null },
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

  const refresh = (): void => { content.value = buildDiag(); };

  // Vue host (Dialog teleports itself; the host just anchors lifecycle).
  const host = document.createElement('div');
  host.id = 'hip-diag-modal-host';
  document.body.appendChild(host);

  const app: App = createApp({
    components: { HipDiagModal },
    setup() {
      return { isOpen, content, refresh };
    },
    template: `
      <HipDiagModal
        v-model="isOpen"
        :content="content"
        @refresh="refresh"
      />
    `,
  });
  installPrimeVueOn(app);
  app.mount(host);

  return {
    open: () => { refresh(); isOpen.value = true; },
    cleanup: () => {
      isOpen.value = false;
      app.unmount();
      host.remove();
    },
  };
}
