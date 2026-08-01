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

From now on in this session, whenever you complete something significant (a fix, a feature, a refactor — not every small step), update \`.fleetview/sessions/$CLAUDE_CODE_SESSION_ID.json\` in the project root with a brief summary of what this session has accomplished so far.

The file schema:

\`\`\`json
{
  "summary": "1-5 sentences describing what this session has accomplished.",
  "updatedAt": "ISO 8601 timestamp"
}
\`\`\`

Rules:
- Create the \`.fleetview/sessions/\` directory if it doesn't exist.
- Overwrite the file each time — it's the current state, not a log.
- Keep the summary concise and focused on outcomes, not process.
- The \`summary\` field is cumulative — it covers everything accomplished in this session, not just the latest change.
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
