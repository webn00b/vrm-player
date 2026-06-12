export type ArmPoseClass = 'sideReach' | 'frontReach' | 'overhead' | 'crossBody' | 'behindBack' | 'unknown';

export type PoseConstraintProfileId = 'default' | 'mixamoLive';

export interface ArmBackwardConstraints {
  upperArmMaxDeg: number;
  forearmMaxDeg: number;
}

export interface ArmIkCorrectionConstraints {
  maxReachFraction: number;
  correctionLerp: number;
  sidePole: {
    left: [number, number, number];
    right: [number, number, number];
  };
  safeTargetBias: {
    forward: number;
    lateral: number;
    upward: number;
  };
}

export interface ArmPoseConstraints {
  backward: ArmBackwardConstraints;
  allowedPoseClasses: ArmPoseClass[];
  ik: ArmIkCorrectionConstraints;
}

export interface PoseConstraints {
  profileId: PoseConstraintProfileId;
  arms: ArmPoseConstraints;
}

export const DEFAULT_POSE_CONSTRAINTS: PoseConstraints = {
  profileId: 'default',
  arms: {
    backward: {
      upperArmMaxDeg: 135,
      forearmMaxDeg: 135,
    },
    allowedPoseClasses: ['sideReach', 'frontReach', 'overhead', 'crossBody'],
    ik: {
      maxReachFraction: 0.98,
      correctionLerp: 1,
      sidePole: {
        left: [0, -1, 0.35],
        right: [0, -1, 0.35],
      },
      safeTargetBias: {
        forward: 0.22,
        lateral: 0.45,
        upward: 0,
      },
    },
  },
};

export const MIXAMO_LIVE_POSE_CONSTRAINTS: PoseConstraints = {
  profileId: 'mixamoLive',
  arms: {
    backward: {
      upperArmMaxDeg: 120,
      forearmMaxDeg: 120,
    },
    allowedPoseClasses: ['sideReach', 'frontReach', 'overhead', 'crossBody'],
    ik: {
      maxReachFraction: 0.98,
      correctionLerp: 1,
      sidePole: {
        left: [0, -1, 0.45],
        right: [0, -1, 0.45],
      },
      safeTargetBias: {
        forward: 0.28,
        lateral: 0.5,
        upward: 0,
      },
    },
  },
};

export const POSE_CONSTRAINT_PROFILES: Record<PoseConstraintProfileId, PoseConstraints> = {
  default: DEFAULT_POSE_CONSTRAINTS,
  mixamoLive: MIXAMO_LIVE_POSE_CONSTRAINTS,
};

export function getPoseConstraints(profileId: PoseConstraintProfileId): PoseConstraints {
  return POSE_CONSTRAINT_PROFILES[profileId] ?? DEFAULT_POSE_CONSTRAINTS;
}
