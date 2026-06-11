/**
 * Behavioral guarantees for the ROM constraint tables.
 *
 * Constraints are applied to three-vrm normalized humanoid bones, whose rest
 * frames are world-aligned in T-pose (+X avatar left, +Y up, +Z forward).
 * These tests pin the axis conventions: natural human poses must pass the
 * clamp untouched, anatomically impossible ones must be clamped — on both
 * sides, in every profile.
 */
import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import { buildMockVRM } from '../../tests/fixtures/mockVrm';
import { BoneValidator } from './boneValidator';

const D = THREE.MathUtils.degToRad;

interface PoseCase {
  name: string;
  bone: string;
  euler: [number, number, number];
  order?: THREE.EulerOrder;
}

const NATURAL: PoseCase[] = [
  { name: 'left arm hanging at side',     bone: 'leftUpperArm',  euler: [0, 0, -90] },
  { name: 'right arm hanging at side',    bone: 'rightUpperArm', euler: [0, 0, 90] },
  { name: 'left arm reach forward',       bone: 'leftUpperArm',  euler: [0, -90, 0] },
  { name: 'right arm reach forward',      bone: 'rightUpperArm', euler: [0, 90, 0] },
  { name: 'left arm raised overhead',     bone: 'leftUpperArm',  euler: [0, 0, 90] },
  { name: 'right arm raised overhead',    bone: 'rightUpperArm', euler: [0, 0, -90] },
  { name: 'left arm across chest',        bone: 'leftUpperArm',  euler: [0, -120, 0] },
  { name: 'left arm down and back',       bone: 'leftUpperArm',  euler: [0, 30, -80] },
  { name: 'left elbow curl forward 120',  bone: 'leftLowerArm',  euler: [0, -120, 0] },
  { name: 'right elbow curl forward 120', bone: 'rightLowerArm', euler: [0, 120, 0] },
  { name: 'left elbow full flexion 145',  bone: 'leftLowerArm',  euler: [0, -145, 0] },
  { name: 'left elbow curl upward 90',    bone: 'leftLowerArm',  euler: [0, 0, 90] },
  { name: 'right elbow curl upward 90',   bone: 'rightLowerArm', euler: [0, 0, -90] },
  { name: 'left wrist flex down 60',      bone: 'leftHand',      euler: [0, 0, -60] },
  { name: 'left wrist extend up 50',      bone: 'leftHand',      euler: [0, 0, 50] },
  { name: 'left thigh forward 90 (sit)',  bone: 'leftUpperLeg',  euler: [-90, 0, 0] },
  { name: 'right thigh forward 90 (sit)', bone: 'rightUpperLeg', euler: [-90, 0, 0] },
  { name: 'left thigh deep squat 110',    bone: 'leftUpperLeg',  euler: [-110, 0, 0] },
  { name: 'right thigh deep squat 120',   bone: 'rightUpperLeg', euler: [-120, 0, 0] },
  { name: 'hips turned 135 (dance turn)', bone: 'hips',          euler: [0, 135, 0] },
  { name: 'hips lying down (pitch 90)',   bone: 'hips',          euler: [-90, 0, 0] },
  { name: 'left thigh back 25 (stride)',  bone: 'leftUpperLeg',  euler: [25, 0, 0] },
  { name: 'left thigh out 40 (abduct)',   bone: 'leftUpperLeg',  euler: [0, 0, 40] },
  { name: 'right thigh out 40 (abduct)',  bone: 'rightUpperLeg', euler: [0, 0, -40] },
  { name: 'left knee bend 120',           bone: 'leftLowerLeg',  euler: [120, 0, 0] },
  { name: 'right knee bend 120',          bone: 'rightLowerLeg', euler: [120, 0, 0] },
  { name: 'left index MCP curl 80',       bone: 'leftIndexProximal',  euler: [0, 0, -80] },
  { name: 'right index MCP curl 80',      bone: 'rightIndexProximal', euler: [0, 0, 80] },
];

const IMPOSSIBLE: PoseCase[] = [
  { name: 'left elbow bent backward',     bone: 'leftLowerArm',  euler: [0, 40, 0] },
  { name: 'right elbow bent backward',    bone: 'rightLowerArm', euler: [0, -40, 0] },
  { name: 'left elbow bent downward',     bone: 'leftLowerArm',  euler: [0, 0, -40] },
  { name: 'left forearm twisted 170',     bone: 'leftLowerArm',  euler: [170, 0, 0], order: 'XYZ' },
  { name: 'left knee bent forward',       bone: 'leftLowerLeg',  euler: [-40, 0, 0] },
  { name: 'left knee bent sideways 45',   bone: 'leftLowerLeg',  euler: [0, 0, 45] },
  { name: 'neck owl twist 150',           bone: 'neck',          euler: [0, 150, 0] },
  { name: 'left index MCP bent back 60',  bone: 'leftIndexProximal', euler: [0, 0, 60] },
];

function applyAndClamp(
  profile: 'default' | 'mixamoLive',
  c: PoseCase,
): { clamped: boolean; driftDeg: number } {
  const vrm = buildMockVRM();
  const validator = new BoneValidator(vrm);
  validator.setProfile(profile);
  const node = vrm.bones.get(c.bone);
  if (!node) throw new Error(`missing mock bone ${c.bone}`);
  const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    D(c.euler[0]), D(c.euler[1]), D(c.euler[2]), c.order ?? 'YXZ',
  ));
  node.quaternion.copy(q0);
  const stats = validator.clampAll();
  return {
    clamped: stats.clampedThisFrame > 0,
    driftDeg: THREE.MathUtils.radToDeg(q0.angleTo(node.quaternion)),
  };
}

describe.each(['default', 'mixamoLive'] as const)('%s profile', (profile) => {
  test.each(NATURAL)('natural pose passes unclamped: $name', (c) => {
    const res = applyAndClamp(profile, c);
    expect(res.clamped, `${c.name} should not clamp (drifted ${res.driftDeg.toFixed(1)}°)`).toBe(false);
    expect(res.driftDeg).toBeLessThan(0.01);
  });

  test.each(IMPOSSIBLE)('impossible pose gets clamped: $name', (c) => {
    const res = applyAndClamp(profile, c);
    expect(res.clamped, `${c.name} should clamp`).toBe(true);
    expect(res.driftDeg).toBeGreaterThan(5);
  });
});
