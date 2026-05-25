# Modular Player Architecture Design

## Goal

Refactor the VRM player startup code into small, architecturally independent modules that are easy to connect, remove, and reason about. This is not a runtime feature-flag system and not a dynamic plugin loader. The target is a clear static composition layer: disabling a subsystem should usually mean removing one module from the bootstrap list and fixing any explicit typed dependency that remains.

Every new module file must start with a short header comment that describes what the module owns. The description should be one or two sentences and must make the module boundary obvious before reading the implementation.

## Current Problem

`src/main.ts` currently owns too many responsibilities:

- scene and VRM startup;
- Vue shell mounting;
- playback controller setup;
- queue UI and export callbacks;
- retarget lab wiring;
- mocap controller and BVH replay;
- debug panel and diagnostics;
- keyboard shortcuts;
- window drag/drop;
- render loop startup;
- hot-reload and cleanup lifecycle.

The surrounding project already has useful domain folders such as `mocap`, `animationLoaders`, `validation`, `physics`, and `playerVue`, but the app composition boundary is still centralized in `main.ts`.

## Recommended Shape

Add a lightweight `src/player/` composition layer:

- `src/player/types.ts`: shared types for module setup, module cleanup, and the app context.
- `src/player/cleanup.ts`: reverse-order cleanup registry.
- `src/player/bootstrap.ts`: runs modules in order, handles failures, and disposes partially initialized modules.
- `src/player/modules/*.ts`: focused modules that each own one startup area.

`src/main.ts` should become a short entry point that imports styles, starts the bootstrap, and reports startup errors through existing UI notifications.

## Module Contract

Each module follows one simple contract:

```ts
export interface PlayerModule {
  readonly name: string;
  setup(ctx: PlayerContext): void | CleanupFn | Promise<void | CleanupFn>;
}
```

`PlayerContext` is a typed mutable composition object, not a global service locator. A module may add the system it owns to the context, and may read only the dependencies it explicitly needs. If a dependency is missing, the module should fail clearly during setup.

The context should start small and grow only around real module boundaries:

- DOM roots and UI helpers;
- scene context and VRM instance;
- playback systems;
- mocap systems;
- tooling systems;
- loaded animation registry state;
- cleanup registry.

Avoid putting every tiny value into `PlayerContext`. Local details should stay inside the owning module.

## Initial Module Split

The first refactor should keep behavior unchanged and split only along existing responsibility lines:

- `sceneModule`: creates the Three.js scene and owns scene disposal.
- `shellModule`: mounts `PlayerShell` and PrimeVue.
- `vrmModule`: resolves and loads the selected VRM, adds it to the scene, and exposes a reload request path.
- `toolingModule`: creates validator, skeleton visualizer, bone pose panel, bone drag controller, hip diagnostics, skeleton logger, and motion trace recorder.
- `playbackModule`: creates `AnimationController`, procedural playback systems, and queue loop-mode persistence.
- `uiModules`: mounts bottom bar, scene toolbar, player start panel, queue panel, re-export panel, and retarget lab.
- `animationImportModule`: owns animation file loading, batch loading, queue registration, source BVH cache, and retarget preview.
- `mocapModule`: creates `MocapController`, debug visualization, debug recorder, and mocap-to-BVH replay wiring.
- `debugModule`: mounts the debug panel and diagnostics modals.
- `inputModule`: owns keyboard shortcuts, drag/drop animation import, and window custom event listeners.
- `renderLoopModule`: starts `startRenderLoop` after scene, VRM, playback, mocap, and tooling are ready.

These can be implemented incrementally. It is acceptable for a first pass to group closely related UI mounts into one module, then split further once the context boundaries are stable.

## Dependency Direction

Modules should depend on domain systems, not on other modules by filename. For example:

- `debugModule` may read `ctx.playback`, `ctx.mocap`, and `ctx.tooling`.
- `renderLoopModule` may read `ctx.scene`, `ctx.vrm`, `ctx.playback`, `ctx.mocap`, and `ctx.tooling`.
- `animationImportModule` may read `ctx.vrm`, `ctx.playback.controller`, and queue handles exposed by the UI module.

If two modules need to coordinate, prefer a narrow typed callback or state object in `PlayerContext` over importing one module from another.

## Lifecycle

Bootstrap must dispose modules in reverse setup order. This preserves the current behavior where UI listeners and render loops are torn down before the underlying scene and VRM are removed.

Cleanup requirements:

- every Vue app unmounts;
- every event listener is removed;
- every interval/timeout owned by a module is cleared;
- `renderLoopHooks` slots are reset by the module that assigned them;
- debug globals such as `window.__mocapDbg`, `window.__skelLog`, and `window.__motionTrace` are removed only by the module that created them;
- blob VRM URLs are revoked when replaced.

## Error Handling

Module setup errors should surface through the existing `setStatus` and `notify` helpers. Bootstrap should clean up any module that was already initialized before rethrowing the error to `main.ts`.

Missing DOM roots should stay explicit. Required roots should throw clear errors; optional roots should make their module a no-op.

## Testing And Verification

Because this is a structural refactor, verification should focus on behavior preservation:

- `npm run build`
- `npm run test:circular`
- focused unit tests only if code is moved in a way that changes public imports
- browser smoke check for startup, model visibility, queue import, debug panel mount, and render loop

The refactor is successful when:

- `src/main.ts` is short and mostly declarative;
- module files have clear header descriptions;
- each module has one visible reason to change;
- removing a module from the bootstrap list produces either a working smaller app or a clear typed dependency error;
- no new circular dependencies are introduced.

