// Ensure the R2 binding target exists before Cloudflare's deploy command runs.
// This script never deletes, replaces, or modifies an existing bucket.
import { spawnSync } from 'node:child_process';

const bucket = 'docflow-pro-files';
const wrangler = process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler';

function run(args) {
  const result = spawnSync(wrangler, ['r2', 'bucket', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  return result;
}

const existing = run(['info', bucket]);
if (existing.status === 0) {
  console.log(`R2 bucket "${bucket}" already exists; reusing it.`);
} else {
  console.log(`R2 bucket "${bucket}" not accessible yet; attempting creation.`);
  const created = run(['create', bucket]);
  if (created.status === 0) {
    console.log(`R2 bucket "${bucket}" created.`);
  } else {
    // If another deployment created it concurrently, an info check resolves that race.
    const retry = run(['info', bucket]);
    if (retry.status !== 0) {
      console.error(created.stderr || created.stdout);
      console.error(`Could not provision R2 bucket "${bucket}". Ensure R2 is enabled and the deployment has R2 permissions.`);
      process.exit(1);
    }
    console.log(`R2 bucket "${bucket}" is now available; reusing it.`);
  }
}
