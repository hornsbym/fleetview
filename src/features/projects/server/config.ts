// Read/write ~/.fleetview.json — FleetView's own config (NOT ~/.claude).
// Safe file handling: missing/corrupt file falls back to defaults; never throws.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG, type FleetViewConfig } from '../shared/config';

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
  return writeConfig({ ...config, repos: [...config.repos, repoPath.trim()] });
}

export async function removeRepo(repoPath: string): Promise<FleetViewConfig> {
  const target = repoPath.trim();
  const config = await readConfig();
  return writeConfig({ ...config, repos: config.repos.filter((r) => r !== target) });
}

// --- FleetView skill installation ---

const SKILL_DIR = path.join(homedir(), '.claude', 'commands');
const SKILL_PATH = path.join(SKILL_DIR, 'fleetview.md');

const FLEETVIEW_SKILL = `# /fleetview — Enable FleetView session reporting

From now on in this session, maintain \`.fleetview/sessions/$CLAUDE_CODE_SESSION_ID.json\` in the project root to keep FleetView informed of your progress.

Update the file:
- **\`now\`**: Every time you start a new piece of work (not every tool call — when you shift focus). One sentence describing what you're actively doing, written for a human scanning a dashboard.
- **\`goal\`**: The high-level objective this session is working toward. Update when the user gives you a new task or shifts direction. One sentence a colleague would understand without context.
- **\`summary\`**: Whenever you complete something significant (a fix, a feature, a refactor). 1-5 sentences covering everything this session has accomplished so far.
- **\`updatedAt\`**: ISO 8601 timestamp of this update.

The file schema:

\`\`\`json
{
  "now": "Brief, human-readable description of current activity.",
  "goal": "The high-level objective this work is serving.",
  "summary": "Cumulative summary of what this session has accomplished.",
  "updatedAt": "ISO 8601 timestamp"
}
\`\`\`

Rules:
- Create the \`.fleetview/sessions/\` directory if it doesn't exist.
- Overwrite the file each time — it's the current state, not a log.
- Write \`now\` in plain language a colleague would understand at a glance (e.g. "Refactoring the auth middleware to use the new token format" not "Edit auth.ts").
- Keep \`summary\` concise and focused on outcomes, not process.
- This is purely for visualization — it does not affect your work.

Acknowledge with: "FleetView reporting enabled for this session."
`;

export async function installSkill(): Promise<void> {
  await mkdir(SKILL_DIR, { recursive: true });
  await writeFile(SKILL_PATH, FLEETVIEW_SKILL, 'utf8');
}

export async function uninstallSkill(): Promise<void> {
  await rm(SKILL_PATH, { force: true });
}

export async function isSkillInstalled(): Promise<boolean> {
  try { await readFile(SKILL_PATH, 'utf8'); return true; } catch { return false; }
}

export { CONFIG_PATH };
