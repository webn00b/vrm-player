<script setup lang="ts">
import FileConverter from '../../exports/FileConverter.vue';
</script>

<template>
  <div id="tools-page">
    <div class="tools-page-inner">
      <section class="tools-section">
        <div class="tools-heading">
          <h1>Conversion</h1>
          <p>Convert animation files to JSON without loading them into the avatar.</p>
        </div>
        <FileConverter />
      </section>

      <section class="tools-section">
        <div class="tools-heading">
          <h1>Re-export</h1>
          <p>Download loaded queue clips as BVH, GLB, or VRMA.</p>
        </div>
        <div id="tools-reexport-root"></div>
      </section>
    </div>
  </div>
</template>

<style scoped>
#tools-page {
  position: fixed;
  inset: 0;
  z-index: 12;
  overflow: auto;
  padding: 58px 24px 24px;
  background: #0d0d0f;
  color: #e6e6e6;
  pointer-events: auto;
}

.tools-page-inner {
  width: min(1120px, 100%);
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(280px, 0.75fr);
  gap: 18px;
  align-items: start;
}

.tools-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tools-heading h1 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0;
}

.tools-heading p {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  opacity: 0.58;
}

#tools-reexport-root {
  min-height: 260px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(16, 16, 16, 0.92);
  padding: 12px;
}

@media (max-width: 860px) {
  .tools-page-inner {
    grid-template-columns: 1fr;
  }
}
</style>
