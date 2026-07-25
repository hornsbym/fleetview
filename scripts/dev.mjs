// Dev launcher: runs the Node API server (tsx watch) + Vite together.
import { spawn } from 'node:child_process';

const procs = [
  { name: 'api', args: ['exec', 'tsx', 'watch', 'src/server/main.ts'] },
  { name: 'web', args: ['exec', 'vite'] },
];

const children = procs.map(({ name, args }) => {
  const c = spawn('pnpm', args, { env: process.env });
  c.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  c.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  c.on('exit', (code) => process.stdout.write(`[${name}] exited ${code}\n`));
  return c;
});

const bye = () => { for (const c of children) c.kill(); process.exit(0); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
