// All DOM code lives here. State flows one way: events parse input and call
// update(); render() recomputes the recipe and writes every derived output.
// Inputs the user is typing in are never rewritten while focused.
(() => {
'use strict';

const {
  FLOURS, PANS, DEFAULTS, LIMITS,
  solve, rebalanceBlend, clamp,
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

function storageAvailable() {
  try {
    localStorage.setItem('__sd_test', '1');
    localStorage.removeItem('__sd_test');
    return true;
  } catch {
    return false;
  }
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

let state = {
  ...DEFAULTS,
  lockedFlour: null,
  view: 'g',
  saved: [],
  confirmDeleteId: null,
  theme: 'auto',
};

let draggingSlider = null;
let saveTimer = null;
let toastTimer = null;

function initUI() {
  const stored = loadStored();
  if (stored) {
    if (stored.current) state = { ...state, ...stored.current };
    if (Array.isArray(stored.saved)) state.saved = stored.saved;
    state.theme = stored.theme || stored.prefs?.theme || 'auto';
    state.blend = fullBlend(state.blend); // older storage may lack newer flours
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

  if (!storageAvailable()) {
    $('storage-note').hidden = false;
    $('save-open').disabled = true;
  }

  // Sticky gram summary once the recipe card scrolls off the TOP of the
  // viewport. A scroll listener, not an IntersectionObserver: a fast jump
  // can skip every intersecting frame and the observer never fires.
  window.addEventListener('scroll', updateStickyBar, { passive: true });
  window.addEventListener('resize', updateStickyBar, { passive: true });
  updateStickyBar();
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
    saveStored({ current, saved: state.saved, theme: state.theme });
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
      <span class="blend-pct" data-pct></span>
      <div class="blend-steppers">
        <button class="step-btn" type="button" data-step="-5" aria-label="${flour.label} −5%">−</button>
        <button class="step-btn" type="button" data-step="5" aria-label="${flour.label} +5%">+</button>
      </div>
      <input class="blend-slider" type="range" min="0" max="100" step="1" aria-label="${flour.label} percent">
    `;
    const slider = row.querySelector('.blend-slider');
    // Track drags with pointer events: on touch, range inputs never become
    // document.activeElement, so a focus check can't protect a live drag.
    slider.addEventListener('pointerdown', () => { draggingSlider = slider; });
    slider.addEventListener('input', () => setBlend(flour.id, Number(slider.value)));
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
  window.addEventListener('pointerup', endSliderDrag);
  window.addEventListener('pointercancel', endSliderDrag);

  const saltStep = (d) => update({
    saltPct: clamp(Math.round((state.saltPct + d) * 4) / 4, LIMITS.saltPct.min, LIMITS.saltPct.max),
  });
  $('salt-minus').addEventListener('click', () => saltStep(-0.25));
  $('salt-plus').addEventListener('click', () => saltStep(0.25));

  wireNumericInput($('dough-input'), (v) =>
    update({ doughG: clamp(v, LIMITS.doughG.min, LIMITS.doughG.max) }));
  wireNumericInput($('starter-input'), (v) =>
    update({ starterG: clamp(v, LIMITS.starterG.min, LIMITS.starterG.max) }));

  $('hyd-minus').addEventListener('click', () => update({ hydrationOffset: state.hydrationOffset - 1 }));
  $('hyd-plus').addEventListener('click', () => update({ hydrationOffset: state.hydrationOffset + 1 }));
  $('hyd-reset').addEventListener('click', () => update({ hydrationOffset: 0 }));

  $('view-g').addEventListener('click', () => update({ view: 'g' }));
  $('view-pct').addEventListener('click', () => update({ view: 'pct' }));

  $('sticky-bar').addEventListener('click', () =>
    $('recipe-card').scrollIntoView({ behavior: 'smooth', block: 'center' }));

  $('save-open').addEventListener('click', openSaveForm);
  $('save-cancel').addEventListener('click', () => { $('save-form').hidden = true; $('save-open').hidden = false; });
  $('save-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveCurrentRecipe($('save-name').value.trim());
  });

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

function endSliderDrag() {
  if (draggingSlider) {
    draggingSlider = null;
    render(); // final sync in case the last drag position was clamped
  }
}

// Write the canonical values into both numeric fields, focus or not.
function syncNumericInputs() {
  $('dough-input').value = Math.round(state.doughG);
  $('starter-input').value = Math.round(state.starterG);
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
  renderSaved();
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
    row.querySelector('[data-pct]').textContent = `${pct}%`;
    const slider = row.querySelector('.blend-slider');
    if (draggingSlider !== slider) slider.value = pct;
    slider.style.setProperty('--fill', `${pct}%`);
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

/* ---------- saved recipes ---------- */

function openSaveForm() {
  $('save-open').hidden = true;
  const form = $('save-form');
  form.hidden = false;
  const input = $('save-name');
  input.value = autoName();
  input.focus();
  input.select();
}

function autoName() {
  const parts = FLOURS
    .filter((f) => state.blend[f.id] > 0)
    .map((f) => `${state.blend[f.id]} ${f.id}`);
  const result = solve(state);
  return `${parts.join(' / ')} · ${result.weigh.total} g`;
}

function saveCurrentRecipe(name) {
  if (!name) name = autoName();
  const inputs = {};
  for (const k of RECIPE_INPUT_KEYS) inputs[k] = state[k];
  const saved = [
    { id: `r_${Date.now()}`, name, inputs, updatedAt: new Date().toISOString() },
    ...state.saved,
  ].slice(0, 50);
  $('save-form').hidden = true;
  $('save-open').hidden = false;
  update({ saved });
  toast(`Saved “${name}”`);
}

function renderSaved() {
  const list = $('saved-list');
  list.textContent = '';
  for (const recipe of state.saved) {
    const li = document.createElement('li');
    li.className = 'saved-row';

    // The confirm prompt lives in state so an unrelated render (a stepper
    // tap elsewhere) rebuilds it instead of dismissing it.
    if (state.confirmDeleteId === recipe.id) {
      const wrap = document.createElement('div');
      wrap.className = 'saved-confirm';
      const label = document.createElement('span');
      label.textContent = `Delete “${recipe.name}”?`;
      const del = document.createElement('button');
      del.className = 'danger-btn'; del.type = 'button'; del.textContent = 'Delete';
      del.addEventListener('click', () => {
        update({
          saved: state.saved.filter((r) => r.id !== recipe.id),
          confirmDeleteId: null,
        });
      });
      const cancel = document.createElement('button');
      cancel.className = 'link-btn'; cancel.type = 'button'; cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => update({ confirmDeleteId: null }));
      wrap.append(label, del, cancel);
      li.appendChild(wrap);
      list.appendChild(li);
      continue;
    }

    const blend = recipe.inputs.blend || {};
    const summary = FLOURS
      .filter((f) => blend[f.id] > 0)
      .map((f) => `${blend[f.id]}% ${f.id}`)
      .join(' · ');
    li.innerHTML = `
      <button class="saved-main" type="button">
        <span class="saved-name"></span>
        <span class="saved-sub">${summary}</span>
      </button>
      <button class="saved-del" type="button" aria-label="Delete recipe">✕</button>
    `;
    li.querySelector('.saved-name').textContent = recipe.name;
    li.querySelector('.saved-main').addEventListener('click', () => {
      const inputs = {};
      for (const k of RECIPE_INPUT_KEYS) {
        if (recipe.inputs[k] !== undefined) inputs[k] = recipe.inputs[k];
      }
      if (inputs.blend) inputs.blend = fullBlend(inputs.blend);
      update(inputs);
      toast(`Loaded “${recipe.name}”`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    li.querySelector('.saved-del').addEventListener('click', () =>
      update({ confirmDeleteId: recipe.id }));
    list.appendChild(li);
  }
}

/* ---------- theme and toast ---------- */

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

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2500);
}

initUI();
})();
