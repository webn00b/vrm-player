<script setup lang="ts">
import { computed, ref } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import SelectButton from 'primevue/selectbutton';
import { useToast } from 'primevue/usetoast';
import type { VRM } from '@pixiv/three-vrm';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { ManualFbxBoneMapping } from '../animationLoaders/fbxBoneMapping';
import {
  RETARGET_BONE_SLOTS,
  analyzeRetargetLabFile,
  baseAnimationName,
  getRetargetTargetJoints,
  isRetargetLabFile,
  type RetargetLabAnalysis,
  type SkeletonJointMeta,
} from '../retargetLabModel';

const props = defineProps<{
  vrm: VRM;
  onImport: (file: File, manualMapping: ManualFbxBoneMapping) => Promise<void>;
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const presetInput = ref<HTMLInputElement | null>(null);
const currentFile = ref<File | null>(null);
const analysis = ref<RetargetLabAnalysis | null>(null);
const mapping = ref<ManualFbxBoneMapping>({});
const loading = ref(false);
const importing = ref(false);
const error = ref('');
const dragActive = ref(false);
const currentTargetJoints = ref(getRetargetTargetJoints(props.vrm));
const infoModalOpen = ref(false);
const toast = useToast();

const PRESET_STORAGE_KEY = 'vrm-player.retarget-lab.presets';

interface RetargetPreset {
  id: string;
  name: string;
  format: string;
  sourceSignature: string;
  sourceJointCount: number;
  mappedCount: number;
  mapping: ManualFbxBoneMapping;
  createdAt: string;
  updatedAt: string;
}

type MappingView = 'body' | 'fingers' | 'all';
const mappingView = ref<MappingView>('body');
const mappingViewOptions: Array<{ label: string; value: MappingView }> = [
  { label: 'Body', value: 'body' },
  { label: 'Fingers', value: 'fingers' },
  { label: 'All', value: 'all' },
];

const presetName = ref('');
const selectedPresetId = ref('');
const presets = ref<RetargetPreset[]>(loadPresets());

const sourceOptions = computed(() => analysis.value?.sourceJoints ?? []);
const targetJoints = computed(() => analysis.value?.targetJoints ?? currentTargetJoints.value);
const tableSlotNames = new Set(RETARGET_BONE_SLOTS.map((slot) => slot.name));
const mappedCount = computed(() => RETARGET_BONE_SLOTS.filter((slot) => !!mapping.value[slot.name]).length);
const extraMappedEntries = computed(() => (
  Object.entries(mapping.value) as Array<[VRMHumanBoneName, string | undefined]>
).filter(([slot, source]) => !!source && !tableSlotNames.has(slot)));
const requiredMissing = computed(() => RETARGET_BONE_SLOTS.filter((slot) => slot.required && !mapping.value[slot.name]));
const canImport = computed(() => !!currentFile.value && !loading.value && !importing.value);
const selectedPreset = computed(() => presets.value.find((preset) => preset.id === selectedPresetId.value) ?? null);
const isFingerSlot = (slot: VRMHumanBoneName): boolean => (
  slot.includes('Thumb') ||
  slot.includes('Index') ||
  slot.includes('Middle') ||
  slot.includes('Ring') ||
  slot.includes('Little')
);
const visibleRetargetSlots = computed(() => RETARGET_BONE_SLOTS.filter((slot) => {
  if (mappingView.value === 'all') return true;
  const finger = isFingerSlot(slot.name);
  return mappingView.value === 'fingers' ? finger : !finger;
}));

interface PreviewNode {
  id: string;
  name: string;
  x: number;
  y: number;
  active: boolean;
  missing: boolean;
}

interface PreviewLine {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  active: boolean;
}

function buildPreview(
  joints: SkeletonJointMeta[],
  activeNames: Set<string>,
  missingNames: Set<string> = new Set(),
): { nodes: PreviewNode[]; lines: PreviewLine[] } {
  if (joints.length === 0) return { nodes: [], lines: [] };

  const xs = joints.map((j) => j.position[0]);
  const ys = joints.map((j) => j.position[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 0.001);
  const spanY = Math.max(maxY - minY, 0.001);
  const byId = new Map(joints.map((j) => [j.id, j]));
  const toPoint = (j: SkeletonJointMeta) => ({
    x: 10 + ((j.position[0] - minX) / spanX) * 80,
    y: 90 - ((j.position[1] - minY) / spanY) * 80,
  });
  const nodes = joints.map((j) => {
    const p = toPoint(j);
    return {
      id: j.id,
      name: j.name,
      x: p.x,
      y: p.y,
      active: activeNames.has(j.name),
      missing: missingNames.has(j.name),
    };
  });
  const lines = joints.flatMap((j) => {
    if (!j.parentId) return [];
    const parent = byId.get(j.parentId);
    if (!parent) return [];
    const a = toPoint(parent);
    const b = toPoint(j);
    return [{
      id: `${j.parentId}-${j.id}`,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      active: activeNames.has(j.name) && activeNames.has(parent.name),
    }];
  });
  return { nodes, lines };
}

const mappedSourceNames = computed(() => new Set(Object.values(mapping.value).filter((name): name is string => !!name)));
const mappedTargetNames = computed(() => new Set(
  (Object.keys(mapping.value) as VRMHumanBoneName[]).filter((slot) => !!mapping.value[slot]),
));
const missingTargetNames = computed(() => new Set(requiredMissing.value.map((slot) => slot.name)));
const sourcePreview = computed(() => buildPreview(analysis.value?.sourceJoints ?? [], mappedSourceNames.value));
const targetPreview = computed(() => buildPreview(targetJoints.value, mappedTargetNames.value, missingTargetNames.value));

function loadPresets(): RetargetPreset[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RetargetPreset => (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as RetargetPreset).id === 'string' &&
      typeof (item as RetargetPreset).name === 'string' &&
      typeof (item as RetargetPreset).mapping === 'object'
    ));
  } catch {
    return [];
  }
}

function persistPresets(): void {
  try {
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets.value));
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Save failed',
      detail: (e as Error).message,
      life: 3000,
    });
  }
}

function sourceSignature(): string {
  const joints = analysis.value?.sourceJoints ?? [];
  return joints.map((joint) => joint.name).join('|');
}

function cleanedMapping(): ManualFbxBoneMapping {
  const out: ManualFbxBoneMapping = {};
  for (const [slot, source] of Object.entries(mapping.value) as Array<[VRMHumanBoneName, string | undefined]>) {
    if (source) out[slot] = source;
  }
  return out;
}

function defaultPresetName(): string {
  if (presetName.value.trim()) return presetName.value.trim();
  if (currentFile.value) return baseAnimationName(currentFile.value.name);
  const now = new Date();
  return `retarget-${now.toISOString().slice(0, 10)}`;
}

const retargetInfoText = computed(() => {
  const file = currentFile.value;
  const a = analysis.value;
  const missingRequired = requiredMissing.value.map((slot) => slot.label);
  const mappedRows = RETARGET_BONE_SLOTS
    .map((slot) => {
      const source = mapping.value[slot.name] || 'UNASSIGNED';
      const flag = slot.required ? 'required' : 'optional';
      return `${slot.name.padEnd(28)} <- ${source} (${flag})`;
    })
    .join('\n');
  const extraRows = extraMappedEntries.value
    .map(([slot, source]) => `${slot.padEnd(28)} <- ${source}`)
    .join('\n') || '- none';
  const sourceJoints = (a?.sourceJoints ?? [])
    .map((joint) => {
      const animated = joint.trackCount > 0 ? ` tracks=${joint.trackCount}` : '';
      return `- ${joint.name}${animated}`;
    })
    .join('\n') || '- none loaded';
  const targetJointRows = targetJoints.value
    .map((joint) => `- ${joint.name}${joint.parentId ? ` parent=${joint.parentId}` : ''}`)
    .join('\n') || '- none';
  const warningRows = (a?.warnings ?? [])
    .map((warning) => `- ${warning}`)
    .join('\n') || '- none';

  return [
    'Retarget Lab Report',
    '===================',
    '',
    'Source',
    '------',
    `file: ${file?.name ?? 'none'}`,
    `format: ${a?.format?.toUpperCase() ?? 'none'}`,
    `clips: ${a?.clipCount ?? 0}`,
    `duration: ${a ? `${a.duration.toFixed(3)}s` : '0.000s'}`,
    `source joints: ${a?.sourceJoints.length ?? 0}`,
    '',
    'Target',
    '------',
    `target: current VRM`,
    `humanoid joints: ${targetJoints.value.length}`,
    '',
    'Mapping Summary',
    '---------------',
    `mapped slots: ${mappedCount.value}/${RETARGET_BONE_SLOTS.length}`,
    `extra mapped bones: ${extraMappedEntries.value.length}`,
    `missing required: ${missingRequired.length ? missingRequired.join(', ') : 'none'}`,
    '',
    'Mapping',
    '-------',
    mappedRows,
    '',
    'Extra Mapped Bones',
    '------------------',
    extraRows,
    '',
    'Warnings',
    '--------',
    warningRows,
    '',
    'Source Joints',
    '-------------',
    sourceJoints,
    '',
    'Target Joints',
    '-------------',
    targetJointRows,
  ].join('\n');
});

async function analyze(file: File): Promise<void> {
  if (!isRetargetLabFile(file)) {
    error.value = 'Unsupported file. Use .bvh, .fbx, or .vrma.';
    return;
  }
  loading.value = true;
  error.value = '';
  currentFile.value = file;
  try {
    const next = await analyzeRetargetLabFile(file, props.vrm);
    analysis.value = next;
    mapping.value = { ...next.mapping };
  } catch (e) {
    analysis.value = null;
    mapping.value = {};
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

function onPick(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void analyze(file);
  input.value = '';
}

function onDrop(event: DragEvent): void {
  dragActive.value = false;
  const file = Array.from(event.dataTransfer?.files ?? []).find(isRetargetLabFile);
  if (file) void analyze(file);
}

function updateMapping(slot: VRMHumanBoneName, value: string): void {
  mapping.value = { ...mapping.value, [slot]: value || undefined };
}

function onMappingChange(slot: VRMHumanBoneName, event: Event): void {
  updateMapping(slot, (event.target as HTMLSelectElement).value);
}

function clearMapping(): void {
  mapping.value = {};
}

function restoreAutoMapping(): void {
  if (!analysis.value) return;
  mapping.value = { ...analysis.value.mapping };
}

function savePreset(): void {
  const name = defaultPresetName();
  const now = new Date().toISOString();
  const next: RetargetPreset = {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    format: analysis.value?.format ?? 'unknown',
    sourceSignature: sourceSignature(),
    sourceJointCount: analysis.value?.sourceJoints.length ?? 0,
    mappedCount: mappedCount.value,
    mapping: cleanedMapping(),
    createdAt: now,
    updatedAt: now,
  };
  presets.value = [next, ...presets.value];
  selectedPresetId.value = next.id;
  presetName.value = name;
  persistPresets();
  toast.add({
    severity: 'success',
    summary: 'Preset saved',
    detail: `${name} · ${next.mappedCount}/${RETARGET_BONE_SLOTS.length}`,
    life: 2200,
  });
}

function loadSelectedPreset(): void {
  if (!selectedPreset.value) return;
  mapping.value = { ...selectedPreset.value.mapping };
  presetName.value = selectedPreset.value.name;
  toast.add({
    severity: 'success',
    summary: 'Preset loaded',
    detail: selectedPreset.value.name,
    life: 2000,
  });
}

function deleteSelectedPreset(): void {
  if (!selectedPreset.value) return;
  const deletedName = selectedPreset.value.name;
  presets.value = presets.value.filter((preset) => preset.id !== selectedPresetId.value);
  selectedPresetId.value = presets.value[0]?.id ?? '';
  persistPresets();
  toast.add({
    severity: 'success',
    summary: 'Preset deleted',
    detail: deletedName,
    life: 2000,
  });
}

function exportSelectedPreset(): void {
  const preset = selectedPreset.value;
  if (!preset) return;
  const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${preset.name.replace(/[^a-z0-9_.-]+/gi, '_')}.retarget-preset.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function importPresetFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text()) as Partial<RetargetPreset>;
    if (!parsed.mapping || typeof parsed.mapping !== 'object') throw new Error('Preset JSON has no mapping object');
    const now = new Date().toISOString();
    const imported: RetargetPreset = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: parsed.name || file.name.replace(/\.json$/i, ''),
      format: parsed.format || 'unknown',
      sourceSignature: parsed.sourceSignature || '',
      sourceJointCount: parsed.sourceJointCount || 0,
      mappedCount: Object.values(parsed.mapping).filter(Boolean).length,
      mapping: parsed.mapping,
      createdAt: parsed.createdAt || now,
      updatedAt: now,
    };
    presets.value = [imported, ...presets.value];
    selectedPresetId.value = imported.id;
    persistPresets();
    toast.add({
      severity: 'success',
      summary: 'Preset imported',
      detail: imported.name,
      life: 2200,
    });
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Import failed',
      detail: (e as Error).message,
      life: 3000,
    });
  }
}

async function importCurrent(): Promise<void> {
  if (!currentFile.value) return;
  importing.value = true;
  error.value = '';
  try {
    await props.onImport(currentFile.value, mapping.value);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    importing.value = false;
  }
}

async function copyRetargetInfo(): Promise<void> {
  try {
    await navigator.clipboard.writeText(retargetInfoText.value);
    toast.add({
      severity: 'success',
      summary: 'Copied',
      detail: 'Retarget report copied to clipboard',
      life: 2000,
    });
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Copy failed',
      detail: (e as Error).message,
      life: 3000,
    });
  }
}
</script>

<template>
  <div class="retarget-lab">
    <section class="lab-pane lab-source">
      <div class="lab-heading">
        <h1>Retarget Lab</h1>
        <p>Inspect a source animation, tune its humanoid mapping, then add the retargeted clip to the player queue.</p>
      </div>
      <Button
        class="info-btn"
        label="Retarget info"
        icon="pi pi-info-circle"
        size="small"
        severity="secondary"
        outlined
        @click="infoModalOpen = true"
      />

      <button
        type="button"
        class="drop-zone"
        :class="{ active: dragActive }"
        @click="fileInput?.click()"
        @dragover.prevent="dragActive = true"
        @dragleave="dragActive = false"
        @drop.prevent="onDrop"
      >
        <i class="pi pi-upload" />
        <span>{{ currentFile ? currentFile.name : 'Drop or choose .bvh / .fbx / .vrma' }}</span>
      </button>
      <input
        ref="fileInput"
        type="file"
        accept=".bvh,.fbx,.vrma"
        class="hidden-input"
        @change="onPick"
      />

      <div v-if="analysis" class="summary-grid">
        <div>
          <span>Format</span>
          <strong>{{ analysis.format.toUpperCase() }}</strong>
        </div>
        <div>
          <span>Clips</span>
          <strong>{{ analysis.clipCount }}</strong>
        </div>
        <div>
          <span>Duration</span>
          <strong>{{ analysis.duration.toFixed(2) }}s</strong>
        </div>
        <div>
          <span>Mapped</span>
          <strong>{{ mappedCount }}/{{ RETARGET_BONE_SLOTS.length }}</strong>
        </div>
      </div>

      <div v-if="analysis?.warnings.length" class="warning-list">
        <div v-for="warning in analysis.warnings" :key="warning">{{ warning }}</div>
      </div>
      <div v-if="error" class="error-box">{{ error }}</div>

      <div class="preset-panel">
        <div class="preset-title">
          <span>Mapping Presets</span>
          <small>{{ presets.length }}</small>
        </div>
        <input
          v-model="presetName"
          class="preset-name"
          type="text"
          placeholder="Preset name"
        />
        <select v-model="selectedPresetId" class="preset-select">
          <option value="">No preset selected</option>
          <option v-for="preset in presets" :key="preset.id" :value="preset.id">
            {{ preset.name }} · {{ preset.mappedCount }}/{{ RETARGET_BONE_SLOTS.length }}
          </option>
        </select>
        <div v-if="selectedPreset" class="preset-meta">
          {{ selectedPreset.format.toUpperCase() }} · {{ selectedPreset.sourceJointCount }} joints ·
          {{ new Date(selectedPreset.updatedAt).toLocaleDateString() }}
        </div>
        <div class="preset-actions">
          <Button label="Save" icon="pi pi-save" size="small" @click="savePreset" :disabled="mappedCount === 0" />
          <Button label="Load" icon="pi pi-download" size="small" text @click="loadSelectedPreset" :disabled="!selectedPreset" />
          <Button label="Delete" icon="pi pi-trash" size="small" text severity="danger" @click="deleteSelectedPreset" :disabled="!selectedPreset" />
          <Button label="Export" icon="pi pi-file-export" size="small" text @click="exportSelectedPreset" :disabled="!selectedPreset" />
          <Button label="Import" icon="pi pi-file-import" size="small" text @click="presetInput?.click()" />
        </div>
        <input
          ref="presetInput"
          class="hidden-input"
          type="file"
          accept=".json,application/json"
          @change="importPresetFile"
        />
      </div>
    </section>

    <section class="lab-pane lab-preview">
      <div class="section-title">
        <div>
          <h2>Skeleton Preview</h2>
          <p>Bright joints are currently mapped into humanoid slots.</p>
        </div>
      </div>

      <div class="preview-grid">
        <div class="preview-card">
          <div class="preview-title">
            <span>Source</span>
            <small>{{ sourcePreview.nodes.length }} joints</small>
          </div>
          <svg viewBox="0 0 100 100" class="skeleton-svg" role="img" aria-label="Source skeleton preview">
            <line
              v-for="line in sourcePreview.lines"
              :key="line.id"
              :x1="line.x1"
              :y1="line.y1"
              :x2="line.x2"
              :y2="line.y2"
              :class="{ active: line.active }"
            />
            <circle
              v-for="node in sourcePreview.nodes"
              :key="node.id"
              :cx="node.x"
              :cy="node.y"
              :r="node.active ? 1.9 : 1.15"
              :class="{ active: node.active }"
            >
              <title>{{ node.name }}</title>
            </circle>
          </svg>
        </div>

        <div class="preview-card">
          <div class="preview-title">
            <span>Target VRM</span>
            <small>{{ targetPreview.nodes.length }} joints</small>
          </div>
          <svg viewBox="0 0 100 100" class="skeleton-svg" role="img" aria-label="Target skeleton preview">
            <line
              v-for="line in targetPreview.lines"
              :key="line.id"
              :x1="line.x1"
              :y1="line.y1"
              :x2="line.x2"
              :y2="line.y2"
              :class="{ active: line.active }"
            />
            <circle
              v-for="node in targetPreview.nodes"
              :key="node.id"
              :cx="node.x"
              :cy="node.y"
              :r="node.active ? 1.9 : 1.15"
              :class="{ active: node.active, missing: node.missing }"
            >
              <title>{{ node.name }}</title>
            </circle>
          </svg>
        </div>
      </div>
    </section>

    <section class="lab-pane lab-mapping">
      <div class="section-title">
        <div>
          <h2>Bone Mapping</h2>
          <p>{{ requiredMissing.length }} required slots missing · {{ mappedCount }}/{{ RETARGET_BONE_SLOTS.length }} mapped</p>
        </div>
        <div class="actions">
          <SelectButton
            v-model="mappingView"
            class="mapping-view-select"
            :options="mappingViewOptions"
            optionLabel="label"
            optionValue="value"
            :allowEmpty="false"
          />
          <Button label="Auto" size="small" text @click="restoreAutoMapping" :disabled="!analysis || loading || importing" />
          <Button label="Clear" size="small" text severity="secondary" @click="clearMapping" :disabled="!analysis || loading || importing" />
        </div>
      </div>

      <div class="mapping-table">
        <div class="mapping-head">
          <span>VRM slot</span>
          <span>Source bone</span>
        </div>
        <div v-for="slot in visibleRetargetSlots" :key="slot.name" class="mapping-row">
          <div class="slot-label">
            <strong>{{ slot.label }}</strong>
            <span :class="{ missing: slot.required && !mapping[slot.name] }">
              {{ slot.required ? 'Required' : 'Optional' }}
            </span>
          </div>
          <select
            :value="mapping[slot.name] || ''"
            :disabled="!analysis || analysis.format === 'vrma' || sourceOptions.length === 0 || importing"
            @change="onMappingChange(slot.name, $event)"
          >
            <option value="">Unassigned</option>
            <option v-for="joint in sourceOptions" :key="joint.id" :value="joint.name">
              {{ joint.name }}{{ joint.trackCount ? ` (${joint.trackCount})` : '' }}
            </option>
          </select>
        </div>
      </div>
    </section>

    <section class="lab-pane lab-target">
      <div class="section-title">
        <div>
          <h2>Current Target VRM</h2>
          <p>{{ targetJoints.length }} humanoid bones available</p>
        </div>
      </div>

      <div class="target-list">
        <div v-for="joint in targetJoints" :key="joint.id">
          <span>{{ joint.name }}</span>
          <small>{{ joint.parentId || 'root' }}</small>
        </div>
      </div>

      <Button
        class="import-btn"
        :label="importing ? 'Retargeting…' : `Add ${currentFile ? baseAnimationName(currentFile.name) : 'clip'} to queue`"
        icon="pi pi-plus"
        :loading="importing"
        :disabled="!canImport"
        @click="importCurrent"
      />
    </section>
  </div>

  <Dialog
    v-model:visible="infoModalOpen"
    modal
    dismissable-mask
    :draggable="false"
    :style="{ width: '760px', maxWidth: '94vw' }"
    :content-style="{ maxHeight: '78vh', overflow: 'auto', padding: '0' }"
  >
    <template #header>
      <div class="modal-header">
        <span class="modal-title">Retarget report</span>
        <Button
          icon="pi pi-copy"
          label="copy"
          severity="secondary"
          size="small"
          text
          @click="copyRetargetInfo"
        />
      </div>
    </template>

    <pre class="report-body">{{ retargetInfoText }}</pre>
  </Dialog>
</template>

<style scoped>
.retarget-lab {
  display: grid;
  grid-template-columns: minmax(260px, 0.85fr) minmax(420px, 1.4fr) minmax(260px, 0.75fr);
  gap: 14px;
  width: min(1320px, 100%);
  margin: 0 auto;
  align-items: start;
}

.lab-pane {
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(16, 16, 16, 0.92);
  padding: 14px;
}

.lab-source,
.lab-preview {
  grid-column: 1;
}

.lab-mapping {
  grid-column: 2;
  grid-row: 1 / span 2;
}

.lab-target {
  grid-column: 3;
  grid-row: 1 / span 2;
}

.lab-heading h1,
.section-title h2 {
  margin: 0 0 4px;
  font-size: 16px;
  letter-spacing: 0;
}

.lab-heading p,
.section-title p {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.58);
}

.info-btn {
  width: 100%;
  margin-top: 12px;
}

.drop-zone {
  width: 100%;
  min-height: 116px;
  margin-top: 14px;
  border-radius: 8px;
  border: 1px dashed rgba(147, 180, 255, 0.45);
  background: rgba(42, 53, 80, 0.24);
  color: #dce7ff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font: inherit;
}

.drop-zone.active {
  border-color: #93b4ff;
  background: rgba(59, 91, 219, 0.28);
}

.hidden-input {
  display: none;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.summary-grid div {
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  padding: 8px;
}

.summary-grid span,
.target-list small,
.slot-label span {
  display: block;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.48);
}

.summary-grid strong {
  display: block;
  margin-top: 3px;
  font-size: 13px;
}

.warning-list,
.error-box {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  line-height: 1.35;
}

.preview-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.preview-card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: #0d0d0f;
  overflow: hidden;
}

.preview-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px;
  font-weight: 700;
}

.preview-title small {
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.48);
}

.skeleton-svg {
  display: block;
  width: 100%;
  aspect-ratio: 1 / 1;
  background:
    linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px);
  background-size: 20px 20px;
}

.skeleton-svg line {
  stroke: rgba(255, 255, 255, 0.26);
  stroke-width: 0.75;
  vector-effect: non-scaling-stroke;
}

.skeleton-svg line.active {
  stroke: #93b4ff;
  stroke-width: 1.35;
}

.skeleton-svg circle {
  fill: rgba(255, 255, 255, 0.48);
  stroke: rgba(0, 0, 0, 0.7);
  stroke-width: 0.45;
  vector-effect: non-scaling-stroke;
}

.skeleton-svg circle.active {
  fill: #93b4ff;
}

.skeleton-svg circle.missing {
  fill: #f59e0b;
}

.warning-list div,
.error-box {
  border-radius: 6px;
  padding: 8px;
  background: rgba(245, 158, 11, 0.12);
  color: #ffd796;
}

.error-box {
  background: rgba(239, 68, 68, 0.14);
  color: #fecaca;
}

.preset-panel {
  margin-top: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
  padding: 10px;
}

.preset-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
}

.preset-title small,
.preset-meta {
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.48);
}

.preset-name,
.preset-select {
  width: 100%;
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: #0d0d0f;
  color: #e6e6e6;
  padding: 7px 8px;
  font-size: 12px;
}

.preset-select {
  margin-top: 7px;
}

.preset-meta {
  margin-top: 6px;
  line-height: 1.35;
}

.preset-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

.section-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
}

:deep(.mapping-view-select) {
  display: flex;
  padding: 2px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.05);
}

:deep(.mapping-view-select .p-togglebutton) {
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: rgba(255, 255, 255, 0.62);
  font-size: 11px;
  padding: 5px 8px;
}

:deep(.mapping-view-select .p-togglebutton[data-p-checked="true"]) {
  background: rgba(147, 180, 255, 0.18);
  color: #dce7ff;
}

.mapping-table {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  overflow: hidden;
}

.mapping-head,
.mapping-row {
  display: grid;
  grid-template-columns: minmax(150px, 0.9fr) minmax(180px, 1.1fr);
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
}

.mapping-head {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.5);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}

.mapping-row {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.slot-label strong {
  display: block;
  font-size: 12px;
}

.slot-label .missing {
  color: #fbbf24;
}

select {
  width: 100%;
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: #0d0d0f;
  color: #e6e6e6;
  padding: 7px 8px;
  font-size: 12px;
}

.target-list {
  max-height: 420px;
  overflow: auto;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
}

.target-list div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px;
}

.target-list div:first-child {
  border-top: 0;
}

.import-btn {
  width: 100%;
  margin-top: 12px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.modal-title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.03em;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
}

.report-body {
  margin: 0;
  padding: 12px 18px 16px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 10px;
  line-height: 1.55;
  color: #e0e0e0;
  white-space: pre;
}

@media (max-width: 1080px) {
  .retarget-lab {
    grid-template-columns: 1fr;
  }
  .lab-source,
  .lab-preview,
  .lab-mapping,
  .lab-target {
    grid-column: auto;
    grid-row: auto;
  }
}
</style>
