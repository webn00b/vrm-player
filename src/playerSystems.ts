import type { AnimationController } from './animationController';
import type { PriorityAnimator } from './priorityAnimator';
import type { MicroAnimations } from './microAnimations';
import type { IdleLoop } from './idleLoop';
import type { MocapController } from './mocap/mocapController';
import type { MocapDebugViz } from './mocap/mocapDebugViz';
import type { MocapDebugRecorder } from './mocap/mocapDebugRecorder';
import type { SkeletonVisualizer } from './skeletonVisualizer';
import type { BoneValidator } from './validation/boneValidator';
import type { BonePosePanel } from './bonePosePanel';
import type { BoneDragController } from './boneDragController';
import type { HipForceTracker } from './physics/hipForce';

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
}
