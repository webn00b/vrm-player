# Language Host Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate Hosts tab where users can choose and preview locale-specific VRM host profiles in an isolated scene without changing the main player avatar or runtime.

**Architecture:** Language hosts are represented as typed data in `src/languageHosts.ts`. The Hosts tab owns a separate Vue page, canvas, Three.js scene, camera, controls, renderer, render loop, and `AvatarCharacterManager`; selecting a host swaps only the model in that preview scene. The main Player, Retarget, Export, playback, mocap, tooling, and render-loop modules are not modified to consume the selected host.

**Tech Stack:** Vite, TypeScript, Vue 3, PrimeVue, three.js, `@pixiv/three-vrm`, Vitest, Playwright.

---

## File Structure

- Create `src/languageHosts.ts`: typed registry for supported locales, model URLs, labels, voice IDs, greetings, idle sets, and fallback resolution.
- Create `tests/regression/languageHosts.test.ts`: unit tests for locale normalization, fallback behavior, supported host list, and runtime immutability.
- Create `src/avatarCharacterManager.ts`: scene-local manager that loads a VRM, swaps it into one `THREE.Scene`, removes the previous VRM, disposes stale/old models, and guards against stale async loads.
- Create `tests/regression/avatarCharacterManager.test.ts`: unit tests using mocked VRM-like objects and a real `THREE.Scene`.
- Create `src/languageHostPreviewScene.ts`: isolated Three.js preview scene for the Hosts tab; it creates its own renderer/camera/controls/render loop and uses `AvatarCharacterManager`.
- Create `src/playerVue/LanguageHostsPage.vue`: Vue page that lists hosts, persists the selected locale, and mounts the isolated preview scene.
- Modify `src/playerVue/PlayerShell.vue`: add a `Hosts` top-level tab and render `LanguageHostsPage` inside it.
- Modify `docs/architecture.md`: document that Hosts is a separate preview scene and does not swap the main player avatar.
- Create `docs/language-hosts.md`: document the host asset contract.
- Create `tests/e2e/language-hosts.spec.ts`: browser smoke test for tab navigation and host selection UI; VRM asset rendering checks stay skipped unless host assets are present.

## Non-Goals

- Do not modify `src/main.ts`.
- Do not modify `src/player/modules/vrmModule.ts`, `playbackModule.ts`, `toolingModule.ts`, `mocapModule.ts`, or `renderLoopModule.ts`.
- Do not create `src/avatarRuntime.ts`.
- Do not add a language selector to `src/playerVue/SceneToolbar.vue`.
- Do not dispatch or consume `vrm-player:language-changed` for the main player runtime.
- Do not make the selected host replace the avatar in the Player tab.

## Task 1: Add Language Host Registry

**Files:**
- Create: `src/languageHosts.ts`
- Create: `tests/regression/languageHosts.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/regression/languageHosts.test.ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LANGUAGE_HOSTS,
  getLanguageHostProfiles,
  isSupportedLocale,
  normalizeLocale,
  resolveLanguageHostProfile,
} from '../../src/languageHosts';

describe('language host profiles', () => {
  it('contains the initial five language hosts', () => {
    expect(Object.keys(LANGUAGE_HOSTS).sort()).toEqual([
      'en-US',
      'es-ES',
      'fr-FR',
      'ja-JP',
      'ru-RU',
    ]);
  });

  it('returns profiles in display order', () => {
    expect(getLanguageHostProfiles().map((profile) => profile.locale)).toEqual([
      'en-US',
      'ja-JP',
      'es-ES',
      'fr-FR',
      'ru-RU',
    ]);
  });

  it('normalizes common language-only locale inputs', () => {
    expect(normalizeLocale('en')).toBe('en-US');
    expect(normalizeLocale('ja')).toBe('ja-JP');
    expect(normalizeLocale('es')).toBe('es-ES');
    expect(normalizeLocale('fr')).toBe('fr-FR');
    expect(normalizeLocale('ru')).toBe('ru-RU');
  });

  it('normalizes mixed-case BCP-47 inputs', () => {
    expect(normalizeLocale('JA-jp')).toBe('ja-JP');
    expect(normalizeLocale('ru-ru')).toBe('ru-RU');
  });

  it('returns the exact profile for supported BCP-47 locale inputs', () => {
    const profile = resolveLanguageHostProfile('ja-JP');
    expect(profile.locale).toBe('ja-JP');
    expect(profile.modelUrl).toBe('/models/hosts/ja-JP/host.vrm');
    expect(profile.voiceId).toBe('ja-JP-host');
  });

  it('falls back to the default host for unsupported locales', () => {
    const profile = resolveLanguageHostProfile('de-DE');
    expect(profile.locale).toBe(DEFAULT_LOCALE);
    expect(profile.modelUrl).toBe('/models/hosts/en-US/host.vrm');
  });

  it('checks supported locales after normalization', () => {
    expect(isSupportedLocale('fr-FR')).toBe(true);
    expect(isSupportedLocale('FR-fr')).toBe(true);
    expect(isSupportedLocale('de-DE')).toBe(false);
  });

  it('keeps profile arrays readonly at runtime by returning frozen objects', () => {
    const profile = resolveLanguageHostProfile('en-US');
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.idleAnimations)).toBe(true);
    expect(Object.isFrozen(getLanguageHostProfiles())).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/regression/languageHosts.test.ts`

Expected: FAIL with an import error for `../../src/languageHosts`.

- [ ] **Step 3: Implement the registry**

```ts
// src/languageHosts.ts
export type SupportedLocale = 'en-US' | 'ja-JP' | 'es-ES' | 'fr-FR' | 'ru-RU';

export interface LanguageHostProfile {
  locale: SupportedLocale;
  label: string;
  nativeLabel: string;
  modelUrl: string;
  voiceId: string;
  greetingAnimation: string;
  idleAnimations: readonly string[];
  expressionPreset: 'neutral' | 'warm-subtle' | 'bright' | 'reserved';
  cameraPreset: 'portrait-medium';
}

export const DEFAULT_LOCALE: SupportedLocale = 'en-US';

const freezeProfile = (profile: LanguageHostProfile): LanguageHostProfile => Object.freeze({
  ...profile,
  idleAnimations: Object.freeze([...profile.idleAnimations]),
});

export const LANGUAGE_HOSTS: Readonly<Record<SupportedLocale, LanguageHostProfile>> = Object.freeze({
  'en-US': freezeProfile({
    locale: 'en-US',
    label: 'English',
    nativeLabel: 'English',
    modelUrl: '/models/hosts/en-US/host.vrm',
    voiceId: 'en-US-host',
    greetingAnimation: 'en-US-greeting',
    idleAnimations: ['en-US-idle-01', 'shared-idle-breathing'],
    expressionPreset: 'warm-subtle',
    cameraPreset: 'portrait-medium',
  }),
  'ja-JP': freezeProfile({
    locale: 'ja-JP',
    label: 'Japanese',
    nativeLabel: '日本語',
    modelUrl: '/models/hosts/ja-JP/host.vrm',
    voiceId: 'ja-JP-host',
    greetingAnimation: 'ja-JP-greeting',
    idleAnimations: ['ja-JP-idle-01', 'shared-idle-breathing'],
    expressionPreset: 'reserved',
    cameraPreset: 'portrait-medium',
  }),
  'es-ES': freezeProfile({
    locale: 'es-ES',
    label: 'Spanish',
    nativeLabel: 'Español',
    modelUrl: '/models/hosts/es-ES/host.vrm',
    voiceId: 'es-ES-host',
    greetingAnimation: 'es-ES-greeting',
    idleAnimations: ['es-ES-idle-01', 'shared-idle-breathing'],
    expressionPreset: 'bright',
    cameraPreset: 'portrait-medium',
  }),
  'fr-FR': freezeProfile({
    locale: 'fr-FR',
    label: 'French',
    nativeLabel: 'Français',
    modelUrl: '/models/hosts/fr-FR/host.vrm',
    voiceId: 'fr-FR-host',
    greetingAnimation: 'fr-FR-greeting',
    idleAnimations: ['fr-FR-idle-01', 'shared-idle-breathing'],
    expressionPreset: 'neutral',
    cameraPreset: 'portrait-medium',
  }),
  'ru-RU': freezeProfile({
    locale: 'ru-RU',
    label: 'Russian',
    nativeLabel: 'Русский',
    modelUrl: '/models/hosts/ru-RU/host.vrm',
    voiceId: 'ru-RU-host',
    greetingAnimation: 'ru-RU-greeting',
    idleAnimations: ['ru-RU-idle-01', 'shared-idle-breathing'],
    expressionPreset: 'warm-subtle',
    cameraPreset: 'portrait-medium',
  }),
});

const DISPLAY_ORDER: readonly SupportedLocale[] = Object.freeze([
  'en-US',
  'ja-JP',
  'es-ES',
  'fr-FR',
  'ru-RU',
]);

const LANGUAGE_ONLY_TO_LOCALE: Readonly<Record<string, SupportedLocale>> = Object.freeze({
  en: 'en-US',
  ja: 'ja-JP',
  es: 'es-ES',
  fr: 'fr-FR',
  ru: 'ru-RU',
});

function canonicalizeLocale(input: string): string {
  const [language, region] = input.split('-');
  if (!language) return '';
  if (!region) return language.toLowerCase();
  return `${language.toLowerCase()}-${region.toUpperCase()}`;
}

export function normalizeLocale(input: string | null | undefined): SupportedLocale {
  if (!input) return DEFAULT_LOCALE;
  const canonical = canonicalizeLocale(input);
  if (Object.prototype.hasOwnProperty.call(LANGUAGE_HOSTS, canonical)) {
    return canonical as SupportedLocale;
  }
  const language = canonical.split('-')[0];
  return LANGUAGE_ONLY_TO_LOCALE[language] ?? DEFAULT_LOCALE;
}

export function isSupportedLocale(input: string | null | undefined): boolean {
  if (!input) return false;
  const canonical = canonicalizeLocale(input);
  return Object.prototype.hasOwnProperty.call(LANGUAGE_HOSTS, canonical);
}

export function resolveLanguageHostProfile(input: string | null | undefined): LanguageHostProfile {
  return LANGUAGE_HOSTS[normalizeLocale(input)];
}

export function getLanguageHostProfiles(): readonly LanguageHostProfile[] {
  return Object.freeze(DISPLAY_ORDER.map((locale) => LANGUAGE_HOSTS[locale]));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/regression/languageHosts.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/languageHosts.ts tests/regression/languageHosts.test.ts
git commit -m "feat: add language host profiles"
```

## Task 2: Add Scene-Local Avatar Character Manager

**Files:**
- Create: `src/avatarCharacterManager.ts`
- Create: `tests/regression/avatarCharacterManager.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/regression/avatarCharacterManager.test.ts
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { VRM } from '@pixiv/three-vrm';
import { AvatarCharacterManager } from '../../src/avatarCharacterManager';
import { resolveLanguageHostProfile } from '../../src/languageHosts';

function mockVrm(name: string): VRM {
  const scene = new THREE.Group();
  scene.name = name;
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial();
  scene.add(new THREE.Mesh(geometry, material));
  return { scene } as VRM;
}

describe('AvatarCharacterManager', () => {
  it('loads and adds the requested language host to the scene', async () => {
    const scene = new THREE.Scene();
    const loadVrm = vi.fn(async () => mockVrm('english-host'));
    const manager = new AvatarCharacterManager({ scene, loadVrm });

    const active = await manager.swapTo(resolveLanguageHostProfile('en-US'));

    expect(loadVrm).toHaveBeenCalledWith('/models/hosts/en-US/host.vrm');
    expect(active.profile.locale).toBe('en-US');
    expect(scene.children).toContain(active.vrm.scene);
  });

  it('removes the previous host after a successful swap', async () => {
    const scene = new THREE.Scene();
    const first = mockVrm('first');
    const second = mockVrm('second');
    const loadVrm = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const manager = new AvatarCharacterManager({ scene, loadVrm });

    await manager.swapTo(resolveLanguageHostProfile('en-US'));
    await manager.swapTo(resolveLanguageHostProfile('ja-JP'));

    expect(scene.children).not.toContain(first.scene);
    expect(scene.children).toContain(second.scene);
    expect(manager.current?.profile.locale).toBe('ja-JP');
  });

  it('keeps the current host when a new host fails to load', async () => {
    const scene = new THREE.Scene();
    const first = mockVrm('first');
    const loadVrm = vi.fn()
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error('missing file'));
    const manager = new AvatarCharacterManager({ scene, loadVrm });

    await manager.swapTo(resolveLanguageHostProfile('en-US'));
    await expect(manager.swapTo(resolveLanguageHostProfile('ja-JP'))).rejects.toThrow('missing file');

    expect(scene.children).toContain(first.scene);
    expect(manager.current?.profile.locale).toBe('en-US');
  });

  it('ignores stale slower loads when a newer swap finishes first', async () => {
    const scene = new THREE.Scene();
    let resolveSlow!: (vrm: VRM) => void;
    const slow = new Promise<VRM>((resolve) => { resolveSlow = resolve; });
    const fast = Promise.resolve(mockVrm('fast'));
    const loadVrm = vi.fn()
      .mockReturnValueOnce(slow)
      .mockReturnValueOnce(fast);
    const manager = new AvatarCharacterManager({ scene, loadVrm });

    const slowSwap = manager.swapTo(resolveLanguageHostProfile('fr-FR'));
    const fastSwap = manager.swapTo(resolveLanguageHostProfile('ru-RU'));
    await fastSwap;
    resolveSlow(mockVrm('slow'));
    await expect(slowSwap).rejects.toThrow('superseded');

    expect(manager.current?.profile.locale).toBe('ru-RU');
    expect(scene.children.map((child) => child.name)).toEqual(['fast']);
  });

  it('removes the active host when disposed', async () => {
    const scene = new THREE.Scene();
    const loadVrm = vi.fn(async () => mockVrm('english-host'));
    const manager = new AvatarCharacterManager({ scene, loadVrm });

    await manager.swapTo(resolveLanguageHostProfile('en-US'));
    manager.dispose();

    expect(scene.children).toEqual([]);
    expect(manager.current).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/regression/avatarCharacterManager.test.ts`

Expected: FAIL with an import error for `../../src/avatarCharacterManager`.

- [ ] **Step 3: Implement the manager**

```ts
// src/avatarCharacterManager.ts
import type * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { LanguageHostProfile } from './languageHosts';

export interface ActiveAvatar {
  profile: LanguageHostProfile;
  vrm: VRM;
}

export interface AvatarCharacterManagerDeps {
  scene: THREE.Scene;
  loadVrm: (url: string) => Promise<VRM>;
}

export class AvatarSwapSupersededError extends Error {
  constructor() {
    super('avatar swap superseded by a newer request');
    this.name = 'AvatarSwapSupersededError';
  }
}

export class AvatarCharacterManager {
  private readonly scene: THREE.Scene;
  private readonly loadVrm: (url: string) => Promise<VRM>;
  private active: ActiveAvatar | null = null;
  private swapSerial = 0;

  constructor(deps: AvatarCharacterManagerDeps) {
    this.scene = deps.scene;
    this.loadVrm = deps.loadVrm;
  }

  get current(): ActiveAvatar | null {
    return this.active;
  }

  async swapTo(profile: LanguageHostProfile): Promise<ActiveAvatar> {
    const serial = ++this.swapSerial;
    const nextVrm = await this.loadVrm(profile.modelUrl);
    if (serial !== this.swapSerial) {
      this.disposeVrm(nextVrm);
      throw new AvatarSwapSupersededError();
    }

    const previous = this.active;
    const next = { profile, vrm: nextVrm };
    this.scene.add(nextVrm.scene);
    this.active = next;

    if (previous) {
      previous.vrm.scene.parent?.remove(previous.vrm.scene);
      this.disposeVrm(previous.vrm);
    }

    return next;
  }

  dispose(): void {
    this.swapSerial += 1;
    if (!this.active) return;
    this.active.vrm.scene.parent?.remove(this.active.vrm.scene);
    this.disposeVrm(this.active.vrm);
    this.active = null;
  }

  private disposeVrm(vrm: VRM): void {
    vrm.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) {
        material.forEach((item) => item.dispose());
      } else {
        material?.dispose();
      }
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/regression/avatarCharacterManager.test.ts tests/regression/languageHosts.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/avatarCharacterManager.ts tests/regression/avatarCharacterManager.test.ts
git commit -m "feat: add language host scene manager"
```

## Task 3: Add Isolated Host Preview Scene

**Files:**
- Create: `src/languageHostPreviewScene.ts`

- [ ] **Step 1: Create the preview scene module**

```ts
// src/languageHostPreviewScene.ts
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AvatarCharacterManager } from './avatarCharacterManager';
import type { LanguageHostProfile } from './languageHosts';
import { loadVRM } from './vrmLoader';

export interface LanguageHostPreviewScene {
  readonly canvas: HTMLCanvasElement;
  readonly manager: AvatarCharacterManager;
  load(profile: LanguageHostProfile): Promise<void>;
  resize(): void;
  dispose(): void;
}

export function createLanguageHostPreviewScene(container: HTMLElement): LanguageHostPreviewScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15191d);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  camera.position.set(0, 1.32, 3.1);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.id = 'language-host-preview-canvas';
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.08, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 1.6;
  controls.maxDistance = 4.2;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x283044, 1.1);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(1.4, 2.4, 2.2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9ccfff, 0.55);
  fill.position.set(-1.8, 1.2, 1.6);
  scene.add(fill);

  const grid = new THREE.GridHelper(3.2, 8, 0x53616d, 0x26313a);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.38;
  scene.add(grid);

  const manager = new AvatarCharacterManager({ scene, loadVrm: loadVRM });
  const clock = new THREE.Clock();
  let rafId = 0;
  let disposed = false;

  const resize = (): void => {
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };

  const tick = (): void => {
    if (disposed) return;
    const delta = clock.getDelta();
    controls.update();
    manager.current?.vrm.update(delta);
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  };

  const onResize = (): void => resize();
  window.addEventListener('resize', onResize);
  resize();
  tick();

  return {
    canvas: renderer.domElement,
    manager,
    async load(profile: LanguageHostProfile): Promise<void> {
      await manager.swapTo(profile);
    },
    resize,
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      manager.dispose();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
```

- [ ] **Step 2: Run typecheck/build**

Run: `npm run build`

Expected: PASS, or FAIL only because the component that consumes this module does not exist yet. If it fails for a type error inside `src/languageHostPreviewScene.ts`, fix that type error before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/languageHostPreviewScene.ts
git commit -m "feat: add isolated language host preview scene"
```

## Task 4: Add Hosts Vue Page

**Files:**
- Create: `src/playerVue/LanguageHostsPage.vue`

- [ ] **Step 1: Create the Hosts page component**

```vue
<!-- src/playerVue/LanguageHostsPage.vue -->
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

async function selectHost(profile: LanguageHostProfile): Promise<void> {
  selectedLocale.value = profile.locale;
  persistLocale(profile.locale);
  loadError.value = '';
  loading.value = true;
  status.value = `Loading ${profile.label}`;
  try {
    await previewScene.value?.load(profile);
    status.value = `${profile.label} host selected`;
  } catch (err) {
    loadError.value = (err as Error).message;
    status.value = `${profile.label} asset unavailable`;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await nextTick();
  if (!previewRoot.value) return;
  const scene = createLanguageHostPreviewScene(previewRoot.value);
  previewScene.value = scene;
  await selectHost(selectedProfile.value);
});

onUnmounted(() => {
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
```

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: PASS, or FAIL only because `LanguageHostsPage.vue` is not imported yet. If it fails for a type error inside `LanguageHostsPage.vue`, fix that type error before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/playerVue/LanguageHostsPage.vue
git commit -m "feat: add language hosts page"
```

## Task 5: Add Hosts Tab To Player Shell

**Files:**
- Modify: `src/playerVue/PlayerShell.vue`

- [ ] **Step 1: Update page type, options, import, and stored-page parsing**

In `src/playerVue/PlayerShell.vue`, add the import near the existing `FileConverter` import:

```ts
import LanguageHostsPage from './LanguageHostsPage.vue';
```

Change the page type and options to:

```ts
type AppPage = 'player' | 'retarget' | 'tools' | 'hosts';
const pageOptions: Array<{ label: string; value: AppPage }> = [
  { label: 'Player', value: 'player' },
  { label: 'Retarget', value: 'retarget' },
  { label: 'Export', value: 'tools' },
  { label: 'Hosts', value: 'hosts' },
];
```

Change stored-page initialization to:

```ts
const activePage = ref<AppPage>(
  storedPage === 'tools' || storedPage === 'retarget' || storedPage === 'hosts'
    ? storedPage
    : 'player',
);
```

Change `onSetPage()` to accept the new page:

```ts
function onSetPage(event: Event): void {
  const page = (event as CustomEvent<AppPage>).detail;
  if (page === 'player' || page === 'retarget' || page === 'tools' || page === 'hosts') {
    setPage(page, false);
  }
}
```

- [ ] **Step 2: Render the Hosts tab**

Add this block after the existing `retarget-page` block:

```vue
  <div id="hosts-page-root" v-show="activePage === 'hosts'">
    <LanguageHostsPage />
  </div>
```

Ensure the existing player overlay remains gated by `activePage === 'player'` and the shell actions remain hidden outside the Player tab:

```vue
    <div class="shell-actions" v-show="activePage === 'player'">
```

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/playerVue/PlayerShell.vue
git commit -m "feat: add hosts tab"
```

## Task 6: Add E2E Smoke Test For Hosts Tab

**Files:**
- Create: `tests/e2e/language-hosts.spec.ts`

- [ ] **Step 1: Write Playwright test**

```ts
// tests/e2e/language-hosts.spec.ts
import { expect, test } from '@playwright/test';

test('hosts tab renders host choices without disturbing the player canvas', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(`pageerror: ${err.message}`);
  });

  await page.goto('/');
  await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: /^Hosts$/ }).click();

  await expect(page.getByRole('heading', { name: 'Hosts' })).toBeVisible();
  await expect(page.getByRole('button', { name: /English/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Japanese/ })).toBeVisible();
  await expect(page.locator('#language-host-preview-canvas')).toBeAttached();

  await page.getByRole('button', { name: /Japanese/ }).click();
  await expect(page.getByRole('button', { name: /Japanese/ })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: /^Player$/ }).click();
  await expect(page.locator('#ui-overlay')).toBeVisible();

  const filtered = consoleErrors.filter((line) => {
    if (/Failed to load resource/i.test(line)) return false;
    if (/AbortError/i.test(line)) return false;
    if (/No VRM data/i.test(line)) return false;
    return true;
  });
  expect(filtered, `console errors found:\n${filtered.join('\n')}`).toEqual([]);
});

test('hosts tab can render a checked-in host VRM asset', async ({ page }) => {
  test.skip(!process.env.VRM_HOST_ASSETS_READY, 'language host VRM assets are not checked into the repo');

  await page.goto('/');
  await page.getByRole('button', { name: /^Hosts$/ }).click();
  await expect(page.locator('#language-host-preview-canvas')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/host selected|asset unavailable/i)).toBeVisible({ timeout: 15_000 });
});
```

- [ ] **Step 2: Run e2e test**

Run: `npm run test:e2e -- tests/e2e/language-hosts.spec.ts`

Expected: PASS. The second test is skipped unless `VRM_HOST_ASSETS_READY=1` is set.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/language-hosts.spec.ts
git commit -m "test: cover hosts tab"
```

## Task 7: Document Host Asset Contract

**Files:**
- Modify: `docs/architecture.md`
- Create: `docs/language-hosts.md`

- [ ] **Step 1: Add architecture section**

Append this section to `docs/architecture.md`:

```md
## Language host preview

Language hosts are previewed in a separate top-level `Hosts` tab. The tab uses `src/languageHosts.ts` to resolve supported locales to `LanguageHostProfile` records, then mounts `LanguageHostsPage.vue`, which owns an isolated Three.js preview scene through `createLanguageHostPreviewScene()`.

The Hosts tab does not replace the active VRM in the Player tab. It has its own scene, camera, renderer, controls, render loop, and `AvatarCharacterManager`. The main player modules (`vrmModule`, `playbackModule`, `toolingModule`, `mocapModule`, and `renderLoopModule`) continue to use the normal player VRM selected by the existing startup and upload flow.
```

- [ ] **Step 2: Add asset contract doc**

```md
# Language Host Asset Contract

The Hosts tab previews one complete VRM host model per supported language:

- `public/models/hosts/en-US/host.vrm`
- `public/models/hosts/ja-JP/host.vrm`
- `public/models/hosts/es-ES/host.vrm`
- `public/models/hosts/fr-FR/host.vrm`
- `public/models/hosts/ru-RU/host.vrm`

Every host should provide a valid VRM humanoid skeleton and these expression names:

- `blinkLeft`
- `blinkRight`
- `aa`
- `happy`
- `sad`
- `angry`
- `relaxed`

The first implementation treats clothing, face, hair, and cultural styling as part of the complete VRM file. Runtime clothing transfer between hosts is outside the Hosts tab scope.

The fallback host is `en-US`. Unsupported locales are normalized by language code first, then fall back to `en-US`.

The Hosts tab is isolated from the main Player tab. Selecting a host stores `vrm-player.language-locale` and updates only the preview scene.
```

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md docs/language-hosts.md
git commit -m "docs: describe language host preview"
```

## Task 8: Full Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run unit tests for new modules**

Run:

```bash
npx vitest run \
  tests/regression/languageHosts.test.ts \
  tests/regression/avatarCharacterManager.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run project build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Run circular dependency check**

Run: `npm run test:circular`

Expected: PASS with no circular dependencies.

- [ ] **Step 4: Run Hosts tab browser smoke**

Run: `npm run test:e2e -- tests/e2e/language-hosts.spec.ts`

Expected: PASS, with asset-rendering checks skipped unless `VRM_HOST_ASSETS_READY=1` is set.
