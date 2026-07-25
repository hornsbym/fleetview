// Read/write ~/.fleetview.json — FleetView's own config (NOT ~/.claude).
// Safe file handling: missing/corrupt file falls back to defaults; never throws.
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG, type FleetViewConfig } from '../shared/config';

const CONFIG_PATH = path.join(homedir(), '.fleetview.json');

/** Coerce untrusted JSON into a valid config: unique, trimmed, non-empty repo paths. */
function normalize(input: unknown): FleetViewConfig {
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const repos = Array.isArray(obj.repos)
    ? Array.from(
        new Set(
          obj.repos
            .filter((r): r is string => typeof r === 'string')
            .map((r) => r.trim())
            .filter((r) => r !== ''),
        ),
      )
    : [];
  return { repos };
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

export { CONFIG_PATH };
