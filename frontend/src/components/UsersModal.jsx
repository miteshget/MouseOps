import React, { useState, useEffect } from 'react';
import { listUsers, createUser, updateUser, deleteUser, changePassword } from '../utils/api';
import { useApp } from '../context/AppContext';

export default function UsersModal({ onClose }) {
  const { user: me, toast } = useApp();
  const [users,   setUsers]   = useState([]);
  const [tab,     setTab]     = useState('users');  // 'users' | 'password'
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try { setUsers(await listUsers()); }
    catch (e) { toast(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []); // eslint-disable-line

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Account Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-5 gap-4">
          {me?.role === 'admin' && (
            <TabBtn active={tab === 'users'} onClick={() => setTab('users')}>Users</TabBtn>
          )}
          <TabBtn active={tab === 'password'} onClick={() => setTab('password')}>Change Password</TabBtn>
        </div>

        <div className="p-5">
          {tab === 'users' && me?.role === 'admin' && (
            <UsersTab users={users} me={me} onRefresh={refresh} loading={loading} />
          )}
          {tab === 'password' && <PasswordTab onClose={onClose} />}
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${active ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
    >
      {children}
    </button>
  );
}

// ── Users tab ─────────────────────────────────────────────────────────────────
function UsersTab({ users, me, onRefresh, loading }) {
  const { toast } = useApp();
  const [showAdd, setShowAdd] = useState(false);

  const handleDelete = async (username) => {
    if (!confirm(`Delete user "${username}"?`)) return;
    try { await deleteUser(username); await onRefresh(); toast(`Deleted ${username}`, 'info'); }
    catch (e) { toast(e.message); }
  };

  const handleRoleToggle = async (username, currentRole) => {
    const newRole = currentRole === 'admin' ? 'viewer' : 'admin';
    try { await updateUser(username, { role: newRole }); await onRefresh(); }
    catch (e) { toast(e.message); }
  };

  if (loading) return <p className="text-gray-400 text-sm text-center py-4">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-xs font-bold uppercase tracking-wider">
              <th className="text-left px-3 py-2">Username</th>
              <th className="text-left px-3 py-2">Role</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.username} className="border-t border-gray-100">
                <td className="px-3 py-2.5 font-medium text-gray-700">
                  {u.username}
                  {u.username === me?.username && <span className="ml-2 text-xs text-gray-400">(you)</span>}
                </td>
                <td className="px-3 py-2.5">
                  <button
                    onClick={() => handleRoleToggle(u.username, u.role)}
                    disabled={u.username === me?.username}
                    title={u.username === me?.username ? "Cannot change your own role" : "Click to toggle role"}
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full cursor-pointer disabled:cursor-default transition-colors ${u.role === 'admin' ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'} disabled:opacity-60`}
                  >
                    {u.role}
                  </button>
                </td>
                <td className="px-3 py-2.5 text-right">
                  {u.username !== me?.username && (
                    <button
                      onClick={() => handleDelete(u.username)}
                      className="text-xs text-red-500 hover:text-red-700 transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd ? (
        <AddUserForm onDone={() => { setShowAdd(false); onRefresh(); }} onCancel={() => setShowAdd(false)} />
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="w-full border-2 border-dashed border-gray-300 hover:border-blue-400 text-gray-400 hover:text-blue-500 rounded-lg py-2 text-sm font-medium transition-colors"
        >
          ＋ Add user
        </button>
      )}
    </div>
  );
}

function AddUserForm({ onDone, onCancel }) {
  const { toast } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole]         = useState('viewer');
  const [saving, setSaving]     = useState(false);

  const submit = async e => {
    e.preventDefault();
    setSaving(true);
    try {
      await createUser({ username: username.trim(), password, role });
      toast(`User "${username}" created`, 'info');
      onDone();
    } catch (err) {
      toast(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="border border-blue-200 bg-blue-50 rounded-lg p-4 space-y-3">
      <p className="text-sm font-semibold text-blue-700">New user</p>
      <div className="grid grid-cols-2 gap-3">
        <input value={username} onChange={e => setUsername(e.target.value)} required placeholder="username"
          className="col-span-2 border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="password"
          className="border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
        <select value={role} onChange={e => setRole(e.target.value)}
          className="border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white">
          <option value="viewer">viewer</option>
          <option value="admin">admin</option>
        </select>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
        <button type="submit" disabled={saving} className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50">
          {saving ? 'Creating…' : 'Create'}
        </button>
      </div>
    </form>
  );
}

// ── Change password tab ───────────────────────────────────────────────────────
function PasswordTab({ onClose }) {
  const { toast } = useApp();
  const [current,  setCurrent]  = useState('');
  const [next,     setNext]     = useState('');
  const [confirm2, setConfirm2] = useState('');
  const [saving,   setSaving]   = useState(false);

  const submit = async e => {
    e.preventDefault();
    if (next !== confirm2) { toast('New passwords do not match'); return; }
    setSaving(true);
    try {
      await changePassword({ current_password: current, new_password: next });
      toast('Password changed successfully', 'info');
      onClose();
    } catch (err) {
      toast(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Current password">
        <input type="password" value={current} onChange={e => setCurrent(e.target.value)} required autoComplete="current-password"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </Field>
      <Field label="New password">
        <input type="password" value={next} onChange={e => setNext(e.target.value)} required autoComplete="new-password"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </Field>
      <Field label="Confirm new password">
        <input type="password" value={confirm2} onChange={e => setConfirm2(e.target.value)} required autoComplete="new-password"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </Field>
      <div className="flex justify-end gap-3 pt-1 border-t border-gray-100">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
        <button type="submit" disabled={saving}
          className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50">
          {saving ? 'Saving…' : 'Update password'}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
