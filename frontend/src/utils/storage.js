const HISTORY_KEY    = 'mouseops-run-history';
const VISIBILITY_KEY = 'mouseops-visibility';
const LAST_RUN_KEY   = 'mouseops-last-run';

// ── Run history ───────────────────────────────────────────────────────────────
export function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}'); }
  catch { return {}; }
}

export function saveHistory(history) {
  const clean = {};
  Object.entries(history).forEach(([ciId, mods]) => {
    clean[ciId] = {};
    Object.entries(mods).forEach(([mod, s]) => {
      clean[ciId][mod] = {
        solve:    s.solve    === 'running' ? null : s.solve,
        validate: s.validate === 'running' ? null : s.validate,
      };
    });
  });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(clean));
}

export function saveLastRun(ciId, mod, stage) {
  const d = JSON.parse(localStorage.getItem(LAST_RUN_KEY) || '{}');
  d[ciId] = { module: mod, stage };
  localStorage.setItem(LAST_RUN_KEY, JSON.stringify(d));
}

export function getLastRun(ciId) {
  try { return JSON.parse(localStorage.getItem(LAST_RUN_KEY) || '{}')[ciId] || null; }
  catch { return null; }
}

// ── Tile visibility / order ────────────────────────────────────────────────────
export function loadVisibility() {
  try { return JSON.parse(localStorage.getItem(VISIBILITY_KEY) || 'null'); }
  catch { return null; }
}

export function saveVisibility(data) {
  localStorage.setItem(VISIBILITY_KEY, JSON.stringify(data));
}

/**
 * Merge saved visibility prefs with the freshly-fetched CI list.
 * New CIs (not in saved prefs) default to visible.
 * Returns { order: [id,...], visible: {id: bool} }
 */
export function mergeVisibility(cis, saved) {
  const ids = cis.map(c => c.id);
  if (!saved) {
    return {
      order:   ids,
      visible: Object.fromEntries(ids.map(id => [id, true])),
    };
  }
  // Preserve saved order; append new ids at the end
  const savedSet = new Set(saved.order);
  const newIds   = ids.filter(id => !savedSet.has(id));
  const order    = [...saved.order.filter(id => ids.includes(id)), ...newIds];
  // Prune deleted CI entries and add new ones
  const visible  = Object.fromEntries(
    Object.entries(saved.visible).filter(([id]) => ids.includes(id))
  );
  newIds.forEach(id => { visible[id] = true; });
  return { order, visible };
}
