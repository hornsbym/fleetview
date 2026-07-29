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

  if (!live) return null;

  const disabled = hasIdentity === false || state === 'loading';
  const title = hasIdentity === false
    ? 'No terminal identity captured yet. Send a prompt in the terminal to enable focus.'
    : 'Bring the terminal running this session to the foreground';

  return (
    <button
      type="button"
      className={`focus-btn focus-${state}${hasIdentity === false ? ' focus-disabled' : ''}`}
      onClick={focus}
      disabled={disabled}
      title={title}
    >
      {state === 'success' ? 'Focused' : state === 'unavailable' ? 'Not found' : 'Focus terminal'}
    </button>
  );
}
