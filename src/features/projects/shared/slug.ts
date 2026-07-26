// Stable, human-readable project slug for URLs. A repo's folder name is the slug;
// only when two watched repos share a folder name do they get a short deterministic
// hash suffix (so links stay clean in the common case and unique in the rare one).
// Pure + order-independent, so a given repo always maps to the same slug.

function hash6(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; // djb2
  return h.toString(36).slice(0, 6);
}

const base = (p: string) => (p.split('/').filter(Boolean).pop() || p).replace(/[^a-zA-Z0-9._-]/g, '-');

/** Build both directions (path→slug, slug→path) for the current set of repo paths. */
export function projectSlugs(paths: string[]): { toSlug: Map<string, string>; toPath: Map<string, string> } {
  const counts = new Map<string, number>();
  for (const p of paths) { const b = base(p); counts.set(b, (counts.get(b) ?? 0) + 1); }
  const toSlug = new Map<string, string>();
  const toPath = new Map<string, string>();
  for (const p of paths) {
    const b = base(p);
    const slug = (counts.get(b) ?? 0) > 1 ? `${b}-${hash6(p)}` : b;
    toSlug.set(p, slug);
    toPath.set(slug, p);
  }
  return { toSlug, toPath };
}
