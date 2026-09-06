// All DOM code lives here. State flows one way: events parse input and call
// update(); render() recomputes the recipe and writes every derived output.
// Inputs the user is typing in are never rewritten while focused.

import {
  FLOURS, PANS, DEFAULTS, LIMITS,
  solve, deriveHydration, rebalanceBlend, clamp,
} from './recipe.js';
import { schedule, formatDuration } from './timeline.js';
import { load, save, storageAvailable } from './storage.js';

const $ = (id) => document.getElementById(id);

const RECIPE_INPUT_KEYS = ['mode', 'doughG', 'starterG', 'blend', 'starterPct', 'saltPct', 'hydrationOffset'];

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
  checked: {},
  bake: null, // { startedAt: ms, done: { stageId: ms } }
  saved: [],
  loadedId: null,
  prefs: { theme: 'auto', large: false },
};

let wakeLock = null;
let saveTimer = null;
let toastTimer = null;

export function initUI() {
  const stored = load();
  if (stored) {
    if (stored.current) state = { ...state, ...stored.current };
    if (Array.isArray(stored.saved)) state.saved = stored.saved;
    if (stored.bake) state.bake = stored.bake;
    if (stored.prefs) state.prefs = { ...state.prefs, ...stored.prefs };
  }

  buildPanChips();
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
  if ('wakeLock' in navigator) {
    $('wake-row').hidden = false;
  }

  // Sticky gram summary once the recipe card scrolls off-screen.
  const observer = new IntersectionObserver(([entry]) => {
    $('sticky-bar').hidden = entry.isIntersecting;
  }, { rootMargin: '-56px 0px 0px 0px' });
  observer.observe($('recipe-card'));
}

function update(patch, { resetChecks } = {}) {
  const touchedRecipe = resetChecks !== false &&
    Object.keys(patch).some((k) => RECIPE_INPUT_KEYS.includes(k));
  state = { ...state, ...patch };
  if (touchedRecipe && Object.keys(state.checked).length > 0) {
    state.checked = {};
    toast('Ingredient checks reset');
  }
  render();
  persist();
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { saved, bake, prefs, checked, ...rest } = state;
    const current = {};
    for (const k of [...RECIPE_INPUT_KEYS, 'lockedFlour', 'view', 'tempC', 'loadedId']) {
      current[k] = rest[k] ?? state[k];
    }
    save({ current, saved, bake, prefs });
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
    b.addEventListener('click', () => update({ mode: 'dough', doughG: pan.grams }));
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
    slider.addEventListener('input', () => setBlend(flour.id, Number(slider.value)));
    row.querySelectorAll('[data-step]').forEach((btn) => {
      btn.addEventListener('click', () =>
        setBlend(flour.id, state.blend[flour.id] + Number(btn.dataset.step)));
    });
    const lock = row.querySelector('.lock-btn');
    lock.addEventListener('click', () => {
      update({ lockedFlour: state.lockedFlour === flour.id ? null : flour.id }, { resetChecks: false });
    });
    row.dataset.flour = flour.id;
    wrap.appendChild(row);
  }
}

function setBlend(key, value) {
  update({ blend: rebalanceBlend(state.blend, key, value, state.lockedFlour) });
}

function buildSteppers() {
  makeStepper($('starterpct-stepper'), {
    get: () => state.starterPct,
    set: (v) => update({ starterPct: clamp(v, LIMITS.starterPct.min, LIMITS.starterPct.max) }),
    step: 5,
    fmt: (v) => `${v}%`,
  });
  makeStepper($('saltpct-stepper'), {
    get: () => state.saltPct,
    set: (v) => update({ saltPct: clamp(Math.round(v * 4) / 4, LIMITS.saltPct.min, LIMITS.saltPct.max) }),
    step: 0.25,
    fmt: (v) => `${v}%`,
  });
  makeStepper($('temp-stepper'), {
    get: () => state.tempC,
    set: (v) => update({ tempC: clamp(v, LIMITS.tempC.min, LIMITS.tempC.max) }, { resetChecks: false }),
    step: 1,
    fmt: (v) => `${v}°C`,
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
  $('mode-dough').addEventListener('click', () => update({ mode: 'dough' }));
  $('mode-starter').addEventListener('click', () => update({ mode: 'starter' }));

  wireNumericInput($('dough-input'), (v) => {
    if (state.mode === 'dough') update({ doughG: clamp(v, LIMITS.doughG.min, LIMITS.doughG.max) });
  });
  wireNumericInput($('starter-input'), (v) => {
    if (state.mode === 'starter') update({ starterG: clamp(v, LIMITS.starterG.min, LIMITS.starterG.max) });
  });
  // Tapping the computed field switches to that mode.
  $('dough-field').addEventListener('click', () => {
    if (state.mode !== 'dough') { update({ mode: 'dough' }); $('dough-input').focus(); }
  });
  $('starter-field').addEventListener('click', () => {
    if (state.mode !== 'starter') { update({ mode: 'starter' }); $('starter-input').focus(); }
  });

  $('hyd-minus').addEventListener('click', () => update({ hydrationOffset: state.hydrationOffset - 1 }));
  $('hyd-plus').addEventListener('click', () => update({ hydrationOffset: state.hydrationOffset + 1 }));
  $('hyd-reset').addEventListener('click', () => update({ hydrationOffset: 0 }));

  $('view-g').addEventListener('click', () => update({ view: 'g' }, { resetChecks: false }));
  $('view-pct').addEventListener('click', () => update({ view: 'pct' }, { resetChecks: false }));

  $('sticky-bar').addEventListener('click', () =>
    $('recipe-card').scrollIntoView({ behavior: 'smooth', block: 'center' }));

  $('bake-start').addEventListener('click', () => {
    if (state.bake) return;
    update({ bake: { startedAt: Date.now(), done: {} } }, { resetChecks: false });
    maybeOfferWakeLock();
  });
  $('bake-reset').addEventListener('click', () => update({ bake: null }, { resetChecks: false }));

  $('save-open').addEventListener('click', openSaveForm);
  $('save-cancel').addEventListener('click', () => { $('save-form').hidden = true; $('save-open').hidden = false; });
  $('save-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveCurrentRecipe($('save-name').value.trim());
  });

  $('theme-toggle').addEventListener('click', cycleTheme);
  $('large-toggle').addEventListener('click', () => {
    state.prefs.large = !state.prefs.large;
    applyPrefs();
    persist();
  });
  $('wake-toggle').addEventListener('change', (e) => setWakeLock(e.target.checked));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && $('wake-toggle').checked) setWakeLock(true);
  });
}

function wireNumericInput(input, onValue) {
  input.addEventListener('focus', () => input.select());
  input.addEventListener('change', () => {
    const v = parseFloat(input.value.replace(',', '.'));
    if (Number.isFinite(v)) onValue(v);
    else render(); // restore last good value
  });
}

/* ---------- render ---------- */

function render() {
  const result = solve(state);
  renderMode();
  renderPanChips();
  renderBlend();
  renderHydration();
  renderRecipe(result);
  renderStickyBar(result);
  renderTimeline();
  renderSaved();
  stepperRenderers.forEach((fn) => fn());
}

function setInputValue(input, value) {
  if (document.activeElement !== input) input.value = value;
}

function renderMode() {
  const doughMode = state.mode === 'dough';
  $('mode-dough').setAttribute('aria-selected', doughMode);
  $('mode-starter').setAttribute('aria-selected', !doughMode);
  $('dough-field').classList.toggle('computed', !doughMode);
  $('starter-field').classList.toggle('computed', doughMode);
  $('dough-input').readOnly = !doughMode;
  $('starter-input').readOnly = doughMode;

  const result = solve(state);
  if (doughMode) {
    setInputValue($('dough-input'), Math.round(state.doughG));
    setInputValue($('starter-input'), result.weigh.starter);
    $('dough-note').textContent = '';
    $('starter-note').textContent = 'computed';
  } else {
    setInputValue($('starter-input'), Math.round(state.starterG));
    setInputValue($('dough-input'), result.weigh.total);
    $('starter-note').textContent = '';
    const fit = bestFitPan(result.weigh.total);
    $('dough-note').textContent = fit ? `computed · ≈ fills a ${fit.label} pan` : 'computed';
  }
}

function bestFitPan(grams) {
  let best = null;
  for (const pan of PANS) {
    const diff = Math.abs(pan.grams - grams);
    if (diff / pan.grams < 0.15 && (!best || diff < Math.abs(best.grams - grams))) best = pan;
  }
  return best;
}

function renderPanChips() {
  const chips = $('pan-chips').children;
  for (const chip of chips) {
    const active = state.mode === 'dough' && Number(chip.dataset.grams) === Math.round(state.doughG);
    chip.setAttribute('aria-pressed', active);
  }
}

function renderBlend() {
  for (const row of $('blend-rows').children) {
    const id = row.dataset.flour;
    const pct = state.blend[id];
    row.querySelector('[data-pct]').textContent = `${pct}%`;
    const slider = row.querySelector('.blend-slider');
    if (document.activeElement !== slider) slider.value = pct;
    slider.style.setProperty('--fill', `${pct}%`);
    const lock = row.querySelector('.lock-btn');
    const locked = state.lockedFlour === id;
    lock.setAttribute('aria-pressed', locked);
    lock.textContent = locked ? '🔒' : '🔓';
  }
}

function renderHydration() {
  const h = clamp(
    deriveHydration(state.blend) + state.hydrationOffset / 100,
    LIMITS.hydration.min, LIMITS.hydration.max,
  );
  const el = $('hyd-value');
  el.textContent = `${(h * 100).toFixed(1)}%`;
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
  $('view-g').setAttribute('aria-selected', state.view === 'g');
  $('view-pct').setAttribute('aria-selected', state.view === 'pct');

  const list = $('recipe-rows');
  list.textContent = '';
  for (const ing of ING_ROWS) {
    if (state.view === 'g' && result.weigh[ing.id] === 0 && state.blend[ing.id] === 0) continue;
    const li = document.createElement('li');
    li.className = 'recipe-row';
    if (state.checked[ing.id]) li.classList.add('checked');
    const amount = state.view === 'g'
      ? `${result.weigh[ing.id]}<span class="unit"> g</span>`
      : `${result.pct[ing.id].toFixed(1)}<span class="unit">%</span>`;
    li.innerHTML = `
      <span class="check">${state.checked[ing.id] ? '✓' : ''}</span>
      <span class="ing-name">${ing.label}</span>
      <span class="ing-amount">${amount}</span>
    `;
    li.addEventListener('click', () => {
      state.checked = { ...state.checked, [ing.id]: !state.checked[ing.id] };
      render();
    });
    list.appendChild(li);
  }

  const h = (result.totals.hydration * 100).toFixed(1);
  $('recipe-total').textContent = state.view === 'g'
    ? `Total dough ${result.weigh.total} g · ${h}% hydration · ${state.saltPct}% salt`
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
}

function renderTimeline() {
  const stages = schedule(state.tempC, state.starterPct);
  const list = $('stages');
  list.textContent = '';

  const started = !!state.bake;
  $('bake-start').hidden = started;
  $('bake-reset').hidden = !started;

  // Each stage starts when the previous ends — or when it was actually
  // marked done, which re-anchors everything after it to reality.
  let cursor = started ? state.bake.startedAt : null;
  let currentFound = false;

  for (const stage of stages) {
    const li = document.createElement('li');
    li.className = 'stage';
    const doneAt = started ? state.bake.done[stage.id] : null;
    let timeText = formatDuration(stage.minutes);
    let subText = stage.note || '';

    if (started) {
      const startAt = cursor;
      const endAt = doneAt ?? startAt + stage.minutes * 60000;
      if (doneAt) {
        li.classList.add('done');
        timeText = `done ${clock(doneAt)}`;
      } else {
        timeText = `until ~${clock(endAt)}`;
        if (!currentFound) {
          li.classList.add('current');
          currentFound = true;
        }
        subText = [formatDuration(stage.minutes), stage.note].filter(Boolean).join(' · ');
      }
      li.classList.add('tappable');
      cursor = endAt;
    }

    li.innerHTML = `
      <span class="dot"></span>
      <div class="stage-top">
        <span class="stage-label">${stage.label}</span>
        <span class="stage-time">${timeText}</span>
      </div>
      ${subText ? `<div class="stage-sub">${subText}</div>` : ''}
    `;
    if (started) li.addEventListener('click', () => toggleStageDone(stage.id));
    list.appendChild(li);
  }

  const totalMin = stages.reduce((a, s) => a + s.minutes, 0);
  const untilBake = stages.slice(0, 4).reduce((a, s) => a + s.minutes, 0);
  if (started) {
    $('timeline-summary').textContent = `Started ${clock(state.bake.startedAt)} · tap a stage when it's done`;
  } else {
    const bakeAt = new Date(Date.now() + untilBake * 60000);
    $('timeline-summary').textContent =
      `Total about ${formatDuration(totalMin)} — start now and bake around ${clock(bakeAt)}`;
  }
}

function toggleStageDone(id) {
  const done = { ...state.bake.done };
  if (done[id]) delete done[id];
  else done[id] = Date.now();
  update({ bake: { ...state.bake, done } }, { resetChecks: false });
}

function clock(t) {
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
  for (const k of [...RECIPE_INPUT_KEYS, 'tempC']) inputs[k] = state[k];
  const saved = [
    { id: `r_${Date.now()}`, name, inputs, updatedAt: new Date().toISOString() },
    ...state.saved,
  ].slice(0, 50);
  $('save-form').hidden = true;
  $('save-open').hidden = false;
  update({ saved }, { resetChecks: false });
  toast(`Saved “${name}”`);
}

function renderSaved() {
  const list = $('saved-list');
  list.textContent = '';
  for (const recipe of state.saved) {
    const li = document.createElement('li');
    li.className = 'saved-row';
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
      update({ ...recipe.inputs, loadedId: recipe.id });
      toast(`Loaded “${recipe.name}”`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    li.querySelector('.saved-del').addEventListener('click', () => confirmDelete(li, recipe));
    list.appendChild(li);
  }
}

function confirmDelete(row, recipe) {
  row.textContent = '';
  const wrap = document.createElement('div');
  wrap.className = 'saved-confirm';
  const label = document.createElement('span');
  label.textContent = `Delete “${recipe.name}”?`;
  const del = document.createElement('button');
  del.className = 'danger-btn'; del.type = 'button'; del.textContent = 'Delete';
  del.addEventListener('click', () => {
    update({ saved: state.saved.filter((r) => r.id !== recipe.id) }, { resetChecks: false });
  });
  const cancel = document.createElement('button');
  cancel.className = 'link-btn'; cancel.type = 'button'; cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => render());
  wrap.append(label, del, cancel);
  row.appendChild(wrap);
}

/* ---------- prefs, wake lock, toast ---------- */

function applyPrefs() {
  const root = document.documentElement;
  if (state.prefs.theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', state.prefs.theme);
  if (state.prefs.large) root.setAttribute('data-large', '');
  else root.removeAttribute('data-large');
  $('theme-toggle').title = `Theme: ${state.prefs.theme}`;
  $('theme-toggle').textContent = { auto: '◐', light: '☀', dark: '☾' }[state.prefs.theme];
}

function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  state.prefs.theme = order[(order.indexOf(state.prefs.theme) + 1) % order.length];
  applyPrefs();
  persist();
}

async function setWakeLock(on) {
  try {
    if (on) {
      wakeLock = await navigator.wakeLock.request('screen');
    } else if (wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    $('wake-toggle').checked = false;
  }
}

function maybeOfferWakeLock() {
  if ('wakeLock' in navigator && !$('wake-toggle').checked) {
    $('wake-toggle').checked = true;
    setWakeLock(true);
    toast('Keeping the screen awake during the bake');
  }
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2500);
}
