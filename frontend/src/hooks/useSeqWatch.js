import { useEffect, useRef } from 'react';
import { getSeqRuns } from '../utils/api';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Polls /api/seq-runs and drives the tile's stream for each module.
 *
 * Callbacks are kept in a ref so the effect only re-runs when ciId or
 * enabled changes — no stale closure risk, no spurious watcher restarts.
 */
export function useSeqWatch({
  ciId,
  enabled,
  startStream,
  isRunning,
  setSeqStatus,
  setPaused,
  onModuleStart,
  onModuleComplete,
  onDone,
}) {
  // Keep all callbacks in a ref so the effect closure always sees the latest ones
  const cb = useRef({});
  cb.current = { startStream, isRunning, setSeqStatus, setPaused, onModuleStart, onModuleComplete, onDone };

  useEffect(() => {
    if (!enabled) return;

    // Use a generation counter — if a new effect runs (ciId / enabled changed)
    // the old loop's generation becomes stale and it exits cleanly.
    let cancelled = false;
    const lastKeyRef = { current: null };

    (async () => {
      while (!cancelled) {
        let seq;
        try {
          const runs = await getSeqRuns();
          seq = runs.find(r => r.ci_id === ciId);
        } catch {
          await sleep(1000);
          continue;
        }

        if (cancelled) break;

        if (!seq) {
          cb.current.setPaused(null);
          cb.current.onDone();
          break;
        }

        if (seq.paused) {
          cb.current.setPaused({ mod: seq.pausedMod, stage: seq.pausedStage });
          await sleep(800);
          continue;
        }

        cb.current.setPaused(null);

        const { currentMod, currentStage } = seq;
        const key = `${currentMod}:${currentStage}`;

        if (currentMod && currentStage && (key !== lastKeyRef.current || !cb.current.isRunning)) {
          lastKeyRef.current = key;
          cb.current.onModuleStart?.(currentMod, currentStage);
          cb.current.setSeqStatus(
            `[${seq.currentIdx + 1}/${seq.total}] ${currentStage === 'solve' ? 'Solving' : 'Validating'} ${currentMod}…`,
            'running'
          );
          const outcome = await cb.current.startStream(currentStage, currentMod);
          if (!cancelled) {
            cb.current.onModuleComplete(currentMod, currentStage, outcome);
          }
          await sleep(400);
        } else {
          await sleep(800);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [enabled, ciId]); // stable — callbacks via ref, no deps needed
}
