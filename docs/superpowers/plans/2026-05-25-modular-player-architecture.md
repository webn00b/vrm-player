# Modular Player Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the VRM player startup into focused, architecturally independent modules while preserving current runtime behavior.

**Architecture:** Add a lightweight static module composition layer under `src/player/`. `main.ts` remains the app entry and restart owner; modules own setup/cleanup for scene, VRM, playback, tooling, mocap, UI, input, debug, and render loop. Each module file begins with a short ownership comment.

**Tech Stack:** TypeScript, Vite, Vue 3, Three.js, @pixiv/three-vrm, Vitest, Madge, Playwright.

---

## File Structure

- Create `src/player/types.ts`: shared `CleanupFn`, `PlayerModule`, `PlayerContext`, queue and animation bridge types.
- Create `src/player/cleanup.ts`: reverse-order cleanup registry with unit coverage.
- Create `src/player/bootstrap.ts`: runs modules in order and disposes partially initialized modules on setup failure.
- Create `src/player/assertions.ts`: small typed dependency assertions for module setup.
- Create `src/player/modules/coreSceneModule.ts`: creates and disposes the Three.js scene.
- Create `src/player/modules/shellModule.ts`: mounts `PlayerShell`.
- Create `src/player/modules/vrmModule.ts`: resolves/loads the VRM and adds it to the scene.
- Create `src/player/modules/playbackModule.ts`: creates `AnimationController`, `PriorityAnimator`, `MicroAnimations`, and `IdleLoop`.
- Create `src/player/modules/toolingModule.ts`: creates validator, skeleton visualizer, bone pose panel, drag controller, hip diagnostics, skeleton logger, and motion trace recorder.
- Create `src/player/modules/mocapModule.ts`: creates mocap controller, mocap debug viz, debug recorder, and recorded-BVH replay callback.
- Create `src/player/modules/animationImportModule.ts`: owns animation loading, queue registration, source file caches, batch import, and retarget preview.
- Create `src/player/modules/playerUiModule.ts`: mounts bottom bar, scene toolbar, start panel, queue panel, re-export panel, and retarget lab.
- Create `src/player/modules/debugModule.ts`: mounts debug panel.
- Create `src/player/modules/inputModule.ts`: owns keyboard shortcuts, drag/drop animation import, VRM-file event handling, and page-change bridge.
- Create `src/player/modules/renderLoopModule.ts`: starts `startRenderLoop`.
- Modify `src/main.ts`: slim entry point that builds `PlayerContext`, runs modules, owns restart when a new VRM file is selected, and reports startup errors.
- Modify `src/playerSystems.ts` only if type exports need to move; prefer leaving it as the domain system shape file.
- Test with `src/player/cleanup.test.ts` and `src/player/bootstrap.test.ts`.

## Module Header Rule

Every file under `src/player/modules/` must start with this pattern:

```ts
/**
 * Owns <one subsystem> setup for the player bootstrap.
 * Keeps <important boundary> out of main.ts and cleans up everything it registers.
 */
```

Adjust the words per file, but keep the first comment short and specific.

### Task 1: Add Cleanup Registry

**Files:**
- Create: `src/player/cleanup.ts`
- Create: `src/player/cleanup.test.ts`

- [ ] **Step 1: Write cleanup tests**

```ts
// src/player/cleanup.test.ts
import { test, expect } from 'vitest';
import { createCleanupRegistry } from './cleanup';

test('cleanup registry disposes callbacks in reverse order', () => {
  const calls: string[] = [];
  const cleanup = createCleanupRegistry();

  cleanup.add(() => calls.push('first'));
  cleanup.add(() => calls.push('second'));
  cleanup.dispose();

  expect(calls).toEqual(['second', 'first']);
});

test('cleanup registry runs each callback only once', () => {
  let calls = 0;
  const cleanup = createCleanupRegistry();

  cleanup.add(() => { calls += 1; });
  cleanup.dispose();
  cleanup.dispose();

  expect(calls).toBe(1);
});

test('cleanup registry aggregates cleanup failures', () => {
  const cleanup = createCleanupRegistry();

  cleanup.add(() => { throw new Error('first failure'); });
  cleanup.add(() => { throw new Error('second failure'); });

  expect(() => cleanup.dispose()).toThrow(AggregateError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/player/cleanup.test.ts`

Expected: FAIL because `src/player/cleanup.ts` does not exist.

- [ ] **Step 3: Implement cleanup registry**

```ts
// src/player/cleanup.ts
export type CleanupFn = () => void;

export interface CleanupRegistry {
  add(cleanup: CleanupFn | undefined | null): void;
  dispose(): void;
}

export function createCleanupRegistry(): CleanupRegistry {
  const callbacks: CleanupFn[] = [];
  let disposed = false;

  return {
    add(cleanup) {
      if (!cleanup) return;
      if (disposed) {
        cleanup();
        return;
      }
      callbacks.push(cleanup);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      for (let i = callbacks.length - 1; i >= 0; i -= 1) {
        try {
          callbacks[i]();
        } catch (error) {
          errors.push(error);
        }
      }
      callbacks.length = 0;
      if (errors.length > 0) {
        throw new AggregateError(errors, 'Player cleanup failed');
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/player/cleanup.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/player/cleanup.ts src/player/cleanup.test.ts
git commit -m "Add player cleanup registry"
```

### Task 2: Add Module Bootstrap Foundation

**Files:**
- Create: `src/player/types.ts`
- Create: `src/player/bootstrap.ts`
- Create: `src/player/assertions.ts`
- Create: `src/player/bootstrap.test.ts`

- [ ] **Step 1: Write bootstrap tests**

```ts
// src/player/bootstrap.test.ts
import { test, expect } from 'vitest';
import { runPlayerModules } from './bootstrap';
import type { PlayerContext, PlayerModule } from './types';

function createContext(): PlayerContext {
  return {
    roots: {
      app: {} as HTMLElement,
      shell: {} as HTMLElement,
    },
    options: {
      selectedVrmUrl: null,
      selectedVrmName: '',
      onVrmFileSelected: () => {},
    },
  };
}

test('runPlayerModules runs modules in order and cleanup in reverse order', async () => {
  const calls: string[] = [];
  const modules: PlayerModule[] = [
    { name: 'a', setup: () => { calls.push('setup-a'); return () => calls.push('cleanup-a'); } },
    { name: 'b', setup: () => { calls.push('setup-b'); return () => calls.push('cleanup-b'); } },
  ];

  const app = await runPlayerModules(createContext(), modules);
  app.dispose();

  expect(calls).toEqual(['setup-a', 'setup-b', 'cleanup-b', 'cleanup-a']);
});

test('runPlayerModules disposes initialized modules when a later module fails', async () => {
  const calls: string[] = [];
  const modules: PlayerModule[] = [
    { name: 'a', setup: () => { calls.push('setup-a'); return () => calls.push('cleanup-a'); } },
    { name: 'b', setup: () => { throw new Error('boom'); } },
  ];

  await expect(runPlayerModules(createContext(), modules)).rejects.toThrow('boom');
  expect(calls).toEqual(['setup-a', 'cleanup-a']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/player/bootstrap.test.ts`

Expected: FAIL because bootstrap files do not exist.

- [ ] **Step 3: Implement shared types**

```ts
// src/player/types.ts
import type * as THREE from 'three';
import type { createApp } from 'vue';
import type { createScene } from '../scene';
import type { loadVRM } from '../vrmLoader';
import type { ParsedBVH } from '../bvhLoader';
import type { AnimationController, QueueLoopMode } from '../animationController';
import type { PlaybackSystems, MocapSystems, ToolingSystems } from '../playerSystems';
import type { ManualFbxBoneMapping } from '../animationLoaders/fbxBoneMapping';
import type { QuaternionCorrection } from '../retargetCorrections';
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
```

- [ ] **Step 4: Implement assertions**

```ts
// src/player/assertions.ts
import type { PlayerContext } from './types';

export function requireScene(ctx: PlayerContext): NonNullable<PlayerContext['scene']> {
  if (!ctx.scene) throw new Error('Player scene is required before this module runs');
  return ctx.scene;
}

export function requireVrm(ctx: PlayerContext): NonNullable<PlayerContext['vrm']> {
  if (!ctx.vrm) throw new Error('Player VRM is required before this module runs');
  return ctx.vrm;
}

export function requirePlayback(ctx: PlayerContext): NonNullable<PlayerContext['playback']> {
  if (!ctx.playback) throw new Error('Player playback systems are required before this module runs');
  return ctx.playback;
}

export function requireMocap(ctx: PlayerContext): NonNullable<PlayerContext['mocap']> {
  if (!ctx.mocap) throw new Error('Player mocap systems are required before this module runs');
  return ctx.mocap;
}

export function requireTooling(ctx: PlayerContext): NonNullable<PlayerContext['tooling']> {
  if (!ctx.tooling) throw new Error('Player tooling systems are required before this module runs');
  return ctx.tooling;
}

export function requireAnimation(ctx: PlayerContext): NonNullable<PlayerContext['animation']> {
  if (!ctx.animation) throw new Error('Player animation bridge is required before this module runs');
  return ctx.animation;
}
```

- [ ] **Step 5: Implement bootstrap**

```ts
// src/player/bootstrap.ts
import { createCleanupRegistry } from './cleanup';
import type { PlayerApp, PlayerContext, PlayerModule } from './types';

export async function runPlayerModules(
  ctx: PlayerContext,
  modules: readonly PlayerModule[],
): Promise<PlayerApp> {
  const cleanup = createCleanupRegistry();

  try {
    for (const module of modules) {
      const moduleCleanup = await module.setup(ctx);
      cleanup.add(moduleCleanup);
    }
  } catch (error) {
    cleanup.dispose();
    throw error;
  }

  return {
    ctx,
    dispose: () => cleanup.dispose(),
  };
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/player/cleanup.test.ts src/player/bootstrap.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/player/types.ts src/player/bootstrap.ts src/player/assertions.ts src/player/bootstrap.test.ts
git commit -m "Add player module bootstrap"
```

### Task 3: Extract Core Scene, Shell, VRM, Playback, And Tooling Modules

**Files:**
- Create: `src/player/modules/coreSceneModule.ts`
- Create: `src/player/modules/shellModule.ts`
- Create: `src/player/modules/vrmModule.ts`
- Create: `src/player/modules/playbackModule.ts`
- Create: `src/player/modules/toolingModule.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Create `coreSceneModule`**

```ts
/**
 * Owns Three.js scene creation for the player bootstrap.
 * Keeps renderer/camera/control disposal out of main.ts.
 */
import { createScene } from '../../scene';
import type { PlayerModule } from '../types';

export const coreSceneModule: PlayerModule = {
  name: 'coreScene',
  setup(ctx) {
    ctx.scene = createScene(ctx.roots.app);
    return () => ctx.scene?.dispose();
  },
};
```

- [ ] **Step 2: Create `shellModule`**

```ts
/**
 * Owns the top-level Vue shell mount for the player bootstrap.
 * Keeps PrimeVue installation and shell unmounting out of main.ts.
 */
import { createApp } from 'vue';
import PlayerShell from '../../playerVue/PlayerShell.vue';
import { installPrimeVueOn } from '../../playerVue/plugin';
import type { PlayerModule } from '../types';

export const shellModule: PlayerModule = {
  name: 'shell',
  setup(ctx) {
    const app = createApp(PlayerShell);
    installPrimeVueOn(app);
    app.mount(ctx.roots.shell);
    ctx.shellApp = app;
    return () => app.unmount();
  },
};
```

- [ ] **Step 3: Create `vrmModule`**

```ts
/**
 * Owns VRM URL resolution, loading, and scene attachment for the player bootstrap.
 * Keeps avatar selection details out of unrelated playback and UI modules.
 */
import { loadVRM } from '../../vrmLoader';
import { notify, setStatus } from '../../ui';
import { requireScene } from '../assertions';
import type { PlayerModule } from '../types';

async function resolveVrmUrl(selectedVrmUrl: string | null): Promise<string> {
  if (selectedVrmUrl) return selectedVrmUrl;
  const res = await fetch('/models/index.json', { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(
      `models/index.json not found (HTTP ${res.status}). ` +
      `Add a JSON array of .vrm filenames to public/models/index.json ` +
      `and place the .vrm files in public/models/ locally / ` +
      `/var/www/<site>/models/ on the server.`,
    );
  }
  const list = await res.json() as string[];
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('models/index.json is empty - add at least one .vrm filename');
  }
  return `/models/${[...list].sort()[0]}`;
}

export const vrmModule: PlayerModule = {
  name: 'vrm',
  async setup(ctx) {
    const scene = requireScene(ctx);
    setStatus('loading VRM...');
    const vrm = await loadVRM(await resolveVrmUrl(ctx.options.selectedVrmUrl));
    if (ctx.options.selectedVrmName) {
      notify({ severity: 'success', summary: 'VRM loaded', detail: ctx.options.selectedVrmName });
    }
    scene.scene.add(vrm.scene);
    ctx.vrm = vrm;
    return () => {
      vrm.scene.parent?.remove(vrm.scene);
    };
  },
};
```

- [ ] **Step 4: Create `playbackModule`**

```ts
/**
 * Owns playback system construction for the player bootstrap.
 * Keeps animation controller and procedural animation setup independent from UI mounts.
 */
import { AnimationController, type QueueLoopMode } from '../../animationController';
import { IdleLoop } from '../../idleLoop';
import { MicroAnimations } from '../../microAnimations';
import { PriorityAnimator } from '../../priorityAnimator';
import { requireVrm } from '../assertions';
import type { PlayerModule } from '../types';

const QUEUE_LOOP_KEY = 'vrm-player.queue-loop-mode';

function readQueueLoopMode(): QueueLoopMode {
  try {
    return localStorage.getItem(QUEUE_LOOP_KEY) === 'one' ? 'one' : 'queue';
  } catch {
    return 'queue';
  }
}

export function writeQueueLoopMode(mode: QueueLoopMode): void {
  try {
    localStorage.setItem(QUEUE_LOOP_KEY, mode);
  } catch {
    /* ignore */
  }
}

export const playbackModule: PlayerModule = {
  name: 'playback',
  setup(ctx) {
    const vrm = requireVrm(ctx);
    const controller = new AnimationController(vrm);
    const loopMode = readQueueLoopMode();
    controller.setLoopMode(loopMode);
    ctx.queueLoopMode = loopMode;
    ctx.playback = {
      controller,
      pa: new PriorityAnimator(vrm),
      micro: new MicroAnimations(),
      idle: new IdleLoop(),
    };
  },
};
```

- [ ] **Step 5: Create `toolingModule`**

```ts
/**
 * Owns player tooling and diagnostics construction for the player bootstrap.
 * Keeps validators, overlays, recorders, and debug globals in one cleanup boundary.
 */
import { BoneDragController } from '../../boneDragController';
import { BonePosePanel } from '../../bonePosePanel';
import { createSkeletonLogger } from '../../diagnostics/skeletonLogger';
import { MotionTraceRecorder } from '../../diagnostics/motionTraceRecorder';
import { HipBalanceCorrector } from '../../physics/hipBalanceCorrector';
import { HipForceTracker } from '../../physics/hipForce';
import { renderLoopHooks } from '../../renderLoopHooks';
import { SkeletonVisualizer } from '../../skeletonVisualizer';
import { BoneValidator } from '../../validation/boneValidator';
import { sceneControlsState } from '../../playerVue/sceneControlsState';
import { requirePlayback, requireScene, requireVrm } from '../assertions';
import type { PlayerModule } from '../types';

declare global {
  interface Window {
    __skelLog?: ReturnType<typeof createSkeletonLogger>;
    __motionTrace?: MotionTraceRecorder;
  }
}

const VIEWPORT_COMPACT_KEY = 'vrm-player.viewport-compact';

export const toolingModule: PlayerModule = {
  name: 'tooling',
  setup(ctx) {
    const scene = requireScene(ctx);
    const vrm = requireVrm(ctx);
    const playback = requirePlayback(ctx);
    const validator = new BoneValidator(vrm);
    const skelViz = new SkeletonVisualizer(vrm, scene.scene);
    const bonePanel = new BonePosePanel(vrm);
    const boneDrag = new BoneDragController(vrm, scene.scene, scene.camera, scene.renderer.domElement, scene.controls);
    const hipForce = new HipForceTracker(vrm, { isPaused: () => !!playback.controller?.paused });
    const hipBalance = new HipBalanceCorrector(vrm);
    const skeletonLogger = createSkeletonLogger(vrm, validator);
    const motionTraceRecorder = new MotionTraceRecorder(vrm);

    const forceSkeletonVisibleForCompact = (): void => {
      sceneControlsState.skeletonOn = true;
      sceneControlsState.skelBodyOn = true;
      sceneControlsState.skelFingersOn = true;
      skelViz.setVisible(true);
      skelViz.setShowBody(true);
      skelViz.setShowFingers(true);
    };

    try {
      if (localStorage.getItem(VIEWPORT_COMPACT_KEY) === '1') forceSkeletonVisibleForCompact();
    } catch {
      /* ignore */
    }

    const onViewportCompactChanged = (event: Event): void => {
      if (!!(event as CustomEvent<boolean>).detail) forceSkeletonVisibleForCompact();
    };
    window.addEventListener('vrm-player:viewport-compact-changed', onViewportCompactChanged);

    renderLoopHooks.skeletonLoggerTick = () => skeletonLogger.tick();
    renderLoopHooks.motionTraceCaptureSink = () => motionTraceRecorder.capture();
    window.__skelLog = skeletonLogger;
    window.__motionTrace = motionTraceRecorder;

    ctx.tooling = {
      skelViz,
      validator,
      bonePanel,
      boneDrag,
      hipForce,
      hipBalance,
      skeletonLogger,
      motionTraceRecorder,
    };

    return () => {
      window.removeEventListener('vrm-player:viewport-compact-changed', onViewportCompactChanged);
      renderLoopHooks.skeletonLoggerTick = null;
      renderLoopHooks.motionTraceCaptureSink = null;
      if (window.__motionTrace?.active) window.__motionTrace.stop();
      if (window.__motionTrace === motionTraceRecorder) delete window.__motionTrace;
      if (window.__skelLog === skeletonLogger) delete window.__skelLog;
      skelViz.dispose();
      boneDrag.dispose();
    };
  },
};
```

- [ ] **Step 6: Wire these modules temporarily in `main.ts`**

Keep the existing remaining code in `main.ts`, but remove duplicated setup for scene, shell, VRM, playback, and tooling. Add imports:

```ts
import { runPlayerModules } from './player/bootstrap';
import type { PlayerApp, PlayerContext } from './player/types';
import { coreSceneModule } from './player/modules/coreSceneModule';
import { shellModule } from './player/modules/shellModule';
import { vrmModule } from './player/modules/vrmModule';
import { playbackModule } from './player/modules/playbackModule';
import { toolingModule } from './player/modules/toolingModule';
```

Create context before the remaining legacy setup:

```ts
const ctx: PlayerContext = {
  roots: { app: container, shell: shellHost },
  options: { selectedVrmUrl, selectedVrmName, onVrmFileSelected },
};
const app = await runPlayerModules(ctx, [
  coreSceneModule,
  shellModule,
  vrmModule,
  playbackModule,
  toolingModule,
]);
```

Then reuse:

```ts
const scene = ctx.scene!;
const vrm = ctx.vrm!;
const playback = ctx.playback!;
const tooling = ctx.tooling!;
```

Do not start the render loop through modules yet.

- [ ] **Step 7: Verify**

Run: `npm run build`

Expected: PASS.

Run: `npm run test:circular`

Expected: PASS with no circular dependency output.

- [ ] **Step 8: Commit**

```bash
git add src/main.ts src/player
git commit -m "Extract core player startup modules"
```

### Task 4: Extract Mocap And Animation Import Bridges

**Files:**
- Create: `src/player/modules/mocapModule.ts`
- Create: `src/player/modules/animationImportModule.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Create `mocapModule`**

Move the current `MocapDebugViz`, `MocapDebugRecorder`, `MocapController`, and `mocap.onBvhReady` setup from `main.ts` into:

```ts
/**
 * Owns mocap runtime setup for the player bootstrap.
 * Keeps live tracking, mocap diagnostics, and recorded-BVH replay wiring together.
 */
import { parseBVH } from '../../bvhLoader';
import { retargetBvhToVrm } from '../../retarget';
import { MocapDebugRecorder } from '../../mocap/diagnostics/mocapDebugRecorder';
import { MocapDebugViz } from '../../mocap/diagnostics/mocapDebugViz';
import { MocapController } from '../../mocap/pipeline/mocapController';
import { notify, setStatus } from '../../ui';
import { requireAnimation, requirePlayback, requireScene, requireVrm } from '../assertions';
import type { PlayerModule } from '../types';

declare global {
  interface Window {
    __mocapDbg?: MocapDebugRecorder;
  }
}

export const mocapModule: PlayerModule = {
  name: 'mocap',
  setup(ctx) {
    const scene = requireScene(ctx);
    const vrm = requireVrm(ctx);
    const playback = requirePlayback(ctx);
    const animation = requireAnimation(ctx);
    const videoEl = document.getElementById('mocap-video') as HTMLVideoElement;
    const debugViz = new MocapDebugViz(scene.scene);
    const dbgRecorder = new MocapDebugRecorder(vrm, 600);
    const mocap = new MocapController(vrm, videoEl);

    dbgRecorder.onStop = (frames) => {
      console.log('[MocapDebugRecorder] recording done -', frames.length, 'frames');
      dbgRecorder.logSummary();
      dbgRecorder.download('mocap_debug.json');
    };
    window.__mocapDbg = dbgRecorder;

    mocap.onBvhReady = async (bvhText, name) => {
      try {
        const bvh = parseBVH(bvhText);
        const clip = await retargetBvhToVrm(vrm, bvh, name);
        const queuePos = animation.registerAndEnqueue(name, bvh, clip, new File([bvhText], `${name}.bvh`, { type: 'text/plain' }));
        playback.controller?.jumpTo(queuePos, { immediate: true });
        setStatus(`> replaying ${name}`);
        notify({ severity: 'success', summary: 'Mocap BVH ready', detail: name });
      } catch (e) {
        const msg = (e as Error).message;
        setStatus(`replay failed: ${msg}`);
        notify({ severity: 'error', summary: 'Replay failed', detail: msg, life: 4200 });
      }
    };

    ctx.mocap = { mocap, debugViz, dbgRecorder };

    return () => {
      if (window.__mocapDbg === dbgRecorder) delete window.__mocapDbg;
      mocap.dispose();
      debugViz.dispose();
    };
  },
};
```

- [ ] **Step 2: Create `animationImportModule`**

Move the `bvhByIndex`, `names`, `sourceFileByIndex`, `registerAndEnqueue`, `loadAnimationIntoQueue`, `handleAnimationFile`, `handleAnimationFiles`, `previewRetargetFile`, and `openQueueItemInRetargetLab` logic from `main.ts` into `ctx.animation`.

The setup shape:

```ts
/**
 * Owns animation import and queue registration for the player bootstrap.
 * Keeps source-file caches, batch loading, and retarget-preview bridges outside UI modules.
 */
import type * as THREE from 'three';
import { loadAnimationFile, isSupportedAnimationFile } from '../../animationImport';
import type { ParsedBVH } from '../../bvhLoader';
import type { ManualFbxBoneMapping } from '../../animationLoaders/fbxBoneMapping';
import { applyQuaternionCorrectionsToClip, type QuaternionCorrection } from '../../retargetCorrections';
import { notify, setStatus } from '../../ui';
import { requirePlayback, requireVrm } from '../assertions';
import type { AnimationBridge, AnimationLoadResult, PlayerModule } from '../types';

export const animationImportModule: PlayerModule = {
  name: 'animationImport',
  setup(ctx) {
    const vrm = requireVrm(ctx);
    const playback = requirePlayback(ctx);
    const controller = playback.controller;
    if (!controller) throw new Error('AnimationController is required before animation imports can be registered');

    const bvhByIndex = new Map<number, ParsedBVH>();
    const names: string[] = [];
    const sourceFileByIndex = new Map<number, File>();

    const bridge = {} as AnimationBridge;

    bridge.names = names;
    bridge.bvhByIndex = bvhByIndex;
    bridge.sourceFileByIndex = sourceFileByIndex;
    bridge.queue = null;
    bridge.reexportQueue = null;

    bridge.registerAndEnqueue = (name: string, bvh: ParsedBVH | null, clip: THREE.AnimationClip, sourceFile?: File): number => {
      controller.register(name, clip);
      const itemIdx = names.length;
      names.push(name);
      if (bvh) bvhByIndex.set(itemIdx, bvh);
      if (sourceFile) sourceFileByIndex.set(itemIdx, sourceFile);
      const queuePos = controller.queueLength;
      controller.addToQueue(itemIdx);
      bridge.queue?.push(name, clip.duration);
      bridge.reexportQueue?.push(name, clip.duration);
      return queuePos;
    };

    bridge.loadAnimationIntoQueue = async (
      file: File,
      manualFbxMapping: ManualFbxBoneMapping = {},
      quaternionCorrections: QuaternionCorrection[] = [],
      options: { statusLabel?: string; toast?: boolean } = {},
    ): Promise<AnimationLoadResult> => {
      const baseName = file.name;
      const shouldToast = options.toast ?? true;
      setStatus(options.statusLabel ?? `loading ${baseName}...`);
      try {
        const loaded = await loadAnimationFile(file, vrm, manualFbxMapping);
        const correctionReport = applyQuaternionCorrectionsToClip(loaded.clip, vrm, quaternionCorrections);
        if (correctionReport.affectedTracks > 0) {
          console.info(
            `[retarget-corrections] applied ${correctionReport.appliedCorrections} correction(s), ` +
            `${correctionReport.affectedTracks} track(s), ${correctionReport.affectedKeyframes} keyframe(s), ` +
            `sign flips normalized: ${correctionReport.signFlips}`,
          );
        }
        bridge.registerAndEnqueue(loaded.name, loaded.parsedBvh, loaded.clip, file);
        setStatus(`> ${loaded.name}`);
        if (shouldToast) notify({ severity: 'success', summary: 'Animation added', detail: loaded.name });
        return { ok: true, fileName: baseName, name: loaded.name };
      } catch (e) {
        const msg = (e as Error).message;
        setStatus(`load failed: ${msg}`);
        if (shouldToast) notify({ severity: 'error', summary: 'Animation load failed', detail: msg, life: 4200 });
        return { ok: false, fileName: baseName, error: msg };
      }
    };

    bridge.handleAnimationFile = async (file, manualFbxMapping = {}, quaternionCorrections = []) => {
      await bridge.loadAnimationIntoQueue(file, manualFbxMapping, quaternionCorrections);
    };

    bridge.handleAnimationFiles = async (files: File[]) => {
      const supported = files.filter((file) => isSupportedAnimationFile(file.name));
      const unsupported = files.filter((file) => !isSupportedAnimationFile(file.name));
      if (unsupported.length > 0) {
        const namesText = unsupported.slice(0, 3).map((file) => file.name).join(', ');
        const suffix = unsupported.length > 3 ? ` +${unsupported.length - 3} more` : '';
        setStatus(`skipped ${unsupported.length} unsupported file${unsupported.length === 1 ? '' : 's'}`);
        notify({
          severity: 'warn',
          summary: 'Unsupported animation file',
          detail: `Use .bvh, .vrma, .fbx, or motion .json. Skipped: ${namesText}${suffix}`,
          life: 5200,
        });
      }
      if (supported.length === 0) return;
      for (const [index, file] of supported.entries()) {
        await bridge.loadAnimationIntoQueue(file, {}, [], {
          statusLabel: supported.length === 1 ? undefined : `loading ${index + 1}/${supported.length}: ${file.name}...`,
          toast: supported.length === 1,
        });
      }
    };

    bridge.previewRetargetFile = async (file, manualFbxMapping = {}, quaternionCorrections = [], corrected = true) => {
      const loaded = await loadAnimationFile(file, vrm, manualFbxMapping);
      if (corrected) applyQuaternionCorrectionsToClip(loaded.clip, vrm, quaternionCorrections);
      const label = `${loaded.name} ${corrected ? '(corrected preview)' : '(original preview)'}`;
      vrm.scene.visible = true;
      controller.playPreviewClip(label, loaded.clip);
      setStatus(`previewing ${label}`);
      return { name: label, duration: loaded.clip.duration };
    };

    bridge.openQueueItemInRetargetLab = (queueIndex: number, navigate: boolean): boolean => {
      const itemIdx = controller.getItemIndexAtQueuePos(queueIndex);
      const file = sourceFileByIndex.get(itemIdx);
      if (!file) {
        notify({
          severity: 'warn',
          summary: 'No source file for this clip',
          detail: 'Load or record the clip first, then open it in Retarget Lab.',
          life: 4200,
        });
        return false;
      }
      if (navigate) window.dispatchEvent(new CustomEvent('vrm-player:set-page', { detail: 'retarget' }));
      window.dispatchEvent(new CustomEvent<File>('vrm-player:retarget-file', { detail: file }));
      return true;
    };

    ctx.animation = bridge;
  },
};
```

- [ ] **Step 3: Update module order in `main.ts`**

Add `animationImportModule` before `mocapModule`, because `mocapModule` registers recorded BVH into the animation bridge:

```ts
await runPlayerModules(ctx, [
  coreSceneModule,
  shellModule,
  vrmModule,
  playbackModule,
  toolingModule,
  animationImportModule,
  mocapModule,
]);
```

- [ ] **Step 4: Remove migrated mocap/import code from `main.ts`**

Delete the duplicate local declarations for:

```ts
bvhByIndex
names
sourceFileByIndex
registerAndEnqueue
AnimationLoadResult
loadAnimationIntoQueue
handleAnimationFile
handleAnimationFiles
previewRetargetFile
openQueueItemInRetargetLab
mocap.onBvhReady
```

Replace uses with:

```ts
const animation = ctx.animation!;
const mocapSys = ctx.mocap!;
```

- [ ] **Step 5: Verify**

Run: `npm run build`

Expected: PASS.

Run: `npm run test:circular`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/player/modules/mocapModule.ts src/player/modules/animationImportModule.ts src/player/types.ts
git commit -m "Extract mocap and animation import modules"
```

### Task 5: Extract Player UI Module

**Files:**
- Create: `src/player/modules/playerUiModule.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Create `playerUiModule`**

Move queue panel mounting, bottom bar, scene toolbar, player start panel, re-export panel, and retarget lab mounting into:

```ts
/**
 * Owns player Vue island mounts for playback, scene controls, queue, exports, and retarget lab.
 * Keeps UI composition separate from animation import and render-loop systems.
 */
import { createApp } from 'vue';
import { exportClipAsBvh } from '../../bvhExportRecorder';
import { exportClipAsGlb } from '../../gltfExportRecorder';
import { exportBvhAsVrma } from '../../retarget';
import BottomBar from '../../playerVue/BottomBar.vue';
import PlayerStartPanel from '../../playerVue/PlayerStartPanel.vue';
import QueuePanel from '../../playerVue/QueuePanel.vue';
import RetargetLab from '../../playerVue/RetargetLab.vue';
import SceneToolbar from '../../playerVue/SceneToolbar.vue';
import { installPrimeVueOn } from '../../playerVue/plugin';
import { sceneControlsState } from '../../playerVue/sceneControlsState';
import { notify, setStatus } from '../../ui';
import { requireAnimation, requirePlayback, requireTooling, requireVrm } from '../assertions';
import { writeQueueLoopMode } from './playbackModule';
import type { PlayerModule, QueueHandle } from '../types';

export const playerUiModule: PlayerModule = {
  name: 'playerUi',
  setup(ctx) {
    const vrm = requireVrm(ctx);
    const playback = requirePlayback(ctx);
    const tooling = requireTooling(ctx);
    const animation = requireAnimation(ctx);
    const controller = playback.controller;
    if (!controller) throw new Error('AnimationController is required before player UI can mount');

    const cleanupFns: Array<() => void> = [];
    const mountVue = (target: string | Element, component: unknown, props: Record<string, unknown>) => {
      const app = createApp(component, props);
      installPrimeVueOn(app);
      const handle = app.mount(target);
      cleanupFns.push(() => app.unmount());
      return handle;
    };

    mountVue('#bottom-bar', BottomBar, { controller });
    mountVue('#scene-toolbar-root', SceneToolbar, {
      skelViz: tooling.skelViz,
      boneDrag: tooling.boneDrag,
      setModelVisible: (v: boolean) => { vrm.scene.visible = v; },
    });
    mountVue('#player-start-root', PlayerStartPanel, {
      controller,
      setModelVisible: (v: boolean) => { vrm.scene.visible = v; },
    });

    const exportCallbacks = {
      onExportVrma: async (qi: number) => {
        const itemIdx = controller.getItemIndexAtQueuePos(qi);
        const bvh = animation.bvhByIndex.get(itemIdx);
        const name = animation.names[itemIdx];
        if (!bvh || !name) {
          const msg = 'No source BVH for this item. Use BVH export instead.';
          setStatus('no source BVH for this item - use BVH instead');
          notify({ severity: 'warn', summary: 'VRMA unavailable', detail: msg, life: 4200 });
          throw new Error(msg);
        }
        await exportBvhAsVrma(vrm, bvh, name);
        setStatus(`saved ${name}.vrma`);
        notify({ severity: 'success', summary: 'VRMA saved', detail: `${name}.vrma` });
      },
      onExportBvh: async (qi: number) => {
        setStatus('recording BVH...');
        const handle = exportClipAsBvh(qi, controller, vrm);
        const filename = await handle.promise;
        setStatus(`saved ${filename}`);
        notify({ severity: 'success', summary: 'BVH saved', detail: filename });
      },
      onExportGlb: async (qi: number) => {
        const clip = controller.getClipAtQueuePos(qi);
        if (!clip) throw new Error('No animation clip for this item.');
        const itemIdx = controller.getItemIndexAtQueuePos(qi);
        const name = animation.names[itemIdx] || 'export';
        const filename = await exportClipAsGlb(vrm, clip, name);
        setStatus(`saved ${filename}`);
        notify({ severity: 'success', summary: 'GLB saved', detail: filename });
      },
    };

    const queue = mountVue('#queue-panel-root', QueuePanel, {
      loopMode: controller.currentLoopMode,
      onLoopModeChange: (mode) => {
        controller.setLoopMode(mode);
        writeQueueLoopMode(mode);
        setStatus(mode === 'one' ? 'looping current clip' : 'looping queue');
      },
      onJump: (qi: number) => controller.jumpTo(qi),
      onReorder: (from: number, to: number) => {
        controller.reorderQueue(from, to);
        animation.reexportQueue?.reorder(from, to);
      },
      onRemove: (qi: number) => {
        controller.removeFromQueue(qi);
        animation.reexportQueue?.remove(qi);
      },
      onClear: () => {
        controller.clearQueue();
        animation.reexportQueue?.clear();
        setStatus('queue cleared');
      },
      onDuplicate: (qi: number) => {
        const itemIdx = controller.getItemIndexAtQueuePos(qi);
        if (itemIdx < 0) return;
        controller.addToQueue(itemIdx);
        const name = animation.names[itemIdx] || controller.getItemName(itemIdx);
        const duration = controller.getClipAtItemIndex(itemIdx)?.duration ?? 0;
        animation.queue?.push(name, duration);
        animation.reexportQueue?.push(name, duration);
      },
      onRetarget: (qi: number) => animation.openQueueItemInRetargetLab(qi, true),
      ...exportCallbacks,
    }) as unknown as QueueHandle;
    animation.queue = queue;

    const reexportRoot = document.getElementById('tools-reexport-root');
    if (reexportRoot) {
      animation.reexportQueue = mountVue(reexportRoot, QueuePanel, {
        mode: 'exportsOnly',
        onJump: (qi: number) => controller.jumpTo(qi),
        onReorder: (from: number, to: number) => controller.reorderQueue(from, to),
        ...exportCallbacks,
      }) as unknown as QueueHandle;
    }

    const retargetLabRoot = document.getElementById('retarget-lab-root');
    if (retargetLabRoot) {
      mountVue(retargetLabRoot, RetargetLab, {
        vrm,
        onImport: animation.handleAnimationFile,
        onPreview: animation.previewRetargetFile,
        onPreviewSeek: (seconds: number) => controller.seek(seconds),
        onPreviewStop: () => {
          controller.stopPreview();
          vrm.scene.visible = false;
          setStatus('preview stopped');
        },
      });
    }

    vrm.scene.visible = sceneControlsState.modelOn;

    controller.onChange((queuePos, item) => {
      animation.queue?.setActive(queuePos);
      animation.reexportQueue?.setActive(queuePos);
      setStatus(`${queuePos + 1}/${controller.queueLength} · ${item.name} · ${item.duration.toFixed(1)}s`);
      tooling.hipForce.reset();
      tooling.hipBalance.reset();
    });

    return () => {
      for (let i = cleanupFns.length - 1; i >= 0; i -= 1) cleanupFns[i]();
      animation.queue = null;
      animation.reexportQueue = null;
    };
  },
};
```

- [ ] **Step 2: Preserve error toasts around export callbacks**

When moving the exact code, keep the current `try/catch` blocks from `main.ts` for `onExportVrma`, `onExportBvh`, and `onExportGlb`. The abbreviated code above shows the structure; the moved implementation should preserve the current user-facing status and notification messages.

- [ ] **Step 3: Update module order**

Run `playerUiModule` after `animationImportModule` and before `mocapModule`:

```ts
await runPlayerModules(ctx, [
  coreSceneModule,
  shellModule,
  vrmModule,
  playbackModule,
  toolingModule,
  animationImportModule,
  playerUiModule,
  mocapModule,
]);
```

- [ ] **Step 4: Verify**

Run: `npm run build`

Expected: PASS.

Run: `npm run test:circular`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/player/modules/playerUiModule.ts
git commit -m "Extract player UI module"
```

### Task 6: Extract Debug, Input, And Render Loop Modules

**Files:**
- Create: `src/player/modules/debugModule.ts`
- Create: `src/player/modules/inputModule.ts`
- Create: `src/player/modules/renderLoopModule.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Create `debugModule`**

```ts
/**
 * Owns debug panel mounting for the player bootstrap.
 * Keeps diagnostics UI wiring separate from player startup and render-loop code.
 */
import { mountDebugPanel } from '../../debugPanel';
import { requireAnimation, requireMocap, requirePlayback, requireTooling, requireVrm } from '../assertions';
import type { PlayerModule } from '../types';

export const debugModule: PlayerModule = {
  name: 'debug',
  setup(ctx) {
    const vrm = requireVrm(ctx);
    const playback = requirePlayback(ctx);
    const mocap = requireMocap(ctx);
    const tooling = requireTooling(ctx);
    const animation = requireAnimation(ctx);
    return mountDebugPanel(
      playback,
      mocap,
      tooling,
      (v) => { vrm.scene.visible = v; },
      animation.handleAnimationFile,
    );
  },
};
```

- [ ] **Step 2: Create `inputModule`**

```ts
/**
 * Owns global player input wiring for the player bootstrap.
 * Keeps keyboard shortcuts, file drops, and custom window events out of main.ts.
 */
import { isSupportedAnimationFile } from '../../animationImport';
import { sceneControlsState } from '../../playerVue/sceneControlsState';
import { notify, setStatus } from '../../ui';
import { requireAnimation, requirePlayback, requireTooling, requireVrm } from '../assertions';
import type { PlayerModule } from '../types';

export const inputModule: PlayerModule = {
  name: 'input',
  setup(ctx) {
    const vrm = requireVrm(ctx);
    const playback = requirePlayback(ctx);
    const tooling = requireTooling(ctx);
    const animation = requireAnimation(ctx);
    const controller = playback.controller;
    if (!controller) throw new Error('AnimationController is required before input can be registered');

    const isTypingTarget = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
    };

    const onShortcutKey = (e: KeyboardEvent): void => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === ' ') {
        e.preventDefault();
        controller.togglePaused();
      } else if (key === 'm') {
        sceneControlsState.modelOn = !sceneControlsState.modelOn;
        vrm.scene.visible = sceneControlsState.modelOn;
      } else if (key === 's') {
        sceneControlsState.skeletonOn = !sceneControlsState.skeletonOn;
        tooling.skelViz.setVisible(sceneControlsState.skeletonOn);
      } else if (key === 'd') {
        sceneControlsState.dragOn = !sceneControlsState.dragOn;
        tooling.boneDrag.setEnabled(sceneControlsState.dragOn);
        if (sceneControlsState.dragOn && !sceneControlsState.skeletonOn) {
          sceneControlsState.skeletonOn = true;
          tooling.skelViz.setVisible(true);
        }
      } else if (key === 'r') {
        tooling.boneDrag.resetAll();
      } else if (key === 'z') {
        window.dispatchEvent(new Event('vrm-player:toggle-zen'));
      } else if (key === '?' || (e.code === 'Slash' && e.shiftKey)) {
        window.dispatchEvent(new Event('vrm-player:toggle-help'));
      }
    };

    const onLoadVrmFile = (e: Event): void => {
      const file = (e as CustomEvent<File>).detail;
      if (!file) return;
      if (!file.name.toLowerCase().endsWith('.vrm')) {
        notify({ severity: 'error', summary: 'Unsupported avatar file', detail: 'Choose a .vrm file.' });
        return;
      }
      sceneControlsState.modelOn = true;
      sceneControlsState.skeletonOn = true;
      sceneControlsState.dragOn = false;
      setStatus(`loading ${file.name}...`);
      notify({ severity: 'info', summary: 'Loading VRM', detail: file.name, life: 1800 });
      ctx.options.onVrmFileSelected(file);
    };

    const onQueueAddAnimationFile = (e: Event): void => {
      const file = (e as CustomEvent<File>).detail;
      if (!file) return;
      void animation.handleAnimationFiles([file]);
    };
    const onQueueAddAnimationFiles = (e: Event): void => {
      const files = (e as CustomEvent<File[]>).detail;
      if (Array.isArray(files) && files.length > 0) void animation.handleAnimationFiles(files);
    };
    const onWindowDragOver = (e: DragEvent): void => {
      if (Array.from(e.dataTransfer?.items ?? []).some((it) => it.kind === 'file')) {
        e.preventDefault();
        e.dataTransfer!.dropEffect = 'copy';
      }
    };
    const onWindowDrop = (e: DragEvent): void => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      void animation.handleAnimationFiles(files.filter((file) => isSupportedAnimationFile(file.name) || file.name));
    };
    const onPageChanged = (e: Event): void => {
      const page = (e as CustomEvent<string>).detail;
      if (page !== 'retarget') return;
      const queueIndex = controller.currentQueuePos;
      if (queueIndex >= 0) animation.openQueueItemInRetargetLab(queueIndex, false);
    };

    window.addEventListener('keydown', onShortcutKey);
    window.addEventListener('vrm-player:load-vrm-file', onLoadVrmFile);
    window.addEventListener('vrm-player:add-animation-file', onQueueAddAnimationFile);
    window.addEventListener('vrm-player:add-animation-files', onQueueAddAnimationFiles);
    window.addEventListener('dragover', onWindowDragOver);
    window.addEventListener('drop', onWindowDrop);
    window.addEventListener('vrm-player:page-changed', onPageChanged);

    return () => {
      window.removeEventListener('keydown', onShortcutKey);
      window.removeEventListener('vrm-player:load-vrm-file', onLoadVrmFile);
      window.removeEventListener('vrm-player:add-animation-file', onQueueAddAnimationFile);
      window.removeEventListener('vrm-player:add-animation-files', onQueueAddAnimationFiles);
      window.removeEventListener('dragover', onWindowDragOver);
      window.removeEventListener('drop', onWindowDrop);
      window.removeEventListener('vrm-player:page-changed', onPageChanged);
    };
  },
};
```

- [ ] **Step 3: Create `renderLoopModule`**

```ts
/**
 * Owns render-loop startup for the player bootstrap.
 * Keeps per-frame system ordering centralized in renderLoop.ts and out of main.ts.
 */
import { startRenderLoop } from '../../renderLoop';
import { requireMocap, requirePlayback, requireScene, requireTooling, requireVrm } from '../assertions';
import type { PlayerModule } from '../types';

export const renderLoopModule: PlayerModule = {
  name: 'renderLoop',
  setup(ctx) {
    return startRenderLoop(
      requireScene(ctx),
      requireVrm(ctx),
      requirePlayback(ctx),
      requireMocap(ctx),
      requireTooling(ctx),
    );
  },
};
```

- [ ] **Step 4: Update final module order**

```ts
await runPlayerModules(ctx, [
  coreSceneModule,
  shellModule,
  vrmModule,
  playbackModule,
  toolingModule,
  animationImportModule,
  playerUiModule,
  mocapModule,
  debugModule,
  inputModule,
  renderLoopModule,
]);
```

- [ ] **Step 5: Remove migrated code from `main.ts`**

Delete duplicate sections for:

```ts
mountDebugPanel(...)
onShortcutKey
onLoadVrmFile
onQueueAddAnimationFile
onQueueAddAnimationFiles
onWindowDragOver
onWindowDrop
onPageChanged
startRenderLoop(...)
```

- [ ] **Step 6: Verify**

Run: `npm run build`

Expected: PASS.

Run: `npm run test:circular`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts src/player/modules/debugModule.ts src/player/modules/inputModule.ts src/player/modules/renderLoopModule.ts
git commit -m "Extract input debug and render loop modules"
```

### Task 7: Slim `main.ts` And Finalize Restart Lifecycle

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Rewrite `main.ts` as the composition entry**

Final shape:

```ts
import './styles/player.css';
import { setStatus, notify } from './ui';
import { runPlayerModules } from './player/bootstrap';
import type { PlayerApp, PlayerContext } from './player/types';
import { animationImportModule } from './player/modules/animationImportModule';
import { coreSceneModule } from './player/modules/coreSceneModule';
import { debugModule } from './player/modules/debugModule';
import { inputModule } from './player/modules/inputModule';
import { mocapModule } from './player/modules/mocapModule';
import { playbackModule } from './player/modules/playbackModule';
import { playerUiModule } from './player/modules/playerUiModule';
import { renderLoopModule } from './player/modules/renderLoopModule';
import { shellModule } from './player/modules/shellModule';
import { toolingModule } from './player/modules/toolingModule';
import { vrmModule } from './player/modules/vrmModule';

type CleanupFn = () => void;

let selectedVrmUrl: string | null = null;
let selectedVrmName = '';
let activeApp: PlayerApp | null = null;

declare global {
  interface Window {
    __vrmPlayerCleanup?: CleanupFn;
  }
}

function disposeActiveApp(): void {
  activeApp?.dispose();
  activeApp = null;
  if (window.__vrmPlayerCleanup === disposeActiveApp) delete window.__vrmPlayerCleanup;
}

function installGlobalCleanup(): void {
  window.__vrmPlayerCleanup = disposeActiveApp;
  import.meta.hot?.dispose(disposeActiveApp);
}

function requestVrmFile(file: File): void {
  if (selectedVrmUrl?.startsWith('blob:')) URL.revokeObjectURL(selectedVrmUrl);
  selectedVrmUrl = URL.createObjectURL(file);
  selectedVrmName = file.name;
  void startPlayer();
}

async function startPlayer(): Promise<void> {
  disposeActiveApp();
  const appRoot = document.getElementById('app');
  if (!appRoot) throw new Error('#app not found');
  const shellRoot = document.getElementById('ui-shell');
  if (!shellRoot) throw new Error('#ui-shell not found');

  const ctx: PlayerContext = {
    roots: { app: appRoot, shell: shellRoot },
    options: {
      selectedVrmUrl,
      selectedVrmName,
      onVrmFileSelected: requestVrmFile,
    },
  };

  activeApp = await runPlayerModules(ctx, [
    coreSceneModule,
    shellModule,
    vrmModule,
    playbackModule,
    toolingModule,
    animationImportModule,
    playerUiModule,
    mocapModule,
    debugModule,
    inputModule,
    renderLoopModule,
  ]);
  installGlobalCleanup();
}

startPlayer().catch((err) => {
  console.error(err);
  setStatus(`error: ${(err as Error).message}`);
  notify({ severity: 'error', summary: 'Startup error', detail: (err as Error).message, life: 6000 });
});
```

- [ ] **Step 2: Ensure ASCII status text remains acceptable**

The existing UI uses symbols like `▶` and ellipses. New module files should default to ASCII unless they move existing user-facing strings unchanged. Do not introduce new non-ASCII decorative text.

- [ ] **Step 3: Verify `main.ts` no longer imports subsystem internals**

Run:

```bash
rg -n "Mocap|Skeleton|Bone|QueuePanel|RetargetLab|AnimationController|startRenderLoop|mountDebugPanel" src/main.ts
```

Expected: no matches except module import names if any are intentionally named with the subsystem.

- [ ] **Step 4: Verify**

Run: `npm run build`

Expected: PASS.

Run: `npm run test:circular`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "Slim player entry point"
```

### Task 8: Final Verification And Browser Smoke Check

**Files:**
- Modify only if verification finds a regression.

- [ ] **Step 1: Run unit and structural checks**

Run:

```bash
npm run build
npm run test:circular
npm test
```

Expected: all commands PASS.

- [ ] **Step 2: Start dev server**

Run: `npm run dev -- --host 127.0.0.1`

Expected: Vite prints a local URL, usually `http://127.0.0.1:5173/`.

- [ ] **Step 3: Browser smoke check**

Use the Browser plugin to open the Vite URL and verify:

- page loads without startup error toast;
- canvas is present and nonblank;
- debug panel controls render;
- model/skeleton toolbar buttons toggle state;
- queue drop zone renders;
- retarget page can be opened and returned from.

- [ ] **Step 4: Run focused Playwright smoke tests**

Run:

```bash
npx playwright test tests/e2e/smoke.spec.ts tests/e2e/player-ux.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit any verification fixes**

If fixes were needed:

```bash
git add src tests
git commit -m "Fix modular player verification issues"
```

If no fixes were needed, do not create an empty commit.

## Self-Review

- Spec coverage: The plan creates the `src/player/` composition layer, module contract, reverse cleanup, typed dependency assertions, all initial module groups, slim `main.ts`, module header comments, and verification commands required by the design.
- Placeholder scan: No unresolved placeholder markers are present. The plan does contain one instruction to preserve exact existing export error handling because those blocks should be moved verbatim from `main.ts`; this is intentional behavior preservation, not missing design.
- Type consistency: `PlayerContext`, `PlayerModule`, `AnimationBridge`, and `QueueHandle` are defined before use. Module order satisfies dependencies: scene -> VRM -> playback/tooling -> animation -> UI/mocap -> debug/input/render loop.
