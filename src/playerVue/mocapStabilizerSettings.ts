export interface MocapStabilizerControlState {
  prerollSec: number;
  bodyMaxStep: number;
  bodyMaxZStep: number;
  bodyMaxGapFrames: number;
  handMaxStep: number;
  handMaxZStep: number;
  handMaxGapFrames: number;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const MOCAP_STABILIZER_SETTINGS_KEY = 'vrm-player.mocap-stabilizer-settings';

const RANGES: Record<keyof MocapStabilizerControlState, { min: number; max: number; integer?: boolean }> = {
  prerollSec: { min: 0, max: 3 },
  bodyMaxStep: { min: 0.05, max: 1 },
  bodyMaxZStep: { min: 0.02, max: 0.6 },
  bodyMaxGapFrames: { min: 0, max: 10, integer: true },
  handMaxStep: { min: 0.02, max: 0.4 },
  handMaxZStep: { min: 0.02, max: 0.4 },
  handMaxGapFrames: { min: 0, max: 10, integer: true },
};

function normalizeNumber(value: unknown, range: { min: number; max: number; integer?: boolean }): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const clamped = Math.max(range.min, Math.min(range.max, value));
  return range.integer ? Math.round(clamped) : clamped;
}

export function normalizeMocapStabilizerSettings(value: unknown): Partial<MocapStabilizerControlState> | null {
  if (!value || typeof value !== 'object') return null;
  const out: Partial<MocapStabilizerControlState> = {};
  for (const key of Object.keys(RANGES) as Array<keyof MocapStabilizerControlState>) {
    const normalized = normalizeNumber((value as Partial<MocapStabilizerControlState>)[key], RANGES[key]);
    if (normalized !== null) out[key] = normalized;
  }
  return Object.keys(out).length ? out : null;
}

export function loadMocapStabilizerSettings(
  storage: StorageLike = localStorage,
): Partial<MocapStabilizerControlState> | null {
  try {
    const raw = storage.getItem(MOCAP_STABILIZER_SETTINGS_KEY);
    if (!raw) return null;
    return normalizeMocapStabilizerSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveMocapStabilizerSettings(
  state: MocapStabilizerControlState,
  storage: StorageLike = localStorage,
): void {
  const normalized = normalizeMocapStabilizerSettings(state);
  if (!normalized) return;
  try {
    storage.setItem(MOCAP_STABILIZER_SETTINGS_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore quota/private-mode failures; sliders should still affect runtime.
  }
}
