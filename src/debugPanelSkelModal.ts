import * as THREE from 'three';
import type { MocapController } from './mocap/pipeline/mocapController';
import type { BoneValidator } from './validation/boneValidator';
import type { PoseFrame, Landmark3D } from './mocap/pipeline/poseDetector';
import type { ArmSolverDiagnostics, TorsoSolverDiagnostics } from './mocap/diagnostics/mocapDiagnostics';

// ── SkelModal context ─────────────────────────────────────────────────────────

export interface SkelModalContext {
  getMocap: () => MocapController | null;
  validator: BoneValidator;
  signal: AbortSignal;
  rememberInterval: (fn: () => void, ms: number) => number;
  rememberTimeout: (fn: () => void, ms: number) => number;
}

// ── Local types ───────────────────────────────────────────────────────────────

type AvatarJointPositions = ReturnType<MocapController['getAvatarJointPositions']>;
type LimbScales = { armL: number; armR: number; legL: number; legR: number };
type ArmSide = 'left' | 'right';
type ArmDebugTargets = {
  elbowTarget: THREE.Vector3 | null;
  poleRaw: THREE.Vector3 | null;
  poleSmoothed: THREE.Vector3 | null;
} & ArmSolverDiagnostics;

// ── Mount ─────────────────────────────────────────────────────────────────────

export function mountSkelModal(ctx: SkelModalContext): () => void {
  const { getMocap, validator, signal, rememberInterval, rememberTimeout } = ctx;

  const skelInfoBtn   = document.querySelector<HTMLButtonElement>('#skel-info-btn');
  const modalOverlay  = document.getElementById('skel-modal-overlay')!;
  const modalBody     = document.getElementById('skel-modal-body')!;
  const modalCloseBtn = document.getElementById('skel-modal-close')!;
  const modalCopyBtn  = document.getElementById('skel-modal-copy')!;

  let modalTimer = 0;

  // ── Format helpers ──────────────────────────────────────────────────────────

  const skelRow = (label: string, value: string): string =>
    `<div class="skel-row">
       <span class="skel-row-label">${label}</span>
       <span class="skel-row-value">${value}</span>
     </div>`;

  const fmtM   = (v: number): string => v > 1e-4 ? `${v.toFixed(3)} m` : '<span style="opacity:.35">—</span>';
  const fmtPct = (v: number): string => v > 0 ? `${(v * 100).toFixed(1)}%` : '<span style="opacity:.35">—</span>';
  const fmtNum = (v: number): string => Number.isFinite(v) ? v.toFixed(3) : '<span style="opacity:.35">—</span>';
  const fmtCm = (v: number): string =>
    Number.isFinite(v) ? `${(v * 100).toFixed(1)} cm` : '<span style="opacity:.35">—</span>';
  const fmtDeg = (v: number): string =>
    Number.isFinite(v) ? `${v.toFixed(1)}°` : '<span style="opacity:.35">—</span>';
  const fmtVecHtml = (v: THREE.Vector3 | null | undefined): string =>
    v ? `<span style="font-family:ui-monospace,monospace">${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}</span>`
      : '<span style="opacity:.35">—</span>';
  const fmtVecText = (v: THREE.Vector3 | null | undefined): string =>
    v ? `${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}` : '—';
  const fmtVisHtml = (v: number | undefined): string =>
    v == null ? '<span style="opacity:.35">—</span>' : `${(v * 100).toFixed(0)}%`;
  const fmtVisText = (v: number | undefined): string =>
    v == null ? '—' : `${(v * 100).toFixed(0)}%`;
  const fmtLmHtml = (lm: Landmark3D | null | undefined): string =>
    lm
      ? `<span style="font-family:ui-monospace,monospace">${lm.x.toFixed(3)}, ${lm.y.toFixed(3)}, ${lm.z.toFixed(3)}</span> <span style="opacity:.55">vis ${fmtVisText(lm.visibility)}</span>`
      : '<span style="opacity:.35">—</span>';
  const fmtLmText = (lm: Landmark3D | null | undefined): string =>
    lm ? `${lm.x.toFixed(3)}, ${lm.y.toFixed(3)}, ${lm.z.toFixed(3)} · vis ${fmtVisText(lm.visibility)}` : '—';
  const fmtRatio = (avatar: number, perf: number): string => {
    if (avatar <= 1e-4 || perf <= 1e-4) return '<span style="opacity:.35">—</span>';
    const r = avatar / perf;
    const color = r < 0.85 ? '#f87171' : r > 1.15 ? '#fbbf24' : '#4ade80';
    return `<span style="color:${color}">${r.toFixed(2)}×</span>`;
  };
  const reachHtml = (v: number): string => {
    if (v <= 0) return '<span style="opacity:.35">—</span>';
    const color = v < 90 ? '#4ade80' : v <= 100 ? '#fbbf24' : '#f87171';
    return `<span style="color:${color}">${v.toFixed(0)}%</span>`;
  };
  const lockHtml = (locked: boolean): string =>
    locked
      ? '<span class="skel-uncal">🔒 locked</span>'
      : '<span class="skel-cal">✓ free</span>';

  // suppress unused warning — fmtVisHtml is kept for completeness
  void fmtVisHtml;

  // ── Geometry helpers ────────────────────────────────────────────────────────

  const distLm = (a: Landmark3D | null | undefined, b: Landmark3D | null | undefined): number => {
    if (!a || !b) return Number.NaN;
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  const distVec = (a: THREE.Vector3 | null | undefined, b: THREE.Vector3 | null | undefined): number =>
    a && b ? a.distanceTo(b) : Number.NaN;
  const avgVec = (a: THREE.Vector3 | null | undefined, b: THREE.Vector3 | null | undefined): THREE.Vector3 | null =>
    a && b ? new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5) : null;
  const vecBetween = (from: THREE.Vector3 | null | undefined, to: THREE.Vector3 | null | undefined): THREE.Vector3 | null =>
    from && to ? new THREE.Vector3().subVectors(to, from) : null;
  const angleVecDeg = (a: THREE.Vector3 | null | undefined, b: THREE.Vector3 | null | undefined): number => {
    if (!a || !b) return Number.NaN;
    const lenA = a.length();
    const lenB = b.length();
    if (lenA <= 1e-6 || lenB <= 1e-6) return Number.NaN;
    return THREE.MathUtils.radToDeg(a.angleTo(b));
  };
  const deltaAxis = (a: THREE.Vector3 | null | undefined, b: THREE.Vector3 | null | undefined, axis: 'x' | 'y' | 'z'): number =>
    a && b ? a[axis] - b[axis] : Number.NaN;

  // ── Snapshot builders ───────────────────────────────────────────────────────

  const computePerformerAvatarSpacePoint = (
    frame: PoseFrame | null,
    avatarHips: THREE.Vector3,
    bodyScale: number,
    scales: LimbScales,
    idx: number,
  ): THREE.Vector3 | null => {
    if (!frame) return null;
    const lms = frame.worldLandmarks;
    const lm = lms[idx];
    if (!lm) return null;

    const lh = lms[23];
    const rh = lms[24];
    const hipMpX = lh && rh ? (lh.x + rh.x) * 0.5 : 0;
    const hipMpY = lh && rh ? (lh.y + rh.y) * 0.5 : 0;
    const hipMpZ = lh && rh ? (lh.z + rh.z) * 0.5 : 0;

    const scaleOf = (landmarkIdx: number): number => {
      switch (landmarkIdx) {
        case 13: case 15: case 17: case 19: case 21: return scales.armR;
        case 14: case 16: case 18: case 20: case 22: return scales.armL;
        case 25: case 27: case 29: case 31: return scales.legR;
        case 26: case 28: case 30: case 32: return scales.legL;
        default: return bodyScale;
      }
    };

    const anchorMpOf = (landmarkIdx: number): [number, number, number] | null => {
      if ([13, 15, 17, 19, 21].includes(landmarkIdx) && lms[11]) return [lms[11].x, lms[11].y, lms[11].z];
      if ([14, 16, 18, 20, 22].includes(landmarkIdx) && lms[12]) return [lms[12].x, lms[12].y, lms[12].z];
      if ([25, 27, 29, 31].includes(landmarkIdx) && lms[23]) return [lms[23].x, lms[23].y, lms[23].z];
      if ([26, 28, 30, 32].includes(landmarkIdx) && lms[24]) return [lms[24].x, lms[24].y, lms[24].z];
      return [hipMpX, hipMpY, hipMpZ];
    };

    const anchorMp = anchorMpOf(idx);
    if (!anchorMp) return null;

    const anchorX = avatarHips.x - (anchorMp[0] - hipMpX) * bodyScale;
    const anchorY = avatarHips.y - (anchorMp[1] - hipMpY) * bodyScale;
    const anchorZ = avatarHips.z - (anchorMp[2] - hipMpZ) * bodyScale;

    const scale = scaleOf(idx);
    const sx = -(lm.x - anchorMp[0]);
    const sy = -(lm.y - anchorMp[1]);
    const sz = -(lm.z - anchorMp[2]);
    return new THREE.Vector3(anchorX + sx * scale, anchorY + sy * scale, anchorZ + sz * scale);
  };

  const buildArmSnapshot = (
    side: ArmSide,
    frame: PoseFrame | null,
    normalizedAvatar: AvatarJointPositions,
    rawAvatar: AvatarJointPositions,
    bodyScale: number,
    scales: LimbScales,
    armDebug: ArmDebugTargets,
    target: THREE.Vector3 | null,
    reachPercent: number,
  ) => {
    const source = side === 'left'
      ? { shoulder: 12, elbow: 14, wrist: 16, mapping: 'Avatar LEFT ← performer RIGHT (12/14/16)' }
      : { shoulder: 11, elbow: 13, wrist: 15, mapping: 'Avatar RIGHT ← performer LEFT (11/13/15)' };

    const rawShoulder = frame?.worldLandmarks[source.shoulder] ?? null;
    const rawElbow    = frame?.worldLandmarks[source.elbow] ?? null;
    const rawWrist    = frame?.worldLandmarks[source.wrist] ?? null;

    const performerAvatarShoulder = computePerformerAvatarSpacePoint(frame, normalizedAvatar.hips, bodyScale, scales, source.shoulder);
    const performerAvatarElbow    = computePerformerAvatarSpacePoint(frame, normalizedAvatar.hips, bodyScale, scales, source.elbow);
    const performerAvatarWrist    = computePerformerAvatarSpacePoint(frame, normalizedAvatar.hips, bodyScale, scales, source.wrist);

    const actualNormShoulder = side === 'left' ? normalizedAvatar.leftUpperArm  : normalizedAvatar.rightUpperArm;
    const actualNormElbow    = side === 'left' ? normalizedAvatar.leftLowerArm  : normalizedAvatar.rightLowerArm;
    const actualNormWrist    = side === 'left' ? normalizedAvatar.leftHand      : normalizedAvatar.rightHand;
    const actualRawShoulder  = side === 'left' ? rawAvatar.leftUpperArm         : rawAvatar.rightUpperArm;
    const actualRawElbow     = side === 'left' ? rawAvatar.leftLowerArm         : rawAvatar.rightLowerArm;
    const actualRawWrist     = side === 'left' ? rawAvatar.leftHand             : rawAvatar.rightHand;

    return {
      side,
      mapping: source.mapping,
      raw: { shoulder: rawShoulder, elbow: rawElbow, wrist: rawWrist },
      performerAvatar: {
        shoulder: performerAvatarShoulder,
        elbow: performerAvatarElbow,
        wrist: performerAvatarWrist,
      },
      actualNormalized: {
        shoulder: actualNormShoulder,
        elbow: actualNormElbow,
        wrist: actualNormWrist,
      },
      actualRaw: {
        shoulder: actualRawShoulder,
        elbow: actualRawElbow,
        wrist: actualRawWrist,
      },
      elbowTarget: armDebug.elbowTarget,
      target,
      poleRaw: armDebug.poleRaw,
      poleSmoothed: armDebug.poleSmoothed,
      solver: armDebug,
      reachPercent,
      errors: {
        shoulderGreenToNorm:   distVec(performerAvatarShoulder, actualNormShoulder),
        shoulderGreenToRaw:    distVec(performerAvatarShoulder, actualRawShoulder),
        elbowGreenToBlue:      distVec(performerAvatarElbow, armDebug.elbowTarget),
        elbowBlueToNorm:       distVec(armDebug.elbowTarget, actualNormElbow),
        elbowBlueToRaw:        distVec(armDebug.elbowTarget, actualRawElbow),
        elbowGreenToNorm:      distVec(performerAvatarElbow, actualNormElbow),
        elbowGreenToRaw:       distVec(performerAvatarElbow, actualRawElbow),
        wristGreenToBlue:      distVec(performerAvatarWrist, target),
        wristBlueToNorm:       distVec(target, actualNormWrist),
        wristBlueToRaw:        distVec(target, actualRawWrist),
        wristGreenToNorm:      distVec(performerAvatarWrist, actualNormWrist),
        wristGreenToRaw:       distVec(performerAvatarWrist, actualRawWrist),
        wristNormToRaw:        distVec(actualNormWrist, actualRawWrist),
      },
      lengths: {
        performerRawUpper:    distLm(rawShoulder, rawElbow),
        performerRawLower:    distLm(rawElbow, rawWrist),
        performerAvatarUpper: distVec(performerAvatarShoulder, performerAvatarElbow),
        performerAvatarLower: distVec(performerAvatarElbow, performerAvatarWrist),
        actualNormUpper:      distVec(actualNormShoulder, actualNormElbow),
        actualNormLower:      distVec(actualNormElbow, actualNormWrist),
        actualRawUpper:       distVec(actualRawShoulder, actualRawElbow),
        actualRawLower:       distVec(actualRawElbow, actualRawWrist),
      },
      feasibility: {
        upperDelta: distVec(performerAvatarShoulder, performerAvatarElbow) - distVec(actualNormShoulder, actualNormElbow),
        lowerDelta: distVec(performerAvatarElbow, performerAvatarWrist) - distVec(actualNormElbow, actualNormWrist),
      },
    };
  };

  const buildTorsoSnapshot = (
    frame: PoseFrame | null,
    normalizedAvatar: AvatarJointPositions,
    rawAvatar: AvatarJointPositions,
    bodyScale: number,
    scales: LimbScales,
    torsoDebug: TorsoSolverDiagnostics,
  ) => {
    const projectedLeftShoulder  = computePerformerAvatarSpacePoint(frame, normalizedAvatar.hips, bodyScale, scales, 12);
    const projectedRightShoulder = computePerformerAvatarSpacePoint(frame, normalizedAvatar.hips, bodyScale, scales, 11);
    const projectedLeftHip       = computePerformerAvatarSpacePoint(frame, normalizedAvatar.hips, bodyScale, scales, 24);
    const projectedRightHip      = computePerformerAvatarSpacePoint(frame, normalizedAvatar.hips, bodyScale, scales, 23);

    const projectedShoulderMid = avgVec(projectedLeftShoulder, projectedRightShoulder);
    const projectedHipMid      = avgVec(projectedLeftHip, projectedRightHip);
    const projectedShoulderAxis = vecBetween(projectedLeftShoulder, projectedRightShoulder);
    const projectedHipAxis      = vecBetween(projectedLeftHip, projectedRightHip);

    const normLeftShoulder   = normalizedAvatar.leftUpperArm;
    const normRightShoulder  = normalizedAvatar.rightUpperArm;
    const normLeftHip        = normalizedAvatar.leftUpperLeg;
    const normRightHip       = normalizedAvatar.rightUpperLeg;
    const normShoulderMid    = avgVec(normLeftShoulder, normRightShoulder);
    const normHipMid         = avgVec(normLeftHip, normRightHip);
    const normShoulderAxis   = vecBetween(normLeftShoulder, normRightShoulder);
    const normHipAxis        = vecBetween(normLeftHip, normRightHip);

    const rawLeftShoulder    = rawAvatar.leftUpperArm;
    const rawRightShoulder   = rawAvatar.rightUpperArm;
    const rawLeftHip         = rawAvatar.leftUpperLeg;
    const rawRightHip        = rawAvatar.rightUpperLeg;
    const rawShoulderMid     = avgVec(rawLeftShoulder, rawRightShoulder);
    const rawHipMid          = avgVec(rawLeftHip, rawRightHip);
    const rawShoulderAxis    = vecBetween(rawLeftShoulder, rawRightShoulder);
    const rawHipAxis         = vecBetween(rawLeftHip, rawRightHip);

    return {
      projected: {
        leftShoulder: projectedLeftShoulder,
        rightShoulder: projectedRightShoulder,
        shoulderMid: projectedShoulderMid,
        leftHip: projectedLeftHip,
        rightHip: projectedRightHip,
        hipMid: projectedHipMid,
        shoulderAxis: projectedShoulderAxis,
        hipAxis: projectedHipAxis,
      },
      actualNormalized: {
        leftShoulder: normLeftShoulder,
        rightShoulder: normRightShoulder,
        shoulderMid: normShoulderMid,
        leftHip: normLeftHip,
        rightHip: normRightHip,
        hipMid: normHipMid,
        shoulderAxis: normShoulderAxis,
        hipAxis: normHipAxis,
      },
      actualRaw: {
        leftShoulder: rawLeftShoulder,
        rightShoulder: rawRightShoulder,
        shoulderMid: rawShoulderMid,
        leftHip: rawLeftHip,
        rightHip: rawRightHip,
        hipMid: rawHipMid,
        shoulderAxis: rawShoulderAxis,
        hipAxis: rawHipAxis,
      },
      errors: {
        shoulderMidGreenToNorm: distVec(projectedShoulderMid, normShoulderMid),
        shoulderMidGreenToRaw:  distVec(projectedShoulderMid, rawShoulderMid),
        hipMidGreenToNorm:      distVec(projectedHipMid, normHipMid),
        hipMidGreenToRaw:       distVec(projectedHipMid, rawHipMid),
        shoulderAxisGreenToNorm: angleVecDeg(projectedShoulderAxis, normShoulderAxis),
        shoulderAxisGreenToRaw:  angleVecDeg(projectedShoulderAxis, rawShoulderAxis),
        hipAxisGreenToNorm:      angleVecDeg(projectedHipAxis, normHipAxis),
        hipAxisGreenToRaw:       angleVecDeg(projectedHipAxis, rawHipAxis),
        shoulderWidthGreenToNorm: distVec(projectedLeftShoulder, projectedRightShoulder) - distVec(normLeftShoulder, normRightShoulder),
        shoulderWidthGreenToRaw:  distVec(projectedLeftShoulder, projectedRightShoulder) - distVec(rawLeftShoulder, rawRightShoulder),
        torsoHeightGreenToNorm:   deltaAxis(projectedShoulderMid, projectedHipMid, 'y') - deltaAxis(normShoulderMid, normHipMid, 'y'),
        torsoHeightGreenToRaw:    deltaAxis(projectedShoulderMid, projectedHipMid, 'y') - deltaAxis(rawShoulderMid, rawHipMid, 'y'),
        torsoDepthGreenToNorm:    deltaAxis(projectedShoulderMid, projectedHipMid, 'z') - deltaAxis(normShoulderMid, normHipMid, 'z'),
        torsoDepthGreenToRaw:     deltaAxis(projectedShoulderMid, projectedHipMid, 'z') - deltaAxis(rawShoulderMid, rawHipMid, 'z'),
      },
      lengths: {
        shoulderWidthGreen: distVec(projectedLeftShoulder, projectedRightShoulder),
        shoulderWidthNorm:  distVec(normLeftShoulder, normRightShoulder),
        shoulderWidthRaw:   distVec(rawLeftShoulder, rawRightShoulder),
        hipWidthGreen:      distVec(projectedLeftHip, projectedRightHip),
        hipWidthNorm:       distVec(normLeftHip, normRightHip),
        hipWidthRaw:        distVec(rawLeftHip, rawRightHip),
        torsoHeightGreen:   deltaAxis(projectedShoulderMid, projectedHipMid, 'y'),
        torsoHeightNorm:    deltaAxis(normShoulderMid, normHipMid, 'y'),
        torsoHeightRaw:     deltaAxis(rawShoulderMid, rawHipMid, 'y'),
        torsoDepthGreen:    deltaAxis(projectedShoulderMid, projectedHipMid, 'z'),
        torsoDepthNorm:     deltaAxis(normShoulderMid, normHipMid, 'z'),
        torsoDepthRaw:      deltaAxis(rawShoulderMid, rawHipMid, 'z'),
      },
      solver: torsoDebug,
    };
  };

  const getDebugSnapshot = () => {
    const m = getMocap();
    if (!m) return null;

    const cal       = m.calibration;
    const frame     = m.latestFrame;
    const pm        = cal.performerMeasurements();
    const st        = cal.status();
    const reach     = m.getReachPercent();
    const dt        = m.debugTargets;
    const avatarNormalized = m.getAvatarJointPositions('normalized');
    const avatarRaw        = m.getAvatarJointPositions('raw');
    const readiness = cal.readiness();
    const overrides = cal.getOverrides();
    const validatorStats = validator.getStats();
    const scales = {
      armL: cal.armScale('left'),
      armR: cal.armScale('right'),
      legL: cal.legScale(),
      legR: cal.legScale(),
    };
    const bodyScale = cal.bodyScale();
    const avatarArmL = cal.avatarLeftUpperArm  + cal.avatarLeftLowerArm;
    const avatarArmR = cal.avatarRightUpperArm + cal.avatarRightLowerArm;
    const avatarLegL = cal.avatarLeftUpperLeg  + cal.avatarLeftLowerLeg;
    const avatarLegR = cal.avatarRightUpperLeg + cal.avatarRightLowerLeg;
    const leftArm = buildArmSnapshot(
      'left',
      frame,
      avatarNormalized,
      avatarRaw,
      bodyScale,
      { ...scales, armL: scales.armL, armR: scales.armR },
      {
        elbowTarget: dt.hasArm ? dt.leftElbowTarget : null,
        poleRaw: dt.hasArm ? dt.leftArmPoleRaw : null,
        poleSmoothed: dt.hasArm ? dt.leftArmPoleSmoothed : null,
        ...(dt.hasArm ? dt.leftArmSolver : {
          rawScale: Number.NaN,
          effectiveScale: Number.NaN,
          segmentScaleCap: Number.NaN,
          midpointBlend: Number.NaN,
          handsTogetherBlend: Number.NaN,
          chestPrayerBlend: Number.NaN,
          wristFrontBlend: Number.NaN,
          frontPoseBlend: Number.NaN,
          faceNearBlend: Number.NaN,
        }),
      },
      dt.hasArm ? dt.leftWristTarget : null,
      reach.armL,
    );
    const rightArm = buildArmSnapshot(
      'right',
      frame,
      avatarNormalized,
      avatarRaw,
      bodyScale,
      { ...scales, armL: scales.armL, armR: scales.armR },
      {
        elbowTarget: dt.hasArm ? dt.rightElbowTarget : null,
        poleRaw: dt.hasArm ? dt.rightArmPoleRaw : null,
        poleSmoothed: dt.hasArm ? dt.rightArmPoleSmoothed : null,
        ...(dt.hasArm ? dt.rightArmSolver : {
          rawScale: Number.NaN,
          effectiveScale: Number.NaN,
          segmentScaleCap: Number.NaN,
          midpointBlend: Number.NaN,
          handsTogetherBlend: Number.NaN,
          chestPrayerBlend: Number.NaN,
          wristFrontBlend: Number.NaN,
          frontPoseBlend: Number.NaN,
          faceNearBlend: Number.NaN,
        }),
      },
      dt.hasArm ? dt.rightWristTarget : null,
      reach.armR,
    );
    const torso = buildTorsoSnapshot(
      frame,
      avatarNormalized,
      avatarRaw,
      bodyScale,
      { ...scales, armL: scales.armL, armR: scales.armR },
      dt.torsoSolver,
    );

    return {
      m,
      cal,
      frame,
      pm,
      st,
      dt,
      reach,
      avatarNormalized,
      avatarRaw,
      readiness,
      overrides,
      validatorStats,
      scales,
      bodyScale,
      avatarArmL,
      avatarArmR,
      avatarLegL,
      avatarLegR,
      torso,
      leftArm,
      rightArm,
    };
  };

  // ── HTML builders ───────────────────────────────────────────────────────────

  const buildModalContent = (): string => {
    const snap = getDebugSnapshot();
    if (!snap) return '<p style="opacity:.45;text-align:center;margin:24px 0">Start mocap to see data</p>';

    const {
      m,
      cal,
      frame,
      pm,
      st,
      dt,
      reach,
      readiness,
      overrides,
      validatorStats,
      scales,
      avatarArmL,
      avatarArmR,
      avatarLegL,
      avatarLegR,
      torso,
      leftArm,
      rightArm,
    } = snap;

    const torsoSectionHtml = `
      <div class="skel-section">
        <h4>Torso diagnostic</h4>
        ${skelRow('Green sh mid', fmtVecHtml(torso.projected.shoulderMid))}
        ${skelRow('Green hip mid', fmtVecHtml(torso.projected.hipMid))}
        ${skelRow('Norm sh mid', fmtVecHtml(torso.actualNormalized.shoulderMid))}
        ${skelRow('Norm hip mid', fmtVecHtml(torso.actualNormalized.hipMid))}
        ${skelRow('Raw sh mid', fmtVecHtml(torso.actualRaw.shoulderMid))}
        ${skelRow('Raw hip mid', fmtVecHtml(torso.actualRaw.hipMid))}
        ${skelRow('Green sh axis', fmtVecHtml(torso.projected.shoulderAxis))}
        ${skelRow('Norm sh axis', fmtVecHtml(torso.actualNormalized.shoulderAxis))}
        ${skelRow('Raw sh axis', fmtVecHtml(torso.actualRaw.shoulderAxis))}
        ${skelRow('Err sh mid G→N', fmtCm(torso.errors.shoulderMidGreenToNorm))}
        ${skelRow('Err sh mid G→R', fmtCm(torso.errors.shoulderMidGreenToRaw))}
        ${skelRow('Err hip mid G→N', fmtCm(torso.errors.hipMidGreenToNorm))}
        ${skelRow('Err hip mid G→R', fmtCm(torso.errors.hipMidGreenToRaw))}
        ${skelRow('Err sh axis G→N', fmtDeg(torso.errors.shoulderAxisGreenToNorm))}
        ${skelRow('Err sh axis G→R', fmtDeg(torso.errors.shoulderAxisGreenToRaw))}
        ${skelRow('Err hip axis G→N', fmtDeg(torso.errors.hipAxisGreenToNorm))}
        ${skelRow('Err hip axis G→R', fmtDeg(torso.errors.hipAxisGreenToRaw))}
        ${skelRow('Torso fwd raw', fmtDeg(torso.solver.forwardLeanRaw))}
        ${skelRow('Torso fwd applied', fmtDeg(torso.solver.forwardLeanApplied))}
        ${skelRow('Torso lat raw', fmtDeg(torso.solver.lateralLeanRaw))}
        ${skelRow('Torso lat applied', fmtDeg(torso.solver.lateralLeanApplied))}
        ${skelRow('Torso lat gain', fmtNum(torso.solver.lateralLeanGain))}
        ${skelRow('Δ shoulder width G→N', fmtCm(torso.errors.shoulderWidthGreenToNorm))}
        ${skelRow('Δ shoulder width G→R', fmtCm(torso.errors.shoulderWidthGreenToRaw))}
        ${skelRow('Δ torso height G→N', fmtCm(torso.errors.torsoHeightGreenToNorm))}
        ${skelRow('Δ torso height G→R', fmtCm(torso.errors.torsoHeightGreenToRaw))}
        ${skelRow('Δ torso depth G→N', fmtCm(torso.errors.torsoDepthGreenToNorm))}
        ${skelRow('Δ torso depth G→R', fmtCm(torso.errors.torsoDepthGreenToRaw))}
        ${skelRow('Shoulder width G/N/R', `${fmtNum(torso.lengths.shoulderWidthGreen)} / ${fmtNum(torso.lengths.shoulderWidthNorm)} / ${fmtNum(torso.lengths.shoulderWidthRaw)} m`)}
        ${skelRow('Hip width G/N/R', `${fmtNum(torso.lengths.hipWidthGreen)} / ${fmtNum(torso.lengths.hipWidthNorm)} / ${fmtNum(torso.lengths.hipWidthRaw)} m`)}
        ${skelRow('Torso height G/N/R', `${fmtNum(torso.lengths.torsoHeightGreen)} / ${fmtNum(torso.lengths.torsoHeightNorm)} / ${fmtNum(torso.lengths.torsoHeightRaw)} m`)}
        ${skelRow('Torso depth G/N/R', `${fmtNum(torso.lengths.torsoDepthGreen)} / ${fmtNum(torso.lengths.torsoDepthNorm)} / ${fmtNum(torso.lengths.torsoDepthRaw)} m`)}
      </div>`;

    const armSectionHtml = (title: string, arm: ReturnType<typeof buildArmSnapshot>): string => `
      <div class="skel-section">
        <h4>${title}</h4>
        ${skelRow('Mapping', arm.mapping)}
        ${skelRow('Reach', reachHtml(arm.reachPercent))}
        ${skelRow('Performer raw S', fmtLmHtml(arm.raw.shoulder))}
        ${skelRow('Performer raw E', fmtLmHtml(arm.raw.elbow))}
        ${skelRow('Performer raw W', fmtLmHtml(arm.raw.wrist))}
        ${skelRow('Green shoulder', fmtVecHtml(arm.performerAvatar.shoulder))}
        ${skelRow('Green elbow', fmtVecHtml(arm.performerAvatar.elbow))}
        ${skelRow('Green wrist', fmtVecHtml(arm.performerAvatar.wrist))}
        ${skelRow('Elbow target', fmtVecHtml(arm.elbowTarget))}
        ${skelRow('Blue target', fmtVecHtml(arm.target))}
        ${skelRow('Pole raw', fmtVecHtml(arm.poleRaw))}
        ${skelRow('Pole smooth', fmtVecHtml(arm.poleSmoothed))}
        ${skelRow('Arm scale raw/eff', `${fmtPct(arm.solver.rawScale)} / ${fmtPct(arm.solver.effectiveScale)}`)}
        ${skelRow('Arm scale cap', fmtPct(arm.solver.segmentScaleCap))}
        ${skelRow('Midpoint blend', fmtPct(arm.solver.midpointBlend))}
        ${skelRow('Hands-together', fmtPct(arm.solver.handsTogetherBlend))}
        ${skelRow('Prayer blend', fmtPct(arm.solver.chestPrayerBlend))}
        ${skelRow('Face-near blend', fmtPct(arm.solver.faceNearBlend))}
        ${skelRow('Wrist front', fmtPct(arm.solver.wristFrontBlend))}
        ${skelRow('Front-pose blend', fmtPct(arm.solver.frontPoseBlend))}
        ${skelRow('Norm shoulder', fmtVecHtml(arm.actualNormalized.shoulder))}
        ${skelRow('Norm elbow', fmtVecHtml(arm.actualNormalized.elbow))}
        ${skelRow('Norm wrist', fmtVecHtml(arm.actualNormalized.wrist))}
        ${skelRow('Raw shoulder', fmtVecHtml(arm.actualRaw.shoulder))}
        ${skelRow('Raw elbow', fmtVecHtml(arm.actualRaw.elbow))}
        ${skelRow('Raw wrist', fmtVecHtml(arm.actualRaw.wrist))}
        ${skelRow('Err shoulder G→N', fmtCm(arm.errors.shoulderGreenToNorm))}
        ${skelRow('Err shoulder G→R', fmtCm(arm.errors.shoulderGreenToRaw))}
        ${skelRow('Err elbow G→T', fmtCm(arm.errors.elbowGreenToBlue))}
        ${skelRow('Err elbow T→N', fmtCm(arm.errors.elbowBlueToNorm))}
        ${skelRow('Err elbow T→R', fmtCm(arm.errors.elbowBlueToRaw))}
        ${skelRow('Err elbow G→N', fmtCm(arm.errors.elbowGreenToNorm))}
        ${skelRow('Err elbow G→R', fmtCm(arm.errors.elbowGreenToRaw))}
        ${skelRow('Err wrist G→B', fmtCm(arm.errors.wristGreenToBlue))}
        ${skelRow('Err wrist B→N', fmtCm(arm.errors.wristBlueToNorm))}
        ${skelRow('Err wrist B→R', fmtCm(arm.errors.wristBlueToRaw))}
        ${skelRow('Err wrist G→N', fmtCm(arm.errors.wristGreenToNorm))}
        ${skelRow('Err wrist G→R', fmtCm(arm.errors.wristGreenToRaw))}
        ${skelRow('Err wrist N→R', fmtCm(arm.errors.wristNormToRaw))}
        ${skelRow('Elbow ref upper Δ', fmtCm(arm.feasibility.upperDelta))}
        ${skelRow('Elbow ref lower Δ', fmtCm(arm.feasibility.lowerDelta))}
        ${skelRow('Raw upper/lower', `${fmtNum(arm.lengths.performerRawUpper)} / ${fmtNum(arm.lengths.performerRawLower)} m`)}
        ${skelRow('Green upper/lower', `${fmtNum(arm.lengths.performerAvatarUpper)} / ${fmtNum(arm.lengths.performerAvatarLower)} m`)}
        ${skelRow('Norm upper/lower', `${fmtNum(arm.lengths.actualNormUpper)} / ${fmtNum(arm.lengths.actualNormLower)} m`)}
        ${skelRow('Raw upper/lower', `${fmtNum(arm.lengths.actualRawUpper)} / ${fmtNum(arm.lengths.actualRawLower)} m`)}
      </div>`;

    return `
      <div class="skel-cols">
        <div class="skel-section">
          <h4>Performer (MediaPipe, metres)</h4>
          ${skelRow('Hip width',      fmtM(pm.hipWidth))}
          ${skelRow('Shoulder width', fmtM(pm.shoulderWidth))}
          ${skelRow('Head width',     fmtM(pm.headWidth))}
          ${skelRow('Arm L max',      fmtM(pm.leftArmMax))}
          ${skelRow('Arm R max',      fmtM(pm.rightArmMax))}
          ${skelRow('Leg length',     fmtM(pm.legLen))}
        </div>
        <div class="skel-section">
          <h4>Avatar skeleton (rest pose)</h4>
          ${skelRow('Hip width',      fmtM(cal.avatarHipWidth))}
          ${skelRow('Shoulder width', fmtM(cal.avatarShoulderWidth))}
          ${skelRow('Head width',     fmtM(cal.avatarHeadWidth))}
          ${skelRow('Arm L upper',    fmtM(cal.avatarLeftUpperArm))}
          ${skelRow('Arm L lower',    fmtM(cal.avatarLeftLowerArm))}
          ${skelRow('Arm R upper',    fmtM(cal.avatarRightUpperArm))}
          ${skelRow('Arm R lower',    fmtM(cal.avatarRightLowerArm))}
          ${skelRow('Leg L upper',    fmtM(cal.avatarLeftUpperLeg))}
          ${skelRow('Leg L lower',    fmtM(cal.avatarLeftLowerLeg))}
          ${skelRow('Leg R upper',    fmtM(cal.avatarRightUpperLeg))}
          ${skelRow('Leg R lower',    fmtM(cal.avatarRightLowerLeg))}
        </div>
      </div>
      <div class="skel-divider"></div>
      <div class="skel-cols">
        <div class="skel-section">
          <h4>Capture &amp; tuning</h4>
          ${skelRow('Live frame', frame ? '<span class="skel-cal">yes</span>' : '<span class="skel-uncal">no</span>')}
          ${skelRow('Hands detected', frame ? (frame.hands.map((h) => h.side).join(', ') || '—') : '<span style="opacity:.35">—</span>')}
          ${skelRow('Face landmarks', frame ? String(frame.faceLandmarks.length) : '<span style="opacity:.35">—</span>')}
          ${skelRow('Scale ref', cal.scaleRef)}
          ${skelRow('Pose model', m.poseQuality)}
          ${skelRow('Mirror', m.mirrorX ? 'ON' : 'OFF')}
          ${skelRow('1€ filter', m.filterEnabled ? 'ON' : 'OFF')}
          ${skelRow('Visibility gate', fmtPct(m.visibilityThreshold))}
          ${skelRow('Depth scale', fmtNum(m.depthScale))}
          ${skelRow('Arm Z atten', fmtNum(m.armZAttenuation))}
          ${skelRow('Pole Z', fmtNum(m.armPoleZ))}
          ${skelRow('Body smooth', fmtNum(m.bodySmoothing))}
          ${skelRow('Spine smooth', fmtNum(m.spineSmoothing))}
          ${skelRow('Pole smooth', fmtNum(m.poleSmoothing))}
          ${skelRow('Shoulder spread', `${m.shoulderSpread.toFixed(0)}°`)}
          ${skelRow('Validator', validator.enabled ? 'ON' : 'OFF')}
          ${skelRow('Clamped/frame', String(validatorStats.clampedThisFrame))}
          ${skelRow('Worst clamp', validatorStats.worstBone
            ? `${validatorStats.worstBone} +${(validatorStats.worstDelta * 180 / Math.PI).toFixed(1)}°`
            : '<span style="opacity:.35">—</span>')}
        </div>
        <div class="skel-section">
          <h4>Readiness &amp; overrides</h4>
          ${skelRow('Shoulders ready', fmtPct(readiness.shoulders))}
          ${skelRow('Hips ready', fmtPct(readiness.hips))}
          ${skelRow('Legs ready', fmtPct(readiness.legs))}
          ${skelRow('Arm L ready', fmtPct(readiness.armL))}
          ${skelRow('Arm R ready', fmtPct(readiness.armR))}
          ${skelRow('Shoulder override', fmtNum(overrides.shoulder))}
          ${skelRow('L arm override', fmtNum(overrides.leftArm))}
          ${skelRow('R arm override', fmtNum(overrides.rightArm))}
          ${skelRow('Body scale raw', fmtPct(st.bodyScale))}
          ${skelRow('Arm L scale raw', fmtPct(scales.armL))}
          ${skelRow('Arm R scale raw', fmtPct(scales.armR))}
          ${skelRow('Leg scale raw', fmtPct(scales.legL))}
          ${skelRow('Wrist targets active', dt.hasArm ? '<span class="skel-cal">yes</span>' : '<span class="skel-uncal">no</span>')}
          ${skelRow('Ankle targets active', dt.hasLeg ? '<span class="skel-cal">yes</span>' : '<span class="skel-uncal">no</span>')}
        </div>
      </div>
      <div class="skel-divider"></div>
      <div class="skel-cols">
        <div class="skel-section">
          <h4>Calibration scales</h4>
          ${skelRow('Calibrated',    st.calibrated
              ? '<span class="skel-cal">yes</span>'
              : '<span class="skel-uncal">no</span>')}
          ${skelRow('Body scale',    fmtPct(st.bodyScale))}
          ${skelRow('Arm L scale',   fmtPct(st.leftArmScale))}
          ${skelRow('Arm R scale',   fmtPct(st.rightArmScale))}
          ${skelRow('Leg scale',     fmtPct(cal.legScale()))}
          ${skelRow('Shoulder ×',    fmtPct(st.shoulderWidthScale))}
        </div>
        <div class="skel-section">
          <h4>IK reach &amp; foot lock</h4>
          ${skelRow('Arm L reach',  reachHtml(reach.armL))}
          ${skelRow('Arm R reach',  reachHtml(reach.armR))}
          ${skelRow('Leg L reach',  reachHtml(reach.legL))}
          ${skelRow('Leg R reach',  reachHtml(reach.legR))}
          ${skelRow('L foot',       dt.hasLeg ? lockHtml(dt.leftFootLocked)  : '<span style="opacity:.35">—</span>')}
          ${skelRow('R foot',       dt.hasLeg ? lockHtml(dt.rightFootLocked) : '<span style="opacity:.35">—</span>')}
        </div>
      </div>
      <div class="skel-divider"></div>
      <div class="skel-cols">
        <div class="skel-section">
          <h4>Size ratios (avatar / performer)</h4>
          ${skelRow('Hip',       fmtRatio(cal.avatarHipWidth,      pm.hipWidth))}
          ${skelRow('Shoulder',  fmtRatio(cal.avatarShoulderWidth, pm.shoulderWidth))}
          ${skelRow('Head',      fmtRatio(cal.avatarHeadWidth,     pm.headWidth))}
          ${skelRow('Arm L',     fmtRatio(avatarArmL, pm.rightArmMax))}
          ${skelRow('Arm R',     fmtRatio(avatarArmR, pm.leftArmMax))}
          ${skelRow('Leg',       fmtRatio((avatarLegL + avatarLegR) * 0.5, pm.legLen))}
        </div>
        <div class="skel-section">
          <h4>Segment totals</h4>
          ${skelRow('Arm L total', fmtM(avatarArmL))}
          ${skelRow('Arm R total', fmtM(avatarArmR))}
          ${skelRow('Leg L total', fmtM(avatarLegL))}
          ${skelRow('Leg R total', fmtM(avatarLegR))}
          ${skelRow('Arm asym',    fmtM(Math.abs(avatarArmL - avatarArmR)))}
          ${skelRow('Leg asym',    fmtM(Math.abs(avatarLegL - avatarLegR)))}
        </div>
      </div>
      <div class="skel-divider"></div>
      <div class="skel-cols">
        ${torsoSectionHtml}
      </div>
      <div class="skel-divider"></div>
      <div class="skel-cols">
        ${armSectionHtml('Arm diagnostic: avatar LEFT', leftArm)}
        ${armSectionHtml('Arm diagnostic: avatar RIGHT', rightArm)}
      </div>`;
  };

  const buildClipboardText = (): string => {
    const snap = getDebugSnapshot();
    if (!snap) return 'No mocap data available.';

    const {
      m,
      cal,
      frame,
      pm,
      st,
      dt,
      reach,
      readiness,
      overrides,
      validatorStats,
      scales,
      avatarArmL,
      avatarArmR,
      avatarLegL,
      avatarLegR,
      torso,
      leftArm,
      rightArm,
    } = snap;

    const f = (v: number) => Number.isFinite(v) ? v.toFixed(4) : '—';
    const p = (v: number) => v > 0 ? (v * 100).toFixed(1) + '%' : '—';
    const r = (a: number, b: number) => (a > 1e-4 && b > 1e-4) ? (a / b).toFixed(3) + '×' : '—';
    const cm = (v: number) => Number.isFinite(v) ? `${(v * 100).toFixed(1)} cm` : '—';
    const deg = (v: number) => Number.isFinite(v) ? `${(v * 180 / Math.PI).toFixed(1)}°` : '—';

    const armText = (title: string, arm: ReturnType<typeof buildArmSnapshot>): string[] => [
      `--- ${title} ---`,
      `Mapping:         ${arm.mapping}`,
      `Reach:           ${arm.reachPercent > 0 ? arm.reachPercent.toFixed(0) + '%' : '—'}`,
      `Perf raw S:      ${fmtLmText(arm.raw.shoulder)}`,
      `Perf raw E:      ${fmtLmText(arm.raw.elbow)}`,
      `Perf raw W:      ${fmtLmText(arm.raw.wrist)}`,
      `Green shoulder:  ${fmtVecText(arm.performerAvatar.shoulder)}`,
      `Green elbow:     ${fmtVecText(arm.performerAvatar.elbow)}`,
      `Green wrist:     ${fmtVecText(arm.performerAvatar.wrist)}`,
      `Elbow target:    ${fmtVecText(arm.elbowTarget)}`,
      `Blue target:     ${fmtVecText(arm.target)}`,
      `Pole raw:        ${fmtVecText(arm.poleRaw)}`,
      `Pole smooth:     ${fmtVecText(arm.poleSmoothed)}`,
      `Arm scale raw/eff:${p(arm.solver.rawScale)} / ${p(arm.solver.effectiveScale)}`,
      `Arm scale cap:   ${p(arm.solver.segmentScaleCap)}`,
      `Midpoint blend:  ${p(arm.solver.midpointBlend)}`,
      `Hands-together:  ${p(arm.solver.handsTogetherBlend)}`,
      `Prayer blend:    ${p(arm.solver.chestPrayerBlend)}`,
      `Face-near blend: ${p(arm.solver.faceNearBlend)}`,
      `Wrist front:     ${p(arm.solver.wristFrontBlend)}`,
      `Front-pose blend:${p(arm.solver.frontPoseBlend)}`,
      `Norm shoulder:   ${fmtVecText(arm.actualNormalized.shoulder)}`,
      `Norm elbow:      ${fmtVecText(arm.actualNormalized.elbow)}`,
      `Norm wrist:      ${fmtVecText(arm.actualNormalized.wrist)}`,
      `Raw shoulder:    ${fmtVecText(arm.actualRaw.shoulder)}`,
      `Raw elbow:       ${fmtVecText(arm.actualRaw.elbow)}`,
      `Raw wrist:       ${fmtVecText(arm.actualRaw.wrist)}`,
      `Err shoulder G→N:${cm(arm.errors.shoulderGreenToNorm)}`,
      `Err shoulder G→R:${cm(arm.errors.shoulderGreenToRaw)}`,
      `Err elbow G→T:   ${cm(arm.errors.elbowGreenToBlue)}`,
      `Err elbow T→N:   ${cm(arm.errors.elbowBlueToNorm)}`,
      `Err elbow T→R:   ${cm(arm.errors.elbowBlueToRaw)}`,
      `Err elbow G→N:   ${cm(arm.errors.elbowGreenToNorm)}`,
      `Err elbow G→R:   ${cm(arm.errors.elbowGreenToRaw)}`,
      `Err wrist G→B:   ${cm(arm.errors.wristGreenToBlue)}`,
      `Err wrist B→N:   ${cm(arm.errors.wristBlueToNorm)}`,
      `Err wrist B→R:   ${cm(arm.errors.wristBlueToRaw)}`,
      `Err wrist G→N:   ${cm(arm.errors.wristGreenToNorm)}`,
      `Err wrist G→R:   ${cm(arm.errors.wristGreenToRaw)}`,
      `Err wrist N→R:   ${cm(arm.errors.wristNormToRaw)}`,
      `Elbow ref upper Δ:${cm(arm.feasibility.upperDelta)}`,
      `Elbow ref lower Δ:${cm(arm.feasibility.lowerDelta)}`,
      `Raw upper/lower: ${f(arm.lengths.performerRawUpper)} / ${f(arm.lengths.performerRawLower)}`,
      `Green upper/lwr: ${f(arm.lengths.performerAvatarUpper)} / ${f(arm.lengths.performerAvatarLower)}`,
      `Norm upper/lwr:  ${f(arm.lengths.actualNormUpper)} / ${f(arm.lengths.actualNormLower)}`,
      `Raw upper/lwr:   ${f(arm.lengths.actualRawUpper)} / ${f(arm.lengths.actualRawLower)}`,
      '',
    ];

    const torsoText = [
      '--- Torso diagnostic ---',
      `Green sh mid:    ${fmtVecText(torso.projected.shoulderMid)}`,
      `Green hip mid:   ${fmtVecText(torso.projected.hipMid)}`,
      `Norm sh mid:     ${fmtVecText(torso.actualNormalized.shoulderMid)}`,
      `Norm hip mid:    ${fmtVecText(torso.actualNormalized.hipMid)}`,
      `Raw sh mid:      ${fmtVecText(torso.actualRaw.shoulderMid)}`,
      `Raw hip mid:     ${fmtVecText(torso.actualRaw.hipMid)}`,
      `Green sh axis:   ${fmtVecText(torso.projected.shoulderAxis)}`,
      `Norm sh axis:    ${fmtVecText(torso.actualNormalized.shoulderAxis)}`,
      `Raw sh axis:     ${fmtVecText(torso.actualRaw.shoulderAxis)}`,
      `Err sh mid G→N:  ${cm(torso.errors.shoulderMidGreenToNorm)}`,
      `Err sh mid G→R:  ${cm(torso.errors.shoulderMidGreenToRaw)}`,
      `Err hip mid G→N: ${cm(torso.errors.hipMidGreenToNorm)}`,
      `Err hip mid G→R: ${cm(torso.errors.hipMidGreenToRaw)}`,
      `Err sh axis G→N: ${Number.isFinite(torso.errors.shoulderAxisGreenToNorm) ? torso.errors.shoulderAxisGreenToNorm.toFixed(1) + '°' : '—'}`,
      `Err sh axis G→R: ${Number.isFinite(torso.errors.shoulderAxisGreenToRaw) ? torso.errors.shoulderAxisGreenToRaw.toFixed(1) + '°' : '—'}`,
      `Err hip axis G→N:${Number.isFinite(torso.errors.hipAxisGreenToNorm) ? torso.errors.hipAxisGreenToNorm.toFixed(1) + '°' : '—'}`,
      `Err hip axis G→R:${Number.isFinite(torso.errors.hipAxisGreenToRaw) ? torso.errors.hipAxisGreenToRaw.toFixed(1) + '°' : '—'}`,
      `Torso fwd raw:   ${deg(torso.solver.forwardLeanRaw)}`,
      `Torso fwd applied:${deg(torso.solver.forwardLeanApplied)}`,
      `Torso lat raw:   ${deg(torso.solver.lateralLeanRaw)}`,
      `Torso lat applied:${deg(torso.solver.lateralLeanApplied)}`,
      `Torso lat gain:  ${Number.isFinite(torso.solver.lateralLeanGain) ? torso.solver.lateralLeanGain.toFixed(3) : '—'}`,
      `Δ shoulder width G→N:${cm(torso.errors.shoulderWidthGreenToNorm)}`,
      `Δ shoulder width G→R:${cm(torso.errors.shoulderWidthGreenToRaw)}`,
      `Δ torso height G→N:${cm(torso.errors.torsoHeightGreenToNorm)}`,
      `Δ torso height G→R:${cm(torso.errors.torsoHeightGreenToRaw)}`,
      `Δ torso depth G→N: ${cm(torso.errors.torsoDepthGreenToNorm)}`,
      `Δ torso depth G→R: ${cm(torso.errors.torsoDepthGreenToRaw)}`,
      `Shoulder width G/N/R: ${f(torso.lengths.shoulderWidthGreen)} / ${f(torso.lengths.shoulderWidthNorm)} / ${f(torso.lengths.shoulderWidthRaw)}`,
      `Hip width G/N/R:      ${f(torso.lengths.hipWidthGreen)} / ${f(torso.lengths.hipWidthNorm)} / ${f(torso.lengths.hipWidthRaw)}`,
      `Torso height G/N/R:   ${f(torso.lengths.torsoHeightGreen)} / ${f(torso.lengths.torsoHeightNorm)} / ${f(torso.lengths.torsoHeightRaw)}`,
      `Torso depth G/N/R:    ${f(torso.lengths.torsoDepthGreen)} / ${f(torso.lengths.torsoDepthNorm)} / ${f(torso.lengths.torsoDepthRaw)}`,
      '',
    ];

    return [
      '=== Skeleton Info ===',
      '',
      '--- Performer (metres) ---',
      `Hip width:      ${f(pm.hipWidth)}`,
      `Shoulder width: ${f(pm.shoulderWidth)}`,
      `Head width:     ${f(pm.headWidth)}`,
      `Arm L max:      ${f(pm.leftArmMax)}`,
      `Arm R max:      ${f(pm.rightArmMax)}`,
      `Leg length:     ${f(pm.legLen)}`,
      '',
      '--- Avatar skeleton ---',
      `Hip width:      ${f(cal.avatarHipWidth)}`,
      `Shoulder width: ${f(cal.avatarShoulderWidth)}`,
      `Head width:     ${f(cal.avatarHeadWidth)}`,
      `Arm L upper:    ${f(cal.avatarLeftUpperArm)}`,
      `Arm L lower:    ${f(cal.avatarLeftLowerArm)}`,
      `Arm R upper:    ${f(cal.avatarRightUpperArm)}`,
      `Arm R lower:    ${f(cal.avatarRightLowerArm)}`,
      `Leg L upper:    ${f(cal.avatarLeftUpperLeg)}`,
      `Leg L lower:    ${f(cal.avatarLeftLowerLeg)}`,
      `Leg R upper:    ${f(cal.avatarRightUpperLeg)}`,
      `Leg R lower:    ${f(cal.avatarRightLowerLeg)}`,
      '',
      '--- Capture & tuning ---',
      `Live frame:      ${frame ? 'yes' : 'no'}`,
      `Hands detected:  ${frame ? (frame.hands.map((h) => h.side).join(', ') || '—') : '—'}`,
      `Face landmarks:  ${frame ? String(frame.faceLandmarks.length) : '—'}`,
      `Scale ref:       ${cal.scaleRef}`,
      `Pose model:      ${m.poseQuality}`,
      `Mirror:          ${m.mirrorX ? 'ON' : 'OFF'}`,
      `1€ filter:       ${m.filterEnabled ? 'ON' : 'OFF'}`,
      `Visibility gate: ${p(m.visibilityThreshold)}`,
      `Depth scale:     ${m.depthScale.toFixed(2)}`,
      `Arm Z atten:     ${m.armZAttenuation.toFixed(2)}`,
      `Pole Z:          ${m.armPoleZ.toFixed(2)}`,
      `Body smooth:     ${m.bodySmoothing.toFixed(2)}`,
      `Spine smooth:    ${m.spineSmoothing.toFixed(2)}`,
      `Pole smooth:     ${m.poleSmoothing.toFixed(2)}`,
      `Shoulder spread: ${m.shoulderSpread.toFixed(0)}°`,
      `Validator:       ${validator.enabled ? 'ON' : 'OFF'}`,
      `Clamped/frame:   ${validatorStats.clampedThisFrame}`,
      `Worst clamp:     ${validatorStats.worstBone
        ? `${validatorStats.worstBone} +${(validatorStats.worstDelta * 180 / Math.PI).toFixed(1)}°`
        : '—'}`,
      '',
      '--- Readiness & overrides ---',
      `Shoulders ready: ${p(readiness.shoulders)}`,
      `Hips ready:      ${p(readiness.hips)}`,
      `Legs ready:      ${p(readiness.legs)}`,
      `Arm L ready:     ${p(readiness.armL)}`,
      `Arm R ready:     ${p(readiness.armR)}`,
      `Shoulder ovrd:   ${overrides.shoulder.toFixed(2)}`,
      `L arm ovrd:      ${overrides.leftArm.toFixed(2)}`,
      `R arm ovrd:      ${overrides.rightArm.toFixed(2)}`,
      `Body scale raw:  ${p(st.bodyScale)}`,
      `Arm L scale raw: ${p(scales.armL)}`,
      `Arm R scale raw: ${p(scales.armR)}`,
      `Leg scale raw:   ${p(scales.legL)}`,
      `Wrist targets:   ${dt.hasArm ? 'yes' : 'no'}`,
      `Ankle targets:   ${dt.hasLeg ? 'yes' : 'no'}`,
      '',
      '--- Calibration scales ---',
      `Calibrated:     ${st.calibrated ? 'yes' : 'no'}`,
      `Body scale:     ${p(st.bodyScale)}`,
      `Arm L scale:    ${p(st.leftArmScale)}`,
      `Arm R scale:    ${p(st.rightArmScale)}`,
      `Leg scale:      ${p(cal.legScale())}`,
      `Shoulder ×:     ${p(st.shoulderWidthScale)}`,
      '',
      '--- IK reach & foot lock ---',
      `Arm L reach:    ${reach.armL > 0 ? reach.armL.toFixed(0) + '%' : '—'}`,
      `Arm R reach:    ${reach.armR > 0 ? reach.armR.toFixed(0) + '%' : '—'}`,
      `Leg L reach:    ${reach.legL > 0 ? reach.legL.toFixed(0) + '%' : '—'}`,
      `Leg R reach:    ${reach.legR > 0 ? reach.legR.toFixed(0) + '%' : '—'}`,
      `L foot:         ${dt.hasLeg ? (dt.leftFootLocked  ? 'locked' : 'free') : '—'}`,
      `R foot:         ${dt.hasLeg ? (dt.rightFootLocked ? 'locked' : 'free') : '—'}`,
      '',
      '--- Size ratios (avatar/performer) ---',
      `Hip:      ${r(cal.avatarHipWidth,      pm.hipWidth)}`,
      `Shoulder: ${r(cal.avatarShoulderWidth, pm.shoulderWidth)}`,
      `Head:     ${r(cal.avatarHeadWidth,     pm.headWidth)}`,
      `Arm L:    ${r(avatarArmL, pm.rightArmMax)}`,
      `Arm R:    ${r(avatarArmR, pm.leftArmMax)}`,
      `Leg:      ${r((avatarLegL + avatarLegR) * 0.5, pm.legLen)}`,
      '',
      '--- Segment totals ---',
      `Arm L total: ${f(avatarArmL)}`,
      `Arm R total: ${f(avatarArmR)}`,
      `Leg L total: ${f(avatarLegL)}`,
      `Leg R total: ${f(avatarLegR)}`,
      `Arm asym:    ${f(Math.abs(avatarArmL - avatarArmR))}`,
      `Leg asym:    ${f(Math.abs(avatarLegL - avatarLegR))}`,
      '',
      ...torsoText,
      ...armText('Arm diagnostic: avatar LEFT', leftArm),
      ...armText('Arm diagnostic: avatar RIGHT', rightArm),
    ].join('\n');
  };

  // ── Modal open / close / refresh ────────────────────────────────────────────

  const refreshModal = (): void => { modalBody.innerHTML = buildModalContent(); };

  const openModal = (): void => {
    modalOverlay.classList.add('open');
    refreshModal();
    modalTimer = rememberInterval(refreshModal, 500);
  };

  const closeModal = (): void => {
    modalOverlay.classList.remove('open');
    clearInterval(modalTimer);
  };

  const modalListenerOpts: AddEventListenerOptions = { signal };
  skelInfoBtn?.addEventListener('click', openModal, modalListenerOpts);
  modalCloseBtn.addEventListener('click', closeModal, modalListenerOpts);
  modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); }, modalListenerOpts);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOverlay.classList.contains('open')) closeModal();
  }, modalListenerOpts);

  let copyResetTimer = 0;
  modalCopyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(buildClipboardText()).then(() => {
      modalCopyBtn.textContent = '✓ copied!';
      modalCopyBtn.classList.add('copied');
      clearTimeout(copyResetTimer);
      copyResetTimer = rememberTimeout(() => {
        modalCopyBtn.textContent = '📋 copy';
        modalCopyBtn.classList.remove('copied');
      }, 2000);
    });
  }, modalListenerOpts);

  return () => {
    clearInterval(modalTimer);
    clearTimeout(copyResetTimer);
    closeModal();
  };
}
