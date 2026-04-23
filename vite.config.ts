import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5333,
  },
  build: {
    rollupOptions: {
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
