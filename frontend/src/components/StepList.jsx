import React from 'react';

const cls = { ok:'step-ok', changed:'step-changed', fail:'step-fail', pending:'step-pending' };

export default function StepList({ steps }) {
  if (!steps.length) return null;
  return (
    <ul className="space-y-1 max-h-44 overflow-y-auto">
      {steps.map(s => (
        <li key={s.id} className={`${cls[s.status] || cls.pending} text-xs px-2.5 py-1 rounded flex items-center gap-1.5`}>
          <span className="flex-1 truncate">{s.text}</span>
        </li>
      ))}
    </ul>
  );
}
