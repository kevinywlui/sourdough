// Pure recipe math. No DOM. UMD-style so it loads as a plain <script>
// (works over file://) and via require() in the node tests.
//
// Baker's math convention: total flour F = 100%, *including* the flour inside
// the starter. Starter is 100% hydration, so it contributes S/2 flour and S/2
// water. The BLEND describes only the flour you ADD; the starter's flour
// counts toward whichever flour it is fed with (starterFlour).
(function (global, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.LoafRecipe = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FLOURS = [
    { id: 'ap', label: 'All-purpose', short: 'AP', hydration: 0.67 },
    { id: 'ww', label: 'Whole wheat', short: 'WW', hydration: 0.80 },
    { id: 'bread', label: 'Bread flour', short: 'Bread', hydration: 0.72 },
  ];

  // Target dough weight ≈ 0.43 g per mL of pan volume, rounded to 50 g.
  const PAN_FACTOR = 0.43;
  const PANS = [
    { id: 'loaf85', label: '8.5×4.5″', grams: 750 },
    { id: 'loaf9', label: '9×5″', grams: 900 },
    { id: 'pullman9', label: 'Pullman 9×4×4', grams: 1000 },
    { id: 'pullman13', label: 'Pullman 13×4×4', grams: 1450 },
    { id: 'mini', label: 'Mini 5.75×3', grams: 250 },
  ];

  const LIMITS = {
    starterG: { min: 10, max: 1000 },
    doughG: { min: 200, max: 2500 },
    starterPct: { min: 5, max: 50 },
    saltPct: { min: 0, max: 3 },
    tempC: { min: 15, max: 30 },
    hydration: { min: 0.60, max: 0.85 },
  };

  const DEFAULTS = {
    mode: 'dough',
    doughG: 900,
    starterG: 150,
    blend: { ap: 40, ww: 20, bread: 40 },
    starterFlour: 'ap',
    starterPct: 20,
    saltPct: 2,
    hydrationOffset: 0,
    tempC: 22,
  };

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  function panPreset(volumeMl) {
    return Math.round((PAN_FACTOR * volumeMl) / 50) * 50;
  }

  // Fraction of TOTAL flour that each flour type makes up. The starter's
  // flour is a fixed share of total flour (starterPct/2, since the starter
  // is half flour), and the added flour fills the rest per the blend.
  function effectiveComposition(blend, starterPct, starterFlour) {
    const starterShare = clamp(starterPct, LIMITS.starterPct.min, LIMITS.starterPct.max) / 200;
    const comp = {};
    for (const f of FLOURS) {
      comp[f.id] = (1 - starterShare) * (blend[f.id] || 0) / 100 +
        (f.id === starterFlour ? starterShare : 0);
    }
    return comp;
  }

  // → hydration fraction, weighted over what's actually in the dough.
  function deriveHydration(blend, starterPct, starterFlour) {
    if (starterPct === undefined) starterPct = DEFAULTS.starterPct;
    if (starterFlour === undefined) starterFlour = DEFAULTS.starterFlour;
    const comp = effectiveComposition(blend, starterPct, starterFlour);
    let h = 0;
    for (const f of FLOURS) h += comp[f.id] * f.hydration;
    return h;
  }

  // Redistribute a blend after one flour is set to `value`, keeping the sum
  // at 100. The delta is spread across the other unlocked flours
  // proportionally (largest-remainder rounding keeps everything integer).
  function rebalanceBlend(blend, key, value, lockedKey) {
    const keys = FLOURS.map((f) => f.id);
    const locked = lockedKey && lockedKey !== key ? lockedKey : null;
    const lockedVal = locked ? blend[locked] : 0;
    const free = keys.filter((k) => k !== key && k !== locked);
    value = Math.round(clamp(value, 0, 100 - lockedVal));
    const remain = 100 - lockedVal - value;
    const out = { ...blend, [key]: value };
    if (free.length === 1) {
      out[free[0]] = remain;
      return out;
    }
    const cur = free.map((k) => blend[k]);
    const curSum = cur.reduce((a, b) => a + b, 0);
    const shares = curSum > 0
      ? cur.map((c) => (remain * c) / curSum)
      : cur.map(() => remain / free.length);
    const floors = shares.map(Math.floor);
    let left = remain - floors.reduce((a, b) => a + b, 0);
    const order = shares
      .map((s, i) => [s - floors[i], i])
      .sort((a, b) => b[0] - a[0]);
    for (let i = 0; i < left; i++) floors[order[i][1]]++;
    free.forEach((k, i) => { out[k] = floors[i]; });
    return out;
  }

  // Solve the full recipe from either direction. Everything pivots on total
  // flour F: given starter S, F = S/p; given dough D, F = D/(1+h+s).
  //
  // Returns exact float totals plus a `weigh` object of display-ready
  // integers where water is the residual, so displayed grams sum exactly.
  function solve(params) {
    const { mode, blend } = params;
    const starterFlour = params.starterFlour || DEFAULTS.starterFlour;
    const p = clamp(params.starterPct, LIMITS.starterPct.min, LIMITS.starterPct.max) / 100;
    const s = clamp(params.saltPct, LIMITS.saltPct.min, LIMITS.saltPct.max) / 100;
    const h = clamp(
      deriveHydration(blend, params.starterPct, starterFlour) +
        (params.hydrationOffset || 0) / 100,
      LIMITS.hydration.min, LIMITS.hydration.max,
    );

    let F;
    if (mode === 'starter') {
      F = clamp(params.starterG, LIMITS.starterG.min, LIMITS.starterG.max) / p;
    } else {
      F = clamp(params.doughG, LIMITS.doughG.min, LIMITS.doughG.max) / (1 + h + s);
    }
    const S = mode === 'starter' ? params.starterG : p * F;
    const W = h * F;
    const salt = s * F;
    const D = F * (1 + h + s);
    const addedFlour = F - S / 2;

    const warnings = [];
    const rS = Math.round(S);
    const rSalt = s > 0 ? Math.max(1, Math.round(salt)) : 0;
    const rAP = Math.round((blend.ap / 100) * addedFlour);
    const rWW = Math.round((blend.ww / 100) * addedFlour);
    const rBread = Math.round((blend.bread / 100) * addedFlour);

    let rWater, rTotal;
    if (mode === 'dough') {
      rTotal = Math.round(params.doughG);
      rWater = rTotal - rS - rSalt - rAP - rWW - rBread;
    } else {
      rWater = Math.round(h * F - S / 2);
      rTotal = rS + rSalt + rAP + rWW + rBread + rWater;
    }
    if (rWater < 0) {
      warnings.push('Not enough room for water at these settings — increase dough weight or reduce starter.');
      rWater = 0;
    }

    const comp = effectiveComposition(blend, params.starterPct, starterFlour);
    return {
      totals: { flour: F, water: W, starter: S, salt, dough: D, hydration: h },
      weigh: { ap: rAP, ww: rWW, bread: rBread, water: rWater, salt: rSalt, starter: rS, total: rTotal },
      pct: {
        ap: comp.ap * 100, ww: comp.ww * 100, bread: comp.bread * 100,
        water: h * 100, salt: s * 100, starter: p * 100,
      },
      warnings,
    };
  }

  function solveFromStarter(starterG, params) {
    return solve({ ...params, mode: 'starter', starterG });
  }

  function solveFromDough(doughG, params) {
    return solve({ ...params, mode: 'dough', doughG });
  }

  return {
    FLOURS, PAN_FACTOR, PANS, LIMITS, DEFAULTS, clamp, panPreset,
    effectiveComposition, deriveHydration, rebalanceBlend,
    solve, solveFromStarter, solveFromDough,
  };
});
