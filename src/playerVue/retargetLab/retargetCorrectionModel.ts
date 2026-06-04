import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { QuaternionCorrection, QuaternionCorrectionMode } from '../../retargetCorrections';

interface QuaternionCorrectionParams {
  id: string;
  bone: VRMHumanBoneName;
  mode: QuaternionCorrectionMode;
  q: [number, number, number, number];
}

export function createQuaternionCorrection(params: QuaternionCorrectionParams): QuaternionCorrection {
  return {
    id: params.id,
    bone: params.bone,
    mode: params.mode,
    q: params.q,
    enabled: true,
  };
}

export function activeQuaternionCorrections(
  corrections: readonly QuaternionCorrection[],
): QuaternionCorrection[] {
  return corrections.filter((correction) => correction.enabled);
}

export function activeCorrectionBones(corrections: readonly QuaternionCorrection[]): Set<string> {
  return new Set(activeQuaternionCorrections(corrections).map((correction) => correction.bone));
}

export function toggleQuaternionCorrection(
  corrections: readonly QuaternionCorrection[],
  id: string,
): QuaternionCorrection[] {
  return corrections.map((correction) => (
    correction.id === id ? { ...correction, enabled: !correction.enabled } : correction
  ));
}

export function removeQuaternionCorrection(
  corrections: readonly QuaternionCorrection[],
  id: string,
): QuaternionCorrection[] {
  return corrections.filter((correction) => correction.id !== id);
}
