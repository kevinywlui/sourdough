// localStorage wrapper. Versioned envelope, every access wrapped in try/catch
// so the calculator still works when storage is blocked (private mode, etc.).
(function (global, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.LoafStorage = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KEY = 'sourdough.v1';

  function storageAvailable() {
    try {
      localStorage.setItem('__sd_test', '1');
      localStorage.removeItem('__sd_test');
      return true;
    } catch {
      return false;
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return migrate(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  function save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ version: 1, ...data }));
    } catch {
      // storage full or blocked — degrade silently, app keeps working in memory
    }
  }

  function migrate(raw) {
    if (!raw || typeof raw !== 'object') return null;
    switch (raw.version) {
      case 1:
        return raw;
      default:
        return null;
    }
  }

  return { storageAvailable, load, save };
});
