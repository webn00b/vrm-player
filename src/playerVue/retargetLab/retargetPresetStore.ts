import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { ManualFbxBoneMapping } from '../../animationLoaders/fbxBoneMapping';
import { baseAnimationName, type RetargetLabAnalysis } from '../../retargetLabModel';

export const RETARGET_PRESET_STORAGE_KEY = 'vrm-player.retarget-lab.presets';
export const QUATERNION_PRESET_STORAGE_KEY = 'vrm-player.retarget-lab.quaternion-presets';

export interface RetargetPreset {
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

export interface QuaternionPreset {
  id: string;
  name: string;
  bone: VRMHumanBoneName;
  q: [number, number, number, number];
  createdAt: string;
}

interface PresetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface RetargetPresetParams {
  requestedName: string;
  fileName: string | null;
  analysis: RetargetLabAnalysis | null;
  mapping: ManualFbxBoneMapping;
  mappedCount: number;
  now?: Date;
  id?: string;
}

interface ImportedRetargetPresetParams {
  parsed: Partial<RetargetPreset>;
  fileName: string;
  now?: Date;
  id?: string;
}

interface QuaternionPresetParams {
  requestedName: string;
  bone: VRMHumanBoneName;
  q: [number, number, number, number];
  now?: Date;
  id?: string;
}

function createPresetId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isRetargetPreset(value: unknown): value is RetargetPreset {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.mapping === 'object' &&
    typeof value.format === 'string'
  );
}

export function isQuaternionPreset(value: unknown): value is QuaternionPreset {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.bone === 'string' &&
    Array.isArray(value.q)
  );
}

export function loadPresetList<T>(
  storageKey: string,
  isValid: (value: unknown) => value is T,
  storage: PresetStorage = localStorage,
): T[] {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValid);
  } catch {
    return [];
  }
}

export function persistPresetList(
  storageKey: string,
  items: unknown[],
  storage: PresetStorage = localStorage,
): void {
  storage.setItem(storageKey, JSON.stringify(items));
}

export function sourceJointSignature(analysis: RetargetLabAnalysis | null): string {
  return (analysis?.sourceJoints ?? []).map((joint) => joint.name).join('|');
}

export function cleanManualMapping(mapping: ManualFbxBoneMapping): ManualFbxBoneMapping {
  const out: ManualFbxBoneMapping = {};
  for (const [slot, source] of Object.entries(mapping) as Array<[VRMHumanBoneName, string | undefined]>) {
    if (source) out[slot] = source;
  }
  return out;
}

export function defaultRetargetPresetName(requestedName: string, fileName: string | null, now = new Date()): string {
  const trimmed = requestedName.trim();
  if (trimmed) return trimmed;
  if (fileName) return baseAnimationName(fileName);
  return `retarget-${now.toISOString().slice(0, 10)}`;
}

export function createRetargetPreset({
  requestedName,
  fileName,
  analysis,
  mapping,
  mappedCount,
  now = new Date(),
  id = createPresetId(),
}: RetargetPresetParams): RetargetPreset {
  const timestamp = now.toISOString();
  return {
    id,
    name: defaultRetargetPresetName(requestedName, fileName, now),
    format: analysis?.format ?? 'unknown',
    sourceSignature: sourceJointSignature(analysis),
    sourceJointCount: analysis?.sourceJoints.length ?? 0,
    mappedCount,
    mapping: cleanManualMapping(mapping),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createImportedRetargetPreset({
  parsed,
  fileName,
  now = new Date(),
  id = createPresetId(),
}: ImportedRetargetPresetParams): RetargetPreset {
  if (!parsed.mapping || typeof parsed.mapping !== 'object') throw new Error('Preset JSON has no mapping object');
  const timestamp = now.toISOString();
  return {
    id,
    name: parsed.name || fileName.replace(/\.json$/i, ''),
    format: parsed.format || 'unknown',
    sourceSignature: parsed.sourceSignature || '',
    sourceJointCount: parsed.sourceJointCount || 0,
    mappedCount: Object.values(parsed.mapping).filter(Boolean).length,
    mapping: parsed.mapping,
    createdAt: parsed.createdAt || timestamp,
    updatedAt: timestamp,
  };
}

export function createQuaternionPreset({
  requestedName,
  bone,
  q,
  now = new Date(),
  id = createPresetId(),
}: QuaternionPresetParams): QuaternionPreset {
  const name = requestedName.trim() || `${bone}-quat`;
  return {
    id,
    name,
    bone,
    q,
    createdAt: now.toISOString(),
  };
}

export function loadRetargetPresets(): RetargetPreset[] {
  return loadPresetList(RETARGET_PRESET_STORAGE_KEY, isRetargetPreset);
}

export function loadQuaternionPresets(): QuaternionPreset[] {
  return loadPresetList(QUATERNION_PRESET_STORAGE_KEY, isQuaternionPreset);
}
