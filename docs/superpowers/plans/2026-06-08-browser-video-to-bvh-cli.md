# Browser Video To BVH CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a JavaScript CLI that converts a local video to BVH by driving the existing vrm-player frontend pipeline in Chromium.

**Architecture:** The CLI starts the Vite app unless `--url` is provided, opens it with Playwright, optionally loads a user VRM through the existing UI file input, switches Capture to Video, uploads the video file, and saves the BVH browser download. No separate MediaPipe or retarget implementation is introduced.

**Tech Stack:** Node.js ESM, Vite programmatic dev server, Playwright Chromium, existing Vue Capture UI, existing browser MediaPipe, existing `MocapController.startFromFile()`, existing `BvhRecorder`.

---

### Task 1: CLI Argument Model

**Files:**
- Create: `tools/video-to-bvh.mjs`
- Test: `tests/regression/videoToBvhCli.test.ts`

- [x] **Step 1: Write failing tests for argument parsing**

Test that `parseCliArgs()` accepts a positional video, `--output`, `--vrm`, `--url`, `--port`, `--headed`, and `--timeout`, and rejects missing video input.

- [x] **Step 2: Verify RED**

Run: `npm test -- tests/regression/videoToBvhCli.test.ts`

Expected: fails because `tools/video-to-bvh.mjs` does not exist.

- [x] **Step 3: Implement parser and option resolver**

Export `parseCliArgs(argv)` and `resolveCliOptions(parsed, cwd)`. Keep validation local: video must exist, `--output` defaults to `<video basename>.bvh`, `--timeout` defaults to `180000`, and `--port` defaults to `5333`.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- tests/regression/videoToBvhCli.test.ts`

Expected: parser tests pass.

### Task 2: Browser Conversion Runner

**Files:**
- Modify: `tools/video-to-bvh.mjs`
- Modify: `src/playerVue/CaptureSection.vue`
- Test: `tests/e2e/video-to-bvh-cli.spec.ts`

- [x] **Step 1: Add stable UI selector**

Add `data-testid="capture-video-input"` to the existing hidden video file input. This does not change user behavior.

- [x] **Step 2: Implement Playwright flow**

In `runVideoToBvh(options)`, start Vite through `createServer()` when no `--url` is supplied, open Chromium with `headless: !options.headed`, navigate to the app, optionally load `--vrm`, switch to Capture > Video, upload the video, wait for a `download` event, and save it to `options.output`.

- [x] **Step 3: Add CLI smoke test**

Create a Playwright test that exercises helper selectors against the local app where practical, and keep full video conversion runnable manually because real body video assets are environment-dependent.

- [x] **Step 4: Verify**

Run:
- `npm test -- tests/regression/videoToBvhCli.test.ts`
- `npm run build`
- `npm run test:e2e`

### Task 3: Package Script And Docs

**Files:**
- Modify: `package.json`
- Modify: `docs/offline-mocap-import.md`

- [x] **Step 1: Add npm script**

Add `"video:bvh": "node tools/video-to-bvh.mjs"`.

- [x] **Step 2: Document usage**

Add a Browser CLI section showing:

```bash
npm run video:bvh -- ./input.mp4 --output ./output.bvh --headed
```

- [x] **Step 3: Final verification and commit**

Run full verification, inspect `git diff --check`, stage the scoped files, and commit with:

```bash
git commit -m "feat: add browser video to bvh cli"
```
