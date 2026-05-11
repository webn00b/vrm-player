import type { AnimationController } from './animationController';
import type { PriorityAnimator } from './priorityAnimator';
import type { MicroAnimations } from './microAnimations';
import type { IdleLoop } from './idleLoop';
import type { MocapController } from './mocap/pipeline/mocapController';
import type { MocapDebugViz } from './mocap/diagnostics/mocapDebugViz';
import type { MocapDebugRecorder } from './mocap/diagnostics/mocapDebugRecorder';
import type { SkeletonVisualizer } from './skeletonVisualizer';
import type { BoneValidator } from './validation/boneValidator';
import type { BonePosePanel } from './bonePosePanel';
import type { BoneDragController } from './boneDragController';
import type { HipForceTracker } from './physics/hipForce';
import type { HipBalanceCorrector } from './physics/hipBalanceCorrector';
import type { SkeletonLogger } from './diagnostics/skeletonLogger';

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
}

export interface ToolingSystems {
  skelViz: SkeletonVisualizer;
  validator: BoneValidator;
  bonePanel: BonePosePanel;
  boneDrag: BoneDragController;
  hipForce: HipForceTracker;
  hipBalance: HipBalanceCorrector;
  skeletonLogger: SkeletonLogger;
}
