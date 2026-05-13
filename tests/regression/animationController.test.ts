import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AnimationController } from '../../src/animationController';
import { buildMockVRM } from '../fixtures/mockVrm';

function makeClip(name: string, duration = 1): THREE.AnimationClip {
  return new THREE.AnimationClip(name, duration, []);
}

function makeController(): AnimationController {
  const controller = new AnimationController(buildMockVRM());
  controller.register('walk', makeClip('walk'));
  controller.register('turn', makeClip('turn'));
  controller.addToQueue(0);
  controller.addToQueue(1);
  return controller;
}

test('AnimationController advances through the queue by default', () => {
  const controller = makeController();

  assert.equal(controller.currentQueuePos, 0);
  controller.update(0.6);

  assert.equal(controller.currentLoopMode, 'queue');
  assert.equal(controller.currentQueuePos, 1);
});

test('AnimationController can loop only the active queue item', () => {
  const controller = makeController();

  controller.setLoopMode('one');
  controller.update(0.6);
  assert.equal(controller.currentQueuePos, 0);

  controller.update(0.6);
  assert.equal(controller.currentQueuePos, 0);
  assert.equal(controller.currentTime, 0);
});
