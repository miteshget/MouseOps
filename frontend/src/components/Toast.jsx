import React from 'react';

const styles = {
  error: 'bg-red-900 text-red-100',
  info:  'bg-blue-900 text-blue-100',
  ok:    'bg-emerald-900 text-emerald-100',
};

export default function Toast({ msg, type = 'error' }) {
  return (
    <div className={`pointer-events-auto max-w-xs px-4 py-2.5 rounded-lg shadow-lg text-sm animate-[slideIn_.2s_ease] ${styles[type] || styles.error}`}>
      {msg}
    </div>
  );
}
