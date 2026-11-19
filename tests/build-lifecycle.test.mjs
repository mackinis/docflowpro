import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const wrangler = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));

test('production build does not provision Cloudflare infrastructure', () => {
  assert.equal(pkg.scripts.build, 'vite build');
  assert.equal(pkg.scripts.postbuild, undefined, 'postbuild must not contact R2 or other Cloudflare APIs');
  assert.equal(pkg.scripts['infra:ensure-r2'], 'node scripts/ensure-r2-bucket.mjs');
});

test('R2 binding remains configured without deleting or renaming its bucket', () => {
  assert.ok(wrangler.r2_buckets.some(({ binding, bucket_name }) =>
    binding === 'R2_BUCKET' && bucket_name === 'docflow-pro-files'));
});
