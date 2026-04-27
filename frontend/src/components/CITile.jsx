import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useApp }        from '../context/AppContext';
import { useStream }     from '../hooks/useStream';
import { useSeqWatch }   from '../hooks/useSeqWatch';
import { startSeq, stopSeq, sendDecision, getActiveRuns, getSeqRuns, getLog } from '../utils/api';
import { getLastRun } from '../utils/storage';
import ModuleSummary from './ModuleSummary';
import StepList      from './StepList';
import LogPanel      from './LogPanel';

const statusColor = {
  idle:    'text-gray-400',
  running: 'text-blue-500',
  success: 'text-emerald-600',
  failed:  'text-red-600',
};

export default function CITile({ ci, onEdit, onOpenLog }) {
  const { history, setModuleState, clearHistory, removeCI, toast } = useApp();
  const stream = useStream(ci.id);

  const [seqActive,    setSeqActive]      = useState(false);
  const [seqStatus,    setSeqStatusRaw]   = useState({ text: '', type: 'idle' });
  const [paused,       setPaused]         = useState(null);

  const setSeqStatus = useCallback((text, type) => setSeqStatusRaw({ text, type }), []);

  const displayStatus = seqActive ? seqStatus : stream.status;

  const accent = useMemo(() => {
    const t = displayStatus.type;
    if (t === 'running') return 'border-t-blue-500';
    if (t === 'success') return 'border-t-emerald-500';
    if (t === 'failed')  return 'border-t-red-500';
    return 'border-t-transparent';
  }, [displayStatus.type]);

  // ── Module selector state ─────────────────────────────────────────────────
  const mods = ci.modules || [];
  const [selectedMod, setSelectedMod] = useState(mods[0] || '');
  const [seqFrom, setSeqFrom] = useState(0);
  const [seqTo,   setSeqTo]   = useState(Math.max(0, mods.length - 1));

  const getModRange = useCallback(() => {
    if (mods.length > 1) return mods.slice(seqFrom, seqTo + 1);
    const f = +seqFrom || 0;
    const t = Math.max(f, +seqTo || f);
    return Array.from({ length: t - f + 1 }, (_, i) => 'module-' + String(f + i).padStart(2, '0'));
  }, [mods, seqFrom, seqTo]);

  // ── Module state recording ────────────────────────────────────────────────
  const recordOutcome = useCallback((mod, stage, outcome) => {
    if (outcome === 'stopped') return;
    setModuleState(ci.id, mod, stage, outcome === 'ok' ? 'ok' : 'fail');
    stream.setStatus({
      text: outcome === 'ok' ? `✅ ${stage} completed` : `❌ ${stage} failed`,
      type: outcome === 'ok' ? 'success' : 'failed',
    });
  }, [ci.id, setModuleState, stream]);

  // ── Individual run ────────────────────────────────────────────────────────
  const runSingle = useCallback(async (stage) => {
    const mod = selectedMod || mods[0] || 'module-01';
    setModuleState(ci.id, mod, stage, 'running');
    const outcome = await stream.startStream(stage, mod);
    recordOutcome(mod, stage, outcome);
  }, [ci.id, selectedMod, mods, stream, setModuleState, recordOutcome]);

  // ── Sequential run ────────────────────────────────────────────────────────
  const startSequential = useCallback(async (mode) => {
    const runMods = getModRange();
    if (!runMods.length) { toast('No modules to run.', 'info'); return; }
    try {
      await startSeq(ci.id, { mode, mods: runMods });
      setSeqActive(true);
      setSeqStatus('Starting sequential run…', 'running');
    } catch (e) { toast(e.message); }
  }, [ci.id, getModRange, toast, setSeqStatus]);

  const stopSequential = useCallback(() => {
    setSeqActive(false);
    stopSeq(ci.id).catch(() => {});
    stream.stopStream();
    setPaused(null);
    setSeqStatus('⏸ Stopped', 'idle');
  }, [ci.id, stream, setSeqStatus]);

  const resolveSkip = useCallback(async (decision) => {
    setPaused(null);
    await sendDecision(ci.id, { decision }).catch(() => {});
    if (decision === 'stop') { setSeqActive(false); setSeqStatus('⏸ Stopped', 'idle'); }
  }, [ci.id, setSeqStatus]);

  // ── Sequential watcher ────────────────────────────────────────────────────
  useSeqWatch({
    ciId:             ci.id,
    enabled:          seqActive,
    startStream:      stream.startStream,
    isRunning:        stream.isRunning,
    setSeqStatus,
    setPaused,
    onModuleStart:    (mod, stage) => {
      setModuleState(ci.id, mod, stage, 'running');  // shows spinner in summary table
    },
    onModuleComplete: (mod, stage, outcome) => {
      setModuleState(ci.id, mod, stage, outcome === 'ok' ? 'ok' : 'fail');
    },
    onDone: () => {
      setSeqActive(false);
      setSeqStatus('✅ Sequential run complete', 'success');
    },
  });

  // ── Reconnect on mount (survives page refresh) ────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Sequential runs take priority — server owns the loop
        const seqRuns = await getSeqRuns().catch(() => []);
        const mySeq   = seqRuns.find(r => r.ci_id === ci.id);
        if (mySeq && !cancelled) {
          toast(`Reconnected to sequential ${mySeq.mode} run`, 'info');
          setSeqActive(true);
          setSeqStatus(
            `Reconnecting at module ${mySeq.currentIdx + 1}/${mySeq.total}…`,
            'running'
          );
          return;
        }

        // Individual stream still running on server
        const activeRuns = await getActiveRuns().catch(() => []);
        const myRun = activeRuns.find(r => r.ci_id === ci.id);
        if (myRun && !cancelled) {
          setModuleState(ci.id, myRun.module, myRun.stage, 'running');
          const outcome = await stream.startStream(myRun.stage, myRun.module);
          if (!cancelled) recordOutcome(myRun.module, myRun.stage, outcome);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load last log ─────────────────────────────────────────────────────────
  const handleLoadLog = useCallback(async () => {
    const last = getLastRun(ci.id);
    if (!last) { toast('No recorded log yet.', 'info'); return; }
    const text = await getLog(ci.id, last.stage, last.module);
    if (!text) { toast('No log file found on server.', 'info'); return; }
    onOpenLog({ title: `${ci.name} — ${last.stage} ${last.module}`, content: text });
  }, [ci.id, ci.name, onOpenLog, toast]);

  const ciHistory = history[ci.id] || {};

  return (
    <div className={`tile-enter bg-white rounded-lg shadow-sm border border-gray-200 border-t-4 ${accent} overflow-hidden flex flex-col`}>

      {/* ── Card header ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
        <div className="min-w-0 flex-1">
          <p className="font-bold text-sm text-gray-800 truncate">{ci.name}</p>
          <span className="inline-block mt-1 text-xs text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5 max-w-full truncate">
            {ci.url.replace(/^https?:\/\//, '')}
          </span>
        </div>
        <div className="flex gap-1 ml-2 flex-shrink-0">
          <IconBtn title="Load last log"   onClick={handleLoadLog}             icon="📄" />
          <IconBtn title="Clear results"   onClick={() => clearHistory(ci.id)} icon="🗑" />
          <IconBtn title="Edit"            onClick={onEdit}                    icon="✎" />
          <IconBtn title="Remove" danger
            onClick={() => { if (confirm(`Remove "${ci.name}"?`)) removeCI(ci.id); }}
            icon="✕" />
        </div>
      </div>

      {/* ── Card body ────────────────────────────────────────────────────── */}
      <div className="flex-1 px-4 pb-4 pt-3 space-y-3">

        {/* INDIVIDUAL EXECUTION */}
        <SectionLabel color="green">Individual Execution</SectionLabel>
        <div className="bg-emerald-50 border border-emerald-200 rounded-md p-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 w-14 shrink-0">Module:</span>
            {mods.length > 0 ? (
              <select value={selectedMod} onChange={e => setSelectedMod(e.target.value)}
                className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-400">
                {mods.map(m => <option key={m}>{m}</option>)}
              </select>
            ) : (
              <input value={selectedMod} onChange={e => setSelectedMod(e.target.value)}
                placeholder="module-01"
                className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-400" />
            )}
          </div>
          <div className="flex gap-2">
            <ActionBtn color="green" onClick={() => runSingle('solve')}    disabled={stream.isRunning || seqActive}>🚀 Solve</ActionBtn>
            <ActionBtn color="blue"  onClick={() => runSingle('validate')} disabled={stream.isRunning || seqActive}>✓ Validate</ActionBtn>
          </div>
        </div>

        {/* SEQUENTIAL EXECUTION */}
        <SectionLabel color="purple">Sequential Execution</SectionLabel>
        <div className="bg-purple-50 border border-purple-200 rounded-md p-2.5 space-y-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-gray-500 shrink-0">Range:</span>
            <span className="text-xs text-gray-500">from</span>
            {mods.length > 1 ? (
              <>
                <select value={seqFrom} onChange={e => setSeqFrom(+e.target.value)} disabled={seqActive}
                  className="text-xs border border-gray-300 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-purple-400 max-w-28 disabled:opacity-50">
                  {mods.map((m, i) => <option key={m} value={i}>{m}</option>)}
                </select>
                <span className="text-xs text-gray-500">to</span>
                <select value={seqTo} onChange={e => setSeqTo(+e.target.value)} disabled={seqActive}
                  className="text-xs border border-gray-300 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-purple-400 max-w-28 disabled:opacity-50">
                  {mods.map((m, i) => <option key={m} value={i}>{m}</option>)}
                </select>
              </>
            ) : (
              <>
                <input type="number" value={seqFrom} onChange={e => setSeqFrom(+e.target.value)} min={0} max={99} disabled={seqActive}
                  className="w-14 text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-purple-400 disabled:opacity-50" />
                <span className="text-xs text-gray-500">to</span>
                <input type="number" value={seqTo}   onChange={e => setSeqTo(+e.target.value)}   min={0} max={99} disabled={seqActive}
                  className="w-14 text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-purple-400 disabled:opacity-50" />
              </>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            <ActionBtn color="green"  onClick={() => startSequential('solve')}    disabled={stream.isRunning || seqActive} small>▶ Solve</ActionBtn>
            <ActionBtn color="blue"   onClick={() => startSequential('validate')} disabled={stream.isRunning || seqActive} small>▶ Validate</ActionBtn>
            <ActionBtn color="purple" onClick={() => startSequential('both')}     disabled={stream.isRunning || seqActive} small>▶▶ Both</ActionBtn>
            {(stream.isRunning || seqActive) && (
              <ActionBtn color="gray" onClick={stopSequential} small>■ Stop</ActionBtn>
            )}
          </div>
        </div>

        {/* Module summary */}
        {Object.keys(ciHistory).length > 0 && (
          <ModuleSummary ciId={ci.id} mods={mods} onOpenLog={onOpenLog} />
        )}

        {/* Status line */}
        {displayStatus.text && (
          <div className={`flex items-center gap-1.5 text-xs font-medium ${statusColor[displayStatus.type] || 'text-gray-400'}`}>
            {displayStatus.type === 'running' && <Spinner />}
            <span>{displayStatus.text}</span>
          </div>
        )}

        {/* Skip / Rerun / Stop banner */}
        {paused && (
          <div className="flex items-center gap-2 flex-wrap bg-amber-50 border border-amber-300 rounded-md p-2.5 text-xs">
            <span className="font-semibold text-amber-800 flex-1 min-w-0">
              {paused.stage} failed on {paused.mod} — what next?
            </span>
            <button onClick={() => resolveSkip('rerun')} className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 text-gray-700 transition-colors">🔄 Rerun</button>
            <button onClick={() => resolveSkip('skip')}  className="px-2 py-1 rounded bg-purple-600 hover:bg-purple-700 text-white transition-colors">⏭ Skip</button>
            <button onClick={() => resolveSkip('stop')}  className="px-2 py-1 rounded bg-red-100 hover:bg-red-200 text-red-700 transition-colors">■ Stop</button>
          </div>
        )}

        {/* Step chips */}
        {stream.steps.length > 0 && <StepList steps={stream.steps} />}

        {/* Log panel */}
        {stream.log && (
          <LogPanel
            log={stream.log}
            onExpand={() => onOpenLog({
              title:   `${ci.name} — ${stream.currentStage} ${stream.currentMod}`,
              content: stream.log,
            })}
          />
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function SectionLabel({ color, children }) {
  const map = { green: 'text-emerald-700 border-emerald-300', purple: 'text-purple-700 border-purple-300' };
  return <p className={`text-xs font-bold uppercase tracking-widest pb-1 border-b ${map[color]}`}>{children}</p>;
}

function ActionBtn({ color, onClick, disabled, children, small }) {
  const size  = small ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-xs';
  const cols  = { green:'bg-emerald-600 hover:bg-emerald-700 text-white', blue:'bg-blue-600 hover:bg-blue-700 text-white', purple:'bg-purple-600 hover:bg-purple-700 text-white', gray:'bg-gray-200 hover:bg-gray-300 text-gray-700' };
  return (
    <button onClick={onClick} disabled={disabled}
      className={`${size} ${cols[color]} rounded font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed`}>
      {children}
    </button>
  );
}

function IconBtn({ icon, onClick, title, danger }) {
  return (
    <button title={title} onClick={onClick}
      className={`w-7 h-7 flex items-center justify-center rounded text-sm transition-colors ${danger ? 'text-gray-400 hover:text-red-600 hover:bg-red-50' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-200'}`}>
      {icon}
    </button>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
