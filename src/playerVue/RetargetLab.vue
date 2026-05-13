<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import * as THREE from 'three';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import SelectButton from 'primevue/selectbutton';
import { useToast } from 'primevue/usetoast';
import type { VRM } from '@pixiv/three-vrm';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { ManualFbxBoneMapping } from '../animationLoaders/fbxBoneMapping';
import type { QuaternionCorrection, QuaternionCorrectionMode } from '../retargetCorrections';
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
  onImport: (
    file: File,
    manualMapping: ManualFbxBoneMapping,
    quaternionCorrections?: QuaternionCorrection[],
  ) => Promise<void>;
  onPreview?: (
    file: File,
    manualMapping: ManualFbxBoneMapping,
    quaternionCorrections: QuaternionCorrection[],
    corrected: boolean,
  ) => Promise<{ name: string; duration: number }>;
  onPreviewSeek?: (seconds: number) => void;
  onPreviewStop?: () => void;
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const presetInput = ref<HTMLInputElement | null>(null);
const currentFile = ref<File | null>(null);
const analysis = ref<RetargetLabAnalysis | null>(null);
const mapping = ref<ManualFbxBoneMapping>({});
const loading = ref(false);
const importing = ref(false);
const previewing = ref(false);
const error = ref('');
const dragActive = ref(false);
const currentTargetJoints = ref(getRetargetTargetJoints(props.vrm));
const infoModalOpen = ref(false);
const toast = useToast();

const PRESET_STORAGE_KEY = 'vrm-player.retarget-lab.presets';
const QUAT_PRESET_STORAGE_KEY = 'vrm-player.retarget-lab.quaternion-presets';

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

interface QuaternionPreset {
  id: string;
  name: string;
  bone: VRMHumanBoneName;
  q: [number, number, number, number];
  createdAt: string;
}

type MappingView = 'body' | 'fingers' | 'all';
type QuaternionMode = 'euler' | 'quat' | 'axis';
type CorrectionModeOption = QuaternionCorrectionMode;
const mappingView = ref<MappingView>('body');
const mappingViewOptions: Array<{ label: string; value: MappingView }> = [
  { label: 'Body', value: 'body' },
  { label: 'Fingers', value: 'fingers' },
  { label: 'All', value: 'all' },
];

const presetName = ref('');
const selectedPresetId = ref('');
const presets = ref<RetargetPreset[]>(loadPresets());
const quaternionMode = ref<QuaternionMode>('euler');
const quaternionModeOptions: Array<{ label: string; value: QuaternionMode }> = [
  { label: 'Euler', value: 'euler' },
  { label: 'Quat', value: 'quat' },
  { label: 'Axis', value: 'axis' },
];
const selectedQuatBone = ref<VRMHumanBoneName>('hips');
const quatPresetName = ref('');
const selectedQuatPresetId = ref('');
const quatPresets = ref<QuaternionPreset[]>(loadQuatPresets());
const correctionMode = ref<CorrectionModeOption>('post');
const correctionModeOptions: Array<{ label: string; value: CorrectionModeOption }> = [
  { label: 'Post', value: 'post' },
  { label: 'Pre', value: 'pre' },
  { label: 'Absolute', value: 'absolute' },
];
const quaternionCorrections = ref<QuaternionCorrection[]>([]);
const previewName = ref('');
const previewDuration = ref(0);
const previewTime = ref(0);
const previewMode = ref<'original' | 'corrected' | ''>('');
const sourceOrigin = ref<'manual' | 'player'>('manual');
const lastImportMessage = ref('');
const quat = reactive({ x: 0, y: 0, z: 0, w: 1 });
const eulerDeg = reactive({ x: 0, y: 0, z: 0 });
const axisAngle = reactive({ x: 1, y: 0, z: 0, angle: 0 });

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
const selectedQuatPreset = computed(() => quatPresets.value.find((preset) => preset.id === selectedQuatPresetId.value) ?? null);
const activeCorrectionCount = computed(() => quaternionCorrections.value.filter((correction) => correction.enabled).length);
const canPreview = computed(() => !!currentFile.value && !!props.onPreview && !loading.value && !previewing.value);
const contextSourceLabel = computed(() => (
  sourceOrigin.value === 'player' ? 'Opened from Player queue' : 'Local source'
));
const previewStatusLabel = computed(() => {
  if (previewing.value) return 'Preparing preview';
  if (previewMode.value) return `Previewing ${previewMode.value}`;
  return 'Preview idle';
});
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

function buildCorrectedTargetJoints(
  joints: SkeletonJointMeta[],
  corrections: QuaternionCorrection[],
): SkeletonJointMeta[] {
  if (joints.length === 0) return [];
  const byId = new Map(joints.map((joint) => [joint.id, joint]));
  const children = new Map<string, SkeletonJointMeta[]>();
  const roots: SkeletonJointMeta[] = [];
  for (const joint of joints) {
    if (!joint.parentId || !byId.has(joint.parentId)) {
      roots.push(joint);
      continue;
    }
    const list = children.get(joint.parentId) ?? [];
    list.push(joint);
    children.set(joint.parentId, list);
  }

  const correctionByBone = new Map<string, THREE.Quaternion>();
  for (const correction of corrections) {
    if (!correction.enabled) continue;
    correctionByBone.set(
      correction.bone,
      new THREE.Quaternion(correction.q[0], correction.q[1], correction.q[2], correction.q[3]).normalize(),
    );
  }

  const corrected = new Map<string, SkeletonJointMeta>();
  const visit = (joint: SkeletonJointMeta, parentPos: THREE.Vector3 | null, parentRot: THREE.Quaternion): void => {
    const originalPos = new THREE.Vector3(...joint.position);
    const originalParent = joint.parentId ? byId.get(joint.parentId) ?? null : null;
    const localOffset = originalParent
      ? originalPos.clone().sub(new THREE.Vector3(...originalParent.position))
      : originalPos.clone();
    const pos = parentPos
      ? parentPos.clone().add(localOffset.applyQuaternion(parentRot))
      : originalPos.clone();
    const ownRot = parentRot.clone();
    const correction = correctionByBone.get(joint.name);
    if (correction) ownRot.multiply(correction);
    corrected.set(joint.id, {
      ...joint,
      position: [pos.x, pos.y, pos.z],
    });
    for (const child of children.get(joint.id) ?? []) visit(child, pos, ownRot);
  };

  for (const root of roots) visit(root, null, new THREE.Quaternion());
  return joints.map((joint) => corrected.get(joint.id) ?? joint);
}

const mappedSourceNames = computed(() => new Set(Object.values(mapping.value).filter((name): name is string => !!name)));
const mappedTargetNames = computed(() => new Set(
  (Object.keys(mapping.value) as VRMHumanBoneName[]).filter((slot) => !!mapping.value[slot]),
));
const missingTargetNames = computed(() => new Set(requiredMissing.value.map((slot) => slot.name)));
const sourcePreview = computed(() => buildPreview(analysis.value?.sourceJoints ?? [], mappedSourceNames.value));
const targetPreview = computed(() => buildPreview(targetJoints.value, mappedTargetNames.value, missingTargetNames.value));
const activeCorrectionBones = computed(() => new Set(
  quaternionCorrections.value.filter((correction) => correction.enabled).map((correction) => correction.bone),
));
const correctedTargetJoints = computed(() => buildCorrectedTargetJoints(targetJoints.value, quaternionCorrections.value));
const originalComparePreview = computed(() => buildPreview(targetJoints.value, activeCorrectionBones.value, missingTargetNames.value));
const correctedComparePreview = computed(() => buildPreview(correctedTargetJoints.value, activeCorrectionBones.value, missingTargetNames.value));
const reportSummary = computed(() => {
  const a = analysis.value;
  const missingRequired = requiredMissing.value.map((slot) => slot.label);
  return [
    { label: 'File', value: currentFile.value?.name ?? 'none' },
    { label: 'Format', value: a?.format?.toUpperCase() ?? 'none' },
    { label: 'Duration', value: a ? `${a.duration.toFixed(3)}s` : '0.000s' },
    { label: 'Source joints', value: String(a?.sourceJoints.length ?? 0) },
    { label: 'Target joints', value: String(targetJoints.value.length) },
    { label: 'Mapped slots', value: `${mappedCount.value}/${RETARGET_BONE_SLOTS.length}` },
    { label: 'Missing required', value: missingRequired.length ? missingRequired.join(', ') : 'none' },
    { label: 'Corrections', value: `${activeCorrectionCount.value}/${quaternionCorrections.value.length} active` },
  ];
});
const reportMappingRows = computed(() => RETARGET_BONE_SLOTS.map((slot) => ({
  slot: slot.name,
  label: slot.label,
  required: slot.required,
  source: mapping.value[slot.name] || '',
  mapped: !!mapping.value[slot.name],
  kind: isFingerSlot(slot.name) ? 'Finger' : 'Body',
})));
const currentQuaternionRows = computed(() => [
  { label: 'Bone', value: selectedQuatBone.value },
  { label: 'Editor mode', value: quaternionMode.value },
  { label: 'Quaternion', value: `[${[quat.x, quat.y, quat.z, quat.w].map((n) => n.toFixed(6)).join(', ')}]` },
  { label: 'Euler YXZ', value: `${eulerDeg.x.toFixed(2)}°, ${eulerDeg.y.toFixed(2)}°, ${eulerDeg.z.toFixed(2)}°` },
  { label: 'Axis-angle', value: `[${axisAngle.x.toFixed(3)}, ${axisAngle.y.toFixed(3)}, ${axisAngle.z.toFixed(3)}] · ${axisAngle.angle.toFixed(2)}°` },
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRetargetPreset(value: unknown): value is RetargetPreset {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.mapping === 'object' &&
    typeof value.format === 'string'
  );
}

function isQuaternionPreset(value: unknown): value is QuaternionPreset {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.bone === 'string' &&
    Array.isArray(value.q)
  );
}

function loadPresetList<T>(storageKey: string, isValid: (value: unknown) => value is T): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValid);
  } catch {
    return [];
  }
}

function persistPresetList(storageKey: string, items: unknown[]): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(items));
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Save failed',
      detail: (e as Error).message,
      life: 3000,
    });
  }
}

function loadPresets(): RetargetPreset[] {
  return loadPresetList(PRESET_STORAGE_KEY, isRetargetPreset);
}

function loadQuatPresets(): QuaternionPreset[] {
  return loadPresetList(QUAT_PRESET_STORAGE_KEY, isQuaternionPreset);
}

function persistPresets(): void {
  persistPresetList(PRESET_STORAGE_KEY, presets.value);
}

function persistQuatPresets(): void {
  persistPresetList(QUAT_PRESET_STORAGE_KEY, quatPresets.value);
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

function selectedQuatNode(): THREE.Object3D | null {
  return props.vrm.humanoid.getNormalizedBoneNode(selectedQuatBone.value) ?? null;
}

function setQuaternionFields(q: THREE.Quaternion): void {
  quat.x = q.x;
  quat.y = q.y;
  quat.z = q.z;
  quat.w = q.w;

  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  eulerDeg.x = THREE.MathUtils.radToDeg(e.x);
  eulerDeg.y = THREE.MathUtils.radToDeg(e.y);
  eulerDeg.z = THREE.MathUtils.radToDeg(e.z);

  const clampedW = THREE.MathUtils.clamp(q.w, -1, 1);
  const angle = 2 * Math.acos(clampedW);
  const s = Math.sqrt(Math.max(0, 1 - clampedW * clampedW));
  if (s < 0.0001) {
    axisAngle.x = 1;
    axisAngle.y = 0;
    axisAngle.z = 0;
  } else {
    axisAngle.x = q.x / s;
    axisAngle.y = q.y / s;
    axisAngle.z = q.z / s;
  }
  axisAngle.angle = THREE.MathUtils.radToDeg(angle);
}

function quaternionFromEditor(): THREE.Quaternion {
  if (quaternionMode.value === 'euler') {
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(eulerDeg.x),
      THREE.MathUtils.degToRad(eulerDeg.y),
      THREE.MathUtils.degToRad(eulerDeg.z),
      'YXZ',
    )).normalize();
  }

  if (quaternionMode.value === 'axis') {
    const axis = new THREE.Vector3(axisAngle.x, axisAngle.y, axisAngle.z);
    if (axis.lengthSq() < 0.000001) axis.set(1, 0, 0);
    axis.normalize();
    return new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(axisAngle.angle)).normalize();
  }

  return new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w).normalize();
}

function syncQuatFromBone(): void {
  const node = selectedQuatNode();
  if (!node) return;
  setQuaternionFields(node.quaternion.clone().normalize());
}

function applyQuaternionToBone(): void {
  const node = selectedQuatNode();
  if (!node) return;
  const q = quaternionFromEditor();
  node.quaternion.copy(q);
  props.vrm.scene.updateMatrixWorld(true);
  setQuaternionFields(q);
}

function normalizeQuaternionEditor(): void {
  const q = new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w).normalize();
  setQuaternionFields(q);
}

function identityQuaternion(): void {
  const q = new THREE.Quaternion();
  setQuaternionFields(q);
  applyQuaternionToBone();
}

function invertQuaternion(): void {
  const q = quaternionFromEditor().invert().normalize();
  setQuaternionFields(q);
}

function onQuatBoneChange(): void {
  syncQuatFromBone();
}

async function copyQuaternionJson(): Promise<void> {
  const payload = {
    bone: selectedQuatBone.value,
    q: [quat.x, quat.y, quat.z, quat.w].map((n) => Number(n.toFixed(8))),
    eulerDeg: {
      x: Number(eulerDeg.x.toFixed(3)),
      y: Number(eulerDeg.y.toFixed(3)),
      z: Number(eulerDeg.z.toFixed(3)),
      order: 'YXZ',
    },
  };
  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  toast.add({ severity: 'success', summary: 'Copied', detail: 'Quaternion JSON copied', life: 2000 });
}

async function pasteQuaternionJson(): Promise<void> {
  try {
    const parsed = JSON.parse(await navigator.clipboard.readText()) as { bone?: string; q?: number[] };
    const bone = parsed.bone;
    if (bone) selectedQuatBone.value = bone as VRMHumanBoneName;
    if (!Array.isArray(parsed.q) || parsed.q.length !== 4) throw new Error('Clipboard JSON has no q: [x,y,z,w]');
    setQuaternionFields(new THREE.Quaternion(parsed.q[0], parsed.q[1], parsed.q[2], parsed.q[3]).normalize());
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Paste failed', detail: (e as Error).message, life: 3000 });
  }
}

function saveQuatPreset(): void {
  const now = new Date().toISOString();
  const name = quatPresetName.value.trim() || `${selectedQuatBone.value}-quat`;
  const preset: QuaternionPreset = {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    bone: selectedQuatBone.value,
    q: [quat.x, quat.y, quat.z, quat.w],
    createdAt: now,
  };
  quatPresets.value = [preset, ...quatPresets.value];
  selectedQuatPresetId.value = preset.id;
  quatPresetName.value = name;
  persistQuatPresets();
  toast.add({ severity: 'success', summary: 'Quaternion preset saved', detail: name, life: 2200 });
}

function loadQuatPreset(): void {
  const preset = selectedQuatPreset.value;
  if (!preset) return;
  selectedQuatBone.value = preset.bone;
  setQuaternionFields(new THREE.Quaternion(...preset.q).normalize());
  quatPresetName.value = preset.name;
  toast.add({ severity: 'success', summary: 'Quaternion preset loaded', detail: preset.name, life: 2000 });
}

function deleteQuatPreset(): void {
  const preset = selectedQuatPreset.value;
  if (!preset) return;
  quatPresets.value = quatPresets.value.filter((item) => item.id !== preset.id);
  selectedQuatPresetId.value = quatPresets.value[0]?.id ?? '';
  persistQuatPresets();
  toast.add({ severity: 'success', summary: 'Quaternion preset deleted', detail: preset.name, life: 2000 });
}

function addQuaternionCorrection(): void {
  const q = quaternionFromEditor();
  const correction: QuaternionCorrection = {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    bone: selectedQuatBone.value,
    mode: correctionMode.value,
    q: [q.x, q.y, q.z, q.w],
    enabled: true,
  };
  quaternionCorrections.value = [correction, ...quaternionCorrections.value];
  toast.add({
    severity: 'success',
    summary: 'Correction added',
    detail: `${correction.bone} · ${correction.mode}`,
    life: 2000,
  });
}

function removeQuaternionCorrection(id: string): void {
  quaternionCorrections.value = quaternionCorrections.value.filter((correction) => correction.id !== id);
}

function toggleQuaternionCorrection(id: string): void {
  quaternionCorrections.value = quaternionCorrections.value.map((correction) => (
    correction.id === id ? { ...correction, enabled: !correction.enabled } : correction
  ));
}

function clearQuaternionCorrections(): void {
  quaternionCorrections.value = [];
}

syncQuatFromBone();

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
  const correctionRows = quaternionCorrections.value
    .map((correction) => (
      `- ${correction.enabled ? 'ON ' : 'OFF'} ${correction.bone} ${correction.mode} ` +
      `[${correction.q.map((n) => n.toFixed(8)).join(', ')}]`
    ))
    .join('\n') || '- none';
  const quatPresetRows = quatPresets.value
    .map((preset) => `- ${preset.name} · ${preset.bone} [${preset.q.map((n) => n.toFixed(8)).join(', ')}]`)
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
    'Quaternion Editor',
    '-----------------',
    `bone: ${selectedQuatBone.value}`,
    `mode: ${quaternionMode.value}`,
    `quat: [${[quat.x, quat.y, quat.z, quat.w].map((n) => n.toFixed(8)).join(', ')}]`,
    `euler YXZ: ${eulerDeg.x.toFixed(3)}°, ${eulerDeg.y.toFixed(3)}°, ${eulerDeg.z.toFixed(3)}°`,
    `axis-angle: [${axisAngle.x.toFixed(4)}, ${axisAngle.y.toFixed(4)}, ${axisAngle.z.toFixed(4)}] ${axisAngle.angle.toFixed(3)}°`,
    '',
    'Quaternion Corrections',
    '----------------------',
    correctionRows,
    '',
    'Quaternion Presets',
    '------------------',
    quatPresetRows,
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

async function analyze(file: File, origin: 'manual' | 'player' = 'manual'): Promise<void> {
  if (!isRetargetLabFile(file)) {
    error.value = 'Unsupported file. Use .bvh, .fbx, or .vrma.';
    return;
  }
  loading.value = true;
  error.value = '';
  sourceOrigin.value = origin;
  lastImportMessage.value = '';
  if (previewName.value) stopPreview();
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
  if (file) void analyze(file, 'manual');
  input.value = '';
}

function onDrop(event: DragEvent): void {
  dragActive.value = false;
  const file = Array.from(event.dataTransfer?.files ?? []).find(isRetargetLabFile);
  if (file) void analyze(file, 'manual');
}

function onRetargetFile(event: Event): void {
  const file = (event as CustomEvent<File>).detail;
  if (!file) return;
  void analyze(file, 'player');
  toast.add({
    severity: 'info',
    summary: 'Opened from Player',
    detail: file.name,
    life: 2200,
  });
}

onMounted(() => {
  window.addEventListener('vrm-player:retarget-file', onRetargetFile);
});

onUnmounted(() => {
  window.removeEventListener('vrm-player:retarget-file', onRetargetFile);
});

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
  lastImportMessage.value = '';
  try {
    await props.onImport(
      currentFile.value,
      mapping.value,
      quaternionCorrections.value.filter((correction) => correction.enabled),
    );
    lastImportMessage.value = 'Added to Player queue';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    importing.value = false;
  }
}

async function previewCurrent(corrected: boolean): Promise<void> {
  if (!currentFile.value || !props.onPreview) return;
  previewing.value = true;
  error.value = '';
  try {
    const result = await props.onPreview(
      currentFile.value,
      mapping.value,
      corrected ? quaternionCorrections.value.filter((correction) => correction.enabled) : [],
      corrected,
    );
    previewName.value = result.name;
    previewDuration.value = result.duration;
    previewTime.value = 0;
    previewMode.value = corrected ? 'corrected' : 'original';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    previewing.value = false;
  }
}

function seekPreview(): void {
  props.onPreviewSeek?.(previewTime.value);
}

function stopPreview(): void {
  props.onPreviewStop?.();
  previewName.value = '';
  previewDuration.value = 0;
  previewTime.value = 0;
  previewMode.value = '';
}

function goBackToPlayer(): void {
  window.dispatchEvent(new CustomEvent('vrm-player:set-page', { detail: 'player' }));
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

      <div v-if="currentFile" class="source-context" :class="{ fromPlayer: sourceOrigin === 'player' }">
        <div class="source-context-main">
          <span>{{ contextSourceLabel }}</span>
          <strong>{{ currentFile.name }}</strong>
        </div>
        <div class="source-context-meta">
          <span>{{ previewStatusLabel }}</span>
          <span v-if="activeCorrectionCount">{{ activeCorrectionCount }} corrections</span>
          <span v-if="lastImportMessage">{{ lastImportMessage }}</span>
        </div>
        <Button
          v-if="sourceOrigin === 'player'"
          class="back-player-btn"
          label="Back to Player"
          icon="pi pi-arrow-left"
          size="small"
          text
          @click="goBackToPlayer"
        />
      </div>

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

      <div class="compare-block">
        <div class="preview-title compare-heading">
          <span>Target A/B</span>
          <small>{{ activeCorrectionCount }} correction{{ activeCorrectionCount === 1 ? '' : 's' }}</small>
        </div>
        <div class="compare-grid">
          <div class="preview-card compare-card">
            <div class="preview-title">
              <span>Original target</span>
              <small>without settings</small>
            </div>
            <svg viewBox="0 0 100 100" class="skeleton-svg" role="img" aria-label="Original target skeleton">
              <line
                v-for="line in originalComparePreview.lines"
                :key="line.id"
                :x1="line.x1"
                :y1="line.y1"
                :x2="line.x2"
                :y2="line.y2"
                :class="{ active: line.active }"
              />
              <circle
                v-for="node in originalComparePreview.nodes"
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

          <div class="preview-card compare-card corrected">
            <div class="preview-title">
              <span>Corrected target</span>
              <small>active corrections</small>
            </div>
            <svg viewBox="0 0 100 100" class="skeleton-svg corrected-svg" role="img" aria-label="Corrected target skeleton">
              <line
                v-for="line in correctedComparePreview.lines"
                :key="line.id"
                :x1="line.x1"
                :y1="line.y1"
                :x2="line.x2"
                :y2="line.y2"
                :class="{ active: line.active }"
              />
              <circle
                v-for="node in correctedComparePreview.nodes"
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

      <div class="quat-editor">
        <div class="quat-title">
          <span>Quaternion Editor</span>
          <small>local bone rotation</small>
        </div>

        <div class="quat-row">
          <label>Bone</label>
          <select v-model="selectedQuatBone" @change="onQuatBoneChange">
            <option v-for="joint in targetJoints" :key="joint.id" :value="joint.name">
              {{ joint.name }}
            </option>
          </select>
        </div>

        <SelectButton
          v-model="quaternionMode"
          class="quat-mode-select"
          :options="quaternionModeOptions"
          optionLabel="label"
          optionValue="value"
          :allowEmpty="false"
        />

        <div v-if="quaternionMode === 'euler'" class="quat-grid">
          <label>X°<input v-model.number="eulerDeg.x" type="number" step="0.1" /></label>
          <label>Y°<input v-model.number="eulerDeg.y" type="number" step="0.1" /></label>
          <label>Z°<input v-model.number="eulerDeg.z" type="number" step="0.1" /></label>
        </div>

        <div v-else-if="quaternionMode === 'quat'" class="quat-grid">
          <label>X<input v-model.number="quat.x" type="number" step="0.0001" /></label>
          <label>Y<input v-model.number="quat.y" type="number" step="0.0001" /></label>
          <label>Z<input v-model.number="quat.z" type="number" step="0.0001" /></label>
          <label>W<input v-model.number="quat.w" type="number" step="0.0001" /></label>
        </div>

        <div v-else class="quat-grid">
          <label>Axis X<input v-model.number="axisAngle.x" type="number" step="0.01" /></label>
          <label>Axis Y<input v-model.number="axisAngle.y" type="number" step="0.01" /></label>
          <label>Axis Z<input v-model.number="axisAngle.z" type="number" step="0.01" /></label>
          <label>Angle°<input v-model.number="axisAngle.angle" type="number" step="0.1" /></label>
        </div>

        <div class="quat-actions">
          <Button label="Read" icon="pi pi-refresh" size="small" text @click="syncQuatFromBone" />
          <Button label="Apply" icon="pi pi-check" size="small" @click="applyQuaternionToBone" />
          <Button label="Normalize" size="small" text @click="normalizeQuaternionEditor" />
          <Button label="Identity" size="small" text severity="secondary" @click="identityQuaternion" />
          <Button label="Invert" size="small" text severity="secondary" @click="invertQuaternion" />
        </div>

        <div class="quat-actions">
          <Button label="Copy JSON" icon="pi pi-copy" size="small" text @click="copyQuaternionJson" />
          <Button label="Paste JSON" icon="pi pi-clipboard" size="small" text @click="pasteQuaternionJson" />
        </div>

        <div class="correction-panel">
          <div class="correction-title">
            <span>Clip Corrections</span>
            <small>{{ activeCorrectionCount }}/{{ quaternionCorrections.length }} active</small>
          </div>
          <SelectButton
            v-model="correctionMode"
            class="correction-mode-select"
            :options="correctionModeOptions"
            optionLabel="label"
            optionValue="value"
            :allowEmpty="false"
          />
          <div class="quat-actions">
            <Button label="Add correction" icon="pi pi-plus" size="small" @click="addQuaternionCorrection" />
            <Button label="Clear" size="small" text severity="secondary" @click="clearQuaternionCorrections" :disabled="quaternionCorrections.length === 0" />
          </div>
          <div class="preview-controls">
            <div class="preview-title">
              <span>Preview</span>
              <small>{{ previewMode || 'idle' }}</small>
            </div>
            <div class="quat-actions">
              <Button
                label="Original"
                icon="pi pi-play"
                size="small"
                text
                :loading="previewing && previewMode === 'original'"
                :disabled="!canPreview"
                @click="previewCurrent(false)"
              />
              <Button
                label="Corrected"
                icon="pi pi-check"
                size="small"
                :loading="previewing && previewMode === 'corrected'"
                :disabled="!canPreview"
                @click="previewCurrent(true)"
              />
              <Button
                label="Stop"
                icon="pi pi-stop"
                size="small"
                text
                severity="secondary"
                :disabled="!previewName"
                @click="stopPreview"
              />
            </div>
            <div class="preview-scrub">
              <input
                v-model.number="previewTime"
                type="range"
                min="0"
                :max="Math.max(previewDuration, 0)"
                step="0.01"
                :disabled="!previewName || previewDuration <= 0"
                @input="seekPreview"
              />
              <span>{{ previewTime.toFixed(2) }} / {{ previewDuration.toFixed(2) }}s</span>
            </div>
            <div v-if="previewName" class="preview-name">{{ previewName }}</div>
          </div>
          <div v-if="quaternionCorrections.length" class="correction-list">
            <div v-for="correction in quaternionCorrections" :key="correction.id" class="correction-item" :class="{ disabled: !correction.enabled }">
              <div>
                <strong>{{ correction.bone }}</strong>
                <span>{{ correction.mode }} · [{{ correction.q.map((n) => n.toFixed(3)).join(', ') }}]</span>
              </div>
              <div class="correction-actions">
                <Button
                  :label="correction.enabled ? 'On' : 'Off'"
                  size="small"
                  text
                  @click="toggleQuaternionCorrection(correction.id)"
                />
                <Button
                  icon="pi pi-times"
                  aria-label="Remove correction"
                  size="small"
                  text
                  severity="danger"
                  @click="removeQuaternionCorrection(correction.id)"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="quat-presets">
          <input v-model="quatPresetName" type="text" placeholder="Quaternion preset name" />
          <select v-model="selectedQuatPresetId">
            <option value="">No quaternion preset</option>
            <option v-for="preset in quatPresets" :key="preset.id" :value="preset.id">
              {{ preset.name }} · {{ preset.bone }}
            </option>
          </select>
          <div class="quat-actions">
            <Button label="Save" icon="pi pi-save" size="small" text @click="saveQuatPreset" />
            <Button label="Load" icon="pi pi-download" size="small" text @click="loadQuatPreset" :disabled="!selectedQuatPreset" />
            <Button label="Delete" icon="pi pi-trash" size="small" text severity="danger" @click="deleteQuatPreset" :disabled="!selectedQuatPreset" />
          </div>
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

    <div class="report-dashboard">
      <section class="report-section">
        <h3>Summary</h3>
        <div class="report-summary-grid">
          <div v-for="item in reportSummary" :key="item.label" class="report-card">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
      </section>

      <section class="report-section">
        <h3>Quaternion State</h3>
        <div class="report-kv-table">
          <div v-for="row in currentQuaternionRows" :key="row.label">
            <span>{{ row.label }}</span>
            <code>{{ row.value }}</code>
          </div>
        </div>
      </section>

      <section class="report-section">
        <div class="report-section-head">
          <h3>Quaternion Corrections</h3>
          <span>{{ activeCorrectionCount }}/{{ quaternionCorrections.length }} active</span>
        </div>
        <table class="report-table">
          <thead>
            <tr>
              <th>State</th>
              <th>Bone</th>
              <th>Mode</th>
              <th>Quaternion</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="quaternionCorrections.length === 0">
              <td colspan="4" class="empty-cell">No corrections</td>
            </tr>
            <tr v-for="correction in quaternionCorrections" :key="correction.id">
              <td><span class="status-pill" :class="{ off: !correction.enabled }">{{ correction.enabled ? 'ON' : 'OFF' }}</span></td>
              <td>{{ correction.bone }}</td>
              <td>{{ correction.mode }}</td>
              <td><code>[{{ correction.q.map((n) => n.toFixed(5)).join(', ') }}]</code></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="report-section">
        <div class="report-section-head">
          <h3>Mapping</h3>
          <span>{{ mappedCount }}/{{ RETARGET_BONE_SLOTS.length }}</span>
        </div>
        <table class="report-table">
          <thead>
            <tr>
              <th>Kind</th>
              <th>VRM Slot</th>
              <th>Source Bone</th>
              <th>Req</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in reportMappingRows" :key="row.slot" :class="{ unmapped: !row.mapped && row.required }">
              <td>{{ row.kind }}</td>
              <td>{{ row.label }}</td>
              <td><code>{{ row.source || 'Unassigned' }}</code></td>
              <td>{{ row.required ? 'yes' : 'no' }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="report-section">
        <h3>Warnings</h3>
        <div class="report-warning-list">
          <div v-if="!analysis?.warnings.length">No warnings</div>
          <div v-for="warning in analysis?.warnings ?? []" :key="warning">{{ warning }}</div>
        </div>
      </section>

      <section class="report-section report-two-cols">
        <div>
          <h3>Source Joints</h3>
          <div class="report-list">
            <div v-if="!analysis?.sourceJoints.length">No source loaded</div>
            <div v-for="joint in analysis?.sourceJoints ?? []" :key="joint.id">
              <span>{{ joint.name }}</span>
              <small>{{ joint.trackCount }} tracks</small>
            </div>
          </div>
        </div>
        <div>
          <h3>Target Joints</h3>
          <div class="report-list">
            <div v-for="joint in targetJoints" :key="joint.id">
              <span>{{ joint.name }}</span>
              <small>{{ joint.parentId || 'root' }}</small>
            </div>
          </div>
        </div>
      </section>
    </div>
  </Dialog>
</template>

<style scoped>
.retarget-lab {
  display: grid;
  grid-template-columns: minmax(300px, 0.9fr) minmax(500px, 1.25fr) minmax(300px, 0.85fr);
  gap: 14px;
  width: min(1680px, 100%);
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

.lab-source {
  grid-column: 1;
}

.lab-preview {
  grid-column: 1 / span 2;
}

.lab-mapping {
  grid-column: 2;
  grid-row: 1;
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

.source-context {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 10px;
  align-items: center;
  margin-top: 10px;
  padding: 9px 10px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
}

.source-context.fromPlayer {
  border-color: rgba(147, 197, 253, 0.22);
  background: rgba(59, 91, 219, 0.12);
}

.source-context-main {
  min-width: 0;
}

.source-context-main span,
.source-context-meta {
  color: rgba(255, 255, 255, 0.52);
  font-size: 10px;
}

.source-context-main span {
  display: block;
  margin-bottom: 3px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.source-context-main strong {
  display: block;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-context-meta {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.source-context-meta span {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 7px;
}

:deep(.back-player-btn.p-button) {
  align-self: start;
  color: #bfdbfe;
  font-size: 11px;
  font-weight: 700;
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.compare-block {
  margin-top: 12px;
}

.compare-heading {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px 8px 0 0;
  background: rgba(255, 255, 255, 0.045);
}

.compare-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 8px;
}

.preview-card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: #0d0d0f;
  overflow: hidden;
}

.compare-card {
  border-color: rgba(147, 180, 255, 0.12);
}

.compare-card.corrected {
  border-color: rgba(34, 197, 94, 0.2);
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
  height: clamp(300px, 28vw, 460px);
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

.corrected-svg line.active {
  stroke: #86efac;
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

.corrected-svg circle.active {
  fill: #86efac;
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

.quat-editor {
  margin-top: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
  padding: 10px;
}

.quat-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
}

.quat-title small {
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.48);
}

.quat-row {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.quat-row label,
.quat-grid label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.58);
}

.quat-row select,
.quat-grid input,
.quat-presets input,
.quat-presets select {
  width: 100%;
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: #0d0d0f;
  color: #e6e6e6;
  padding: 7px 8px;
  font-size: 12px;
}

:deep(.quat-mode-select) {
  display: flex;
  padding: 2px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.05);
  margin-bottom: 8px;
}

:deep(.quat-mode-select .p-togglebutton) {
  flex: 1;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: rgba(255, 255, 255, 0.62);
  font-size: 11px;
  padding: 5px 8px;
}

:deep(.quat-mode-select .p-togglebutton[data-p-checked="true"]) {
  background: rgba(147, 180, 255, 0.18);
  color: #dce7ff;
}

:deep(.correction-mode-select) {
  display: flex;
  padding: 2px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.05);
  margin-top: 8px;
}

:deep(.correction-mode-select .p-togglebutton) {
  flex: 1;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: rgba(255, 255, 255, 0.62);
  font-size: 10px;
  padding: 5px 6px;
}

:deep(.correction-mode-select .p-togglebutton[data-p-checked="true"]) {
  background: rgba(147, 180, 255, 0.18);
  color: #dce7ff;
}

.quat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.quat-grid input {
  display: block;
  margin-top: 3px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
}

.quat-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

.quat-presets {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.correction-panel {
  margin-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 10px;
}

.correction-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
}

.correction-title small {
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.48);
}

.correction-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.preview-controls {
  margin-top: 10px;
  border: 1px solid rgba(147, 180, 255, 0.14);
  border-radius: 7px;
  background: rgba(147, 180, 255, 0.06);
  padding: 8px;
}

.preview-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
}

.preview-title small,
.preview-name,
.preview-scrub span {
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.52);
}

.preview-scrub {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}

.preview-scrub input {
  width: 100%;
}

.preview-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 6px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
}

.correction-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 7px;
  background: rgba(255, 255, 255, 0.035);
}

.correction-item.disabled {
  opacity: 0.45;
}

.correction-item strong,
.correction-item span {
  display: block;
  min-width: 0;
}

.correction-item strong {
  font-size: 11px;
}

.correction-item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
}

.correction-actions {
  display: flex;
  align-items: center;
  gap: 2px;
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

.report-dashboard {
  padding: 14px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: #e0e0e0;
}

.report-section {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
  padding: 12px;
}

.report-section h3,
.report-section-head h3 {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0;
}

.report-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.report-section-head span {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.52);
}

.report-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.report-card {
  min-width: 0;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.22);
  padding: 8px;
}

.report-card span {
  display: block;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.48);
}

.report-card strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 3px;
  font-size: 12px;
}

.report-kv-table {
  margin-top: 10px;
  display: grid;
  gap: 6px;
}

.report-kv-table div {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  font-size: 11px;
}

.report-kv-table span {
  color: rgba(255, 255, 255, 0.52);
}

.report-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.report-table th,
.report-table td {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding: 7px 8px;
  text-align: left;
  vertical-align: top;
}

.report-table th {
  border-top: 0;
  color: rgba(255, 255, 255, 0.52);
  font-size: 10px;
  text-transform: uppercase;
}

.report-table code,
.report-kv-table code {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 10px;
  color: #dce7ff;
  white-space: normal;
  word-break: break-word;
}

.report-table tr.unmapped td {
  background: rgba(245, 158, 11, 0.08);
}

.status-pill {
  display: inline-flex;
  border-radius: 999px;
  padding: 2px 6px;
  background: rgba(34, 197, 94, 0.16);
  color: #86efac;
  font-size: 10px;
  font-weight: 700;
}

.status-pill.off {
  background: rgba(148, 163, 184, 0.12);
  color: rgba(255, 255, 255, 0.52);
}

.empty-cell {
  color: rgba(255, 255, 255, 0.48);
}

.report-warning-list {
  margin-top: 10px;
  display: grid;
  gap: 6px;
}

.report-warning-list div {
  border-radius: 6px;
  background: rgba(245, 158, 11, 0.12);
  color: #ffd796;
  padding: 8px;
  font-size: 11px;
}

.report-two-cols {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.report-list {
  max-height: 260px;
  overflow: auto;
  margin-top: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 7px;
}

.report-list div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding: 7px 8px;
  font-size: 11px;
}

.report-list div:first-child {
  border-top: 0;
}

.report-list small {
  color: rgba(255, 255, 255, 0.48);
  white-space: nowrap;
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
  .preview-grid,
  .compare-grid {
    grid-template-columns: 1fr;
  }
  .skeleton-svg {
    height: 320px;
  }
  .report-summary-grid,
  .report-two-cols {
    grid-template-columns: 1fr;
  }
}
</style>
