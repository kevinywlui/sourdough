// Pure recipe math. No DOM. UMD-style so it loads as a plain <script>
// (works over file://) and via require() in the node tests.
//
// Baker's math convention: total flour F = 100%, *including* the flour inside
// the starter. Starter is 100% hydration, so it contributes S/2 flour and S/2
// water. The BLEND describes only the flour you ADD; the starter's flour
// counts toward whichever flour it is fed with (starterFlour).
//
// Both dough target D and starter S are user inputs, so inoculation
// (starter as % of total flour) is DERIVED, not chosen. With x = S/2,
// Hb = blend-weighted hydration of the added flour, hst = the starter
// flour's hydration, and off = the user's hydration nudge:
//   W = Hb·(F − x) + hst·x + off·F        (water, incl. starter's)
//   D = F + W + s·F
// which solves in closed form:
//   F = (D − x·(hst − Hb)) / (1 + Hb + s + off)
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

  // Preset dough weights ≈ 0.43 g per mL of pan volume, rounded to 50 g.
  // Ordered by weight — the chips show grams first.
  const PANS = [
    { id: 'loaf8', label: '8×4″', grams: 550 },
    { id: 'loaf85', label: '8.5×4.5″', grams: 750 },
    { id: 'loaf9', label: '9×5″', grams: 900 },
  ];

  const LIMITS = {
    starterG: { min: 10, max: 1000 },
    doughG: { min: 200, max: 2500 },
    saltPct: { min: 0, max: 3 },
    // advisory ranges — the solver warns outside these instead of clamping
    inoculation: { min: 0.05, max: 0.50 },
    hydration: { min: 0.60, max: 0.85 },
  };

  const DEFAULTS = {
    doughG: 750,
    starterG: 100,
    blend: { ap: 40, ww: 20, bread: 40 },
    starterFlour: 'ap',
    saltPct: 2,
    hydrationOffset: 0,
  };

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  // How much starter to build for a dough target, aiming at a given
  // inoculation (default 20% of total flour). Inverts solve()'s closed
  // form: S = p·F with F = (D − (S/2)(hst − Hb)) / K solves to
  // S = p·D / (K + (p/2)(hst − Hb)). Rounded to 5 g — a build amount.
  function suggestStarter(params, inoculation) {
    const p = inoculation || 0.20;
    const starterFlour = params.starterFlour || DEFAULTS.starterFlour;
    const hst = FLOURS.find((f) => f.id === starterFlour).hydration;
    const Hb = blendHydration(params.blend);
    const s = clamp(params.saltPct, LIMITS.saltPct.min, LIMITS.saltPct.max) / 100;
    const off = (params.hydrationOffset || 0) / 100;
    const D = clamp(params.doughG, LIMITS.doughG.min, LIMITS.doughG.max);
    const S = (p * D) / (1 + Hb + s + off + (p / 2) * (hst - Hb));
    return clamp(Math.round(S / 5) * 5, LIMITS.starterG.min, LIMITS.starterG.max);
  }

  // Hydration of the ADDED flour blend alone (weighted average).
  function blendHydration(blend) {
    let h = 0;
    for (const f of FLOURS) h += ((blend[f.id] || 0) / 100) * f.hydration;
    return h;
  }

  // Redistribute a blend after one flour is set to `value`, keeping the sum
  // at 100. The difference comes out of the flours not in `keep` (the user's
  // recent edits), proportionally; kept flours only give way once the others
  // are exhausted. Largest-remainder rounding keeps everything integer.
  function rebalanceBlend(blend, key, value, keep = []) {
    const others = FLOURS.map((f) => f.id).filter((k) => k !== key);
    const kept = others.filter((k) => keep.includes(k));
    const free = others.filter((k) => !keep.includes(k));
    value = Math.round(clamp(value, 0, 100));
    const out = { ...blend, [key]: value };
    const keptSum = kept.reduce((a, k) => a + (blend[k] || 0), 0);
    if (free.length && keptSum <= 100 - value) {
      spread(out, blend, free, 100 - value - keptSum);
    } else {
      // the kept flours alone overflow (or nothing is free): squeeze them too
      free.forEach((k) => { out[k] = 0; });
      spread(out, blend, kept.length ? kept : free, 100 - value);
    }
    return out;
  }

  // Split `total` across `keys` in proportion to their current values
  // (evenly if they're all zero), writing integers into `out`.
  function spread(out, blend, keys, total) {
    const cur = keys.map((k) => blend[k] || 0);
    const curSum = cur.reduce((a, b) => a + b, 0);
    const shares = curSum > 0
      ? cur.map((c) => (total * c) / curSum)
      : cur.map(() => total / keys.length);
    const floors = shares.map(Math.floor);
    const left = total - floors.reduce((a, b) => a + b, 0);
    const order = shares
      .map((s, i) => [s - floors[i], i])
      .sort((a, b) => b[0] - a[0]);
    for (let i = 0; i < left; i++) floors[order[i][1]]++;
    keys.forEach((k, i) => { out[k] = floors[i]; });
  }

  // Solve the full recipe from either direction. Everything pivots on total
  // flour F (see the derivation at the top of this file), then everything
  // else — added flours, water, salt, inoculation — follows from F.
  //
  // Returns exact float totals plus a `weigh` object of display-ready
  // integers where water is the residual, so displayed grams sum exactly
  // to the dough target.
  function solve(params) {
    const { blend } = params;
    const starterFlour = params.starterFlour || DEFAULTS.starterFlour;
    const hst = FLOURS.find((f) => f.id === starterFlour).hydration;
    const Hb = blendHydration(blend);
    const s = clamp(params.saltPct, LIMITS.saltPct.min, LIMITS.saltPct.max) / 100;
    const off = (params.hydrationOffset || 0) / 100;
    const D = clamp(params.doughG, LIMITS.doughG.min, LIMITS.doughG.max);
    let S = clamp(params.starterG, LIMITS.starterG.min, LIMITS.starterG.max);

    const warnings = [];
    // Largest starter this dough target can hold (added flour would hit 0):
    const maxS = (2 * D) / (1 + hst + s + off);
    if (S > maxS) {
      S = Math.floor(maxS);
      warnings.push(`That much starter doesn't fit this dough target — using ${S} g.`);
    }

    const x = S / 2; // the starter's flour (and also its water)
    const F = (D - x * (hst - Hb)) / (1 + Hb + s + off);
    const added = F - x;
    const p = S / F; // inoculation: starter as a fraction of total flour
    const h = (Hb * added + hst * x) / F + off;
    const W = h * F;
    const salt = s * F;

    if (p > LIMITS.inoculation.max) {
      warnings.push(`High inoculation (${Math.round(p * 100)}% starter) — fermentation will be fast and tangy.`);
    } else if (p < LIMITS.inoculation.min) {
      warnings.push(`Low inoculation (${Math.round(p * 100)}% starter) — fermentation will be slow.`);
    }
    if (h < LIMITS.hydration.min - 1e-9) {
      warnings.push(`Hydration is unusually low (${(h * 100).toFixed(1)}%) — expect a stiff dough.`);
    } else if (h > LIMITS.hydration.max + 1e-9) {
      warnings.push(`Hydration is unusually high (${(h * 100).toFixed(1)}%) — expect a slack dough.`);
    }

    const rS = Math.round(S);
    const rSalt = s > 0 ? Math.max(1, Math.round(salt)) : 0;
    const rTotal = Math.round(D);
    const weigh = { salt: rSalt, starter: rS, total: rTotal };
    const pct = { water: h * 100, salt: s * 100, starter: p * 100 };
    let flourGrams = 0;
    for (const f of FLOURS) {
      const share = (blend[f.id] || 0) / 100;
      weigh[f.id] = Math.round(share * added);
      flourGrams += weigh[f.id];
      pct[f.id] = ((share * added + (starterFlour === f.id ? x : 0)) / F) * 100;
    }
    weigh.water = rTotal - rS - rSalt - flourGrams;
    if (weigh.water < 0) {
      warnings.push('No room for water at these settings — reduce starter or raise the dough weight.');
      weigh.water = 0;
    }

    return {
      totals: { flour: F, water: W, starter: S, salt, dough: D, hydration: h, inoculation: p },
      weigh,
      pct,
      warnings,
    };
  }

  return {
    FLOURS, PANS, LIMITS, DEFAULTS, clamp,
    blendHydration, rebalanceBlend, solve, suggestStarter,
  };
});
