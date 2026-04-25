import test from 'node:test';
import assert from 'node:assert/strict';
import fixtures from './solverHeuristics.fixtures.json' with { type: 'json' };
import {
  capArmScaleByCurrentSegments,
  computeAdaptiveLateralGain,
  computeFaceNearBlend,
  computeFrontPoseBlendBase,
  computeHandsTogetherBlend,
  computeMidpointBlend,
  computePrayerBlend,
} from '../../.tmp-regression/solverHeuristics.js';

function approxEqual(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, got ${actual}`,
  );
}

for (const fixture of fixtures.adaptiveLateralGain) {
  test(`adaptive lateral gain: ${fixture.name}`, () => {
    const actual = computeAdaptiveLateralGain(
      fixture.args.baseScale,
      fixture.args.maxScale,
      fixture.args.lateralLeanAbs,
    );
    approxEqual(actual, fixture.expected, fixture.tolerance, fixture.name);
  });
}

for (const fixture of fixtures.armScaleCap) {
  test(`arm scale cap: ${fixture.name}`, () => {
    const actual = capArmScaleByCurrentSegments(
      fixture.args.rawScale,
      fixture.args.avatarArmLen,
      fixture.args.perfSegmentLen,
    );
    approxEqual(actual.effectiveScale, fixture.expectedEffectiveScale, fixture.tolerance, fixture.name);
    if (fixture.expectedCap == null) {
      assert.equal(actual.cap, null, `${fixture.name}: expected null cap`);
    } else {
      approxEqual(actual.cap ?? Number.NaN, fixture.expectedCap, fixture.tolerance, fixture.name);
    }
  });
}

for (const fixture of fixtures.midpointBlend) {
  test(`midpoint blend: ${fixture.name}`, () => {
    const actual = computeMidpointBlend(
      fixture.args.shoulderCenterOffset,
      fixture.args.wristCenterOffset,
    );
    approxEqual(actual, fixture.expected, fixture.tolerance, fixture.name);
  });
}

for (const fixture of fixtures.handsTogetherBlend) {
  test(`hands together blend: ${fixture.name}`, () => {
    const actual = computeHandsTogetherBlend(
      fixture.args.shoulderSpan,
      fixture.args.wristGap,
      fixture.args.wristLevelDelta,
    );
    approxEqual(actual, fixture.expected, fixture.tolerance, fixture.name);
  });
}

for (const fixture of fixtures.prayerBlend) {
  test(`prayer blend: ${fixture.name}`, () => {
    const actual = computePrayerBlend(
      fixture.args.handsTogetherBlend,
      fixture.args.armBendRatio,
      fixture.args.wristBelowShoulders,
    );
    approxEqual(actual, fixture.expected, fixture.tolerance, fixture.name);
  });
}

for (const fixture of fixtures.frontPoseBlendBase) {
  test(`front-pose blend base: ${fixture.name}`, () => {
    const actual = computeFrontPoseBlendBase(
      fixture.args.midpointBlend,
      fixture.args.handsTogetherBlend,
      fixture.args.chestPrayerBlend,
    );
    approxEqual(actual, fixture.expected, fixture.tolerance, fixture.name);
  });
}

for (const fixture of fixtures.faceNearBlend) {
  test(`face-near blend: ${fixture.name}`, () => {
    const actual = computeFaceNearBlend(fixture.args);
    approxEqual(actual, fixture.expected, fixture.tolerance, fixture.name);
  });
}
