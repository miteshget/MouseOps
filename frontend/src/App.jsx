import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import Sidebar        from './components/Sidebar';
import Dashboard      from './components/Dashboard';
import AddEditModal   from './components/AddEditModal';
import LogModal       from './components/LogModal';
import ActionsMenu    from './components/ActionsMenu';
import Toast          from './components/Toast';

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

function Shell() {
  const { toasts, cis } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [addModal, setAddModal]       = useState(null);  // null | {} | ci-object
  const [logModal, setLogModal]       = useState(null);  // null | { ciId, mod, stage, title }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
      {/* ── Left sidebar ─────────────────────────────────────── */}
      <Sidebar
        open={sidebarOpen}
        onOpenAdd={() => setAddModal({})}
      />

      {/* ── Main area ─────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Header */}
        <header className="flex items-center gap-3 px-4 py-2.5 bg-gray-900 text-white shadow-md z-10 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(v => !v)}
            className="p-1.5 rounded hover:bg-gray-700 transition-colors text-gray-300"
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <img src="/logo.png" alt="MouseOps" className="h-8 w-8 rounded-full object-cover" />
          <h1 className="font-semibold text-sm tracking-wide">MouseOps</h1>
          <span className="bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded uppercase tracking-widest">
            RHDP
          </span>

          <div className="ml-auto flex items-center gap-2">
            <ActionsMenu />
            <button
              onClick={() => setAddModal({})}
              className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors"
            >
              ＋ Add CI
            </button>
          </div>
        </header>

        {/* Dashboard */}
        <Dashboard
          onEdit={ci  => setAddModal(ci)}
          onOpenLog={opts => setLogModal(opts)}
        />
      </div>

      {/* ── Modals ────────────────────────────────────────────── */}
      {addModal !== null && (
        <AddEditModal ci={addModal?.id ? addModal : null} onClose={() => setAddModal(null)} />
      )}
      {logModal && (
        <LogModal {...logModal} onClose={() => setLogModal(null)} />
      )}

      {/* ── Toasts ────────────────────────────────────────────── */}
      <div className="fixed bottom-5 right-5 flex flex-col gap-2 z-50 pointer-events-none">
        {toasts.map(t => <Toast key={t.id} {...t} />)}
      </div>
    </div>
  );
}
