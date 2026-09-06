// localStorage wrapper. Versioned envelope, every access wrapped in try/catch
// so the calculator still works when storage is blocked (private mode, etc.).

const KEY = 'sourdough.v1';

export function storageAvailable() {
  try {
    localStorage.setItem('__sd_test', '1');
    localStorage.removeItem('__sd_test');
    return true;
  } catch {
    return false;
  }
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return migrate(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function save(data) {
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
