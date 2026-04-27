import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { getCIs, createCI, updateCI, deleteCI } from '../utils/api';
import { loadHistory, saveHistory, saveLastRun, getLastRun } from '../utils/storage';
import { loadVisibility, saveVisibility, mergeVisibility } from '../utils/storage';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }) {
  const [cis,       setCIs]       = useState([]);
  const [history,   setHistory]   = useState(loadHistory);
  const [visibility, setVisibility] = useState(null);  // merged after CIs load
  const [toasts,    setToasts]    = useState([]);

  // ── CI CRUD ────────────────────────────────────────────────────────────────
  const refreshCIs = useCallback(async () => {
    const data = await getCIs();
    setCIs(data);
    setVisibility(prev => {
      const merged = mergeVisibility(data, prev ?? loadVisibility());
      saveVisibility(merged);
      return merged;
    });
  }, []);

  useEffect(() => { refreshCIs(); }, [refreshCIs]);

  const addCI    = useCallback(async d => { await createCI(d); await refreshCIs(); }, [refreshCIs]);
  const editCI   = useCallback(async (id, d) => { await updateCI(id, d); await refreshCIs(); }, [refreshCIs]);
  const removeCI = useCallback(async id => {
    await deleteCI(id);
    setHistory(prev => { const n = { ...prev }; delete n[id]; saveHistory(n); return n; });
    await refreshCIs();
  }, [refreshCIs]);

  // ── Visibility ─────────────────────────────────────────────────────────────
  const setModuleVisible = useCallback((ciId, visible) => {
    setVisibility(prev => {
      const next = { ...prev, visible: { ...prev.visible, [ciId]: visible } };
      saveVisibility(next);
      return next;
    });
  }, []);

  const setAllVisible = useCallback((val) => {
    setVisibility(prev => {
      const next = { ...prev, visible: Object.fromEntries(Object.keys(prev.visible).map(k => [k, val])) };
      saveVisibility(next);
      return next;
    });
  }, []);

  const reorderTiles = useCallback((newOrder) => {
    setVisibility(prev => {
      const next = { ...prev, order: newOrder };
      saveVisibility(next);
      return next;
    });
  }, []);

  // ── Run history ────────────────────────────────────────────────────────────
  const setModuleState = useCallback((ciId, mod, stage, state) => {
    setHistory(prev => {
      const next = {
        ...prev,
        [ciId]: {
          ...(prev[ciId] || {}),
          [mod]: { solve: null, validate: null, ...(prev[ciId]?.[mod] || {}), [stage]: state },
        },
      };
      if (state !== 'running') saveHistory(next);
      if (state === 'ok' || state === 'fail') saveLastRun(ciId, mod, stage);
      return next;
    });
  }, []);

  const clearHistory = useCallback((ciId) => {
    setHistory(prev => {
      const next = { ...prev };
      if (ciId) delete next[ciId];
      else Object.keys(next).forEach(k => delete next[k]);
      saveHistory(next);
      return next;
    });
  }, []);

  // ── Toasts ─────────────────────────────────────────────────────────────────
  const toast = useCallback((msg, type = 'error') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }, []);

  return (
    <AppCtx.Provider value={{
      cis, refreshCIs, addCI, editCI, removeCI,
      visibility, setModuleVisible, setAllVisible, reorderTiles,
      history, setModuleState, clearHistory, getLastRun,
      toasts, toast,
    }}>
      {children}
    </AppCtx.Provider>
  );
}
