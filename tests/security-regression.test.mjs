import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
const ai = readFileSync(new URL('../worker/ai.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/components/SystemSettings.tsx', import.meta.url), 'utf8');
const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('AI model configuration requires server-side authorization', () => {
  assert.match(worker, /app\.post\('\/api\/ai\/settings'/);
  assert.match(worker, /if \(!canConfigure\) return c\.json\(\{ error: 'No autorizado/);
  assert.match(worker, /AI_MODELS\.some\(model => model\.id === body\.model\)/);
  assert.match(worker, /auth\.user\.role === 'SUPERADMIN'/);
});

test('legacy AI endpoints remain protected by RBAC', () => {
  assert.match(worker, /app\.use\('\/api\/ai\/\*', enforceAiRbac\)/);
  assert.match(worker, /app\.use\('\/api\/gemini\/\*', enforceAiRbac\)/);
  assert.match(worker, /settings\.aiAllowedRoles/);
  assert.match(worker, /Configure Agente IA desde su sección específica/);
});

test('model selection is applied to actual inference', () => {
  assert.match(ai, /getSystemConfigValue\(env\.DB, 'systemSettings'/);
  assert.match(ai, /for \(const model of \[chosen\]\)/);
});

test('navigation and API requests are logged without storing request bodies', () => {
  assert.match(worker, /app\.post\('\/api\/audit\/navigation'/);
  assert.match(worker, /'ApiRequest'/);
  assert.match(app, /fetch\('\/api\/audit\/navigation'/);
  assert.doesNotMatch(worker.match(/\/\/ Audit every authenticated API request[\s\S]*?app\.post\('\/api\/audit\/navigation'/)?.[0] || '', /c\.req\.json\(/);
});

test('audit retention runs hourly and expires after 120 hours', () => {
  assert.match(wrangler, /"crons": \["0 \* \* \* \*"\]/);
  assert.match(worker, /5 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(worker, /DELETE FROM audit_logs WHERE created_at < \?/);
});

test('AI configuration has a dedicated tab', () => {
  assert.match(ui, /'ia', 'Agente IA'/);
  assert.match(ui, /<AiAgentSettings currentUser=\{currentUser\}/);
});
