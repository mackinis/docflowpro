import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const caseWorkflow = readFileSync(new URL('../worker/case-workflow-routes.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
const coreRoutes = readFileSync(new URL('../worker/core-routes.ts', import.meta.url), 'utf8');
const configAdmin = readFileSync(new URL('../worker/config-admin-routes.ts', import.meta.url), 'utf8');
const ai = readFileSync(new URL('../worker/ai.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/components/SystemSettings.tsx', import.meta.url), 'utf8');
const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const appController = readFileSync(new URL('../src/hooks/useAppController.ts', import.meta.url), 'utf8');

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
  assert.match(configAdmin, /Configure Agente IA desde su sección específica/);
  assert.match(worker, /registerConfigAdminRoutes\(app, dispatchQueueJob\)/);
});

test('model selection is applied to actual inference', () => {
  assert.match(ai, /getSystemConfigValue\(env\.DB, 'systemSettings'/);
  assert.match(ai, /for \(const model of \[chosen\]\)/);
});

test('navigation and API requests are logged without storing request bodies', () => {
  assert.match(coreRoutes, /app\.post\('\/api\/audit\/navigation'/);
  assert.match(worker, /registerCoreRoutes\(app\)/);
  assert.ok(worker.indexOf("app.use('/api/*'") < worker.indexOf('registerCoreRoutes(app)'), 'Core routes must register after API authentication middleware');
  assert.match(worker, /'ApiRequest'/);
  assert.match(app, /useAppController\(\)/);
  assert.match(appController, /fetch\('\/api\/audit\/navigation'/);
  assert.doesNotMatch(worker.match(/\/\/ Audit every authenticated API request[\s\S]*?registerCoreRoutes\(app\)/)?.[0] || '', /c\.req\.json\(/);
});

test('forensic audit records are retained without scheduled deletion', () => {
  assert.match(wrangler, /"crons": \["0 \* \* \* \*"\]/);
  assert.match(worker, /async scheduled\(_event: ScheduledEvent, env: Env\)/);
  assert.match(worker, /await ensureDatabaseReady\(env\.DB\)/);
  assert.doesNotMatch(worker, /DELETE FROM audit_logs WHERE created_at/);
});

test('AI configuration has a dedicated tab', () => {
  assert.match(ui, /'ia', 'Agente IA'/);
  assert.match(ui, /<AiAgentSettings currentUser=\{currentUser\}/);
});

test('clients cannot forge forensic audit events', () => {
  assert.match(caseWorkflow, /app\.post\('\/api\/audit-logs\/log', \(c\) => c\.json\(\{ error: 'Los registros de auditoría se generan exclusivamente en el servidor\.' \}, 403\)\)/);
});

test('forensic audit browsing is restricted and paginated', () => {
  assert.match(caseWorkflow, /auth\.realUser\.role !== 'ADMIN'/);
  assert.match(caseWorkflow, /LIMIT \? OFFSET \?/);
});
