// All DOM code lives here. State flows one way: events parse input and call
// update(); render() recomputes the recipe and writes every derived output.
// Inputs the user is typing in are never rewritten while focused.
(() => {
'use strict';

const {
  FLOURS, PANS, DEFAULTS, LIMITS,
  solve, rebalanceBlend, clamp,
} = LoafRecipe;
const { load, save, storageAvailable } = LoafStorage;

const $ = (id) => document.getElementById(id);

const RECIPE_INPUT_KEYS = ['doughG', 'starterG', 'blend', 'starterFlour', 'saltPct', 'hydrationOffset'];

const BLEND_PRESETS = [
  { label: 'All AP', blend: { ap: 100, ww: 0, bread: 0 } },
  { label: 'All bread', blend: { ap: 0, ww: 0, bread: 100 } },
  { label: '80/20 WW', blend: { ap: 0, ww: 20, bread: 80 } },
  { label: '40/20/40', blend: { ap: 40, ww: 20, bread: 40 } },
];

let state = {
  ...DEFAULTS,
  lockedFlour: null,
  view: 'g',
  saved: [],
  loadedId: null,
  confirmDeleteId: null,
  prefs: { theme: 'auto' },
};

let draggingSlider = null;
let saveTimer = null;
let toastTimer = null;

function initUI() {
  const stored = load();
  if (stored) {
    if (stored.current) state = { ...state, ...stored.current };
    if (Array.isArray(stored.saved)) state.saved = stored.saved;
    if (stored.prefs) state.prefs = { ...state.prefs, ...stored.prefs };
  }

  buildPanChips();
  buildStarterFlourChips();
  buildBlendPresets();
  buildBlendRows();
  buildSteppers();
  wireEvents();
  applyPrefs();
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
    const { saved, prefs } = state;
    const current = {};
    for (const k of [...RECIPE_INPUT_KEYS, 'lockedFlour', 'view', 'loadedId']) {
      current[k] = state[k];
    }
    save({ current, saved, prefs });
  }, 200);
}

/* ---------- dynamic DOM construction ---------- */

function buildPanChips() {
  const row = $('pan-chips');
  for (const pan of PANS) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = `${pan.label} · ${pan.grams} g`;
    b.dataset.grams = pan.grams;
    b.addEventListener('click', () => update({ doughG: pan.grams }));
    row.appendChild(b);
  }
}

function buildStarterFlourChips() {
  const row = $('starter-flour-chips');
  for (const flour of FLOURS) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = flour.short;
    b.dataset.flour = flour.id;
    b.addEventListener('click', () => update({ starterFlour: flour.id }));
    row.appendChild(b);
  }
}

function buildBlendPresets() {
  const row = $('blend-presets');
  for (const preset of BLEND_PRESETS) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = preset.label;
    b.addEventListener('click', () => update({ blend: { ...preset.blend }, lockedFlour: null }));
    row.appendChild(b);
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

function buildSteppers() {
  makeStepper($('saltpct-stepper'), {
    get: () => state.saltPct,
    set: (v) => update({ saltPct: clamp(Math.round(v * 4) / 4, LIMITS.saltPct.min, LIMITS.saltPct.max) }),
    step: 0.25,
    fmt: (v) => `${v}%`,
  });
}

const stepperRenderers = [];
function makeStepper(container, { get, set, step, fmt }) {
  const minus = document.createElement('button');
  minus.className = 'step-btn'; minus.type = 'button'; minus.textContent = '−';
  const value = document.createElement('span');
  value.className = 'stepper-value';
  const plus = document.createElement('button');
  plus.className = 'step-btn'; plus.type = 'button'; plus.textContent = '+';
  minus.addEventListener('click', () => set(get() - step));
  plus.addEventListener('click', () => set(get() + step));
  const group = document.createElement('div');
  group.className = 'stepper-group';
  group.append(minus, value, plus);
  container.appendChild(group);
  stepperRenderers.push(() => { value.textContent = fmt(get()); });
}

/* ---------- events ---------- */

function wireEvents() {
  window.addEventListener('pointerup', endSliderDrag);
  window.addEventListener('pointercancel', endSliderDrag);

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
  stepperRenderers.forEach((fn) => fn());
}

function setInputValue(input, value) {
  if (document.activeElement !== input) input.value = value;
}

function renderInputs(result) {
  setInputValue($('dough-input'), Math.round(state.doughG));
  setInputValue($('starter-input'), Math.round(state.starterG));
  $('starter-note').textContent =
    `= ${Math.round(result.totals.inoculation * 100)}% of total flour`;
}

function renderChips() {
  for (const chip of $('pan-chips').children) {
    chip.setAttribute('aria-pressed', Number(chip.dataset.grams) === Math.round(state.doughG));
  }
  for (const chip of $('starter-flour-chips').children) {
    chip.setAttribute('aria-pressed', chip.dataset.flour === state.starterFlour);
  }
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
  { id: 'ap', label: 'All-purpose flour' },
  { id: 'ww', label: 'Whole wheat' },
  { id: 'bread', label: 'Bread flour' },
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
  const { ap, ww, bread, water, salt, starter } = result.weigh;
  const flours = [ap, ww, bread].filter((g) => g > 0).join('+');
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
      update({ ...inputs, loadedId: recipe.id });
      toast(`Loaded “${recipe.name}”`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    li.querySelector('.saved-del').addEventListener('click', () =>
      update({ confirmDeleteId: recipe.id }));
    list.appendChild(li);
  }
}

/* ---------- prefs and toast ---------- */

function applyPrefs() {
  const root = document.documentElement;
  if (state.prefs.theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', state.prefs.theme);
  $('theme-toggle').title = `Theme: ${state.prefs.theme}`;
  $('theme-toggle').textContent = { auto: '◐', light: '☀', dark: '☾' }[state.prefs.theme];
}

function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  state.prefs.theme = order[(order.indexOf(state.prefs.theme) + 1) % order.length];
  applyPrefs();
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
