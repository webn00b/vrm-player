# End-to-end tests (Playwright)

Browser-level tests that drive the deployed UI through real Chromium. Tests
spawn a `npm run dev` server on port 5333 automatically — no manual setup
beyond installing browsers once.

## Running

```bash
npx playwright install chromium   # one-time, ~150 MB
npm run test:e2e                  # all tests, headless
npm run test:e2e:ui               # Playwright UI mode — debug interactively
```

## Webcam mocap with a real recording

Chromium's `--use-fake-device-for-media-stream` defaults to a synthetic
green test pattern. To drive MediaPipe with a real body-motion clip, set
`FAKE_VIDEO_PATH` to a `.y4m` or `.mjpeg` file:

```bash
FAKE_VIDEO_PATH=/path/to/dance.y4m npm run test:e2e
```

### Recording / converting a Y4M

The format Chromium accepts is YUV4MPEG2 (`.y4m`) at any resolution & FPS.
Convert any video to Y4M with ffmpeg:

```bash
ffmpeg -i input.mp4 -pix_fmt yuv420p -t 5 -vf scale=640:480 output.y4m
```

Tips:
- Keep clips short (3-10 s). Y4M is uncompressed — a 5 s 640×480 clip is
  ~50 MB.
- Place the file OUTSIDE `tests/` so it doesn't get committed by accident.
- The clip should show a full body in frame so MediaPipe finds landmarks.
- 640×480 at 30 fps is typical webcam input.

### What changes with a real video

The `mocap.spec.ts` file has a test gated on `FAKE_VIDEO_PATH` being set.
Without the env var only the pipeline-startup test runs (verifies mocap
initialises without errors). With it, an additional test verifies that
the avatar's tracking-health readout reports `live` phases after a few
seconds of processing.

## Limitations

- Chromium only. Firefox / Safari skipped — MediaPipe's GPU delegate is
  Chrome-family-only in practice.
- No visual-regression baselines yet. The viewport canvas is rendered
  by Three.js with anti-aliasing, MSAA, and OS-level font rasterisation —
  pixel-perfect comparison would be noisy. If you need it later, look at
  `expect(page).toHaveScreenshot({ maxDiffPixels: N })`.
- No CI hook. Tests are local-only by user choice. If we eventually add
  `.github/workflows/e2e.yml` it needs the `playwright/chromium` image
  and ~3 min per run.
