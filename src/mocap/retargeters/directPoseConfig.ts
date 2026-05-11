// MediaPipe BlazePose landmark indices used across the direct pose solver.
export const LM = {
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
} as const;

export const FACE = {
  MOUTH_TOP: 13,
  MOUTH_BOTTOM: 14,
  MOUTH_LEFT: 61,
  MOUTH_RIGHT: 291,
} as const;

// VRM bone → [parent-landmark index, child-landmark index].
// Swapped sides for mirror effect: person's right hand drives character's LEFT
// bones (which in VRM T-pose appear on viewer's right side when character
// faces the camera). Combined with _mirrorX=true, this gives correct identity
// rotation in T-pose and natural mirror behaviour during motion.
export const LIMB_BONES: Record<string, [number, number]> = {
  leftUpperArm: [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
  leftLowerArm: [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  rightUpperArm: [LM.LEFT_SHOULDER, LM.LEFT_ELBOW],
  rightLowerArm: [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  leftUpperLeg: [LM.RIGHT_HIP, LM.RIGHT_KNEE],
  leftLowerLeg: [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
  rightUpperLeg: [LM.LEFT_HIP, LM.LEFT_KNEE],
  rightLowerLeg: [LM.LEFT_KNEE, LM.LEFT_ANKLE],
};

// BFS order — parent bones processed before children so their world matrices
// are up-to-date when we compute the child's parent-local target direction.
export const PROCESS_ORDER: string[] = [
  'leftUpperArm', 'leftLowerArm',
  'rightUpperArm', 'rightLowerArm',
  'leftUpperLeg', 'leftLowerLeg',
  'rightUpperLeg', 'rightLowerLeg',
];

export const FINGER_VRM_NAMES = (() => {
  const names: string[] = [];
  for (const side of ['left', 'right'] as const) {
    for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const) {
      for (const seg of ['Metacarpal', 'Proximal', 'Intermediate', 'Distal'] as const) {
        if (finger === 'Thumb' && seg === 'Intermediate') continue;
        names.push(`${side}${finger}${seg}`);
      }
    }
  }
  return names;
})();

export const PALM_ROOT_SUFFIXES = [
  'IndexProximal',
  'MiddleProximal',
  'RingProximal',
  'LittleProximal',
] as const;

export function kalidoHandBoneToVrm(kalidoName: string): string {
  const side = kalidoName.startsWith('Right') ? 'right' : 'left';
  const without = kalidoName.replace(/^(Left|Right)/, '');
  // KalidoKit's "Wrist" is VRM's hand bone (the wrist/palm joint).
  if (without === 'Wrist') return side + 'Hand';
  const suffix = without === 'ThumbProximal'
    ? 'ThumbMetacarpal'
    : without === 'ThumbIntermediate'
      ? 'ThumbProximal'
      : without;
  return side + suffix;
}
