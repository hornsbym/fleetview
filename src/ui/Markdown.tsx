// Render assistant text as Markdown instead of a wall of raw `##` and `-`.
//
// The one hard requirement is that click-to-open file links keep working through
// it. Claude almost always wraps paths in backticks, so `linkify` is applied to
// code spans; bare paths in prose are handled too, via the `text` renderer.
import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { linkify, openInEditor } from './FileLink';

/** react-markdown hands children through as strings or nested nodes; only the
 *  all-string case can be linkified without destroying inline formatting. */
function asText(children: ReactNode): string | null {
  if (typeof children === 'string') return children;
  if (Array.isArray(children) && children.every(c => typeof c === 'string')) return children.join('');
  return null;
}

/** Rewrite only the plain-string children, leaving nested elements alone. */
function linkifyChildren(children: ReactNode, repo?: string): ReactNode {
  const list = Array.isArray(children) ? children : [children];
  if (!list.some(c => typeof c === 'string')) return children;
  return list.map((c, i) =>
    typeof c === 'string'
      ? <span key={i}>{linkify(c, repo)}</span>
      : c);
}

/** A href we should open in the editor rather than the browser. */
const isFileHref = (href: string) =>
  href.startsWith('file://') || href.startsWith('/') || href.startsWith('~/') || /^\.{1,2}\//.test(href);

export function Markdown({ text, repo }: { text: string; repo?: string }) {
  const components: Components = {
    // Inline code and fenced blocks both arrive here. Linkifying either is safe —
    // it only wraps matched paths, leaving surrounding text untouched — and a
    // clickable path inside a code span is exactly what you want.
    code({ className, children, ...props }) {
      const raw = asText(children);
      return (
        <code className={className} {...props}>
          {raw !== null ? linkify(raw, repo) : children}
        </code>
      );
    },
    a({ href, children, ...props }) {
      const target = typeof href === 'string' ? href : '';
      if (target && isFileHref(target)) {
        const path = target.replace(/^file:\/\//, '');
        return (
          <a
            className="file-link"
            href="#"
            title={`Open ${path} in editor`}
            onClick={(e) => { e.preventDefault(); openInEditor(path, { repo }); }}
          >
            {children}
          </a>
        );
      }
      // External links leave the app: open in a new tab and don't leak the referrer.
      return <a href={target} target="_blank" rel="noreferrer noopener" {...props}>{children}</a>;
    },
    // Bare paths in prose aren't code spans, so linkify the plain-text runs of
    // paragraphs and list items too. Nested elements (bold, links, code) pass
    // through untouched — only the string segments are rewritten.
    p({ children, ...props }) { return <p {...props}>{linkifyChildren(children, repo)}</p>; },
    li({ children, ...props }) { return <li {...props}>{linkifyChildren(children, repo)}</li>; },
  };

  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
