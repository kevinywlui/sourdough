// All DOM code lives here. State flows one way: events parse input and call
// update(); render() recomputes the recipe and writes every derived output.
// Inputs the user is typing in are never rewritten while focused.
(() => {
'use strict';

const {
  FLOURS, PANS, DEFAULTS, LIMITS,
  solve, rebalanceBlend, suggestStarter, clamp,
} = LoafRecipe;

const $ = (id) => document.getElementById(id);

/* ---------- storage (all access try/caught: private mode, quota) ---------- */

const STORAGE_KEY = 'sourdough.v1';

function loadStored() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return raw && raw.version === 1 ? raw : null;
  } catch {
    return null;
  }
}

function saveStored(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...data }));
  } catch { /* degrade to in-memory */ }
}

const RECIPE_INPUT_KEYS = ['doughG', 'starterG', 'blend', 'starterFlour', 'saltPct', 'hydrationOffset'];

// Blends may be sparse here; fullBlend() fills the missing flours with 0.
const BLEND_PRESETS = [
  { label: 'All AP', blend: { ap: 100 } },
  { label: 'All bread', blend: { bread: 100 } },
  { label: '80/20 WW', blend: { bread: 80, ww: 20 } },
  { label: '40/20/40', blend: { ap: 40, ww: 20, bread: 40 } },
];

const fullBlend = (b = {}) =>
  Object.fromEntries(FLOURS.map((f) => [f.id, b[f.id] || 0]));

// Drop unknown flours; if that leaves the blend short of 100, scale it back up.
function normalizeBlend(b) {
  const out = fullBlend(b);
  const sum = FLOURS.reduce((a, f) => a + out[f.id], 0);
  if (sum === 100) return out;
  if (sum === 0) return fullBlend(DEFAULTS.blend);
  const [first, ...rest] = FLOURS;
  return rebalanceBlend(out, first.id, (out[first.id] / sum) * 100);
}

let state = {
  ...DEFAULTS,
  lockedFlour: null,
  view: 'g',
  theme: 'auto',
};

let saveTimer = null;

function initUI() {
  const stored = loadStored();
  if (stored) {
    if (stored.current) state = { ...state, ...stored.current };
    state.theme = stored.theme || stored.prefs?.theme || 'auto';
    // older storage may hold removed flours (rye, spelt) or lack newer ones
    state.blend = normalizeBlend(state.blend);
    if (!FLOURS.some((f) => f.id === state.starterFlour)) state.starterFlour = DEFAULTS.starterFlour;
    if (!FLOURS.some((f) => f.id === state.lockedFlour)) state.lockedFlour = null;
  }

  buildChips($('pan-chips'), PANS,
    (p) => `${p.label} · ${p.grams} g`,
    (p) => update({ doughG: p.grams }));
  buildChips($('starter-flour-chips'), FLOURS,
    (f) => f.short,
    (f) => update({ starterFlour: f.id }));
  buildChips($('blend-presets'), BLEND_PRESETS,
    (p) => p.label,
    (p) => update({ blend: fullBlend(p.blend), lockedFlour: null }));
  buildBlendRows();
  wireEvents();
  applyTheme();
  render();

  // Sticky gram summary once the recipe card scrolls off the TOP of the
  // viewport. A scroll listener, not an IntersectionObserver: a fast jump
  // can skip every intersecting frame and the observer never fires.
  window.addEventListener('scroll', updateStickyBar, { passive: true });
  window.addEventListener('resize', updateStickyBar, { passive: true });
  updateStickyBar();

  // Offline support + home-screen install. Service workers need a secure
  // context, so skip when opened via file:// — the app works fine without.
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function update(patch) {
  state = { ...state, ...patch };
  render();
  persist();
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const current = {};
    for (const k of [...RECIPE_INPUT_KEYS, 'lockedFlour', 'view']) {
      current[k] = state[k];
    }
    saveStored({ current, theme: state.theme });
  }, 200);
}

/* ---------- dynamic DOM construction ---------- */

function buildChips(container, items, makeLabel, onPick) {
  for (const item of items) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = makeLabel(item);
    b.addEventListener('click', () => onPick(item));
    container.appendChild(b);
  }
}

function buildBlendRows() {
  const wrap = $('blend-rows');
  for (const flour of FLOURS) {
    const row = document.createElement('div');
    row.className = 'blend-row';
    row.innerHTML = `
      <div class="blend-name">
        <button class="lock-btn" type="button" aria-pressed="false" title="Lock ${flour.label}">🔓</button>
        <span>${flour.label}</span>
      </div>
      <span class="field-input blend-input">
        <input type="text" inputmode="numeric" autocomplete="off" aria-label="${flour.label} percent">
        <span class="unit">%</span>
      </span>
      <div class="blend-steppers">
        <button class="step-btn" type="button" data-step="-5" aria-label="${flour.label} −5%">−</button>
        <button class="step-btn" type="button" data-step="5" aria-label="${flour.label} +5%">+</button>
      </div>
    `;
    const input = row.querySelector('input');
    wireNumericInput(input, (v) => setBlend(flour.id, v));
    row.querySelectorAll('[data-step]').forEach((btn) => {
      btn.addEventListener('click', () =>
        setBlend(flour.id, state.blend[flour.id] + Number(btn.dataset.step)));
    });
    const lock = row.querySelector('.lock-btn');
    lock.addEventListener('click', () => {
      update({ lockedFlour: state.lockedFlour === flour.id ? null : flour.id });
    });
    row.dataset.flour = flour.id;
    wrap.appendChild(row);
  }
}

function setBlend(key, value) {
  update({ blend: rebalanceBlend(state.blend, key, value, state.lockedFlour) });
}

/* ---------- events ---------- */

function wireEvents() {
  const saltStep = (d) => update({
    saltPct: clamp(Math.round((state.saltPct + d) * 4) / 4, LIMITS.saltPct.min, LIMITS.saltPct.max),
  });
  $('salt-minus').addEventListener('click', () => saltStep(-0.25));
  $('salt-plus').addEventListener('click', () => saltStep(0.25));

  wireNumericInput($('dough-input'), (v) =>
    update({ doughG: clamp(v, LIMITS.doughG.min, LIMITS.doughG.max) }));
  wireNumericInput($('starter-input'), (v) =>
    update({ starterG: clamp(v, LIMITS.starterG.min, LIMITS.starterG.max) }));
  $('starter-suggest').addEventListener('click', () =>
    update({ starterG: suggestStarter(state) }));

  $('hyd-minus').addEventListener('click', () => update({ hydrationOffset: state.hydrationOffset - 1 }));
  $('hyd-plus').addEventListener('click', () => update({ hydrationOffset: state.hydrationOffset + 1 }));
  $('hyd-reset').addEventListener('click', () => update({ hydrationOffset: 0 }));

  $('view-g').addEventListener('click', () => update({ view: 'g' }));
  $('view-pct').addEventListener('click', () => update({ view: 'pct' }));

  $('sticky-bar').addEventListener('click', () =>
    $('recipe-card').scrollIntoView({ behavior: 'smooth', block: 'center' }));

  $('theme-toggle').addEventListener('click', cycleTheme);
}

function wireNumericInput(input, onValue) {
  input.addEventListener('focus', () => input.select());
  input.addEventListener('change', () => {
    const v = parseFloat(input.value.replace(',', '.'));
    if (Number.isFinite(v)) onValue(v);
    // 'change' fires while the input is still focused, so render()'s focus
    // guard would leave a clamped or invalid value on screen — force-sync.
    syncNumericInputs();
  });
}

// Write the canonical values into every numeric field, focus or not.
function syncNumericInputs() {
  $('dough-input').value = Math.round(state.doughG);
  $('starter-input').value = Math.round(state.starterG);
  for (const row of $('blend-rows').children) {
    row.querySelector('input').value = state.blend[row.dataset.flour];
  }
}

/* ---------- render ---------- */

function render() {
  const result = solve(state);
  renderInputs(result);
  renderChips();
  renderBlend();
  renderHydration(result);
  renderRecipe(result);
  renderStickyBar(result);
}

function setInputValue(input, value) {
  if (document.activeElement !== input) input.value = value;
}

function renderInputs(result) {
  setInputValue($('dough-input'), Math.round(state.doughG));
  setInputValue($('starter-input'), Math.round(state.starterG));
  $('starter-note').textContent =
    `= ${Math.round(result.totals.inoculation * 100)}% of total flour`;
  $('salt-value').textContent = `${state.saltPct}%`;

  // "How much starter should I prepare?" — hide once they're already there.
  const suggested = suggestStarter(state);
  $('suggest-row').hidden = Math.round(state.starterG) === suggested;
  $('starter-suggest').textContent = `Use ${suggested} g`;
}

function renderChips() {
  [...$('pan-chips').children].forEach((chip, i) =>
    chip.setAttribute('aria-pressed', PANS[i].grams === Math.round(state.doughG)));
  [...$('starter-flour-chips').children].forEach((chip, i) =>
    chip.setAttribute('aria-pressed', FLOURS[i].id === state.starterFlour));
}

function renderBlend() {
  for (const row of $('blend-rows').children) {
    const id = row.dataset.flour;
    const pct = state.blend[id];
    setInputValue(row.querySelector('input'), pct);
    const lock = row.querySelector('.lock-btn');
    const locked = state.lockedFlour === id;
    lock.setAttribute('aria-pressed', locked);
    lock.textContent = locked ? '🔒' : '🔓';
  }
}

function renderHydration(result) {
  const el = $('hyd-value');
  el.textContent = `${(result.totals.hydration * 100).toFixed(1)}%`;
  el.classList.toggle('adjusted', state.hydrationOffset !== 0);
  $('hyd-reset').style.visibility = state.hydrationOffset !== 0 ? 'visible' : 'hidden';
}

const ING_ROWS = [
  ...FLOURS.map((f) => ({ id: f.id, label: f.label })),
  { id: 'water', label: 'Water' },
  { id: 'salt', label: 'Salt' },
  { id: 'starter', label: 'Starter' },
];

function renderRecipe(result) {
  $('view-g').setAttribute('aria-pressed', state.view === 'g');
  $('view-pct').setAttribute('aria-pressed', state.view === 'pct');

  const list = $('recipe-rows');
  list.textContent = '';
  for (const ing of ING_ROWS) {
    if (result.weigh[ing.id] === 0 && (state.blend[ing.id] ?? 1) === 0) continue;
    const li = document.createElement('li');
    li.className = 'recipe-row';
    const amount = state.view === 'g'
      ? `${result.weigh[ing.id]}<span class="unit"> g</span>`
      : `${result.pct[ing.id].toFixed(1)}<span class="unit">%</span>`;
    li.innerHTML = `
      <span class="ing-name">${ing.label}</span>
      <span class="ing-amount">${amount}</span>
    `;
    list.appendChild(li);
  }

  const h = (result.totals.hydration * 100).toFixed(1);
  const inoc = Math.round(result.totals.inoculation * 100);
  $('recipe-total').textContent = state.view === 'g'
    ? `Total dough ${result.weigh.total} g · ${h}% hydration · ${inoc}% starter · ${state.saltPct}% salt`
    : `Percentages are of total flour (${Math.round(result.totals.flour)} g), starter flour included`;

  const warn = $('warnings');
  warn.textContent = '';
  for (const w of result.warnings) {
    const p = document.createElement('p');
    p.textContent = `⚠ ${w}`;
    warn.appendChild(p);
  }
}

function renderStickyBar(result) {
  const { water, salt, starter } = result.weigh;
  const flours = FLOURS.map((f) => result.weigh[f.id]).filter((g) => g > 0).join('+');
  $('sticky-bar').textContent =
    `${flours} flour · ${water} water · ${salt} salt · ${starter} starter`;
  updateStickyBar();
}

function updateStickyBar() {
  // Show only after the recipe card has scrolled up under the header.
  const cardBottom = $('recipe-card').getBoundingClientRect().bottom;
  $('sticky-bar').hidden = cardBottom > 56;
}

/* ---------- theme ---------- */

function applyTheme() {
  const root = document.documentElement;
  if (state.theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', state.theme);
  $('theme-toggle').title = `Theme: ${state.theme}`;
  $('theme-toggle').textContent = { auto: '◐', light: '☀', dark: '☾' }[state.theme];
}

function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  state.theme = order[(order.indexOf(state.theme) + 1) % order.length];
  applyTheme();
  persist();
}

initUI();
})();
