import * as THREE from 'three';
import type { ArmSolverDiagnostics } from '../mocap/diagnostics/mocapDiagnostics';
import type { MocapController } from '../mocap/pipeline/mocapController';

export type AvatarJointPositions = ReturnType<MocapController['getAvatarJointPositions']>;
export type LimbScales = { armL: number; armR: number; legL: number; legR: number };
export type ArmSide = 'left' | 'right';
export type ArmDebugTargets = {
  elbowTarget: THREE.Vector3 | null;
  poleRaw: THREE.Vector3 | null;
  poleSmoothed: THREE.Vector3 | null;
} & ArmSolverDiagnostics;
