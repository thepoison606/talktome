// Optional development tool. Kept out of production dependencies and builds.
import { spawnSync } from 'node:child_process';

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error('Run through npm: npm run web:guidance -- <command> [arguments]');
  process.exit(1);
}
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [
  npmCli, 'exec', '--yes', '--package=modern-web-guidance@1.0.0', '--',
  'modern-web-guidance', ...(args.length ? args : ['--help']),
], {
  stdio: 'inherit',
  env: { ...process.env, DISABLE_TELEMETRY: '1' },
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
