import type { VRMHumanBoneName } from '@pixiv/three-vrm';

interface QuaternionClipboardParams {
  bone: VRMHumanBoneName;
  quat: { x: number; y: number; z: number; w: number };
  eulerDeg: { x: number; y: number; z: number };
}

interface QuaternionClipboardPayload {
  bone?: string;
  q: [number, number, number, number];
}

function fixedNumber(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

export function buildQuaternionClipboardJson(params: QuaternionClipboardParams): string {
  const payload = {
    bone: params.bone,
    q: [
      fixedNumber(params.quat.x, 8),
      fixedNumber(params.quat.y, 8),
      fixedNumber(params.quat.z, 8),
      fixedNumber(params.quat.w, 8),
    ],
    eulerDeg: {
      x: fixedNumber(params.eulerDeg.x, 3),
      y: fixedNumber(params.eulerDeg.y, 3),
      z: fixedNumber(params.eulerDeg.z, 3),
      order: 'YXZ',
    },
  };
  return JSON.stringify(payload, null, 2);
}

export function parseQuaternionClipboardJson(text: string): QuaternionClipboardPayload {
  const parsed = JSON.parse(text) as { bone?: unknown; q?: unknown };
  if (
    !Array.isArray(parsed.q) ||
    parsed.q.length !== 4 ||
    !parsed.q.every((value) => typeof value === 'number' && Number.isFinite(value))
  ) {
    throw new Error('Clipboard JSON has no q: [x,y,z,w]');
  }
  return {
    bone: typeof parsed.bone === 'string' ? parsed.bone : undefined,
    q: [parsed.q[0], parsed.q[1], parsed.q[2], parsed.q[3]],
  };
}
