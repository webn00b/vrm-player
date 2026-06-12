import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { ManualFbxBoneMapping } from '../../animationLoaders/fbxBoneMapping';
import type { QuaternionCorrection } from '../../retargetCorrections';
import type { RetargetLabAnalysis, SkeletonJointMeta } from '../../retargetLabModel';
import { isFingerSlot, type RetargetSlot } from './retargetMappingModel';
import type { QuaternionPreset } from './retargetPresetStore';

export interface SummaryRow {
  label: string;
  value: string;
}

export interface MappingReportRow {
  slot: string;
  label: string;
  required: boolean;
  source: string;
  mapped: boolean;
  kind: 'Body' | 'Finger';
}

export type { RetargetSlot } from './retargetMappingModel';

export interface QuaternionEditorReportState {
  selectedBone: VRMHumanBoneName;
  mode: string;
  quat: { x: number; y: number; z: number; w: number };
  eulerDeg: { x: number; y: number; z: number };
  axisAngle: { x: number; y: number; z: number; angle: number };
}

export function buildReportSummary(params: {
  currentFileName: string | null;
  analysis: RetargetLabAnalysis | null;
  targetJointCount: number;
  mappedCount: number;
  slotCount: number;
  missingRequiredLabels: string[];
  activeCorrectionCount: number;
  correctionCount: number;
}): SummaryRow[] {
  const { analysis } = params;
  return [
    { label: 'File', value: params.currentFileName ?? 'none' },
    { label: 'Format', value: analysis?.format?.toUpperCase() ?? 'none' },
    { label: 'Duration', value: analysis ? `${analysis.duration.toFixed(3)}s` : '0.000s' },
    { label: 'Source joints', value: String(analysis?.sourceJoints.length ?? 0) },
    { label: 'Target joints', value: String(params.targetJointCount) },
    { label: 'Mapped slots', value: `${params.mappedCount}/${params.slotCount}` },
    {
      label: 'Missing required',
      value: params.missingRequiredLabels.length ? params.missingRequiredLabels.join(', ') : 'none',
    },
    { label: 'Corrections', value: `${params.activeCorrectionCount}/${params.correctionCount} active` },
  ];
}

export function buildReportMappingRows(
  slots: RetargetSlot[],
  mapping: ManualFbxBoneMapping,
): MappingReportRow[] {
  return slots.map((slot) => ({
    slot: slot.name,
    label: slot.label,
    required: slot.required,
    source: mapping[slot.name] || '',
    mapped: !!mapping[slot.name],
    kind: isFingerSlot(slot.name) ? 'Finger' : 'Body',
  }));
}

export function buildCurrentQuaternionRows(state: QuaternionEditorReportState): SummaryRow[] {
  return [
    { label: 'Bone', value: state.selectedBone },
    { label: 'Editor mode', value: state.mode },
    { label: 'Quaternion', value: `[${[state.quat.x, state.quat.y, state.quat.z, state.quat.w].map((n) => n.toFixed(6)).join(', ')}]` },
    { label: 'Euler YXZ', value: `${state.eulerDeg.x.toFixed(2)}°, ${state.eulerDeg.y.toFixed(2)}°, ${state.eulerDeg.z.toFixed(2)}°` },
    {
      label: 'Axis-angle',
      value: `[${state.axisAngle.x.toFixed(3)}, ${state.axisAngle.y.toFixed(3)}, ${state.axisAngle.z.toFixed(3)}] · ${state.axisAngle.angle.toFixed(2)}°`,
    },
  ];
}

export function buildRetargetInfoText(params: {
  currentFileName: string | null;
  analysis: RetargetLabAnalysis | null;
  slots: RetargetSlot[];
  mapping: ManualFbxBoneMapping;
  targetJoints: SkeletonJointMeta[];
  mappedCount: number;
  extraMappedEntries: Array<[VRMHumanBoneName, string | undefined]>;
  missingRequiredLabels: string[];
  editor: QuaternionEditorReportState;
  corrections: QuaternionCorrection[];
  quaternionPresets: QuaternionPreset[];
}): string {
  const mappedRows = params.slots
    .map((slot) => {
      const source = params.mapping[slot.name] || 'UNASSIGNED';
      const flag = slot.required ? 'required' : 'optional';
      return `${slot.name.padEnd(28)} <- ${source} (${flag})`;
    })
    .join('\n');
  const extraRows = params.extraMappedEntries
    .map(([slot, source]) => `${slot.padEnd(28)} <- ${source}`)
    .join('\n') || '- none';
  const sourceJoints = (params.analysis?.sourceJoints ?? [])
    .map((joint) => {
      const animated = joint.trackCount > 0 ? ` tracks=${joint.trackCount}` : '';
      return `- ${joint.name}${animated}`;
    })
    .join('\n') || '- none loaded';
  const targetJointRows = params.targetJoints
    .map((joint) => `- ${joint.name}${joint.parentId ? ` parent=${joint.parentId}` : ''}`)
    .join('\n') || '- none';
  const warningRows = (params.analysis?.warnings ?? [])
    .map((warning) => `- ${warning}`)
    .join('\n') || '- none';
  const correctionRows = params.corrections
    .map((correction) => (
      `- ${correction.enabled ? 'ON ' : 'OFF'} ${correction.bone} ${correction.mode} ` +
      `[${correction.q.map((n) => n.toFixed(8)).join(', ')}]`
    ))
    .join('\n') || '- none';
  const quatPresetRows = params.quaternionPresets
    .map((preset) => `- ${preset.name} · ${preset.bone} [${preset.q.map((n) => n.toFixed(8)).join(', ')}]`)
    .join('\n') || '- none';

  return [
    'Retarget Lab Report',
    '===================',
    '',
    'Source',
    '------',
    `file: ${params.currentFileName ?? 'none'}`,
    `format: ${params.analysis?.format?.toUpperCase() ?? 'none'}`,
    `clips: ${params.analysis?.clipCount ?? 0}`,
    `duration: ${params.analysis ? `${params.analysis.duration.toFixed(3)}s` : '0.000s'}`,
    `source joints: ${params.analysis?.sourceJoints.length ?? 0}`,
    '',
    'Target',
    '------',
    `target: current VRM`,
    `humanoid joints: ${params.targetJoints.length}`,
    '',
    'Mapping Summary',
    '---------------',
    `mapped slots: ${params.mappedCount}/${params.slots.length}`,
    `extra mapped bones: ${params.extraMappedEntries.length}`,
    `missing required: ${params.missingRequiredLabels.length ? params.missingRequiredLabels.join(', ') : 'none'}`,
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
    `bone: ${params.editor.selectedBone}`,
    `mode: ${params.editor.mode}`,
    `quat: [${[params.editor.quat.x, params.editor.quat.y, params.editor.quat.z, params.editor.quat.w].map((n) => n.toFixed(8)).join(', ')}]`,
    `euler YXZ: ${params.editor.eulerDeg.x.toFixed(3)}°, ${params.editor.eulerDeg.y.toFixed(3)}°, ${params.editor.eulerDeg.z.toFixed(3)}°`,
    `axis-angle: [${params.editor.axisAngle.x.toFixed(4)}, ${params.editor.axisAngle.y.toFixed(4)}, ${params.editor.axisAngle.z.toFixed(4)}] ${params.editor.axisAngle.angle.toFixed(3)}°`,
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
}
