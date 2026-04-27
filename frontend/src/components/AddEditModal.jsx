import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';

export default function AddEditModal({ ci, onClose }) {
  const { addCI, editCI, toast } = useApp();
  const editing = !!ci?.id;

  const [name,    setName]    = useState(ci?.name    || '');
  const [url,     setUrl]     = useState(ci?.url     || '');
  const [token,   setToken]   = useState('');
  const [modules, setModules] = useState((ci?.modules || []).join(','));
  const [from,    setFrom]    = useState(0);
  const [to,      setTo]      = useState(5);
  const [saving,  setSaving]  = useState(false);

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const autoFill = () => {
    const mods = Array.from({ length: to - from + 1 }, (_, i) =>
      'module-' + String(from + i).padStart(2, '0')
    );
    setModules(mods.join(','));
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (!name.trim()) return;
    const modList = modules.trim()
      ? modules.split(',').map(m => m.trim()).filter(Boolean)
      : [];
    setSaving(true);
    try {
      if (editing) {
        await editCI(ci.id, { name: name.trim(), url: url.trim(), token: token.trim(), modules: modList });
      } else {
        await addCI({ name: name.trim(), url: url.trim(), token: token.trim(), modules: modList });
      }
      onClose();
    } catch (err) {
      toast(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">{editing ? 'Edit CI Instance' : 'Add CI Instance'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <Field label="Name" required>
            <input value={name} onChange={e => setName(e.target.value)} required
              placeholder="e.g. HOL RHEL10 – h9lhq"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </Field>

          <Field label="Showroom URL" required>
            <input value={url} onChange={e => setUrl(e.target.value)} required type="url"
              placeholder="https://showroom.apps.cluster.example.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </Field>

          <Field label={<>Auth Token <span className="text-gray-400 font-normal">(optional)</span></>}>
            <input value={token} onChange={e => setToken(e.target.value)} type="password"
              placeholder={editing ? 'Leave blank to keep existing' : 'Bearer token if required'}
              autoComplete="off"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </Field>

          <Field label="Modules">
            <input value={modules} onChange={e => setModules(e.target.value)}
              placeholder="module-01,module-02,module-03"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500">
              Auto-fill from
              <input type="number" value={from} onChange={e => setFrom(+e.target.value)} min={0} max={99}
                className="w-12 border border-gray-300 rounded px-1.5 py-1 text-center focus:outline-none focus:ring-1 focus:ring-blue-400" />
              to
              <input type="number" value={to}   onChange={e => setTo(+e.target.value)}   min={0} max={99}
                className="w-12 border border-gray-300 rounded px-1.5 py-1 text-center focus:outline-none focus:ring-1 focus:ring-blue-400" />
              <button type="button" onClick={autoFill}
                className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-600 transition-colors">
                Fill
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">Leave blank to type module names manually per action.</p>
          </Field>

          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-colors disabled:opacity-50">
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add CI'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
