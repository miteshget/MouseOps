import React, { useState } from 'react';
import { login } from '../utils/api';

export default function LoginModal({ onSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login({ username: username.trim(), password });
      onSuccess(user);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900 flex items-center justify-center z-50">
      <div className="w-full max-w-sm">
        {/* Logo + title */}
        <div className="flex flex-col items-center mb-8 gap-3">
          <img src="/logo.png" alt="MouseOps" className="w-16 h-16 rounded-full shadow-lg" />
          <h1 className="text-2xl font-bold text-white">MouseOps</h1>
          <span className="text-gray-400 text-sm">Showroom E2E Test Runner</span>
        </div>

        <form onSubmit={handleSubmit}
          className="bg-gray-800 border border-gray-700 rounded-xl px-8 py-8 shadow-2xl space-y-5">
          <h2 className="text-white font-semibold text-lg text-center">Sign in</h2>

          {error && (
            <div className="bg-red-900/50 border border-red-700 text-red-300 text-sm px-4 py-2.5 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Username</label>
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoFocus
              autoComplete="username"
              className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-gray-500"
              placeholder="admin"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-gray-600 text-xs mt-4">
          Default: admin / mouseops
        </p>
      </div>
    </div>
  );
}
