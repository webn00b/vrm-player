import type { AnimationController } from './animationController';
import type { PriorityAnimator } from './priorityAnimator';
import type { MicroAnimations } from './microAnimations';
import type { IdleLoop } from './idleLoop';
import type { MocapController } from './mocap/pipeline/mocapController';
import type { MocapDebugViz } from './mocap/diagnostics/mocapDebugViz';
import type { MocapDebugRecorder } from './mocap/diagnostics/mocapDebugRecorder';
import type { FaceTrackPlayer } from './mocap/bvh/faceTrack';
import type { SkeletonVisualizer } from './skeletonVisualizer';
import type { BoneValidator } from './validation/boneValidator';
import type { PoseValidator } from './validation/poseValidator';
import type { BonePosePanel } from './bonePosePanel';
import type { BoneDragController } from './boneDragController';
import type { HipForceTracker } from './physics/hipForce';
import type { HipBalanceCorrector } from './physics/hipBalanceCorrector';
import type { HipCompensator } from './physics/hipCompensation';
import type { SkeletonLogger } from './diagnostics/skeletonLogger';
import type { MotionTraceRecorder } from './diagnostics/motionTraceRecorder';

export interface PlaybackSystems {
  controller: AnimationController | null;
  pa: PriorityAnimator;
  micro: MicroAnimations;
  idle: IdleLoop;
}

export interface MocapSystems {
  mocap: MocapController;
  debugViz: MocapDebugViz;
  dbgRecorder: MocapDebugRecorder;
  faceTrackPlayer: FaceTrackPlayer;
}

export interface ToolingSystems {
  skelViz: SkeletonVisualizer;
  validator: BoneValidator;
  poseValidator: PoseValidator;
  bonePanel: BonePosePanel;
  boneDrag: BoneDragController;
  hipForce: HipForceTracker;
  hipBalance: HipBalanceCorrector;
  hipCompensator: HipCompensator;
  skeletonLogger: SkeletonLogger;
  motionTraceRecorder: MotionTraceRecorder;
}
