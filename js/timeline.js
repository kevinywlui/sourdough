// Pure timeline math. No DOM. UMD-style: plain <script> in the browser,
// require() in node tests.
//
// Bulk fermentation scales with temperature (rate roughly doubles per ~8°C)
// and inoculation (more starter → faster, ~square-root sensitivity).
// Baseline: 7 h at 22°C with 20% starter. This is a guide, not a lab.
(function (global, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.LoafTimeline = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  function bulkHours(tempC, starterPct) {
    const t = 7 * Math.pow(2, (22 - tempC) / 8) * Math.sqrt(20 / starterPct);
    return clamp(t, 3, 14);
  }

  const toQuarterHour = (hours) => Math.round((hours * 60) / 15) * 15;

  // → [{id, label, minutes, note?}]
  function schedule(tempC, starterPct) {
    const bulk = bulkHours(tempC, starterPct);
    const proof = clamp(0.4 * bulk, 1.5, 4);
    return [
      { id: 'mix', label: 'Mix & autolyse', minutes: 45 },
      { id: 'bulk', label: 'Bulk ferment', minutes: toQuarterHour(bulk) },
      { id: 'shape', label: 'Shape & pan', minutes: 15 },
      { id: 'proof', label: 'Final proof', minutes: toQuarterHour(proof), note: 'or 8–14 h in the fridge' },
      { id: 'bake', label: 'Bake', minutes: 45, note: '~220°C · 20 min lidded/steam, then vented' },
      { id: 'cool', label: 'Cool before slicing', minutes: 120 },
    ];
  }

  function formatDuration(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m} min`;
    if (m === 0) return `${h} h`;
    return `${h} h ${m} m`;
  }

  return { bulkHours, schedule, formatDuration };
});
