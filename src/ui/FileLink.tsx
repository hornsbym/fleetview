import type { ReactNode } from 'react';

// Open a file in the user's editor via the backend (POST /api/open → `code -g`).
export function openInEditor(filePath: string, opts: { line?: number; col?: number; repo?: string } = {}) {
  fetch('/api/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: filePath, ...opts }),
  }).catch(() => { /* local-only; failures are non-fatal to the UI */ });
}

export function FileLink(props: {
  path: string; line?: number; col?: number; repo?: string; children?: ReactNode;
}) {
  const { path: p, line, col, repo, children } = props;
  return (
    <a
      className="file-link"
      href="#"
      title={`Open ${p}${line ? `:${line}` : ''} in editor`}
      onClick={(e) => { e.preventDefault(); openInEditor(p, { line, col, repo }); }}
    >
      {children ?? p}
    </a>
  );
}

// A file-ish token: absolute (/…) or relative (…/…) path ending in a .ext,
// with optional :line[:col]. Lookbehind avoids matching inside URLs / mid-word.
const FILE_RE = /(?<![\w@:/])((?:~\/|\/|(?:[\w@.\-]+\/))[\w@.\-/]*\.[A-Za-z][\w]{0,7})(?::(\d+))?(?::(\d+))?/g;

/** Turn file paths inside plain text into clickable FileLinks; leave the rest as text. */
export function linkify(text: string, repo?: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  FILE_RE.lastIndex = 0;
  while ((m = FILE_RE.exec(text))) {
    const [full, p, line, col] = m;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <FileLink key={`${m.index}-${p}`} path={p} line={line ? +line : undefined} col={col ? +col : undefined} repo={repo}>
        {full}
      </FileLink>,
    );
    last = m.index + full.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
