import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveHydration, solve, solveFromStarter, solveFromDough,
  rebalanceBlend, panPreset, DEFAULTS,
} from '../js/recipe.js';

const params = { ...DEFAULTS };

test('deriveHydration: pure blends hit per-flour values', () => {
  assert.equal(deriveHydration({ ap: 100, ww: 0, bread: 0 }), 0.67);
  assert.equal(deriveHydration({ ap: 0, ww: 100, bread: 0 }), 0.80);
  assert.equal(deriveHydration({ ap: 0, ww: 0, bread: 100 }), 0.72);
});

test('deriveHydration: default 40/20/40 blend is 71.6%', () => {
  const h = deriveHydration({ ap: 40, ww: 20, bread: 40 });
  assert.ok(Math.abs(h - 0.716) < 1e-9);
});

test('solveFromStarter matches spec worked example (150 g)', () => {
  const r = solveFromStarter(150, params);
  assert.equal(Math.round(r.totals.flour), 750);
  assert.equal(Math.round(r.totals.water), 537);
  assert.equal(r.weigh.salt, 15);
  assert.equal(r.weigh.starter, 150);
  assert.equal(r.weigh.water, 462);
  assert.equal(r.weigh.ap, 225);
  assert.equal(r.weigh.ww, 150);
  assert.equal(r.weigh.bread, 300);
  assert.equal(r.weigh.total, 1302);
});

test('solveFromDough: displayed grams sum exactly to the target', () => {
  for (const target of [250, 750, 900, 1000, 1450, 2500]) {
    const r = solveFromDough(target, params);
    const { ap, ww, bread, water, salt, starter, total } = r.weigh;
    assert.equal(ap + ww + bread + water + salt + starter, total);
    assert.equal(total, target);
  }
});

test('directions are inverses (round-trip within rounding)', () => {
  const a = solveFromStarter(150, params);
  const b = solveFromDough(a.totals.dough, params);
  assert.ok(Math.abs(b.totals.starter - 150) < 0.01);

  const c = solveFromDough(900, params);
  const d = solveFromStarter(c.totals.starter, params);
  assert.ok(Math.abs(d.totals.dough - 900) < 0.01);
});

test('starter-mode displayed total equals sum of displayed parts', () => {
  const r = solveFromStarter(137, params);
  const { ap, ww, bread, water, salt, starter, total } = r.weigh;
  assert.equal(ap + ww + bread + water + salt + starter, total);
});

test('AP debit: low-AP blend spills into other flours with a warning', () => {
  const r = solve({
    ...params, mode: 'dough', doughG: 900,
    blend: { ap: 5, ww: 45, bread: 50 }, starterPct: 30,
  });
  assert.equal(r.weigh.ap, 0);
  assert.ok(r.warnings.length > 0);
  const { ap, ww, bread, water, salt, starter, total } = r.weigh;
  assert.equal(ap + ww + bread + water + salt + starter, total);
});

test('salt floors at 1 g when salt % > 0', () => {
  const r = solve({ ...params, mode: 'dough', doughG: 200, saltPct: 0.25 });
  assert.equal(r.weigh.salt, 1);
});

test('salt is 0 when salt % is 0', () => {
  const r = solve({ ...params, mode: 'dough', doughG: 900, saltPct: 0 });
  assert.equal(r.weigh.salt, 0);
});

test('hydration offset shifts water', () => {
  const base = solveFromDough(900, params);
  const wetter = solveFromDough(900, { ...params, hydrationOffset: 5 });
  assert.ok(wetter.totals.hydration > base.totals.hydration);
  assert.ok(Math.abs(wetter.totals.hydration - base.totals.hydration - 0.05) < 1e-9);
});

test('rebalanceBlend keeps sum at 100', () => {
  let b = { ap: 40, ww: 20, bread: 40 };
  b = rebalanceBlend(b, 'ap', 70);
  assert.equal(b.ap + b.ww + b.bread, 100);
  assert.equal(b.ap, 70);
  b = rebalanceBlend(b, 'ww', 100);
  assert.equal(b.ap + b.ww + b.bread, 100);
});

test('rebalanceBlend respects a lock', () => {
  const b = rebalanceBlend({ ap: 40, ww: 20, bread: 40 }, 'ap', 60, 'ww');
  assert.equal(b.ww, 20);
  assert.equal(b.ap, 60);
  assert.equal(b.bread, 20);
});

test('rebalanceBlend clamps against a lock', () => {
  const b = rebalanceBlend({ ap: 40, ww: 20, bread: 40 }, 'ap', 95, 'ww');
  assert.equal(b.ap, 80);
  assert.equal(b.ww, 20);
  assert.equal(b.bread, 0);
});

test('rebalanceBlend recovers from a zeroed row', () => {
  const b = rebalanceBlend({ ap: 100, ww: 0, bread: 0 }, 'ap', 60);
  assert.equal(b.ap + b.ww + b.bread, 100);
  assert.equal(b.ap, 60);
});

test('panPreset: 9×4×4 Pullman (~2.4 L) lands near 1000 g', () => {
  assert.equal(panPreset(2400), 1050);
  assert.equal(panPreset(2000), 850);
});
