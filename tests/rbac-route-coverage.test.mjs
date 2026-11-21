import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const middleware = readFileSync(new URL('../worker/access-ai-settings.ts', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../worker/confecciones-routes.ts', import.meta.url), 'utf8');
const drafts = readFileSync(new URL('../worker/case-routes.ts', import.meta.url), 'utf8');

test('case drafts are covered by global case RBAC', () => {
  assert.match(middleware, /\/api\\\/case-drafts/);
  assert.match(drafts, /app\.put\('\/api\/case-drafts\/:id'/);
});

test('confecciones are covered by RBAC and existing per-case restrictions', () => {
  assert.match(middleware, /\/api\\\/confecciones/);
  assert.match(middleware, /(?:templates|confecciones)\$\/\.test\(path\)/);
  assert.match(routes, /const confeccionesRoles = \['SUPERADMIN', 'ADMIN', 'MANAGER'\]/);
  assert.match(routes, /caseObj\.assignedManagerId/);
});

test('document requirement upload exception remains limited to the exact upload endpoint', () => {
  assert.match(middleware, /path === '\/api\/documents\/upload' && c\.req\.method === 'POST'/);
});

test('RBAC administration stays superadmin only', () => {
  assert.match(middleware, /path\.startsWith\('\/api\/admin\/rbac'\)/);
  assert.match(middleware, /auth\.realUser\.role !== 'SUPERADMIN'/);
});
