// Read/write ~/.fleetview.json — FleetView's own config (NOT ~/.claude).
// Safe file handling: missing/corrupt file falls back to defaults; never throws.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG, type FleetViewConfig } from '../shared/config';
import { ensureReportDir } from './scaffold';

const CONFIG_PATH = path.join(homedir(), '.fleetview.json');

const cleanStr = (v: unknown): string | undefined => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? undefined : s;
};

function uniqueStrings(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return Array.from(
    new Set(
      arr
        .filter((r): r is string => typeof r === 'string')
        .map((r) => r.trim())
        .filter((r) => r !== ''),
    ),
  );
}

/** Coerce untrusted JSON into a valid config: unique, trimmed repo paths, and
 *  preserve editor/host (dropping them here silently disabled both features). */
function normalize(input: unknown): FleetViewConfig {
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const repos = uniqueStrings(obj.repos);
  const editor = cleanStr(obj.editor);
  const host = cleanStr(obj.host);
  return {
    repos,
    ...(editor ? { editor } : {}),
    ...(host ? { host } : {}),
  };
}

export async function readConfig(): Promise<FleetViewConfig> {
  try {
    return normalize(JSON.parse(await readFile(CONFIG_PATH, 'utf8')));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function writeConfig(config: FleetViewConfig): Promise<FleetViewConfig> {
  const normalized = normalize(config);
  await writeFile(CONFIG_PATH, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

export async function addRepo(repoPath: string): Promise<FleetViewConfig> {
  const config = await readConfig();
  const target = repoPath.trim();
  // Scaffold now rather than waiting for the next /api/fleet poll, so a session
  // started immediately after adding the repo never races the .gitignore.
  await ensureReportDir(target);
  return writeConfig({ ...config, repos: [...config.repos, target] });
}

export async function removeRepo(repoPath: string): Promise<FleetViewConfig> {
  const target = repoPath.trim();
  const config = await readConfig();
  return writeConfig({ ...config, repos: config.repos.filter((r) => r !== target) });
}

// --- FleetView skill installation ---

const SKILL_DIR = path.join(homedir(), '.claude', 'commands');
const SKILL_PATH = path.join(SKILL_DIR, 'fleetview.md');

/**
 * Bump whenever FLEETVIEW_SKILL changes in a way already-installed copies need.
 * The UI only calls installSkill() when the skill is absent, so without this an
 * early adopter would keep the text they installed on day one forever — still
 * reporting prose summaries into a UI that now renders title/description bullets.
 *
 * The marker is written at the END of the file: Claude Code derives the command's
 * description from the leading heading, so nothing may precede it.
 */
const SKILL_VERSION = 3;
const SKILL_MARKER = /<!--\s*fleetview-skill:\s*v(\d+)/;

const FLEETVIEW_SKILL = `# /fleetview — Enable FleetView session reporting

From now on in this session, maintain \`.fleetview/sessions/$CLAUDE_CODE_SESSION_ID.json\` in the project root to keep FleetView informed of your progress.

Update the file:
- **\`now\`**: Every time you start a new piece of work (not every tool call — when you shift focus). One sentence describing what you're actively doing, written for a human scanning a dashboard.
- **\`goal\`**: The high-level objective this session is working toward. Update when the user gives you a new task or shifts direction. One sentence a colleague would understand without context.
- **\`summary\`**: Whenever you complete something significant (a fix, a feature, a refactor). An array of 1-5 \`{ title, description }\` objects covering everything this session has accomplished so far, oldest first — one accomplishment per entry.
  - \`title\`: a few words, no trailing period (e.g. "Self-ignoring .fleetview directory").
  - \`description\`: 1-2 sentences, and prefer 1. Say what changed and why it matters; drop anything a reader could infer from the title. Omit the field entirely when the title already says it — a redundant sentence is worse than none.
- **\`updatedAt\`**: ISO 8601 timestamp of this update.

The file schema:

\`\`\`json
{
  "now": "Brief, human-readable description of current activity.",
  "goal": "The high-level objective this work is serving.",
  "summary": [
    { "title": "Short noun phrase", "description": "One sentence on what changed and why it matters." },
    { "title": "Another accomplishment" }
  ],
  "updatedAt": "ISO 8601 timestamp"
}
\`\`\`

Rules:
- Write only that one JSON file. FleetView creates and git-ignores \`.fleetview/\` itself — never add, move, or clean up anything else in that directory.
- Overwrite the file each time — it's the current state, not a log.
- Write \`now\` in plain language a colleague would understand at a glance (e.g. "Refactoring the auth middleware to use the new token format" not "Edit auth.ts").
- Keep \`summary\` entries focused on outcomes, not process. Bias hard toward brevity: a scannable title with no description beats a padded one.
- This is purely for visualization — it does not affect your work.

Acknowledge with: "FleetView reporting enabled for this session."

<!-- fleetview-skill: v${SKILL_VERSION} — generated by FleetView; regenerated when this version changes. To keep a customized copy, save it under a different name in ~/.claude/commands/. -->
`;

export async function installSkill(): Promise<void> {
  await mkdir(SKILL_DIR, { recursive: true });
  await writeFile(SKILL_PATH, FLEETVIEW_SKILL, 'utf8');
}

export async function uninstallSkill(): Promise<void> {
  await rm(SKILL_PATH, { force: true });
}

async function readSkill(): Promise<string | null> {
  try { return await readFile(SKILL_PATH, 'utf8'); } catch { return null; }
}

/**
 * Report whether the skill is installed, rewriting a stale copy on the way.
 *
 * Deliberately a side effect on a read: the GET is the only moment FleetView is
 * reliably running with the skill already on disk, and a user who installed once
 * has no reason to ever click Install again.
 *
 * An unmarked file is a pre-versioning install (v1), not a customized one — the
 * marker did not exist to be removed — so it refreshes. That makes this file
 * FleetView-generated rather than user-editable, which installSkill() already
 * assumed by overwriting unconditionally; Remove in the UI is the way out. The one
 * copy left alone is a marker NEWER than this build, so an older FleetView pointed
 * at a newer install downgrades nothing.
 */
export async function ensureSkillCurrent(): Promise<{ installed: boolean; refreshed: boolean }> {
  const text = await readSkill();
  if (text === null) return { installed: false, refreshed: false };

  const match = text.match(SKILL_MARKER);
  if (match && Number(match[1]) >= SKILL_VERSION) return { installed: true, refreshed: false };

  await installSkill();
  return { installed: true, refreshed: true };
}

export { CONFIG_PATH };
