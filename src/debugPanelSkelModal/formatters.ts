import * as THREE from 'three';
import type { Landmark3D } from '../mocap/pipeline/poseDetector';

export const skelRow = (label: string, value: string): string =>
  `<div class="skel-row">
     <span class="skel-row-label">${label}</span>
     <span class="skel-row-value">${value}</span>
   </div>`;

export const fmtM = (v: number): string => v > 1e-4 ? `${v.toFixed(3)} m` : '<span style="opacity:.35">—</span>';
export const fmtPct = (v: number): string => v > 0 ? `${(v * 100).toFixed(1)}%` : '<span style="opacity:.35">—</span>';
export const fmtNum = (v: number): string => Number.isFinite(v) ? v.toFixed(3) : '<span style="opacity:.35">—</span>';
export const fmtCm = (v: number): string =>
  Number.isFinite(v) ? `${(v * 100).toFixed(1)} cm` : '<span style="opacity:.35">—</span>';
export const fmtDeg = (v: number): string =>
  Number.isFinite(v) ? `${v.toFixed(1)}°` : '<span style="opacity:.35">—</span>';
export const fmtVecHtml = (v: THREE.Vector3 | null | undefined): string =>
  v ? `<span style="font-family:ui-monospace,monospace">${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}</span>`
    : '<span style="opacity:.35">—</span>';
export const fmtVecText = (v: THREE.Vector3 | null | undefined): string =>
  v ? `${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}` : '—';
export const fmtVisText = (v: number | undefined): string =>
  v == null ? '—' : `${(v * 100).toFixed(0)}%`;
export const fmtLmHtml = (lm: Landmark3D | null | undefined): string =>
  lm
    ? `<span style="font-family:ui-monospace,monospace">${lm.x.toFixed(3)}, ${lm.y.toFixed(3)}, ${lm.z.toFixed(3)}</span> <span style="opacity:.55">vis ${fmtVisText(lm.visibility)}</span>`
    : '<span style="opacity:.35">—</span>';
export const fmtLmText = (lm: Landmark3D | null | undefined): string =>
  lm ? `${lm.x.toFixed(3)}, ${lm.y.toFixed(3)}, ${lm.z.toFixed(3)} · vis ${fmtVisText(lm.visibility)}` : '—';
export const fmtRatio = (avatar: number, perf: number): string => {
  if (avatar <= 1e-4 || perf <= 1e-4) return '<span style="opacity:.35">—</span>';
  const r = avatar / perf;
  const color = r < 0.85 ? '#f87171' : r > 1.15 ? '#fbbf24' : '#4ade80';
  return `<span style="color:${color}">${r.toFixed(2)}×</span>`;
};
export const reachHtml = (v: number): string => {
  if (v <= 0) return '<span style="opacity:.35">—</span>';
  const color = v < 90 ? '#4ade80' : v <= 100 ? '#fbbf24' : '#f87171';
  return `<span style="color:${color}">${v.toFixed(0)}%</span>`;
};
export const lockHtml = (locked: boolean): string =>
  locked
    ? '<span class="skel-uncal">🔒 locked</span>'
    : '<span class="skel-cal">✓ free</span>';
