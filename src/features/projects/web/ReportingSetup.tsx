import { useCallback, useEffect, useState } from 'react';
import './ReportingSetup.css';

export function ReportingSetup() {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const d = await (await fetch('/api/skill')).json();
        if (d.ok) setInstalled(d.installed);
      } catch { /* leave unknown */ }
    })();
  }, []);

  const toggle = useCallback(async (action: 'install' | 'uninstall') => {
    setBusy(true);
    try {
      const d = await (await fetch('/api/skill', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })).json();
      if (d.ok) setInstalled(d.installed);
    } catch { /* leave as-is */ }
    finally { setBusy(false); }
  }, []);

  if (installed === null) return null;

  if (installed) {
    return (
      <div className="rs rs-ok">
        <span><code>/fleetview</code> skill installed — run it in any session to enable reporting.</span>
        <button type="button" className="rs-btn" disabled={busy} onClick={() => void toggle('uninstall')}>Remove</button>
      </div>
    );
  }

  if (dismissed) return null;

  return (
    <div className="rs">
      <div className="rs-body">
        <strong>Install the /fleetview skill?</strong>
        <p>
          Adds a global <code>/fleetview</code> slash command to Claude Code. Running it in
          a session tells Claude to maintain a brief summary of its progress, which FleetView
          displays on the session page.
        </p>
        <p className="rs-note">
          Sessions only report when you explicitly run <code>/fleetview</code> — no
          session is affected without your say-so.
        </p>
      </div>
      <div className="rs-actions">
        <button type="button" className="rs-btn rs-primary" disabled={busy} onClick={() => void toggle('install')}>
          {busy ? 'Installing…' : 'Install skill'}
        </button>
        <button type="button" className="rs-btn" onClick={() => setDismissed(true)}>Not now</button>
      </div>
    </div>
  );
}
