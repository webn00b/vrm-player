/**
 * Unit tests for the foreshortening-recovery math.
 *
 * Strategy: synthesise 3D arm poses (shoulder + wrist), project them by
 * deliberately corrupting the wrist's Z component (simulating MediaPipe Z
 * noise), then verify that `recoverWristZ` rebuilds something close to the
 * original 3D wrist position when foreshortening is engaged.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { recoverWristZ } from '../../src/mocap/solvers/anatomicalDepth';

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

test('straight-out arm (perpendicular to camera): no recovery, Z untouched', () => {
  // Performer faces camera; arm extends sideways. dist2D ≈ armLength.
  const shoulder = { x: 0,    y: 0,    z: 0   };
  const wrist    = { x: 0.6,  y: 0,    z: 0.05 };  // slight Z noise; dist2D = 0.6
  const armLength = 0.6;

  const result = recoverWristZ({ shoulder, wrist, armLength });
  assert.equal(result.recovered, false, 'should not engage when dist2D ≈ armLength');
  assert.equal(result.wrist.z, wrist.z, 'Z preserved');
});

test('fully foreshortened arm (pointed at camera): recovers correct Z magnitude', () => {
  // Performer points arm straight along Z axis. dist2D = 0, true Z offset = armLength.
  const shoulder = { x: 0, y: 0, z: 0   };
  const trueWrist = { x: 0, y: 0, z: -0.6 };  // 60 cm in front of shoulder
  const armLength = 0.6;

  // MediaPipe corrupts the Z: reports a small negative (~ -0.1) instead of -0.6
  const noisyWrist = { x: 0, y: 0, z: -0.1 };

  const result = recoverWristZ({ shoulder, wrist: noisyWrist, armLength });
  assert.equal(result.recovered, true, 'should engage on full foreshortening');
  assert.ok(
    Math.abs(result.wrist.z - trueWrist.z) < 0.01,
    `recovered Z ${result.wrist.z} should match true Z ${trueWrist.z}`,
  );
});

test('substantially foreshortened arm (60° to camera): recovers 3D position', () => {
  // Arm at 60° to camera: dist2D = armLength * cos(60°) = 0.3 (= 0.5 * armLength),
  // true Z offset = armLength * sin(60°) ≈ 0.52. Well inside the default 0.7
  // foreshortening gate so the recovery engages.
  const shoulder = { x: 0, y: 0, z: 0 };
  const armLength = 0.6;
  const trueWrist = {
    x: armLength * Math.cos(Math.PI / 3),  // 0.3
    y: 0,
    z: -armLength * Math.sin(Math.PI / 3), // ≈ -0.52
  };

  // MediaPipe Z is roughly the right sign but wrong magnitude.
  const noisyWrist = { ...trueWrist, z: -0.15 };

  const result = recoverWristZ({ shoulder, wrist: noisyWrist, armLength });
  assert.equal(result.recovered, true);
  const error = dist(result.wrist, trueWrist);
  assert.ok(error < 0.01, `recovered position within 1 cm of true; got ${error.toFixed(4)}`);
});

test('sign disambiguation: respects MediaPipe Z direction hint', () => {
  // Same 2D projection but two valid 3D solutions (wrist in front vs behind).
  // Hint sign determines which we pick.
  const shoulder = { x: 0, y: 0, z: 0 };
  const armLength = 0.6;

  // Hint Z negative (wrist in front of shoulder)
  const noisyWristFront = { x: 0.3, y: 0, z: -0.1 };
  const resultFront = recoverWristZ({ shoulder, wrist: noisyWristFront, armLength });
  assert.ok(resultFront.wrist.z < 0, 'with negative hint → recovered Z negative');

  // Hint Z positive (wrist behind shoulder)
  const noisyWristBack = { x: 0.3, y: 0, z: 0.1 };
  const resultBack = recoverWristZ({ shoulder, wrist: noisyWristBack, armLength });
  assert.ok(resultBack.wrist.z > 0, 'with positive hint → recovered Z positive');

  // Both recoveries should have the same |Z|.
  assert.ok(
    Math.abs(Math.abs(resultFront.wrist.z) - Math.abs(resultBack.wrist.z)) < 1e-6,
    'magnitudes should match across sign choices',
  );
});

test('over-extended 2D (dist2D > armLength): no recovery, fall through', () => {
  // E.g. avatar arm shorter than performer arm — performer's 2D projection
  // is already longer than what the avatar can reach.
  const shoulder = { x: 0, y: 0, z: 0 };
  const wrist    = { x: 1.5, y: 0, z: 0.05 };  // 2D distance 1.5m
  const armLength = 0.6;                        // anatomy only 0.6m

  const result = recoverWristZ({ shoulder, wrist, armLength });
  // Sphere can't intersect — discriminant negative, but the gate test fires
  // first (dist2D > gate * armLength). Bail without modifying.
  assert.equal(result.recovered, false);
  assert.equal(result.wrist.z, wrist.z);
});

test('zero/tiny armLength: skip (no anatomical data yet)', () => {
  const shoulder = { x: 0, y: 0, z: 0 };
  const wrist    = { x: 0.3, y: 0, z: -0.5 };
  const result = recoverWristZ({ shoulder, wrist, armLength: 0 });
  assert.equal(result.recovered, false);
});

test('custom foreshortening gate: stricter engagement threshold', () => {
  const shoulder = { x: 0, y: 0, z: 0 };
  const armLength = 0.6;

  // dist2D = 0.5 = 0.833 * armLength.
  // Default gate (0.7) → no engagement (0.833 > 0.7).
  // Stricter gate (0.9) → engagement (0.833 < 0.9).
  const wrist = { x: 0.5, y: 0, z: -0.05 };

  const defaultResult = recoverWristZ({ shoulder, wrist, armLength });
  assert.equal(defaultResult.recovered, false, 'default gate too lax to engage');

  const strictResult = recoverWristZ({ shoulder, wrist, armLength, foreshorteningGate: 0.9 });
  assert.equal(strictResult.recovered, true, 'strict gate triggers recovery');
});
