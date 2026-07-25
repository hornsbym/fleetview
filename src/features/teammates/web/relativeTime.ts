/** Compact relative time from an ISO timestamp: "just now", "5s ago", "3m ago",
    "2h ago", "1d ago". Empty string for null/invalid input (caller hides it). */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';

  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;

  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;

  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;

  return `${Math.floor(hrs / 24)}d ago`;
}
