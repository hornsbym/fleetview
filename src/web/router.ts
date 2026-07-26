// Minimal History-API router — no dependency, refresh-safe (the server's SPA
// fallback serves index.html for deep links). Routes:
//   /                    → home (first project)
//   /p/<slug>            → project view (session tiles)
//   /p/<slug>/s/<sid>    → a session's page (chat + that session's agents)
// <slug> is the repo's clean folder-name slug (see features/projects/shared/slug.ts),
// resolved back to an absolute path via the fleet. The `sid` sentinel "live" means
// "this repo's currently-owned running session".
import { useSyncExternalStore } from 'react';

const EVT = 'fleetview:navigate';

function subscribe(cb: () => void): () => void {
  window.addEventListener('popstate', cb);
  window.addEventListener(EVT, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(EVT, cb);
  };
}

export function navigate(to: string): void {
  if (to === window.location.pathname) return;
  window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(EVT));
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname, () => '/');
}

export interface Route {
  slug?: string;
  sessionId?: string;
}

export function parseRoute(path: string): Route {
  const m = path.match(/^\/p\/([^/]+)(?:\/s\/([^/]+))?\/?$/);
  if (!m) return {};
  return { slug: decodeURIComponent(m[1]), sessionId: m[2] ? decodeURIComponent(m[2]) : undefined };
}

export const projectPath = (slug: string) => `/p/${encodeURIComponent(slug)}`;
export const sessionPath = (slug: string, sessionId: string) =>
  `/p/${encodeURIComponent(slug)}/s/${encodeURIComponent(sessionId)}`;
export const LIVE = 'live';
