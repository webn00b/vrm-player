import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 5333,
  },
  build: {
    // three.js + @pixiv/three-vrm together land at ~880 KB minified. That's
    // genuinely the library footprint — splitting them further produces
    // smaller chunks that load in parallel (good for HTTP/2) but the same
    // bytes. Bump the warning ceiling so the build log stays signal-only.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      // Multi-page entry points. `index.html` is the main VRM player;
      // `exports.html` is a lightweight standalone-converter page that ships
      // its own minimal bundle (no three.js, no VRM, no mocap stack).
      input: {
        main:    'index.html',
        exports: 'exports.html',
      },
      output: {
        manualChunks(id) {
          // three.js + VRM core: heavy, evergreen, shared by main + debug.
          if (id.includes('node_modules/three') || id.includes('node_modules/@pixiv')) {
            return 'vendor';
          }
          // PrimeVue components + the unstyled theme runtime. Splitting these
          // out lets the modal lazy-chunks share them rather than pulling
          // duplicated copies, AND keeps the main chunk free of PrimeVue
          // bytes the home page doesn't actually need on first paint.
          if (id.includes('node_modules/primevue') || id.includes('node_modules/@primevue')) {
            return 'primevue';
          }
          // Debug-only modules (heavy mocap visualisations + recorder). Kept
          // separate from `main` so reloading just the panel UI doesn't bust
          // the larger main cache.
          if (
            id.includes('/debugPanel') ||
            id.includes('/skeletonVisualizer') ||
            id.includes('/bonePosePanel') ||
            id.includes('/boneValidator') ||
            id.includes('/mocapDebugViz') ||
            id.includes('/mocapDebugRecorder')
          ) {
            return 'debug';
          }
        },
      },
    },
  },
});
