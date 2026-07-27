// Setup strip for the permission bridge.
//
// Without the hook installed FleetView is read-only: it shows what your sessions
// are doing but can't surface their permission prompts. Installing writes a
// user-level block to ~/.claude/settings.json, which covers every repo at once.
import { useCallback, useEffect, useState } from 'react';
import './HookSetup.css';

interface HookStatus {
  installed: boolean;
  path: string;
  events: string[];
  port: number;
  error?: string;
}

export function HookSetup() {
  const [status, setStatus] = useState<HookStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await (await fetch('/api/hooks/config')).json();
      if (d.ok) setStatus(d.status);
    } catch { /* leave unknown; the strip just won't render */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (action: 'install' | 'uninstall') => {
    setBusy(true);
    try {
      const d = await (await fetch('/api/hooks/config', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })).json();
      if (d.status) setStatus(d.status);
    } catch { /* status stays as-is */ }
    finally { setBusy(false); }
  }, []);

  if (!status) return null;

  if (status.error) {
    return (
      <div className="hk hk-warn">
        <span>⚠ Can’t read <code>{status.path}</code> — {status.error}. Fix it and reload; FleetView won’t write over a file it can’t parse.</span>
      </div>
    );
  }

  if (status.installed) {
    return (
      <div className="hk hk-ok">
        <span>✓ Permission bridge installed — approve tool calls here.</span>
        <button type="button" className="hk-btn" disabled={busy} onClick={() => void act('uninstall')}>Remove</button>
      </div>
    );
  }

  if (dismissed) return null;

  return (
    <div className="hk">
      <div className="hk-body">
        <strong>Approve tool calls from FleetView</strong>
        <p>
          Adds a hook to <code>{status.path}</code> so sessions in any repo send their
          permission prompts here. Your terminal still prompts normally whenever
          FleetView isn’t running, and if you don’t answer within 45 seconds it hands
          the prompt back to the terminal.
        </p>
        <p className="hk-note">
          New folders only start sending after you accept Claude Code’s
          “do you trust this folder?” prompt — hooks don’t run before that.
        </p>
      </div>
      <div className="hk-actions">
        <button type="button" className="hk-btn hk-primary" disabled={busy} onClick={() => void act('install')}>
          {busy ? 'Installing…' : 'Install hook'}
        </button>
        <button type="button" className="hk-btn" onClick={() => setDismissed(true)}>Not now</button>
      </div>
    </div>
  );
}
