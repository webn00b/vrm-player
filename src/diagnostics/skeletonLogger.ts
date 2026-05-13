/**
 * SkeletonLogger — компактная per-clip диагностика скелета.
 *
 * Streaming-агрегатор постоянной памяти (на кость) + sparse-буфер аномалий.
 * Цель — после стопа выдать ≤100 строк текста, по которым можно за один
 * взгляд найти типовые проблемы: NaN, 180°-flip между кадрами, ROM-overshoot,
 * дрейф hips по Y, повышенный jitter.
 *
 * Хук в renderLoop: после `validator.clampAll(...)`, до записи кадра в любой
 * recorder — это финальная on-screen-поза, тождественная тому, что увидит
 * BVH-экспорт.
 *
 * Дизайн: ядро (`SkeletonLoggerCore`) не зависит от three / VRM и принимает
 * абстрактные источники (`BoneSource`, `ValidatorSource`); фабрика
 * `createSkeletonLogger(vrm, validator)` строит обёртку для реального VRM.
 */

import type { VRM } from '@pixiv/three-vrm';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { EulerAxisOrder, RotationConstraint } from '../validation/boneConstraints';

// ── Типы и константы ─────────────────────────────────────────────────────────

export const KEY_LOG_BONES: VRMHumanBoneName[] = [
  VRMHumanBoneName.Hips,
  VRMHumanBoneName.Spine,
  VRMHumanBoneName.Chest,
  VRMHumanBoneName.UpperChest,
  VRMHumanBoneName.Neck,
  VRMHumanBoneName.Head,
  VRMHumanBoneName.LeftShoulder,
  VRMHumanBoneName.LeftUpperArm,
  VRMHumanBoneName.LeftLowerArm,
  VRMHumanBoneName.LeftHand,
  VRMHumanBoneName.RightShoulder,
  VRMHumanBoneName.RightUpperArm,
  VRMHumanBoneName.RightLowerArm,
  VRMHumanBoneName.RightHand,
  VRMHumanBoneName.LeftUpperLeg,
  VRMHumanBoneName.LeftLowerLeg,
  VRMHumanBoneName.LeftFoot,
  VRMHumanBoneName.RightUpperLeg,
  VRMHumanBoneName.RightLowerLeg,
  VRMHumanBoneName.RightFoot,
];

export const FLIP_DEG = 60;            // Δ-кватернион между кадрами выше — flip
export const HIP_DRIFT_PER_FRAME = 0.005; // м/кадр для накопления признака drift
export const HIP_DRIFT_RUN = 8;        // подряд кадров одного знака для anomaly
export const JITTER_SHOW_DEG = 5;      // σ Δ-кватерниона выше — показать в digest
export const ROM_SHOW_DEG = 1;         // суммарный ROM-overshoot выше — показать
export const ANOMALY_CAP = 20;         // храним первые N аномалий

export type Quat = { x: number; y: number; z: number; w: number };

export interface BoneSource {
  /** Вернуть локальный кватернион, или null если кость не найдена. */
  getQuat(name: VRMHumanBoneName): Quat | null;
  /** Мировой Y у hips — для drift-детектора. null если недоступно. */
  getHipsWorldY(): number | null;
}

export interface ValidatorSource {
  /** Стат от *последнего* clampAll — кость с максимальным overshoot. */
  getStats(): { worstBone: VRMHumanBoneName | null; worstDelta: number };
  /** Constraints (для извлечения Euler order). */
  getConstraints(): Partial<Record<VRMHumanBoneName, RotationConstraint>>;
}

export type AnomalyKind = 'nan' | 'flip' | 'hipDrift';

export interface Anomaly {
  frame: number;
  t: number;
  kind: AnomalyKind;
  bone: VRMHumanBoneName | null;
  detail: string;
}

interface BoneStat {
  prevQ: [number, number, number, number] | null;
  frames: number;
  nanFrames: number;
  flipCount: number;
  worstFlip: { frame: number; deltaDeg: number } | null;
  deltaSumDeg: number;
  deltaSqSumDeg: number;
  maxDeltaDeg: number;
  romHits: number;
  worstRomDeg: number;
  eulerMin: [number, number, number];
  eulerMax: [number, number, number];
  eulerOrder: EulerAxisOrder;
}

// ── Pure-math помощники ──────────────────────────────────────────────────────

/**
 * Угол между двумя кватернионами в градусах с нормализацией знака.
 * `dot < 0` означает, что b — антипод a; кратчайший путь требует инверсии знака.
 */
export function quatDeltaDeg(a: Quat | [number,number,number,number], b: Quat | [number,number,number,number]): number {
  const ax = Array.isArray(a) ? a[0] : a.x;
  const ay = Array.isArray(a) ? a[1] : a.y;
  const az = Array.isArray(a) ? a[2] : a.z;
  const aw = Array.isArray(a) ? a[3] : a.w;
  const bx = Array.isArray(b) ? b[0] : b.x;
  const by = Array.isArray(b) ? b[1] : b.y;
  const bz = Array.isArray(b) ? b[2] : b.z;
  const bw = Array.isArray(b) ? b[3] : b.w;
  let dot = ax*bx + ay*by + az*bz + aw*bw;
  if (dot < 0) dot = -dot;
  if (dot > 1) dot = 1;
  return (2 * Math.acos(dot)) * 180 / Math.PI;
}

export function isQuatNaN(q: Quat): boolean {
  return !Number.isFinite(q.x) || !Number.isFinite(q.y) ||
         !Number.isFinite(q.z) || !Number.isFinite(q.w);
}

/**
 * Кватернион → Euler по заданному порядку. Возвращает в радианах.
 * Реализовано без three.js, чтобы ядро было тестируемо в чистом TS.
 * (Идентично three.Euler.setFromQuaternion для порядков из RotationConstraint.)
 */
export function quatToEuler(q: Quat, order: EulerAxisOrder): [number, number, number] {
  // Унифицируем через матрицу 3×3, как в three.js.
  const { x, y, z, w } = q;
  const xx = x*x, yy = y*y, zz = z*z, ww = w*w;
  const m00 = ww + xx - yy - zz;
  const m01 = 2*(x*y - z*w);
  const m02 = 2*(x*z + y*w);
  const m10 = 2*(x*y + z*w);
  const m11 = ww - xx + yy - zz;
  const m12 = 2*(y*z - x*w);
  const m20 = 2*(x*z - y*w);
  const m21 = 2*(y*z + x*w);
  const m22 = ww - xx - yy + zz;
  const clamp = (v: number) => v < -1 ? -1 : v > 1 ? 1 : v;
  let ex = 0, ey = 0, ez = 0;
  switch (order) {
    case 'XYZ':
      ey = Math.asin(clamp(m02));
      if (Math.abs(m02) < 0.9999999) { ex = Math.atan2(-m12, m22); ez = Math.atan2(-m01, m00); }
      else                            { ex = Math.atan2( m21, m11); ez = 0; }
      break;
    case 'YXZ':
      ex = Math.asin(-clamp(m12));
      if (Math.abs(m12) < 0.9999999) { ey = Math.atan2( m02, m22); ez = Math.atan2( m10, m11); }
      else                            { ey = Math.atan2(-m20, m00); ez = 0; }
      break;
    case 'ZXY':
      ex = Math.asin(clamp(m21));
      if (Math.abs(m21) < 0.9999999) { ey = Math.atan2(-m20, m22); ez = Math.atan2(-m01, m11); }
      else                            { ey = 0;                    ez = Math.atan2( m10, m00); }
      break;
    case 'ZYX':
      ey = Math.asin(-clamp(m20));
      if (Math.abs(m20) < 0.9999999) { ex = Math.atan2( m21, m22); ez = Math.atan2( m10, m00); }
      else                            { ex = 0;                    ez = Math.atan2(-m01, m11); }
      break;
    case 'YZX':
      ez = Math.asin(clamp(m10));
      if (Math.abs(m10) < 0.9999999) { ex = Math.atan2(-m12, m11); ey = Math.atan2(-m20, m00); }
      else                            { ex = 0;                    ey = Math.atan2( m02, m22); }
      break;
    case 'XZY':
      ez = Math.asin(-clamp(m01));
      if (Math.abs(m01) < 0.9999999) { ex = Math.atan2( m21, m11); ey = Math.atan2( m02, m00); }
      else                            { ex = Math.atan2(-m12, m22); ey = 0; }
      break;
  }
  return [ex, ey, ez];
}

const RAD2DEG = 180 / Math.PI;

// ── Ядро логгера ────────────────────────────────────────────────────────────

export class SkeletonLoggerCore {
  private boneSrc: BoneSource;
  private valSrc: ValidatorSource;
  private bones: VRMHumanBoneName[];
  private stats = new Map<VRMHumanBoneName, BoneStat>();
  private anomalies: Anomaly[] = [];
  private active = false;
  private label = '';
  private t0Ms = 0;
  private frame = 0;

  // Hips world-Y trace — компактные счётчики drift.
  private hipsY = { first: NaN, last: NaN, min: +Infinity, max: -Infinity };
  private hipsRun = { dir: 0, count: 0, start: 0, sum: 0 };
  private hipsPrevY: number | undefined = undefined;

  // Последний дайджест, на случай повторного вызова printToConsole/download.
  private lastDigest = '';

  private nanFrames = 0;
  private romFrames = 0;
  private flipFrames = 0;

  // Источник времени; в продакшене — performance.now, в тестах — фиксируемый.
  private now: () => number;

  constructor(
    boneSrc: BoneSource,
    valSrc: ValidatorSource,
    options: { bones?: VRMHumanBoneName[]; now?: () => number } = {},
  ) {
    this.boneSrc = boneSrc;
    this.valSrc = valSrc;
    this.bones = options.bones ?? KEY_LOG_BONES;
    this.now = options.now ?? (() => performance.now());
  }

  get isActive(): boolean { return this.active; }
  get frameCount(): number { return this.frame; }

  start(label = ''): void {
    this.stats.clear();
    this.anomalies = [];
    this.label = label;
    this.t0Ms = this.now();
    this.frame = 0;
    this.hipsY = { first: NaN, last: NaN, min: +Infinity, max: -Infinity };
    this.hipsRun = { dir: 0, count: 0, start: 0, sum: 0 };
    this.hipsPrevY = undefined;
    this.nanFrames = 0;
    this.romFrames = 0;
    this.flipFrames = 0;
    this.lastDigest = '';

    const constraints = this.valSrc.getConstraints();
    for (const name of this.bones) {
      this.stats.set(name, {
        prevQ: null,
        frames: 0,
        nanFrames: 0,
        flipCount: 0,
        worstFlip: null,
        deltaSumDeg: 0,
        deltaSqSumDeg: 0,
        maxDeltaDeg: 0,
        romHits: 0,
        worstRomDeg: 0,
        eulerMin: [+Infinity, +Infinity, +Infinity],
        eulerMax: [-Infinity, -Infinity, -Infinity],
        eulerOrder: constraints[name]?.order ?? 'XYZ',
      });
    }
    this.active = true;
  }

  /** Один кадр — читать после `validator.clampAll()`. */
  tick(): void {
    if (!this.active) return;
    const f = this.frame++;
    const t = (this.now() - this.t0Ms) / 1000;

    // Per-frame флаги — чтобы посчитать nanFrames/flipFrames независимо от
    // числа костей, у которых сработало.
    let frameHasNan = false;
    let frameHasFlip = false;

    for (const name of this.bones) {
      const st = this.stats.get(name);
      if (!st) continue;
      const q = this.boneSrc.getQuat(name);
      if (!q) continue;
      st.frames++;

      if (isQuatNaN(q)) {
        st.nanFrames++;
        frameHasNan = true;
        this.pushAnomaly({ frame: f, t, kind: 'nan', bone: name, detail: 'NaN in quaternion' });
        // не кладём prevQ из NaN — пропустим следующее сравнение
        st.prevQ = null;
        continue;
      }

      if (st.prevQ) {
        const d = quatDeltaDeg(st.prevQ, q);
        st.deltaSumDeg += d;
        st.deltaSqSumDeg += d * d;
        if (d > st.maxDeltaDeg) st.maxDeltaDeg = d;
        if (d > FLIP_DEG) {
          st.flipCount++;
          frameHasFlip = true;
          if (!st.worstFlip || d > st.worstFlip.deltaDeg) {
            st.worstFlip = { frame: f, deltaDeg: d };
          }
          this.pushAnomaly({
            frame: f, t, kind: 'flip', bone: name,
            detail: `Δ=${d.toFixed(1)}°`,
          });
        }
      }

      // Euler range — для отладки залипаний по конкретной оси.
      const e = quatToEuler(q, st.eulerOrder);
      for (let i = 0; i < 3; i++) {
        if (e[i] < st.eulerMin[i]) st.eulerMin[i] = e[i];
        if (e[i] > st.eulerMax[i]) st.eulerMax[i] = e[i];
      }

      st.prevQ = [q.x, q.y, q.z, q.w];
    }

    // ROM — берём итог последнего clampAll. Этот метод запоминает только
    // *одну* худшую кость на кадр, но именно она нам и нужна.
    const vs = this.valSrc.getStats();
    if (vs.worstBone && vs.worstDelta > 0) {
      const st = this.stats.get(vs.worstBone);
      if (st) {
        st.romHits++;
        const deg = vs.worstDelta * RAD2DEG;
        if (deg > st.worstRomDeg) st.worstRomDeg = deg;
        this.romFrames++;
      }
    }

    // Hips Y — drift-детектор.
    const y = this.boneSrc.getHipsWorldY();
    if (y !== null && Number.isFinite(y)) {
      if (Number.isNaN(this.hipsY.first)) this.hipsY.first = y;
      this.hipsY.last = y;
      if (y < this.hipsY.min) this.hipsY.min = y;
      if (y > this.hipsY.max) this.hipsY.max = y;

      // Длина серии однонаправленных смещений ≥HIP_DRIFT_PER_FRAME.
      // Не используем prevWorldY вне трэкера — храним его в hipsRun.
      const prev = this.hipsPrevY;
      if (prev !== undefined) {
        const dy = y - prev;
        const dir = dy > +HIP_DRIFT_PER_FRAME ? +1
                  : dy < -HIP_DRIFT_PER_FRAME ? -1 : 0;
        if (dir !== 0 && dir === this.hipsRun.dir) {
          this.hipsRun.count++;
          this.hipsRun.sum += dy;
          if (this.hipsRun.count === HIP_DRIFT_RUN) {
            this.pushAnomaly({
              frame: f, t, kind: 'hipDrift', bone: VRMHumanBoneName.Hips,
              detail: `Δy=${this.hipsRun.sum >= 0 ? '+' : ''}${this.hipsRun.sum.toFixed(3)}m over ${HIP_DRIFT_RUN}f`,
            });
          }
        } else {
          this.hipsRun = { dir, count: dir !== 0 ? 1 : 0, start: f, sum: dir !== 0 ? dy : 0 };
        }
      }
      this.hipsPrevY = y;
    }

    if (frameHasNan) this.nanFrames++;
    if (frameHasFlip) this.flipFrames++;
  }

  stop(): string {
    this.active = false;
    this.lastDigest = this.buildDigest();
    return this.lastDigest;
  }

  private pushAnomaly(a: Anomaly): void {
    if (this.anomalies.length < ANOMALY_CAP) this.anomalies.push(a);
  }

  // ── Форматирование дайджеста ───────────────────────────────────────────────

  buildDigest(): string {
    const lines: string[] = [];
    const dur = this.frame > 0 ? (this.now() - this.t0Ms) / 1000 : 0;
    const fps = dur > 0 ? this.frame / dur : 0;

    lines.push(
      `=== SkelLog === src=${this.label || '?'}  frames=${this.frame}  ` +
      `dur=${dur.toFixed(2)}s  fps≈${fps.toFixed(1)}`,
    );

    // GLOBAL
    const worst = this.findWorstBone();
    const worstStr = worst
      ? `${worst.bone}/+${worst.deg.toFixed(1)}°`
      : '—';
    lines.push(
      `GLOBAL   nanFrames=${this.nanFrames}  flipFrames=${this.flipFrames}  ` +
      `romFrames=${this.romFrames}  worstBone=${worstStr}`,
    );

    // HIP
    if (Number.isFinite(this.hipsY.first)) {
      const drift = this.hipsY.last - this.hipsY.first;
      const dirSign = drift > 0 ? '↑' : drift < 0 ? '↓' : '·';
      const monotonic = Math.abs(drift) > 0.02 ? `monotonic${dirSign}` : 'stable';
      const warn = Math.abs(drift) > 0.05 ? '  ⚠ drift' : '';
      lines.push(
        `HIP      y=[${this.hipsY.min.toFixed(3)}..${this.hipsY.max.toFixed(3)}]  ` +
        `Δ=${drift >= 0 ? '+' : ''}${drift.toFixed(3)}m  ${monotonic}${warn}`,
      );
    } else {
      lines.push('HIP      n/a');
    }

    // PER-BONE — только аномальные.
    const anomalous: Array<{ name: VRMHumanBoneName; line: string; severity: number }> = [];
    const healthy: VRMHumanBoneName[] = [];
    for (const name of this.bones) {
      const st = this.stats.get(name);
      if (!st || st.frames === 0) continue;
      const parts: string[] = [];
      let severity = 0;
      if (st.nanFrames > 0)  { parts.push(`nan=${st.nanFrames}`); severity += 1000; }
      if (st.flipCount > 0)  {
        const wf = st.worstFlip!;
        parts.push(`flips=${st.flipCount}  worstΔ=${wf.deltaDeg.toFixed(0)}°@f${wf.frame}`);
        severity += 100 + wf.deltaDeg;
      }
      if (st.romHits > 0 && st.worstRomDeg >= ROM_SHOW_DEG) {
        parts.push(`romHits=${st.romHits}  worstROM=+${st.worstRomDeg.toFixed(1)}°`);
        severity += 10 + st.worstRomDeg;
      }
      const sigma = st.frames > 1
        ? Math.sqrt(Math.max(0, st.deltaSqSumDeg / (st.frames - 1) -
                                (st.deltaSumDeg / (st.frames - 1)) ** 2))
        : 0;
      if (sigma >= JITTER_SHOW_DEG) {
        parts.push(`jitterσ=${sigma.toFixed(1)}°/frame`);
        severity += sigma;
      }

      if (parts.length === 0) {
        healthy.push(name);
      } else {
        anomalous.push({
          name,
          line: `  ${name.padEnd(14)} ${parts.join('  ')}`,
          severity,
        });
      }
    }
    anomalous.sort((a, b) => b.severity - a.severity);

    if (anomalous.length > 0) {
      lines.push('PER-BONE (anomalous, sorted by severity):');
      for (const a of anomalous) lines.push(a.line);
    }

    if (healthy.length > 0) {
      lines.push('HEALTHY:');
      // По 5 в строку для компактности.
      for (let i = 0; i < healthy.length; i += 5) {
        lines.push('  ' + healthy.slice(i, i + 5).join('  '));
      }
    }

    if (this.anomalies.length > 0) {
      lines.push(`ANOMALIES (first ${this.anomalies.length}):`);
      for (const a of this.anomalies) {
        const boneStr = a.bone ? a.bone : '-';
        lines.push(
          `  f=${String(a.frame).padEnd(4)} t=${a.t.toFixed(3)}s  ` +
          `${a.kind.padEnd(8)} ${boneStr.padEnd(14)} ${a.detail}`,
        );
      }
    }

    return lines.join('\n');
  }

  private findWorstBone(): { bone: VRMHumanBoneName; deg: number } | null {
    let best: { bone: VRMHumanBoneName; deg: number } | null = null;
    for (const [name, st] of this.stats) {
      const candidate = Math.max(
        st.worstRomDeg,
        st.worstFlip ? st.worstFlip.deltaDeg : 0,
      );
      if (candidate > 0 && (!best || candidate > best.deg)) {
        best = { bone: name, deg: candidate };
      }
    }
    return best;
  }

  /** Прямой доступ к собранным аномалиям — используется тестами. */
  getAnomalies(): readonly Anomaly[] { return this.anomalies; }
  getStat(name: VRMHumanBoneName): Readonly<BoneStat> | null {
    return this.stats.get(name) ?? null;
  }
}

// ── Production-обёртка над VRM ───────────────────────────────────────────────

import * as THREE from 'three';

function makeBoneSourceFromVrm(vrm: VRM): BoneSource {
  const cache = new Map<VRMHumanBoneName, THREE.Object3D | null>();
  const tmpV = new THREE.Vector3();
  const getNode = (name: VRMHumanBoneName) => {
    let n = cache.get(name);
    if (n === undefined) {
      const got = vrm.humanoid.getNormalizedBoneNode(name) as THREE.Object3D | null;
      // null означает «нет такой кости в скелете» — кэшируем явно
      n = got;
      cache.set(name, n);
    }
    return n;
  };
  return {
    getQuat(name) {
      const node = getNode(name);
      if (!node) return null;
      const q = node.quaternion;
      return { x: q.x, y: q.y, z: q.z, w: q.w };
    },
    getHipsWorldY() {
      const node = getNode(VRMHumanBoneName.Hips);
      if (!node) return null;
      node.getWorldPosition(tmpV);
      return tmpV.y;
    },
  };
}

export interface SkeletonLogger {
  readonly active: boolean;
  readonly frameCount: number;
  start(label?: string): void;
  stop(): string;
  tick(): void;
  printToConsole(): void;
  download(filename?: string): void;
  /** Чтобы UI мог показать «X frames» во время записи. */
  getDigestSoFar(): string;
}

export function createSkeletonLogger(
  vrm: VRM,
  validator: ValidatorSource,
): SkeletonLogger {
  const core = new SkeletonLoggerCore(makeBoneSourceFromVrm(vrm), validator);
  let lastDigest = '';
  return {
    get active() { return core.isActive; },
    get frameCount() { return core.frameCount; },
    start(label) { core.start(label); lastDigest = ''; },
    stop() { lastDigest = core.stop(); return lastDigest; },
    tick() { core.tick(); },
    getDigestSoFar() {
      return core.buildDigest();
    },
    printToConsole() {
      const d = lastDigest || core.buildDigest();
      console.log(d);
    },
    download(filename = 'skel_log.txt') {
      const d = lastDigest || core.buildDigest();
      const blob = new Blob([d], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    },
  };
}
