import { useEffect, useRef } from 'react';

/**
 * Poll on an interval, but only while the tab is visible — and refresh
 * immediately when it becomes visible again.
 *
 * Why this exists: Chrome heavily throttles `setInterval` in hidden tabs (roughly
 * once a minute, and harder still after a few minutes). Measured live: a
 * backgrounded FleetView fired **zero** requests over two minutes, so switching
 * away and back left you staring at stale data with no indication it was stale,
 * and nothing to trigger a refresh until the next throttled tick.
 *
 * Throttling while hidden is fine — desirable, even, since the fleet build is
 * expensive. The bug was never catching up. So: skip ticks while hidden, and
 * fire once on `visibilitychange` back to visible.
 *
 * `run` is held in a ref so a new closure each render doesn't restart the
 * interval; the timer always calls the latest one. Pass `restartKey` when a
 * change should force an immediate re-run (e.g. a manual refresh counter).
 */
export function useVisiblePoll(run: () => void, intervalMs: number, restartKey?: unknown): void {
  const saved = useRef(run);
  useEffect(() => { saved.current = run; }, [run]);

  useEffect(() => {
    let stopped = false;
    const tick = () => { if (!stopped && !document.hidden) saved.current(); };

    // The FIRST load always runs, even hidden. Gating it too would leave a tab
    // that was restored in the background stuck on "Loading…" until it happened
    // to be focused — a worse failure than one wasted fetch.
    if (!stopped) saved.current();
    const id = setInterval(tick, intervalMs);
    // Coming back to the tab must not wait for the next (throttled) tick.
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs, restartKey]);
}
