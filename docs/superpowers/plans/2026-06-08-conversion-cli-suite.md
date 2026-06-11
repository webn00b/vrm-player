# Conversion CLI Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add several JavaScript conversion entrypoints around the existing browser-based video/motion conversion pipeline.

**Architecture:** Keep the Playwright/Vite frontend automation in `tools/video-to-bvh.mjs` and export reusable helpers. Add thin scripts for pair, matrix, debug, batch video, motion-json, and batch motion conversion. Motion JSON conversion goes through the existing Capture > Anim export UI path.

**Tech Stack:** Node.js ESM, Vite dev server, Playwright Chromium, existing Vue Capture UI, existing animation import/export and BVH recorder.

---

### Task 1: Reusable CLI Helpers

**Files:**
- Modify: `tools/video-to-bvh.mjs`
- Modify: `tests/regression/videoToBvhCli.test.ts`

- [x] Add tests for path variants, batch input discovery, and script entrypoint imports.
- [x] Export reusable helpers from `video-to-bvh.mjs`.

### Task 2: Video Conversion Scripts

**Files:**
- Create: `tools/video-to-bvh-pair.mjs`
- Create: `tools/video-to-bvh-matrix.mjs`
- Create: `tools/video-to-bvh-debug.mjs`
- Create: `tools/batch-video-to-bvh.mjs`

- [x] Add thin entrypoints that call the shared runner.
- [x] Add npm scripts for each entrypoint.

### Task 3: Motion JSON Conversion Scripts

**Files:**
- Create: `tools/motion-json-to-bvh.mjs`
- Create: `tools/batch-motion-to-bvh.mjs`
- Modify: `src/playerVue/CaptureSection.vue`

- [x] Add a stable `data-testid` for the hidden animation input.
- [x] Drive Capture > Anim export through the same browser UI path.

### Task 4: Verification And Docs

**Files:**
- Modify: `docs/offline-mocap-import.md`
- Modify: `tests/e2e/video-to-bvh-cli.spec.ts`

- [x] Document the script set.
- [x] Run focused tests, build, and e2e before committing.
