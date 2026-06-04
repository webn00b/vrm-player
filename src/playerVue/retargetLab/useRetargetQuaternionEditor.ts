import { reactive, ref } from 'vue';
import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import {
  buildQuaternionEditorState,
  quaternionFromEditorState,
} from './retargetQuaternionModel';
import type {
  AxisAngleField,
  QuaternionEditorMode,
  QuaternionField,
  VectorField,
} from './retargetQuaternionTypes';

export function useRetargetQuaternionEditor(vrm: VRM) {
  const quaternionMode = ref<QuaternionEditorMode>('euler');
  const quaternionModeOptions: Array<{ label: string; value: QuaternionEditorMode }> = [
    { label: 'Euler', value: 'euler' },
    { label: 'Quat', value: 'quat' },
    { label: 'Axis', value: 'axis' },
  ];
  const selectedQuatBone = ref<VRMHumanBoneName>('hips');
  const quat = reactive({ x: 0, y: 0, z: 0, w: 1 });
  const eulerDeg = reactive({ x: 0, y: 0, z: 0 });
  const axisAngle = reactive({ x: 1, y: 0, z: 0, angle: 0 });

  function selectedQuatNode(): THREE.Object3D | null {
    return vrm.humanoid.getNormalizedBoneNode(selectedQuatBone.value) ?? null;
  }

  function setQuaternionFields(q: THREE.Quaternion): void {
    const state = buildQuaternionEditorState(q);
    Object.assign(quat, state.quat);
    Object.assign(eulerDeg, state.eulerDeg);
    Object.assign(axisAngle, state.axisAngle);
  }

  function quaternionFromEditor(): THREE.Quaternion {
    return quaternionFromEditorState(quaternionMode.value, { quat, eulerDeg, axisAngle });
  }

  function syncQuatFromBone(): void {
    const node = selectedQuatNode();
    if (!node) return;
    setQuaternionFields(node.quaternion.clone().normalize());
  }

  function applyQuaternionToBone(): void {
    const node = selectedQuatNode();
    if (!node) return;
    const q = quaternionFromEditor();
    node.quaternion.copy(q);
    vrm.scene.updateMatrixWorld(true);
    setQuaternionFields(q);
  }

  function normalizeQuaternionEditor(): void {
    const q = new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w).normalize();
    setQuaternionFields(q);
  }

  function identityQuaternion(): void {
    const q = new THREE.Quaternion();
    setQuaternionFields(q);
    applyQuaternionToBone();
  }

  function invertQuaternion(): void {
    const q = quaternionFromEditor().invert().normalize();
    setQuaternionFields(q);
  }

  function updateQuatField(field: QuaternionField, value: number): void {
    quat[field] = value;
  }

  function updateEulerField(field: VectorField, value: number): void {
    eulerDeg[field] = value;
  }

  function updateAxisAngleField(field: AxisAngleField, value: number): void {
    axisAngle[field] = value;
  }

  syncQuatFromBone();

  return {
    quaternionMode,
    quaternionModeOptions,
    selectedQuatBone,
    quat,
    eulerDeg,
    axisAngle,
    setQuaternionFields,
    quaternionFromEditor,
    syncQuatFromBone,
    applyQuaternionToBone,
    normalizeQuaternionEditor,
    identityQuaternion,
    invertQuaternion,
    updateQuatField,
    updateEulerField,
    updateAxisAngleField,
  };
}
