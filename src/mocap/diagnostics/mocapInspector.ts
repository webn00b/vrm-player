import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { PoseFrame } from '../pipeline/poseDetector';
import type { MocapCalibration } from '../trackers/mocapCalibration';
import type { MocapDebugTargets } from './mocapDiagnostics';
import { getCachedHumanoidRestAxes } from '../../humanoidRestPose';

export type AvatarJointPositionMap = {
  hips: THREE.Vector3;
  leftUpperArm: THREE.Vector3;  leftLowerArm: THREE.Vector3;  leftHand: THREE.Vector3;
  rightUpperArm: THREE.Vector3; rightLowerArm: THREE.Vector3; rightHand: THREE.Vector3;
  leftUpperLeg: THREE.Vector3;  leftLowerLeg: THREE.Vector3;  leftFoot: THREE.Vector3;
  rightUpperLeg: THREE.Vector3; rightLowerLeg: THREE.Vector3; rightFoot: THREE.Vector3;
};

export interface ReachPercent { armL: number; armR: number; legL: number; legR: number }

function getNormBoneWorldPosition(vrm: VRM, name: VRMHumanBoneName): THREE.Vector3 {
  const out = new THREE.Vector3();
  vrm.humanoid.getNormalizedBoneNode(name)?.getWorldPosition(out);
  return out;
}

/**
 * IK target reach as % of avatar limb length, per side.
 *   < 90%  — comfortable reach, IK bends freely
 *   ~100%  — near max (straight limb)
 *   > 100% — unreachable (limb locks, hand/foot short of target)
 */
export function getReachPercent(
  vrm: VRM,
  cal: MocapCalibration,
  dt: MocapDebugTargets,
): ReachPercent {
  const h = vrm.humanoid;
  const tmp = new THREE.Vector3();
  const reach = (boneName: VRMHumanBoneName, target: THREE.Vector3, limbLen: number): number => {
    const n = h.getNormalizedBoneNode(boneName);
    if (!n || limbLen <= 0) return 0;
    n.getWorldPosition(tmp);
    return (tmp.distanceTo(target) / limbLen) * 100;
  };
  return {
    armL: dt.hasArm ? reach(VRMHumanBoneName.LeftUpperArm, dt.leftWristTarget,  cal.avatarLeftUpperArm  + cal.avatarLeftLowerArm)   : 0,
    armR: dt.hasArm ? reach(VRMHumanBoneName.RightUpperArm, dt.rightWristTarget, cal.avatarRightUpperArm + cal.avatarRightLowerArm)  : 0,
    legL: dt.hasLeg ? reach(VRMHumanBoneName.LeftUpperLeg, dt.leftAnkleTarget,  cal.avatarLeftUpperLeg  + cal.avatarLeftLowerLeg)   : 0,
    legR: dt.hasLeg ? reach(VRMHumanBoneName.RightUpperLeg, dt.rightAnkleTarget, cal.avatarRightUpperLeg + cal.avatarRightLowerLeg)  : 0,
  };
}

/** World positions of the avatar's hand / foot bones — used to compare against
 *  IK targets for fit statistics. */
export function getActualBonePositions(vrm: VRM): {
  leftHand: THREE.Vector3; rightHand: THREE.Vector3;
  leftFoot: THREE.Vector3; rightFoot: THREE.Vector3;
} {
  return {
    leftHand:  getNormBoneWorldPosition(vrm, VRMHumanBoneName.LeftHand),
    rightHand: getNormBoneWorldPosition(vrm, VRMHumanBoneName.RightHand),
    leftFoot:  getNormBoneWorldPosition(vrm, VRMHumanBoneName.LeftFoot),
    rightFoot: getNormBoneWorldPosition(vrm, VRMHumanBoneName.RightFoot),
  };
}

/** World positions of key avatar joints for side-by-side pose diagnostics. */
export function getAvatarJointPositions(
  vrm: VRM,
  kind: 'normalized' | 'raw' = 'normalized',
): AvatarJointPositionMap {
  const get = (name: VRMHumanBoneName): THREE.Vector3 => {
    const node = kind === 'raw'
      ? vrm.humanoid.getRawBoneNode(name) ?? vrm.humanoid.getNormalizedBoneNode(name)
      : vrm.humanoid.getNormalizedBoneNode(name);
    const out = new THREE.Vector3();
    node?.getWorldPosition(out);
    return out;
  };
  return {
    hips:          get(VRMHumanBoneName.Hips),
    leftUpperArm:  get(VRMHumanBoneName.LeftUpperArm),
    leftLowerArm:  get(VRMHumanBoneName.LeftLowerArm),
    leftHand:      get(VRMHumanBoneName.LeftHand),
    rightUpperArm: get(VRMHumanBoneName.RightUpperArm),
    rightLowerArm: get(VRMHumanBoneName.RightLowerArm),
    rightHand:     get(VRMHumanBoneName.RightHand),
    leftUpperLeg:  get(VRMHumanBoneName.LeftUpperLeg),
    leftLowerLeg:  get(VRMHumanBoneName.LeftLowerLeg),
    leftFoot:      get(VRMHumanBoneName.LeftFoot),
    rightUpperLeg: get(VRMHumanBoneName.RightUpperLeg),
    rightLowerLeg: get(VRMHumanBoneName.RightLowerLeg),
    rightFoot:     get(VRMHumanBoneName.RightFoot),
  };
}

/**
 * Dump a full side-by-side comparison of performer landmarks vs avatar
 * skeleton to the console. Useful for debugging scale / calibration bugs
 * (e.g. "performer skeleton shoulders look too wide").
 */
export function dumpSkeleton(params: {
  vrm: VRM;
  cal: MocapCalibration;
  frame: PoseFrame | null;
  debugTargets: MocapDebugTargets;
}): void {
  const { vrm, cal, frame, debugTargets } = params;
  const calMe = cal.performerMeasurements();

  console.group('%cSkeleton dump', 'color:#6186ff;font-weight:bold');

  if (!frame) {
    console.warn('No mocap frame available — start camera first.');
    console.groupEnd();
    return;
  }

  // ── Performer measurements (raw MediaPipe world meters) ────────────────
  const lms = frame.worldLandmarks;
  const dist = (a: PoseFrame['worldLandmarks'][number] | undefined, b: PoseFrame['worldLandmarks'][number] | undefined): number => {
    if (!a || !b) return NaN;
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
  };
  const vis = (l: PoseFrame['worldLandmarks'][number] | undefined): string =>
    l?.visibility != null ? `${(l.visibility*100).toFixed(0)}%` : '?';

  const ls = lms[11], rs = lms[12];           // shoulders
  const lh = lms[23], rh = lms[24];           // hips
  const lw = lms[15], rw = lms[16];           // wrists
  const le = lms[13], re = lms[14];           // elbows
  const lk = lms[25], rk = lms[26];           // knees
  const la = lms[27], ra = lms[28];           // ankles

  console.group('%cPerformer (raw MP meters)', 'color:#00ff88');
  console.table({
    'Shoulder width':  { value: dist(ls, rs).toFixed(3), vis: `${vis(ls)}/${vis(rs)}` },
    'Hip width':       { value: dist(lh, rh).toFixed(3), vis: `${vis(lh)}/${vis(rh)}` },
    'Left upper arm':  { value: dist(ls, le).toFixed(3), vis: `${vis(ls)}/${vis(le)}` },
    'Left lower arm':  { value: dist(le, lw).toFixed(3), vis: `${vis(le)}/${vis(lw)}` },
    'Right upper arm': { value: dist(rs, re).toFixed(3), vis: `${vis(rs)}/${vis(re)}` },
    'Right lower arm': { value: dist(re, rw).toFixed(3), vis: `${vis(re)}/${vis(rw)}` },
    'Left upper leg':  { value: dist(lh, lk).toFixed(3), vis: `${vis(lh)}/${vis(lk)}` },
    'Left lower leg':  { value: dist(lk, la).toFixed(3), vis: `${vis(lk)}/${vis(la)}` },
    'Right upper leg': { value: dist(rh, rk).toFixed(3), vis: `${vis(rh)}/${vis(rk)}` },
    'Right lower leg': { value: dist(rk, ra).toFixed(3), vis: `${vis(rk)}/${vis(ra)}` },
  });
  const leftWristArmMax = cal.unifyArmMax
    ? Math.max(calMe.leftArmMax, calMe.rightArmMax)
    : calMe.rightArmMax;
  const rightWristArmMax = cal.unifyArmMax
    ? Math.max(calMe.leftArmMax, calMe.rightArmMax)
    : calMe.leftArmMax;
  console.log('Shoulder→Wrist L (max accum):', leftWristArmMax ? leftWristArmMax.toFixed(3) : 'n/a');
  console.log('Shoulder→Wrist R (max accum):', rightWristArmMax ? rightWristArmMax.toFixed(3) : 'n/a');
  console.groupEnd();

  // ── Avatar measurements (rest-pose bone lengths) ───────────────────────
  const boneWorld = (name: VRMHumanBoneName): THREE.Vector3 => getNormBoneWorldPosition(vrm, name);

  const avatarShoulderW = boneWorld(VRMHumanBoneName.LeftUpperArm).distanceTo(boneWorld(VRMHumanBoneName.RightUpperArm));
  const avatarHipW      = boneWorld(VRMHumanBoneName.LeftUpperLeg).distanceTo(boneWorld(VRMHumanBoneName.RightUpperLeg));
  console.group('%cAvatar (rest-pose world meters)', 'color:#fbbf24');
  console.table({
    'Shoulder width':  { value: avatarShoulderW.toFixed(3) },
    'Hip width':       { value: avatarHipW.toFixed(3) },
    'L upper arm':     { value: cal.avatarLeftUpperArm.toFixed(3) },
    'L lower arm':     { value: cal.avatarLeftLowerArm.toFixed(3) },
    'R upper arm':     { value: cal.avatarRightUpperArm.toFixed(3) },
    'R lower arm':     { value: cal.avatarRightLowerArm.toFixed(3) },
    'L upper leg':     { value: cal.avatarLeftUpperLeg.toFixed(3) },
    'L lower leg':     { value: cal.avatarLeftLowerLeg.toFixed(3) },
    'R upper leg':     { value: cal.avatarRightUpperLeg.toFixed(3) },
    'R lower leg':     { value: cal.avatarRightLowerLeg.toFixed(3) },
  });
  console.groupEnd();

  // ── Calibration state ──────────────────────────────────────────────────
  const st = cal.status();
  console.group('%cCalibration', 'color:#c084fc');
  console.table({
    'Calibrated':          { value: st.calibrated },
    'Body scale':          { value: `${(st.bodyScale*100).toFixed(1)}%` },
    'Shoulder scale':      { value: `${(st.shoulderWidthScale*100).toFixed(1)}%` },
    'Arm L scale':         { value: `${(st.leftArmScale*100).toFixed(1)}%` },
    'Arm R scale':         { value: `${(st.rightArmScale*100).toFixed(1)}%` },
    'Leg scale':           { value: `${(cal.legScale()*100).toFixed(1)}%` },
    'Unify arm max':       { value: cal.unifyArmMax },
    'Hip vis gate':        { value: cal.hipVisGate.toFixed(2) },
  });
  console.log('Readiness:', cal.readiness());
  console.groupEnd();

  // ── Ratios: avatar / performer ─────────────────────────────────────────
  const refs = cal.refRatios();
  console.group('%cRatios avatar/performer (all references)', 'color:#f87171');
  console.table({
    'Shoulder ratio': { value: refs.shoulder?.toFixed(3) ?? 'n/a' },
    'Hip ratio':      { value: refs.hip?.toFixed(3)      ?? 'n/a' },
    'Head ratio':     { value: refs.head?.toFixed(3)     ?? 'n/a' },
    'Active ref':     { value: cal.scaleRef },
    'bodyScale used': { value: (cal.bodyScale() * 100).toFixed(1) + '%' },
  });
  console.groupEnd();

  // ── IK target vs actual bone ───────────────────────────────────────────
  const dt = debugTargets;
  const actual = getActualBonePositions(vrm);
  const reach  = getReachPercent(vrm, cal, dt);
  console.group('%cIK targets & reach', 'color:#93b4ff');
  console.table({
    'L wrist target':  { pos: dt.leftWristTarget.toArray().map((v) => v.toFixed(3)).join(', '), reach: `${reach.armL.toFixed(0)}%` },
    'L hand actual':   { pos: actual.leftHand.toArray().map((v) => v.toFixed(3)).join(', '), reach: '' },
    'R wrist target':  { pos: dt.rightWristTarget.toArray().map((v) => v.toFixed(3)).join(', '), reach: `${reach.armR.toFixed(0)}%` },
    'R hand actual':   { pos: actual.rightHand.toArray().map((v) => v.toFixed(3)).join(', '), reach: '' },
    'L ankle target':  { pos: dt.leftAnkleTarget.toArray().map((v) => v.toFixed(3)).join(', '), reach: `${reach.legL.toFixed(0)}%` },
    'L foot actual':   { pos: actual.leftFoot.toArray().map((v) => v.toFixed(3)).join(', '), reach: '' },
    'R ankle target':  { pos: dt.rightAnkleTarget.toArray().map((v) => v.toFixed(3)).join(', '), reach: `${reach.legR.toFixed(0)}%` },
    'R foot actual':   { pos: actual.rightFoot.toArray().map((v) => v.toFixed(3)).join(', '), reach: '' },
  });
  console.groupEnd();

  console.groupEnd();
}

/**
 * Returns a multi-section diagnostic string covering:
 * - VRM normalized bone offsets (used as BVH OFFSET values)
 * - Humanoid rest-axis corrections (rawAxis vs normalizedAxis per bone)
 * - Current-pose 1-frame BVH text
 * Intended for the debug diagnostic modal.
 */
export function buildBvhDiagnosticText(params: {
  vrm: VRM;
  state: string;
  getJointOffset: (name: string) => [number, number, number] | null;
  getApplierRestAxis: (name: string) => THREE.Vector3 | null;
  captureCurrentPoseBvh: () => string;
}): string {
  const { vrm, state, getJointOffset, getApplierRestAxis, captureCurrentPoseBvh } = params;
  const lines: string[] = ['=== BVH Diagnostic ===', `Timestamp: ${new Date().toISOString()}`, ''];

  // ── Joint offsets ────────────────────────────────────────────────────────
  lines.push('--- Joint offsets (BVH HIERARCHY OFFSET, metres) ---');
  const boneNames = Object.keys(vrm.humanoid.humanBones);
  for (const name of boneNames) {
    const offset = getJointOffset(name);
    if (offset) {
      lines.push(`  ${name.padEnd(30)} [${offset.map((v) => v.toFixed(5)).join(', ')}]`);
    } else {
      lines.push(`  ${name.padEnd(30)} (not in humanoid)`);
    }
  }

  // ── Applier rest axes (what the mocap pipeline actually uses) ────────────
  lines.push('', '--- Applier restLocalAxis + per-bone BVH correction ---');
  lines.push('  applier uses rawAxis; BVH export pre-multiplies by corrInv to produce T-pose-relative output');
  const axes = getCachedHumanoidRestAxes(vrm);
  for (const [bone, info] of axes) {
    const corrAngleDeg = THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(info.correction.w))));
    const na = info.normalizedAxis;
    const ra = info.rawAxis;
    const applierAxis = getApplierRestAxis(bone);
    const matchesRaw = applierAxis
      ? Math.abs(applierAxis.dot(ra) - 1) < 0.001
      : false;
    lines.push(`  ${bone.padEnd(20)} restAxis=[${(applierAxis?.x ?? NaN).toFixed(4)}, ${(applierAxis?.y ?? NaN).toFixed(4)}, ${(applierAxis?.z ?? NaN).toFixed(4)}]  normAxis=[${na.x.toFixed(4)}, ${na.y.toFixed(4)}, ${na.z.toFixed(4)}]  rawAxis=[${ra.x.toFixed(4)}, ${ra.y.toFixed(4)}, ${ra.z.toFixed(4)}]  corrAngle=${corrAngleDeg.toFixed(1)}°  useRaw=${matchesRaw}`);
  }

  // ── Current pose BVH (1 frame) ───────────────────────────────────────────
  lines.push('', `--- Current pose BVH (1 frame) [mocap state: ${state}] ---`);
  lines.push('  NOTE: bone values here reflect CURRENT node.quaternion (idle anim when camera off).');
  lines.push('  To verify BVH fix: enable camera, stand in T-pose, then re-open this modal.');
  try {
    lines.push(captureCurrentPoseBvh());
  } catch (e) {
    lines.push(`ERROR: ${(e as Error).message}`);
  }

  return lines.join('\n');
}
