const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  deriveHydration, solve, solveFromStarter, solveFromDough,
  rebalanceBlend, panPreset, DEFAULTS,
} = require('../js/recipe.js');

const params = { ...DEFAULTS };

test('deriveHydration: all-AP blend with AP starter is pure AP (67%)', () => {
  assert.ok(Math.abs(deriveHydration({ ap: 100, ww: 0, bread: 0 }, 20, 'ap') - 0.67) < 1e-9);
});

test('deriveHydration: starter flour type shifts hydration', () => {
  // All-bread added flour; 20% starter = 10% of total flour from the starter.
  const withWW = deriveHydration({ ap: 0, ww: 0, bread: 100 }, 20, 'ww');
  const withBread = deriveHydration({ ap: 0, ww: 0, bread: 100 }, 20, 'bread');
  assert.ok(Math.abs(withWW - (0.9 * 0.72 + 0.1 * 0.80)) < 1e-9);   // 72.8%
  assert.ok(Math.abs(withBread - 0.72) < 1e-9);
});

test('deriveHydration: default 40/20/40 blend with AP starter is 71.14%', () => {
  const h = deriveHydration({ ap: 40, ww: 20, bread: 40 }, 20, 'ap');
  assert.ok(Math.abs(h - 0.7114) < 1e-9);
});

test('solveFromStarter: 150 g AP starter, default blend', () => {
  const r = solveFromStarter(150, params);
  assert.equal(Math.round(r.totals.flour), 750);
  // added flour = 750 - 75 = 675, split 40/20/40
  assert.equal(r.weigh.ap, 270);
  assert.equal(r.weigh.ww, 135);
  assert.equal(r.weigh.bread, 270);
  assert.equal(r.weigh.salt, 15);
  assert.equal(r.weigh.starter, 150);
  assert.equal(r.weigh.water, 459); // 0.7114·750 − 75 = 458.55
  assert.equal(r.weigh.total, 150 + 15 + 270 + 135 + 270 + 459);
});

test("the user's case: 140 g WW starter, add only bread flour", () => {
  const r = solve({
    ...params, mode: 'starter', starterG: 140,
    blend: { ap: 0, ww: 0, bread: 100 }, starterFlour: 'ww',
  });
  assert.equal(Math.round(r.totals.flour), 700);       // 140 / 0.20
  assert.equal(r.weigh.bread, 630);                    // 700 − 70 starter flour
  assert.equal(r.weigh.ap, 0);
  assert.equal(r.weigh.ww, 0);                         // WW comes from the starter
  assert.equal(r.weigh.salt, 14);
  assert.equal(r.weigh.water, 440);                    // 0.728·700 − 70 = 439.6
  assert.equal(r.weigh.starter, 140);
  assert.equal(r.weigh.total, 1224);
  assert.equal(r.warnings.length, 0);
  assert.ok(Math.abs(r.totals.hydration - 0.728) < 1e-9);
  assert.ok(Math.abs(r.pct.ww - 10) < 1e-9);           // starter's share of total flour
  assert.ok(Math.abs(r.pct.bread - 90) < 1e-9);
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

test('added flour amounts are never negative, whatever the combination', () => {
  for (const sf of ['ap', 'ww', 'bread']) {
    const r = solve({
      ...params, mode: 'dough', doughG: 900,
      blend: { ap: 0, ww: 0, bread: 100 }, starterPct: 50, starterFlour: sf,
    });
    assert.ok(r.weigh.ap >= 0 && r.weigh.ww >= 0 && r.weigh.bread >= 0);
    assert.equal(r.warnings.length, 0);
  }
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

test('panPreset: volume heuristic rounds to 50 g', () => {
  assert.equal(panPreset(2400), 1050);
  assert.equal(panPreset(2000), 850);
});
