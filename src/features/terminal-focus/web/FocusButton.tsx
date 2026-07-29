import { useCallback, useEffect, useState } from 'react';
import './FocusButton.css';

interface Props {
  sessionId: string;
  live: boolean;
  cwd?: string | null;
}

type FocusState = 'idle' | 'loading' | 'success' | 'unavailable';

export function FocusButton({ sessionId, live, cwd }: Props) {
  const [state, setState] = useState<FocusState>('idle');
  const [hasIdentity, setHasIdentity] = useState<boolean | null>(null);

  useEffect(() => {
    if (!live) { setHasIdentity(false); return; }
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch(`/api/session/terminal?sessionId=${encodeURIComponent(sessionId)}`);
        const data = await res.json();
        if (alive) setHasIdentity(!!data.identity);
      } catch {
        if (alive) setHasIdentity(false);
      }
    };
    void check();
    const id = setInterval(check, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [sessionId, live]);

  const focus = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch('/api/session/focus', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, cwd }),
      });
      const data = await res.json();
      setState(data.ok ? 'success' : 'unavailable');
    } catch {
      setState('unavailable');
    }
    setTimeout(() => setState('idle'), 2000);
  }, [sessionId]);

  if (!live || hasIdentity === false) return null;

  return (
    <button
      type="button"
      className={`focus-btn focus-${state}`}
      onClick={focus}
      disabled={state === 'loading'}
      title="Bring the terminal running this session to the foreground"
    >
      {state === 'success' ? 'Focused' : state === 'unavailable' ? 'Not found' : 'Focus terminal'}
    </button>
  );
}
