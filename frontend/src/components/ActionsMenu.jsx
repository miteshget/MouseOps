import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { startSeq, createCI } from '../utils/api';

export default function ActionsMenu() {
  const { cis, clearHistory, toast, refreshCIs } = useApp();
  const [open, setOpen] = useState(false);
  const ref  = useRef(null);

  useEffect(() => {
    const h = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const bulkSeq = async (mode) => {
    setOpen(false);
    for (const ci of cis) {
      const mods = ci.modules || [];
      if (!mods.length) continue;
      try { await startSeq(ci.id, { mode, mods }); }
      catch (e) {
        const msg = (e?.message || '').toLowerCase().includes('already active')
          ? `Sequential run already active for ${ci.name}`
          : `Failed to start seq run for ${ci.name}: ${e?.message || 'unknown error'}`;
        toast(msg);
      }
    }
    toast(`Sequential ${mode} started for all CIs`, 'info');
  };

  const exportConfig = async () => {
    setOpen(false);
    const data = cis.map(({ id, ...rest }) => rest);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `mouseops-config-${new Date().toISOString().slice(0, 10)}.json`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importConfig = async (file) => {
    setOpen(false);
    if (!file) return;
    let configs;
    try { configs = JSON.parse(await file.text()); }
    catch { toast('Invalid JSON file'); return; }
    if (!Array.isArray(configs)) { toast('Expected a JSON array'); return; }
    let added = 0;
    for (const cfg of configs) {
      if (!cfg.name || !cfg.url) continue;
      try { await createCI({ name: cfg.name, url: cfg.url, token: cfg.token || '', modules: cfg.modules || [] }); added++; }
      catch { /* skip */ }
    }
    await refreshCIs();
    toast(`Imported ${added} CI(s)`, 'info');
  };

  const MenuItem = ({ children, onClick, danger }) => (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-gray-100 transition-colors ${danger ? 'text-red-600' : 'text-gray-700'}`}
    >
      {children}
    </button>
  );

  const MenuSection = ({ label }) => (
    <div className="px-3 py-1 text-xs font-bold uppercase tracking-widest text-gray-400 bg-gray-50">{label}</div>
  );

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="border border-white/30 text-white text-xs font-medium px-3 py-1.5 rounded hover:bg-white/10 transition-colors"
      >
        Actions ▾
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden z-50">
          <MenuSection label="Sequential" />
          <MenuItem onClick={() => bulkSeq('solve')}>    ▶ Solve All    <span className="ml-auto text-xs text-gray-400">full range</span></MenuItem>
          <MenuItem onClick={() => bulkSeq('validate')}> ▶ Validate All <span className="ml-auto text-xs text-gray-400">full range</span></MenuItem>
          <MenuItem onClick={() => bulkSeq('both')}>     ▶▶ Run All    <span className="ml-auto text-xs text-gray-400">solve→validate</span></MenuItem>

          <div className="border-t border-gray-100" />
          <MenuSection label="Config" />
          <MenuItem onClick={exportConfig}>⬇ Export Config</MenuItem>
          <MenuItem onClick={() => { setOpen(false); document.getElementById('import-file-input')?.click(); }}>
            ⬆ Import Config
          </MenuItem>
          <input id="import-file-input" type="file" accept=".json" className="hidden"
            onChange={e => { importConfig(e.target.files?.[0]); e.target.value = ''; }} />

          <div className="border-t border-gray-100" />
          <MenuSection label="Results" />
          <MenuItem danger onClick={() => {
            setOpen(false);
            if (confirm('Clear all test results?')) clearHistory(null);
          }}>
            🗑 Clear All Results
          </MenuItem>
        </div>
      )}
    </div>
  );
}
