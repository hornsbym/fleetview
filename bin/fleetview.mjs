#!/usr/bin/env node
// `fleetview` launcher: build the web UI if needed, start the single Node server
// (serves the built UI + API on one port), and open the browser. Runs from the
// package dir, so it uses the repo's own tsx/vite (install with `npm link`).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const localBin = (name) => path.join(ROOT, 'node_modules', '.bin', name);
const PORT = process.env.PORT || '4317';
const url = `http://127.0.0.1:${PORT}`;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    p.on('error', reject);
  });
}

async function main() {
  // Build the web UI on launch so it's never stale after a source change.
  // Skip with FLEETVIEW_NO_BUILD=1 for fast restarts (still builds if dist is absent).
  const distMissing = !existsSync(path.join(ROOT, 'dist', 'index.html'));
  if (process.env.FLEETVIEW_NO_BUILD !== '1' || distMissing) {
    console.log('FleetView: building the web UI…');
    await run(localBin('vite'), ['build']);
  }
  console.log(`FleetView → ${url}`);
  const server = spawn(localBin('tsx'), ['src/server/main.ts'], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, PORT },
  });
  // Open the browser shortly after the server binds.
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  setTimeout(() => { try { spawn(opener, [url], { stdio: 'ignore', detached: true }).unref(); } catch { /* ignore */ } }, 900);

  const bye = () => { server.kill(); process.exit(0); };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
  server.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((e) => { console.error('FleetView failed to start:', e.message); process.exit(1); });
