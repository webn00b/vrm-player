import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { ManualFbxBoneMapping } from '../../animationLoaders/fbxBoneMapping';
import type { QuaternionCorrection, QuaternionCorrectionMode } from '../../retargetCorrections';
import type { RetargetLabAnalysis, SkeletonJointMeta } from '../../retargetLabModel';
import type { SkeletonPreview } from './retargetPreviewModel';
import type { MappingReportRow, SummaryRow } from './retargetReportModel';
import type { MappingView, RetargetSlot } from './retargetMappingModel';
import type { QuaternionPreset, RetargetPreset } from './retargetPresetStore';
import type {
  AxisAngleField,
  AxisAngleFields,
  EulerDegFields,
  QuaternionEditorMode,
  QuaternionField,
  QuaternionFields,
  VectorField,
} from './retargetQuaternionTypes';

export interface RetargetLabDashboardProps {
  currentFile: File | null;
  analysis: RetargetLabAnalysis | null;
  sourceOrigin: 'manual' | 'player';
  contextSourceLabel: string;
  previewStatusLabel: string;
  activeCorrectionCount: number;
  lastImportMessage: string;
  mappedCount: number;
  slotCount: number;
  error: string;
  presets: RetargetPreset[];
  selectedPreset: RetargetPreset | null;
  sourcePreview: SkeletonPreview;
  targetPreview: SkeletonPreview;
  originalComparePreview: SkeletonPreview;
  correctedComparePreview: SkeletonPreview;
  mappingViewOptions: Array<{ label: string; value: MappingView }>;
  visibleSlots: RetargetSlot[];
  sourceOptions: SkeletonJointMeta[];
  mapping: ManualFbxBoneMapping;
  loading: boolean;
  importing: boolean;
  requiredMissingCount: number;
  targetJoints: SkeletonJointMeta[];
  canImport: boolean;
  selectedQuatPreset: QuaternionPreset | null;
  quatPresets: QuaternionPreset[];
  quaternionModeOptions: Array<{ label: string; value: QuaternionEditorMode }>;
  correctionModeOptions: Array<{ label: string; value: QuaternionCorrectionMode }>;
  quat: QuaternionFields;
  eulerDeg: EulerDegFields;
  axisAngle: AxisAngleFields;
  corrections: QuaternionCorrection[];
  previewMode: 'original' | 'corrected' | '';
  previewing: boolean;
  canPreview: boolean;
  previewName: string;
  previewDuration: number;
  summaryRows: SummaryRow[];
  quaternionRows: SummaryRow[];
  mappingRows: MappingReportRow[];
}

export interface RetargetLabDashboardEmits {
  analyzeFile: [file: File];
  backToPlayer: [];
  savePreset: [];
  loadPreset: [];
  deletePreset: [];
  exportPreset: [];
  importPresetFile: [event: Event];
  autoMapping: [];
  clearMapping: [];
  mappingChange: [slot: VRMHumanBoneName, value: string];
  boneChange: [];
  quatFieldChange: [field: QuaternionField, value: number];
  eulerFieldChange: [field: VectorField, value: number];
  axisAngleFieldChange: [field: AxisAngleField, value: number];
  readQuaternion: [];
  applyQuaternion: [];
  normalizeQuaternion: [];
  identityQuaternion: [];
  invertQuaternion: [];
  copyQuaternionJson: [];
  pasteQuaternionJson: [];
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
  copyReport: [];
}
