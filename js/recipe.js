// Pure recipe math. No DOM, no imports — runs identically in browser and Node.
//
// Baker's math convention: total flour F = 100%, *including* the flour inside
// the starter. Starter is 100% hydration, so it contributes S/2 flour and S/2
// water. Starter flour is assumed AP-fed and debits the AP bucket.

export const FLOURS = [
  { id: 'ap', label: 'All-purpose', hydration: 0.67 },
  { id: 'ww', label: 'Whole wheat', hydration: 0.80 },
  { id: 'bread', label: 'Bread flour', hydration: 0.72 },
];

// Target dough weight ≈ 0.43 g per mL of pan volume, rounded to 50 g.
export const PAN_FACTOR = 0.43;
export const PANS = [
  { id: 'loaf85', label: '8.5×4.5″', grams: 750 },
  { id: 'loaf9', label: '9×5″', grams: 900 },
  { id: 'pullman9', label: 'Pullman 9×4×4', grams: 1000 },
  { id: 'pullman13', label: 'Pullman 13×4×4', grams: 1450 },
  { id: 'mini', label: 'Mini 5.75×3', grams: 250 },
];

export const LIMITS = {
  starterG: { min: 10, max: 1000 },
  doughG: { min: 200, max: 2500 },
  starterPct: { min: 5, max: 50 },
  saltPct: { min: 0, max: 3 },
  tempC: { min: 15, max: 30 },
  hydration: { min: 0.60, max: 0.85 },
};

export const DEFAULTS = {
  mode: 'dough',
  doughG: 900,
  starterG: 150,
  blend: { ap: 40, ww: 20, bread: 40 },
  starterPct: 20,
  saltPct: 2,
  hydrationOffset: 0,
  tempC: 22,
};

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function panPreset(volumeMl) {
  return Math.round((PAN_FACTOR * volumeMl) / 50) * 50;
}

// blend: {ap, ww, bread} in percents summing to 100 → hydration fraction
export function deriveHydration(blend) {
  let h = 0;
  for (const f of FLOURS) h += ((blend[f.id] || 0) / 100) * f.hydration;
  return h;
}

// Redistribute a blend after one flour is set to `value`, keeping the sum at
// 100. The delta is spread across the other unlocked flours proportionally
// (largest-remainder rounding so everything stays an integer).
export function rebalanceBlend(blend, key, value, lockedKey = null) {
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
// Returns exact float totals plus a `weigh` object of display-ready integers
// where water is the residual, so the displayed grams always sum exactly.
export function solve(params) {
  const { mode, blend } = params;
  const p = clamp(params.starterPct, LIMITS.starterPct.min, LIMITS.starterPct.max) / 100;
  const s = clamp(params.saltPct, LIMITS.saltPct.min, LIMITS.saltPct.max) / 100;
  const h = clamp(
    deriveHydration(blend) + (params.hydrationOffset || 0) / 100,
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

  const warnings = [];
  const rS = Math.round(S);
  const rSalt = s > 0 ? Math.max(1, Math.round(salt)) : 0;
  let rWW = Math.round((blend.ww / 100) * F);
  let rBread = Math.round((blend.bread / 100) * F);
  let rAP = Math.round((blend.ap / 100) * F - S / 2);
  if (rAP < 0) {
    // Starter brings in more AP flour than the blend calls for; take the
    // deficit out of the other flours so nothing goes negative.
    let deficit = -rAP;
    rAP = 0;
    const fromBread = Math.min(deficit, rBread);
    rBread -= fromBread;
    deficit -= fromBread;
    const fromWW = Math.min(deficit, rWW);
    rWW -= fromWW;
    warnings.push('Starter contributes more AP flour than the blend calls for — other flours reduced to compensate.');
  }

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

  return {
    totals: { flour: F, water: W, starter: S, salt, dough: D, hydration: h },
    weigh: { ap: rAP, ww: rWW, bread: rBread, water: rWater, salt: rSalt, starter: rS, total: rTotal },
    pct: {
      ap: blend.ap, ww: blend.ww, bread: blend.bread,
      water: h * 100, salt: s * 100, starter: p * 100,
    },
    warnings,
  };
}

export function solveFromStarter(starterG, params) {
  return solve({ ...params, mode: 'starter', starterG });
}

export function solveFromDough(doughG, params) {
  return solve({ ...params, mode: 'dough', doughG });
}
