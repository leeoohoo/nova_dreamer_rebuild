import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { mapAllSettledWithConcurrency, resolveConcurrency } from './concurrency.js';

test('resolveConcurrency normalizes values', () => {
  assert.equal(resolveConcurrency(undefined, 3), 3);
  assert.equal(resolveConcurrency('2', 3), 2);
  assert.equal(resolveConcurrency(' 0 ', 3), 3);
  assert.equal(resolveConcurrency('bad', 3), 3);
});

test('mapAllSettledWithConcurrency preserves order and limit', async () => {
  const items = [0, 1, 2, 3, 4, 5];
  let active = 0;
  let maxActive = 0;

  const results = await mapAllSettledWithConcurrency(items, 2, async (value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await setTimeout(10);
    active -= 1;
    if (value === 3) {
      throw new Error('boom');
    }
    return value * 2;
  });

  assert.equal(results.length, items.length);
  assert.ok(maxActive <= 2);
  assert.deepEqual(
    results.map((r) => r.status),
    ['fulfilled', 'fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled']
  );
  assert.equal(results[0].value, 0);
  assert.equal(results[2].value, 4);
  assert.ok(results[3].reason instanceof Error);
});

