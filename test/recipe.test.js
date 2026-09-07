const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  FLOURS, blendHydration, solve, rebalanceBlend, suggestStarter, DEFAULTS,
} = require('../public/js/recipe.js');

const params = { ...DEFAULTS };

test('blendHydration: pure blends hit per-flour values', () => {
  assert.equal(blendHydration({ ap: 100 }), 0.67);
  assert.equal(blendHydration({ ww: 100 }), 0.80);
  assert.equal(blendHydration({ bread: 100 }), 0.72);
  assert.equal(blendHydration({ rye: 100 }), 0.85);
  assert.equal(blendHydration({ spelt: 100 }), 0.68);
});

test('rye in the blend raises hydration; rye starter works', () => {
  const plain = solve({ ...params, blend: { bread: 100 } });
  const withRye = solve({ ...params, blend: { bread: 80, rye: 20 } });
  assert.ok(withRye.totals.hydration > plain.totals.hydration);

  const ryeStarter = solve({ ...params, blend: { bread: 100 }, starterFlour: 'rye' });
  assert.ok(ryeStarter.totals.hydration > plain.totals.hydration);
  assert.equal(ryeStarter.weigh.total, 900);
  assert.ok(Math.abs(ryeStarter.pct.rye - ryeStarter.totals.inoculation * 100 / 2) < 1e-9);
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

test('suggestStarter: applying the suggestion lands near 20% inoculation', () => {
  for (const p of [
    params,
    { ...params, doughG: 750, blend: { bread: 100 }, starterFlour: 'ww' },
    { ...params, doughG: 1450, blend: { ap: 50, rye: 50 }, starterFlour: 'rye' },
  ]) {
    const s = suggestStarter(p);
    assert.equal(s % 5, 0); // a build amount, rounded to 5 g
    const r = solve({ ...p, starterG: s });
    assert.ok(Math.abs(r.totals.inoculation - 0.20) < 0.01);
  }
});

test('suggestStarter: default 900 g loaf suggests 105 g', () => {
  assert.equal(suggestStarter(params), 105);
});

test('displayed grams always sum exactly to the dough target', () => {
  for (const target of [250, 750, 900, 1450, 2500]) {
    const r = solve({ ...params, doughG: target, blend: { ap: 30, ww: 20, bread: 30, rye: 10, spelt: 10 } });
    const flourSum = FLOURS.reduce((a, f) => a + r.weigh[f.id], 0);
    assert.equal(flourSum + r.weigh.water + r.weigh.salt + r.weigh.starter, r.weigh.total);
    assert.equal(r.weigh.total, target);
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
  const r = solve({ ...params, blend: { ap: 40, ww: 20, bread: 20, rye: 10, spelt: 10 }, starterFlour: 'ww' });
  const pctSum = FLOURS.reduce((a, f) => a + r.pct[f.id], 0);
  assert.ok(Math.abs(pctSum - 100) < 1e-9);
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
  const b = rebalanceBlend({ ap: 100 }, 'ap', 60);
  const sum = FLOURS.reduce((a, f) => a + b[f.id], 0);
  assert.equal(sum, 100);
  assert.equal(b.ap, 60);
});
