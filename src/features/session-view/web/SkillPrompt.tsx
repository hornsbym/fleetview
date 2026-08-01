import { useCallback, useEffect, useState } from 'react';
import type { SessionDigest } from '../shared/events';
import './SkillPrompt.css';

export function SkillPrompt({ digest }: { digest: SessionDigest | null }) {
  const [skillInstalled, setSkillInstalled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const d = await (await fetch('/api/skill')).json();
        if (d.ok) setSkillInstalled(d.installed);
      } catch { /* leave unknown */ }
    })();
  }, []);

  const install = useCallback(async () => {
    setBusy(true);
    try {
      const d = await (await fetch('/api/skill', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'install' }),
      })).json();
      if (d.ok) setSkillInstalled(d.installed);
    } catch { /* leave as-is */ }
    finally { setBusy(false); }
  }, []);

  if (digest?.reported) return null;
  if (skillInstalled === null) return null;

  if (!skillInstalled) {
    return (
      <section className="sk-prompt" aria-label="Install FleetView skill">
        <p className="sk-text">
          <strong>Enable session reporting</strong><br />
          Install the <code>/fleetview</code> skill to get AI-authored summaries, progress tracking, and goal visibility for your sessions.
        </p>
        <button type="button" className="sk-btn sk-primary" disabled={busy} onClick={() => void install()}>
          {busy ? 'Installing…' : 'Install skill'}
        </button>
      </section>
    );
  }

  return (
    <section className="sk-prompt" aria-label="Enable reporting">
      <p className="sk-text">
        Run <code>/fleetview</code> in this session to enable rich reporting — summaries, progress, and goals will appear here.
      </p>
    </section>
  );
}
