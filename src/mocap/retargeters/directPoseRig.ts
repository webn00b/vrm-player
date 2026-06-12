import type * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { MocapCalibration } from '../trackers/mocapCalibration';
import type { BoneTracker } from '../trackers/boneTrackState';
import type { MocapDebugTargets } from '../diagnostics/mocapDiagnostics';
import type { DirectPoseSettings } from './directPoseSettings';

/**
 * Shared mutable state of the direct pose pipeline, owned by DirectPoseApplier
 * and handed by reference to the per-region appliers (torso / arm IK / leg IK).
 *
 * `now` is captured once per apply() call so all bone updates within a frame
 * see the same time (otherwise FRESH/DECAYING thresholds would drift across
 * the per-bone iteration). `calibration` may be late-bound via setCalibration.
 */
export interface DirectPoseRig {
  vrm: VRM;
  nodeCache: Map<string, THREE.Object3D>;
  restLocalAxis: Map<string, THREE.Vector3>;
  boneTracker: BoneTracker;
  debugTargets: MocapDebugTargets;
  settings: DirectPoseSettings;
  calibration: MocapCalibration | null;
  now: number;
}
