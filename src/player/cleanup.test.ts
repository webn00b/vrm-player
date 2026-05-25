import { expect, test } from 'vitest';
import { createCleanupRegistry } from './cleanup';

test('cleanup registry disposes callbacks in reverse order', () => {
  const calls: string[] = [];
  const cleanup = createCleanupRegistry();

  cleanup.add(() => calls.push('first'));
  cleanup.add(() => calls.push('second'));
  cleanup.dispose();

  expect(calls).toEqual(['second', 'first']);
});

test('cleanup registry runs each callback only once', () => {
  let calls = 0;
  const cleanup = createCleanupRegistry();

  cleanup.add(() => {
    calls += 1;
  });
  cleanup.dispose();
  cleanup.dispose();

  expect(calls).toBe(1);
});

test('cleanup registry aggregates cleanup failures', () => {
  const cleanup = createCleanupRegistry();

  cleanup.add(() => {
    throw new Error('first failure');
  });
  cleanup.add(() => {
    throw new Error('second failure');
  });

  expect(() => cleanup.dispose()).toThrow(AggregateError);
});
