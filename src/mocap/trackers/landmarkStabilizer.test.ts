import { describe, expect, test } from 'vitest';
import { LandmarkStabilizer, type StabilizedLandmark } from './landmarkStabilizer';

function lm(x: number, y: number, z: number, visibility = 1): StabilizedLandmark {
  return { x, y, z, visibility };
}

describe('LandmarkStabilizer', () => {
  test('limits a sudden z outlier against the previous stable landmark', () => {
    const stabilizer = new LandmarkStabilizer(1, {
      maxStep: 0.5,
      maxZStep: 0.2,
      minVisibility: 0.3,
    });

    stabilizer.stabilize([lm(0, 0, 0)], 0);
    const [out] = stabilizer.stabilize([lm(0.01, 0.02, 3)], 1 / 30);

    expect(out.x).toBeCloseTo(0.01);
    expect(out.y).toBeCloseTo(0.02);
    expect(out.z).toBeCloseTo(0.2);
  });

  test('holds a short low-confidence gap from the last stable landmark', () => {
    const stabilizer = new LandmarkStabilizer(1, {
      maxGapFrames: 2,
      minVisibility: 0.3,
    });

    stabilizer.stabilize([lm(1, 2, 3, 1)], 0);
    const [gap] = stabilizer.stabilize([lm(9, 9, 9, 0.1)], 1 / 30);

    expect(gap).toEqual({ x: 1, y: 2, z: 3, visibility: 0.3 });
  });

  test('accepts a new landmark after a long low-confidence gap', () => {
    const stabilizer = new LandmarkStabilizer(1, {
      maxGapFrames: 1,
      minVisibility: 0.3,
    });

    stabilizer.stabilize([lm(1, 2, 3, 1)], 0);
    stabilizer.stabilize([lm(9, 9, 9, 0.1)], 1 / 30);
    stabilizer.stabilize([lm(8, 8, 8, 0.1)], 2 / 30);
    const [recovered] = stabilizer.stabilize([lm(4, 5, 6, 1)], 3 / 30);

    expect(recovered).toEqual({ x: 4, y: 5, z: 6, visibility: 1 });
  });

  test('reset clears previous landmark state', () => {
    const stabilizer = new LandmarkStabilizer(1, {
      maxStep: 0.5,
      maxZStep: 0.2,
    });

    stabilizer.stabilize([lm(0, 0, 0)], 0);
    stabilizer.reset();
    const [out] = stabilizer.stabilize([lm(10, 10, 10)], 1);

    expect(out).toEqual({ x: 10, y: 10, z: 10, visibility: 1 });
  });

  test('markMissing makes a returning landmark fresh after a long absence', () => {
    const stabilizer = new LandmarkStabilizer(1, {
      maxGapFrames: 1,
      maxStep: 0.5,
      maxZStep: 0.2,
    });

    stabilizer.stabilize([lm(0, 0, 0)], 0);
    stabilizer.markMissing();
    stabilizer.markMissing();
    const [out] = stabilizer.stabilize([lm(10, 10, 10)], 1);

    expect(out).toEqual({ x: 10, y: 10, z: 10, visibility: 1 });
  });

  test('setOptions updates clamping without clearing existing landmark state', () => {
    const stabilizer = new LandmarkStabilizer(1, {
      maxStep: 0.5,
      maxZStep: 0.2,
    });

    stabilizer.stabilize([lm(0, 0, 0)], 0);
    stabilizer.setOptions({ maxStep: 0.1, maxZStep: 0.05, maxGapFrames: 5 });
    const [out] = stabilizer.stabilize([lm(1, 0, 1)], 1 / 30);

    expect(stabilizer.getOptions()).toMatchObject({
      maxStep: 0.1,
      maxZStep: 0.05,
      maxGapFrames: 5,
    });
    expect(out.x).toBeCloseTo(0.1);
    expect(out.y).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(0.05);
  });
});
