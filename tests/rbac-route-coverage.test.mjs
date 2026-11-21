import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const middleware = readFileSync(new URL('../worker/access-ai-settings.ts', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../worker/confecciones-routes.ts', import.meta.url), 'utf8');
const drafts = readFileSync(new URL('../worker/case-routes.ts', import.meta.url), 'utf8');

test('case drafts are covered by global case RBAC', () => {
  assert.ok(middleware.includes('case-drafts'), 'case drafts must be included in global RBAC routing');
  assert.ok(drafts.includes("app.put('/api/case-drafts/:id'"));
});

test('confecciones are covered by RBAC and existing per-case restrictions', () => {
  assert.ok(middleware.includes('confecciones'), 'confecciones must be included in global RBAC routing');
  assert.ok(middleware.includes('templates|confecciones'), 'creation must be classified as create');
  assert.ok(routes.includes("const confeccionesRoles = ['SUPERADMIN', 'ADMIN', 'MANAGER']"));
  assert.ok(routes.includes('caseObj.assignedManagerId'));
});

test('document requirement upload exception remains limited to the exact upload endpoint', () => {
  assert.ok(middleware.includes("path === '/api/documents/upload' && c.req.method === 'POST'"));
});

test('RBAC administration stays superadmin only', () => {
  assert.ok(middleware.includes("path.startsWith('/api/admin/rbac')"));
  assert.ok(middleware.includes("auth.realUser.role !== 'SUPERADMIN'"));
});
