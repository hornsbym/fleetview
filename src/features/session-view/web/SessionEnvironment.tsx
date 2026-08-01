// Collapsible panel showing the static environment metadata of a session:
// working directory, model, skills, tools, MCP servers, permission mode, and
// CLI version. Fetched once when the session loads — this data never changes
// during a session's lifetime.
import { useEffect, useId, useState } from 'react';
import type { SessionEnvironment, EnvironmentResponse } from '../shared/events';
import type { Session } from '../../../lib/claude-adapter/types';

export function SessionEnvironmentPanel({ session, sessionId }: {
  session: Session | null;
  sessionId: string;
}) {
  const [env, setEnv] = useState<SessionEnvironment | null>(null);
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();

  useEffect(() => {
    if (!sessionId) return;
    setEnv(null);
    setExpanded(false);
    const q = new URLSearchParams({ sessionId, ...(session?.cwd ? { cwd: session.cwd } : {}) });
    void (async () => {
      try {
        const r: EnvironmentResponse = await (await fetch(`/api/session/environment?${q}`)).json();
        if (r.ok && r.environment) setEnv(r.environment);
      } catch { /* leave null */ }
    })();
  }, [sessionId, session?.cwd]);

  if (!env) return null;

  return (
    <section className="dg dg-env" aria-label="Session environment">
      <button
        type="button"
        className="dg-env-toggle"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded(e => !e)}
      >
        <span className="dg-chevron" aria-hidden="true" />
        <h3>Environment</h3>
        <span className="dg-env-model mono">{env.model || `v${env.version}` || 'unknown'}</span>
      </button>

      {expanded && (
        <div className="dg-env-body" id={bodyId}>
          <EnvRow label="Working directory" value={env.cwd} mono />
          <EnvRow label="Model" value={env.model} mono />
          <EnvRow label="Permission mode" value={env.permissionMode} />
          <EnvRow label="Version" value={env.version} mono />

          {env.tools.length > 0 && (
            <div className="dg-env-row">
              <span className="dg-env-label">Tools</span>
              <div className="dg-env-tags">
                {env.tools.map(t => <span key={t} className="dg-env-tag mono">{t}</span>)}
              </div>
            </div>
          )}

          {env.mcpServers.length > 0 && (
            <div className="dg-env-row">
              <span className="dg-env-label">MCP servers</span>
              <div className="dg-env-tags">
                {env.mcpServers.map(m => (
                  <span key={m.name} className="dg-env-tag mono">
                    {m.name}
                    <span className={`dg-env-mcp-status dg-env-mcp-${m.status}`}>{m.status}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function EnvRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="dg-env-row">
      <span className="dg-env-label">{label}</span>
      <span className={`dg-env-value${mono ? ' mono' : ''}`}>{value}</span>
    </div>
  );
}
