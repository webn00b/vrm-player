<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import Button from 'primevue/button';
import {
  DEFAULT_LOCALE,
  getLanguageHostProfiles,
  normalizeLocale,
  resolveLanguageHostProfile,
  type LanguageHostProfile,
  type SupportedLocale,
} from '../languageHosts';
import {
  createLanguageHostPreviewScene,
  type LanguageHostPreviewScene,
} from '../languageHostPreviewScene';

const LANGUAGE_LOCALE_KEY = 'vrm-player.language-locale';
const previewRoot = ref<HTMLElement | null>(null);
const previewScene = ref<LanguageHostPreviewScene | null>(null);
const status = ref('Preparing preview');
const loading = ref(false);
const loadError = ref('');
const profiles = getLanguageHostProfiles();
let selectionSerial = 0;
let mounted = false;

const selectedLocale = ref<SupportedLocale>((() => {
  try {
    return normalizeLocale(localStorage.getItem(LANGUAGE_LOCALE_KEY));
  } catch {
    return DEFAULT_LOCALE;
  }
})());

const selectedProfile = computed(() => resolveLanguageHostProfile(selectedLocale.value));

function persistLocale(locale: SupportedLocale): void {
  try { localStorage.setItem(LANGUAGE_LOCALE_KEY, locale); } catch { /* ignore */ }
}

function isCurrentSelection(serial: number): boolean {
  return mounted && serial === selectionSerial;
}

async function selectHost(profile: LanguageHostProfile): Promise<void> {
  const serial = ++selectionSerial;
  selectedLocale.value = profile.locale;
  persistLocale(profile.locale);
  loadError.value = '';
  loading.value = true;
  status.value = `Loading ${profile.label}`;
  try {
    await previewScene.value?.load(profile);
    if (isCurrentSelection(serial)) {
      status.value = `${profile.label} host selected`;
    }
  } catch (err) {
    if (isCurrentSelection(serial)) {
      loadError.value = (err as Error).message;
      status.value = `${profile.label} asset unavailable`;
    }
  } finally {
    if (isCurrentSelection(serial)) {
      loading.value = false;
    }
  }
}

onMounted(async () => {
  mounted = true;
  await nextTick();
  if (!mounted || !previewRoot.value) return;
  const scene = createLanguageHostPreviewScene(previewRoot.value);
  previewScene.value = scene;
  await selectHost(selectedProfile.value);
});

onUnmounted(() => {
  mounted = false;
  selectionSerial += 1;
  previewScene.value?.dispose();
  previewScene.value = null;
});
</script>

<template>
  <div id="hosts-page">
    <section class="hosts-preview">
      <div ref="previewRoot" class="hosts-preview-canvas" aria-label="Language host preview"></div>
      <div class="hosts-preview-status" aria-live="polite">
        <span>{{ status }}</span>
        <span v-if="loading" class="hosts-loading">Loading</span>
      </div>
    </section>

    <aside class="hosts-panel" aria-label="Language hosts">
      <div class="hosts-heading">
        <h1>Hosts</h1>
        <p>Select a language host for this preview scene.</p>
      </div>

      <div class="hosts-list">
        <button
          v-for="profile in profiles"
          :key="profile.locale"
          class="host-option"
          :class="{ active: profile.locale === selectedLocale }"
          type="button"
          :aria-pressed="profile.locale === selectedLocale"
          @click="selectHost(profile)"
        >
          <span class="host-label">{{ profile.label }}</span>
          <span class="host-native">{{ profile.nativeLabel }}</span>
          <span class="host-locale">{{ profile.locale }}</span>
        </button>
      </div>

      <div class="hosts-meta">
        <dl>
          <div>
            <dt>Voice</dt>
            <dd>{{ selectedProfile.voiceId }}</dd>
          </div>
          <div>
            <dt>Expression</dt>
            <dd>{{ selectedProfile.expressionPreset }}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{{ selectedProfile.modelUrl }}</dd>
          </div>
        </dl>
      </div>

      <p v-if="loadError" class="hosts-error">
        {{ loadError }}
      </p>

      <Button
        class="hosts-reload"
        icon="pi pi-refresh"
        label="Reload"
        size="small"
        :disabled="loading"
        @click="selectHost(selectedProfile)"
      />
    </aside>
  </div>
</template>

<style scoped>
#hosts-page {
  position: fixed;
  inset: 54px 0 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
  gap: 14px;
  padding: 14px;
  color: rgba(255, 255, 255, 0.86);
  background: #101316;
}

.hosts-preview {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(169, 210, 215, 0.11);
  background: #15191d;
}

.hosts-preview-canvas {
  width: 100%;
  height: 100%;
  min-height: 360px;
}

.hosts-preview-canvas :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}

.hosts-preview-status {
  position: absolute;
  left: 12px;
  bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border-radius: 7px;
  background: rgba(10, 12, 14, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px;
}

.hosts-loading {
  color: #9cecf2;
}

.hosts-panel {
  min-width: 0;
  overflow: auto;
  padding: 14px;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
}

.hosts-heading h1 {
  margin: 0;
  font-size: 20px;
}

.hosts-heading p {
  margin: 5px 0 14px;
  color: rgba(255, 255, 255, 0.62);
  font-size: 13px;
  line-height: 1.4;
}

.hosts-list {
  display: grid;
  gap: 8px;
}

.host-option {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 3px 8px;
  width: 100%;
  padding: 10px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.host-option:hover {
  background: rgba(255, 255, 255, 0.07);
}

.host-option.active {
  border-color: rgba(30, 188, 196, 0.48);
  background: rgba(30, 188, 196, 0.16);
}

.host-label {
  font-weight: 800;
}

.host-native,
.host-locale {
  color: rgba(255, 255, 255, 0.62);
  font-size: 12px;
}

.host-native {
  grid-column: 1;
}

.host-locale {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
  font-family: var(--font-mono);
}

.hosts-meta {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.hosts-meta dl {
  display: grid;
  gap: 9px;
  margin: 0;
}

.hosts-meta div {
  display: grid;
  gap: 2px;
}

.hosts-meta dt {
  color: rgba(255, 255, 255, 0.48);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}

.hosts-meta dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  color: rgba(255, 255, 255, 0.78);
  font-size: 12px;
}

.hosts-error {
  margin: 14px 0 0;
  padding: 9px;
  border-radius: 7px;
  background: rgba(184, 64, 64, 0.16);
  color: #ffc2c2;
  font-size: 12px;
  line-height: 1.4;
}

:deep(.hosts-reload.p-button) {
  margin-top: 14px;
}

@media (max-width: 800px) {
  #hosts-page {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(300px, 52vh) minmax(0, 1fr);
  }

  .hosts-panel {
    border-left: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
}
</style>
