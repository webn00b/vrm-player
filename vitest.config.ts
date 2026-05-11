import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Co-located tests next to source (`src/**/*.test.ts`) plus the existing
    // cross-cutting suite in `tests/regression/`. The latter survives the
    // migration from node:test as a single .ts directory.
    include: [
      'tests/**/*.test.ts',
      'src/**/*.test.ts',
    ],
    // Exclude Playwright e2e specs (they use a different runner + browser
    // environment). Playwright suffixes its files .spec.ts.
    exclude: [
      'tests/e2e/**',
      'node_modules/**',
      'dist/**',
    ],
    environment: 'node',
    // Three.js is heavy; avoid happy-dom/jsdom unless a test actually needs DOM.
    // (mock VRMs we'll build for applier integration tests use plain THREE.Object3D
    // hierarchies — no DOM needed.)
    globals: false,
    // Each test file gets its own process-isolated context. Default is "threads"
    // (worker_threads). Pure-math tests don't care; applier tests rely on per-
    // module THREE state — isolation prevents cross-file pollution.
    isolate: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/main.ts',
      ],
    },
  },
});
