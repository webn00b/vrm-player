import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 5333,
  },
  build: {
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
          if (id.includes('node_modules/three') || id.includes('node_modules/@pixiv')) {
            return 'vendor';
          }
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
