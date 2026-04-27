import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import Sidebar        from './components/Sidebar';
import Dashboard      from './components/Dashboard';
import AddEditModal   from './components/AddEditModal';
import LogModal       from './components/LogModal';
import ActionsMenu    from './components/ActionsMenu';
import Toast          from './components/Toast';
import LoginModal     from './components/LoginModal';
import UsersModal     from './components/UsersModal';

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

function Shell() {
  const { toasts, readonly, user, loginRequired, onLoginSuccess, doLogout } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [addModal,    setAddModal]    = useState(null);
  const [logModal,    setLogModal]    = useState(null);
  const [usersOpen,   setUsersOpen]   = useState(false);

  // First-ever load — nothing to show yet
  if (!user && !loginRequired) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-900">
        <svg className="animate-spin w-8 h-8 text-gray-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
        </svg>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100 relative">
      <Sidebar open={sidebarOpen} onOpenAdd={() => setAddModal({})} />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Header */}
        <header className="flex items-center gap-3 px-4 py-2.5 bg-gray-900 text-white shadow-md z-10 flex-shrink-0">
          <button onClick={() => setSidebarOpen(v => !v)}
            className="p-1.5 rounded hover:bg-gray-700 transition-colors text-gray-300">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <img src="/logo.png" alt="MouseOps" className="h-8 w-8 rounded-full object-cover" />
          <h1 className="font-semibold text-sm tracking-wide">MouseOps</h1>
          <span className="bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded uppercase tracking-widest">RHDP</span>

          <div className="ml-auto flex items-center gap-2">
            {/* Read-only badge */}
            {readonly && (
              <span className="flex items-center gap-1.5 bg-amber-500/20 border border-amber-400/40 text-amber-300 text-xs font-semibold px-3 py-1.5 rounded">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
                </svg>
                Read-only
              </span>
            )}

            {/* Viewer badge */}
            {!readonly && user?.role === 'viewer' && (
              <span className="text-xs text-gray-400 border border-gray-600 px-2 py-1 rounded">
                👁 View only
              </span>
            )}

            {!readonly && user?.role === 'admin' && <ActionsMenu />}
            {!readonly && user?.role === 'admin' && (
              <button onClick={() => setAddModal({})}
                className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors">
                ＋ Add Showroom
              </button>
            )}

            {/* User menu */}
            <button onClick={() => setUsersOpen(true)}
              className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white border border-gray-600 hover:border-gray-400 px-2.5 py-1.5 rounded transition-colors">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd"/>
              </svg>
              {user?.username}
            </button>

            <button onClick={doLogout}
              className="text-xs text-gray-400 hover:text-white transition-colors px-2 py-1.5">
              Sign out
            </button>
          </div>
        </header>

        <Dashboard onEdit={ci => setAddModal(ci)} onOpenLog={opts => setLogModal(opts)} />
      </div>

      {/* Login overlay — tiles stay mounted so streams keep running */}
      {loginRequired && (
        <div className="absolute inset-0 z-50">
          <LoginModal onSuccess={onLoginSuccess} />
        </div>
      )}

      {/* Modals */}
      {addModal !== null && user?.role === 'admin' && !readonly && (
        <AddEditModal ci={addModal?.id ? addModal : null} onClose={() => setAddModal(null)} />
      )}
      {logModal && <LogModal {...logModal} onClose={() => setLogModal(null)} />}
      {usersOpen && <UsersModal onClose={() => setUsersOpen(false)} />}

      {/* Toasts */}
      <div className="fixed bottom-5 right-5 flex flex-col gap-2 z-50 pointer-events-none">
        {toasts.map(t => <Toast key={t.id} {...t} />)}
      </div>
    </div>
  );
}
