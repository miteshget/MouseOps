import React from 'react';
import { useApp } from '../context/AppContext';
import { getLog } from '../utils/api';

const badge = {
  ok:      'bg-emerald-100 text-emerald-800 border border-emerald-200',
  fail:    'bg-red-100     text-red-800     border border-red-200',
  running: 'bg-blue-100   text-blue-700    border border-blue-200',
};

export default function ModuleSummary({ ciId, mods, onOpenLog }) {
  const { history } = useApp();
  const ciHistory = history[ciId] || {};
  const entries   = Object.entries(ciHistory);
  if (!entries.length) return null;

  const configuredSet = new Set(mods);

  return (
    <div className="border border-gray-200 rounded-md overflow-hidden text-xs shadow-sm">
      <div className="grid grid-cols-[1fr_auto_auto] bg-gray-100 text-gray-500 font-bold uppercase tracking-wider text-[0.6rem] px-3 py-1.5 gap-3">
        <span>Module</span><span>Solve</span><span>Validate</span>
      </div>
      {entries.map(([mod, s], i) => {
        const stale = configuredSet.size > 0 && !configuredSet.has(mod);
        return (
          <div key={mod} className={`grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-1.5 border-t border-gray-100 ${i % 2 === 0 ? '' : 'bg-gray-50'} ${stale ? 'opacity-50' : ''}`}>
            <span className={`font-mono text-xs truncate ${stale ? 'line-through' : ''}`}>
              {mod}{stale && <span title="Module no longer configured" className="ml-1 text-amber-500">⚠</span>}
            </span>
            <BadgeCell state={s.solve}    ciId={ciId} mod={mod} stage="solve"    onOpenLog={onOpenLog} />
            <BadgeCell state={s.validate} ciId={ciId} mod={mod} stage="validate" onOpenLog={onOpenLog} />
          </div>
        );
      })}
    </div>
  );
}

function BadgeCell({ state, ciId, mod, stage, onOpenLog }) {
  if (!state) return <span className="text-gray-300 text-center">—</span>;

  const isRunning = state === 'running';
  const label = state === 'ok' ? '✅ Pass' : state === 'fail' ? '❌ Fail' : null;
  const cls   = badge[state] || 'bg-gray-100 text-gray-500';

  const handleLog = async () => {
    const text = await getLog(ciId, stage, mod);
    if (text) onOpenLog({ title: `${stage} ${mod}`, content: text });
  };

  return (
    <div className="flex items-center gap-1 justify-end">
      <span className={`px-1.5 py-0.5 rounded text-[0.65rem] font-semibold whitespace-nowrap flex items-center gap-1 ${cls}`}>
        {isRunning ? (
          <>
            <svg className="animate-spin w-2.5 h-2.5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
            </svg>
            running
          </>
        ) : label}
      </span>
      {!isRunning && (
        <button onClick={handleLog} title="View log"
          className="text-gray-300 hover:text-gray-600 transition-colors text-xs leading-none">
          📄
        </button>
      )}
    </div>
  );
}
