import * as THREE from 'three';
import { createApp, ref, type App } from 'vue';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
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
    const get    = (n: VRMHumanBoneName) => vrm.humanoid.getNormalizedBoneNode(n);
    const getRaw = (n: VRMHumanBoneName) => vrm.humanoid.getRawBoneNode(n);
    vrm.scene.updateMatrixWorld(true);

    const boneRow = (name: VRMHumanBoneName) => {
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

    const cal = m.calibration;
    const frame = m.latestFrame;
    const dt = m.debugTargets;

    const data = {
      timestamp: new Date().toISOString(),
      rig: {
        leftUpperLeg:   boneRow(VRMHumanBoneName.LeftUpperLeg),
        rightUpperLeg:  boneRow(VRMHumanBoneName.RightUpperLeg),
        leftLowerLeg:   boneRow(VRMHumanBoneName.LeftLowerLeg),
        rightLowerLeg:  boneRow(VRMHumanBoneName.RightLowerLeg),
        leftFoot:       boneRow(VRMHumanBoneName.LeftFoot),
        rightFoot:      boneRow(VRMHumanBoneName.RightFoot),
        leftUpperArm:   boneRow(VRMHumanBoneName.LeftUpperArm),
        rightUpperArm: boneRow(VRMHumanBoneName.RightUpperArm),
        hips:           boneRow(VRMHumanBoneName.Hips),
        spine:          boneRow(VRMHumanBoneName.Spine),
        chest:          boneRow(VRMHumanBoneName.Chest),
        upperChest:     boneRow(VRMHumanBoneName.UpperChest),
      },
      hipsEqualsShoulders: getHipsEqualsState
        ? getHipsEqualsState()
        : { buttonState: '(unknown)', prevSpreadBeforeToggle: null },
      calibration: {
        calibrated:             cal.calibrated,
        avatarHipWidth:         r3(cal.avatarHipWidth),
        avatarLeftUpperArm:     r3(cal.avatarLeftUpperArm),
        avatarLeftUpperLeg:     r3(cal.avatarLeftUpperLeg),
        avatarLeftLowerLeg:     r3(cal.avatarLeftLowerLeg),
        avatarRightUpperLeg:    r3(cal.avatarRightUpperLeg),
        avatarRightLowerLeg:    r3(cal.avatarRightLowerLeg),
        performerHipWidth:      r3(cal.performerHipWidthMetric),
        performerShoulderWidth: r3(cal.performerShoulderWidthMetric),
        performerLegLen:        r3(cal.performerLegLenMetric),
        bodyScale:              r3(cal.bodyScale()),
        legScale:               r3(cal.legScale()),
        armScaleL:              r3(cal.armScale('left')),
        armScaleR:              r3(cal.armScale('right')),
        scaleRef:               cal.scaleRef,
        hipVisGate:             r3(cal.hipVisGate),
        readiness:              cal.readiness(),
      },
      applier: {
        mirrorX:        m.mirrorX,
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
        // MocapDebugTargets exposes ankle targets, not foot/knee — the
        // solver constructs foot/knee from ankle + leg pose internally.
        leftAnkleTarget:  dt.hasLeg ? vec3(dt.leftAnkleTarget)  : null,
        rightAnkleTarget: dt.hasLeg ? vec3(dt.rightAnkleTarget) : null,
        leftFootLocked:   dt.leftFootLocked,
        rightFootLocked:  dt.rightFootLocked,
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
