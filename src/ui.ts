import { ref } from 'vue';

// ── Display name helpers ──────────────────────────────────────────────────────

const ALIAS_KEY = 'vrm-player.library-aliases';

export function readLibraryAlias(rawName: string): string | undefined {
  try {
    const raw = localStorage.getItem(ALIAS_KEY);
    if (!raw) return undefined;
    return (JSON.parse(raw) as Record<string, string>)[rawName];
  } catch { return undefined; }
}

export function writeLibraryAlias(rawName: string, alias: string | null): void {
  try {
    const raw = localStorage.getItem(ALIAS_KEY);
    const obj = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    if (alias && alias.trim().length > 0) obj[rawName] = alias.trim();
    else delete obj[rawName];
    localStorage.setItem(ALIAS_KEY, JSON.stringify(obj));
  } catch { /* quota / private mode — silently ignore */ }
}

/**
 * Render a friendly display name. If the user has set an alias, use it.
 * Otherwise, hash-like raw names (hex ≥ 16 chars) get truncated: `abc12345…defg`.
 */
export function formatLibraryName(rawName: string): string {
  const alias = readLibraryAlias(rawName);
  if (alias) return alias;
  if (/^[0-9a-f]{16,}$/i.test(rawName)) {
    return `${rawName.slice(0, 8)}…${rawName.slice(-4)}`;
  }
  return rawName;
}


// ── Status bar ────────────────────────────────────────────────────────────────

export const statusText = ref('booting…');

export function setStatus(text: string): void {
  statusText.value = text;
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}
