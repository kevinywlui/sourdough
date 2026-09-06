import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bulkHours, schedule, formatDuration } from '../js/timeline.js';

test('baseline: 7 h at 22°C with 20% starter', () => {
  assert.ok(Math.abs(bulkHours(22, 20) - 7) < 1e-9);
});

test('warmer is faster, colder is slower', () => {
  assert.ok(bulkHours(26, 20) < bulkHours(22, 20));
  assert.ok(bulkHours(18, 20) > bulkHours(22, 20));
});

test('more starter is faster', () => {
  assert.ok(bulkHours(22, 40) < bulkHours(22, 20));
  assert.ok(bulkHours(22, 10) > bulkHours(22, 20));
});

test('clamped to [3, 14] hours', () => {
  assert.equal(bulkHours(40, 50), 3);
  assert.equal(bulkHours(5, 5), 14);
});

test('schedule stages are quarter-hour rounded and ordered', () => {
  const s = schedule(22, 20);
  assert.deepEqual(s.map((x) => x.id), ['mix', 'bulk', 'shape', 'proof', 'bake', 'cool']);
  for (const stage of s) assert.equal(stage.minutes % 15, 0);
  assert.equal(s.find((x) => x.id === 'bulk').minutes, 420);
});

test('proof clamps between 1.5 and 4 hours', () => {
  const cold = schedule(15, 5);
  const warm = schedule(30, 50);
  assert.ok(cold.find((x) => x.id === 'proof').minutes <= 240);
  assert.ok(warm.find((x) => x.id === 'proof').minutes >= 90);
});

test('formatDuration', () => {
  assert.equal(formatDuration(45), '45 min');
  assert.equal(formatDuration(120), '2 h');
  assert.equal(formatDuration(330), '5 h 30 m');
});
