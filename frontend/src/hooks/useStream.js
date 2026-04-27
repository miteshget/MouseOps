import { useRef, useState, useCallback, useEffect } from 'react';
import { parseSolveLine, parseValidationMsg, applyStepResult } from '../utils/parser';

/**
 * Manages a single SSE stream for one CI.
 * startStream() resolves with 'ok' | 'fail' | 'stopped' derived from actual task outcomes.
 */
export function useStream(ciId) {
  const esRef         = useRef(null);
  const resolveRef    = useRef(null);
  const stepStateRef  = useRef({ currentTask: null, pendingId: null });
  const failCountRef  = useRef(0);   // tracks sp-step-fail count during this run

  const [isRunning, setIsRunning]       = useState(false);
  const [status, setStatus]             = useState({ text: '⏸ Idle', type: 'idle' });
  const [steps, setSteps]               = useState([]);
  const [log, setLog]                   = useState('');
  const [currentMod, setCurrentMod]     = useState(null);
  const [currentStage, setCurrentStage] = useState(null);

  const stopStream = useCallback(() => {
    if (esRef.current)      { esRef.current.close(); esRef.current = null; }
    if (resolveRef.current) { resolveRef.current('stopped'); resolveRef.current = null; }
    setIsRunning(false);
    setStatus({ text: '⏸ Stopped', type: 'idle' });
  }, []);

  const startStream = useCallback((stage, mod) => {
    return new Promise(resolve => {
      // Cancel any previous stream
      if (esRef.current)      { esRef.current.close(); esRef.current = null; }
      if (resolveRef.current) { resolveRef.current('stopped'); }
      resolveRef.current = resolve;

      stepStateRef.current = { currentTask: null, pendingId: null };
      failCountRef.current = 0;

      setSteps([]);
      setLog('');
      setCurrentMod(mod);
      setCurrentStage(stage);
      setIsRunning(true);
      setStatus({ text: `Running ${stage} on ${mod}…`, type: 'running' });

      const es = new EventSource(`/api/stream/${ciId}/${stage}/${encodeURIComponent(mod)}`);
      esRef.current = es;

      es.onmessage = (evt) => {
        if (evt.data === '__DONE__' || evt.data === '__DONE_FAIL__') {
          es.close();
          esRef.current      = null;
          resolveRef.current = null;
          setIsRunning(false);
          // Outcome: connection error → fail, else check actual task results
          const outcome = evt.data === '__DONE_FAIL__' || failCountRef.current > 0 ? 'fail' : 'ok';
          resolve(outcome);
          return;
        }

        let line;
        try { line = JSON.parse(evt.data); } catch { line = evt.data; }
        line = String(line);

        setLog(prev => prev + line + '\n');

        const result = parseSolveLine(line, stepStateRef.current);
        stepStateRef.current = result.stepState;
        if (result.updateStatus === 'fail' || result.newStep?.status === 'fail') {
          failCountRef.current++;
        }
        setSteps(prev => applyStepResult(prev, result));

        const valSteps = parseValidationMsg(line);
        if (valSteps.length) {
          const fails = valSteps.filter(s => s.status === 'fail').length;
          failCountRef.current += fails;
          setSteps(prev => [...prev, ...valSteps]);
        }
      };

      es.onerror = () => {
        es.close();
        esRef.current      = null;
        resolveRef.current = null;
        setIsRunning(false);
        setLog(prev => prev + '\n❌ Stream connection lost\n');
        resolve('fail');
      };
    });
  }, [ciId]);

  useEffect(() => () => { if (esRef.current) esRef.current.close(); }, []);

  return { isRunning, status, setStatus, steps, log, currentMod, currentStage, startStream, stopStream };
}
