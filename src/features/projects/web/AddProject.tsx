// Add/remove watched repo paths. Owns its own config fetch; reports changes up via
// onConfigChange so the parent can re-poll the fleet. Server also validates on add.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConfigRequest, ConfigResponse, FleetViewConfig } from '../shared/config';
import './AddProject.css';

export interface AddProjectProps {
  /** Fired whenever the persisted config changes (initial load, add, remove). */
  onConfigChange?: (config: FleetViewConfig) => void;
}

/** Client-side format check; the server does the authoritative is-a-directory check. */
const looksAbsolute = (p: string) => {
  const t = p.trim();
  return t.startsWith('/') || t === '~' || t.startsWith('~/');
};

const REASONS: Record<string, string> = {
  'empty-path': 'Enter a repo path.',
  'not-absolute': 'Path must be absolute (start with / or ~).',
  'not-a-directory': 'That path is not a directory.',
  'not-found': 'No such directory on disk.',
  'bad-request': 'Could not process that request.',
  'server-error': 'Something went wrong saving the config.',
};
const reasonText = (r?: string) => (r && REASONS[r]) || 'Could not update the watched repos.';

export function AddProject({ onConfigChange }: AddProjectProps) {
  const [repos, setRepos] = useState<string[]>([]);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Held in a ref, NOT a dependency. Callers pass an inline arrow, so depending on
  // its identity made `apply` — and the effect below — new on every render. That
  // was an infinite loop: fetch config -> onConfigChange -> parent re-renders ->
  // new arrow -> new apply -> effect re-runs -> fetch config… Measured in the
  // browser at ~270 requests/second, which froze the renderer and made the whole
  // app look like it was permanently "loading".
  const onChange = useRef(onConfigChange);
  useEffect(() => { onChange.current = onConfigChange; }, [onConfigChange]);

  const apply = useCallback((config: FleetViewConfig) => {
    setRepos(config.repos);
    onChange.current?.(config);
  }, []);

  // Load the persisted config once, on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d: ConfigResponse = await (await fetch('/api/config')).json();
        if (alive && d?.config) apply(d.config);
      } catch {
        /* leave empty; the add form still works */
      }
    })();
    return () => {
      alive = false;
    };
  }, [apply]);

  const post = async (body: ConfigRequest): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d: ConfigResponse = await res.json();
      if (d.ok) {
        apply(d.config);
        return true;
      }
      setError(reasonText(d.reason));
      return false;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onAdd = async () => {
    const path = value.trim();
    if (!looksAbsolute(path)) {
      setError('Path must be absolute (start with / or ~).');
      return;
    }
    if (await post({ action: 'add', path })) setValue('');
  };

  return (
    <div className="add-project">
      {repos.length > 0 && (
        <ul className="ap-list">
          {repos.map((r) => (
            <li key={r} className="ap-row">
              <span className="ap-path mono" title={r}>{r}</span>
              <button
                type="button"
                className="ap-remove"
                disabled={busy}
                aria-label={`Stop watching ${r}`}
                onClick={() => post({ action: 'remove', path: r })}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="ap-form"
        onSubmit={(e) => {
          e.preventDefault();
          void onAdd();
        }}
      >
        <input
          className="ap-input mono"
          type="text"
          aria-label="Repo path to watch"
          placeholder="/absolute/path/to/repo"
          value={value}
          disabled={busy}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
        />
        <button type="submit" className="ap-add" disabled={busy || value.trim() === ''}>
          Add
        </button>
      </form>
      {error && <div className="ap-error">{error}</div>}
    </div>
  );
}
