<script setup lang="ts">
/**
 * Root component for the standalone exports page.
 * Just a header, the converter tool, and a back-to-player link.
 */
import FileConverter from './FileConverter.vue';
import Toast from 'primevue/toast';
</script>

<template>
  <div class="page">
    <header>
      <h1>🛠 Animation File Converters</h1>
      <p class="sub">
        Standalone tools — no avatar, no playback, no retargeting.
        Input file → output file.
      </p>
    </header>

    <main>
      <FileConverter />
    </main>

    <footer>
      <a href="/" class="back-link">← back to player</a>
    </footer>

    <!-- Toast container — invoked from child components via useToast(). -->
    <Toast position="bottom-right" />
  </div>
</template>

<style scoped>
.page {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-height: 100vh;
  box-sizing: border-box;
}
header h1 {
  margin: 0 0 4px 0;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
header .sub {
  margin: 0;
  font-size: 13px;
  opacity: 0.65;
  line-height: 1.5;
}
main {
  flex: 1;
}
footer {
  font-size: 12px;
  opacity: 0.5;
}
footer .back-link {
  color: var(--p-primary-color, #6ea8ff);
  text-decoration: none;
}
footer .back-link:hover {
  text-decoration: underline;
}
</style>

<style>
/* Page-level styles (not scoped). Sets body background + ambient colour. */
:root {
  color-scheme: dark;
}
body {
  margin: 0;
  background: #0d0d0f;
  color: #e6e6e6;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI", sans-serif;
}
</style>
