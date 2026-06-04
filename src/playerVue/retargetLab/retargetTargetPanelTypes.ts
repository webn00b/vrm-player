import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { QuaternionCorrection, QuaternionCorrectionMode } from '../../retargetCorrections';
import type { SkeletonJointMeta } from '../../retargetLabModel';
import type { QuaternionPreset } from './retargetPresetStore';
import type {
  AxisAngleField,
  AxisAngleFields,
  EulerDegFields,
  QuaternionEditorMode,
  QuaternionField,
  QuaternionFields,
  VectorField,
} from './retargetQuaternionTypes';

export interface RetargetTargetPanelProps {
  targetJoints: SkeletonJointMeta[];
  currentFile: File | null;
  importing: boolean;
  canImport: boolean;
  selectedQuatPreset: QuaternionPreset | null;
  quatPresets: QuaternionPreset[];
  quaternionModeOptions: Array<{ label: string; value: QuaternionEditorMode }>;
  correctionModeOptions: Array<{ label: string; value: QuaternionCorrectionMode }>;
  quat: QuaternionFields;
  eulerDeg: EulerDegFields;
  axisAngle: AxisAngleFields;
  corrections: QuaternionCorrection[];
  activeCorrectionCount: number;
  previewMode: 'original' | 'corrected' | '';
  previewing: boolean;
  canPreview: boolean;
  previewName: string;
  previewDuration: number;
}

export interface RetargetTargetPanelEmits {
  boneChange: [];
  quatFieldChange: [field: QuaternionField, value: number];
  eulerFieldChange: [field: VectorField, value: number];
  axisAngleFieldChange: [field: AxisAngleField, value: number];
  read: [];
  apply: [];
  normalize: [];
  identity: [];
  invert: [];
  copyJson: [];
  pasteJson: [];
  addCorrection: [];
  clearCorrections: [];
  toggleCorrection: [id: string];
  removeCorrection: [id: string];
  preview: [corrected: boolean];
  seekPreview: [];
  stopPreview: [];
  saveQuatPreset: [];
  loadQuatPreset: [];
  deleteQuatPreset: [];
  importCurrent: [];
}
