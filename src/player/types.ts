import type * as THREE from 'three';
import type { createApp } from 'vue';
import type { AnimationController, QueueLoopMode } from '../animationController';
import type { ManualFbxBoneMapping } from '../animationLoaders/fbxBoneMapping';
import type { ParsedBVH } from '../bvhLoader';
import type { PlaybackSystems, MocapSystems, ToolingSystems } from '../playerSystems';
import type { QuaternionCorrection } from '../retargetCorrections';
import type { createScene } from '../scene';
import type { loadVRM } from '../vrmLoader';
import type { CleanupFn } from './cleanup';

export type { CleanupFn };

export interface PlayerModule {
  readonly name: string;
  setup(ctx: PlayerContext): void | CleanupFn | Promise<void | CleanupFn>;
}

export interface PlayerRoots {
  app: HTMLElement;
  shell: HTMLElement;
}

export interface PlayerOptions {
  selectedVrmUrl: string | null;
  selectedVrmName: string;
  onVrmFileSelected(file: File): void;
}

export interface QueueHandle {
  push(name: string, duration?: number): void;
  remove(qi: number): void;
  setActive(qi: number): void;
  reorder(from: number, to: number): void;
  clear(): void;
}

export interface AnimationLoadResult {
  ok: boolean;
  fileName: string;
  name?: string;
  error?: string;
}

export interface AnimationBridge {
  readonly names: string[];
  readonly bvhByIndex: Map<number, ParsedBVH>;
  readonly sourceFileByIndex: Map<number, File>;
  queue: QueueHandle | null;
  reexportQueue: QueueHandle | null;
  registerAndEnqueue(name: string, bvh: ParsedBVH | null, clip: THREE.AnimationClip, sourceFile?: File): number;
  loadAnimationIntoQueue(
    file: File,
    manualFbxMapping?: ManualFbxBoneMapping,
    quaternionCorrections?: QuaternionCorrection[],
    options?: { statusLabel?: string; toast?: boolean },
  ): Promise<AnimationLoadResult>;
  handleAnimationFile(
    file: File,
    manualFbxMapping?: ManualFbxBoneMapping,
    quaternionCorrections?: QuaternionCorrection[],
  ): Promise<void>;
  handleAnimationFiles(files: File[]): Promise<void>;
  previewRetargetFile(
    file: File,
    manualFbxMapping?: ManualFbxBoneMapping,
    quaternionCorrections?: QuaternionCorrection[],
    corrected?: boolean,
  ): Promise<{ name: string; duration: number }>;
  openQueueItemInRetargetLab(queueIndex: number, navigate: boolean): boolean;
}

export interface PlayerContext {
  roots: PlayerRoots;
  options: PlayerOptions;
  scene?: ReturnType<typeof createScene>;
  shellApp?: ReturnType<typeof createApp>;
  vrm?: Awaited<ReturnType<typeof loadVRM>>;
  playback?: PlaybackSystems;
  mocap?: MocapSystems;
  tooling?: ToolingSystems;
  animation?: AnimationBridge;
  queueLoopMode?: QueueLoopMode;
}

export interface PlayerApp {
  readonly ctx: PlayerContext;
  dispose(): void;
}
