const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  blendHydration, solve, rebalanceBlend, DEFAULTS,
} = require('../js/recipe.js');

const params = { ...DEFAULTS };

test('blendHydration: pure blends hit per-flour values', () => {
  assert.equal(blendHydration({ ap: 100, ww: 0, bread: 0 }), 0.67);
  assert.equal(blendHydration({ ap: 0, ww: 100, bread: 0 }), 0.80);
  assert.equal(blendHydration({ ap: 0, ww: 0, bread: 100 }), 0.72);
});

test('defaults: 900 g dough with 100 g AP starter', () => {
  const r = solve(params);
  assert.equal(Math.round(r.totals.flour), 520);
  assert.equal(r.weigh.ap, 188);
  assert.equal(r.weigh.ww, 94);
  assert.equal(r.weigh.bread, 188);
  assert.equal(r.weigh.salt, 10);
  assert.equal(r.weigh.starter, 100);
  assert.equal(r.weigh.water, 320);
  assert.equal(r.weigh.total, 900);
  assert.ok(Math.abs(r.totals.inoculation - 0.1924) < 0.001);
  assert.equal(r.warnings.length, 0);
});

test("the user's case: 140 g WW starter, all-bread blend, 900 g target", () => {
  const r = solve({
    ...params, doughG: 900, starterG: 140,
    blend: { ap: 0, ww: 0, bread: 100 }, starterFlour: 'ww',
  });
  assert.equal(r.weigh.bread, 444);
  assert.equal(r.weigh.ap, 0);
  assert.equal(r.weigh.ww, 0);          // the WW is inside the starter
  assert.equal(r.weigh.salt, 10);
  assert.equal(r.weigh.water, 306);
  assert.equal(r.weigh.starter, 140);
  assert.equal(r.weigh.total, 900);
  assert.ok(Math.abs(r.totals.inoculation - 0.2724) < 0.001);
  assert.ok(Math.abs(r.totals.hydration - 0.7309) < 0.001);
  assert.equal(r.warnings.length, 0);
});

test('displayed grams always sum exactly to the dough target', () => {
  for (const target of [250, 750, 900, 1450, 2500]) {
    const r = solve({ ...params, doughG: target });
    const { ap, ww, bread, water, salt, starter, total } = r.weigh;
    assert.equal(ap + ww + bread + water + salt + starter, total);
    assert.equal(total, target);
  }
});

test('dough total identity holds in floats: F + W + salt = D', () => {
  for (const starterG of [50, 140, 300]) {
    const r = solve({ ...params, starterG, starterFlour: 'ww' });
    assert.ok(Math.abs(r.totals.flour + r.totals.water + r.totals.salt - r.totals.dough) < 1e-9);
  }
});

test('starter flour type shifts hydration', () => {
  const base = { ...params, blend: { ap: 0, ww: 0, bread: 100 }, starterG: 200 };
  const ww = solve({ ...base, starterFlour: 'ww' });
  const bread = solve({ ...base, starterFlour: 'bread' });
  assert.ok(ww.totals.hydration > bread.totals.hydration);
  assert.ok(Math.abs(bread.totals.hydration - 0.72) < 1e-9);
});

test('absurd starter amounts warn and never produce negative grams', () => {
  const r = solve({
    ...params, doughG: 200, starterG: 1000,
    blend: { ap: 100, ww: 0, bread: 0 }, starterFlour: 'ww',
  });
  assert.ok(r.warnings.length >= 1);
  for (const v of Object.values(r.weigh)) assert.ok(v >= 0);
});

test('inoculation warnings fire outside 5-50%', () => {
  const high = solve({ ...params, doughG: 400, starterG: 400 });
  assert.ok(high.warnings.some((w) => w.includes('High inoculation')));
  const low = solve({ ...params, doughG: 2500, starterG: 30 });
  assert.ok(low.warnings.some((w) => w.includes('Low inoculation')));
});

test('salt floors at 1 g when salt % > 0, is 0 at 0%', () => {
  const tiny = solve({ ...params, doughG: 200, starterG: 50, saltPct: 0.25 });
  assert.equal(tiny.weigh.salt, 1);
  const none = solve({ ...params, saltPct: 0 });
  assert.equal(none.weigh.salt, 0);
});

test('hydration offset shifts hydration by ~its amount', () => {
  const base = solve(params);
  const wetter = solve({ ...params, hydrationOffset: 5 });
  assert.ok(Math.abs(wetter.totals.hydration - base.totals.hydration - 0.05) < 0.001);
  assert.equal(wetter.weigh.total, 900); // still sums to target
});

test('baker\'s percentages: flours sum to 100% of total flour', () => {
  const r = solve({ ...params, starterFlour: 'ww' });
  assert.ok(Math.abs(r.pct.ap + r.pct.ww + r.pct.bread - 100) < 1e-9);
  assert.ok(Math.abs(r.pct.starter - r.totals.inoculation * 100) < 1e-9);
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
