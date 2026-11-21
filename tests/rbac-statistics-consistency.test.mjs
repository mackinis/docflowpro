import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const js = ts.transpileModule(read('../src/rbac.ts'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { hasRbacPermission } = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(js));

test('statistics view grants reading without requiring manage', () => {
  const matrix = { roles: {}, users: { manager1: { 'statistics.view': true, 'statistics.manage': false } } };
  assert.equal(hasRbacPermission(matrix, 'MANAGER', 'manager1', 'statistics.view'), true);
  assert.equal(hasRbacPermission(matrix, 'MANAGER', 'manager1', 'statistics.manage'), false);
});

test('user denial overrides manager role permission', () => {
  const matrix = { roles: { MANAGER: { 'statistics.view': true } }, users: { manager1: { 'statistics.view': false } } };
  assert.equal(hasRbacPermission(matrix, 'MANAGER', 'manager1', 'statistics.view'), false);
});

test('role denial removes statistics view when no user exception exists', () => {
  const matrix = { roles: { MANAGER: { 'statistics.view': false } }, users: {} };
  assert.equal(hasRbacPermission(matrix, 'MANAGER', 'manager1', 'statistics.view'), false);
});

test('superadmin remains unrestricted', () => {
  assert.equal(hasRbacPermission({ roles: {}, users: {} }, 'SUPERADMIN', 'admin1', 'statistics.view'), true);
});

test('sidebar and team endpoint use the same statistics.view permission', () => {
  const sidebar = read('../src/components/Sidebar.tsx');
  const routes = read('../worker/case-routes.ts');
  assert.match(sidebar, /Boolean\(data\?\.statistics\?\.view\)/);
  const endpoint = routes.split("app.get('/api/statistics/advisors'")[1]?.split("app.get('/api/cases/advisor-statistics'")[0];
  assert.ok(endpoint, 'team statistics endpoint must exist');
  assert.match(endpoint, /hasRbacPermission\(matrix, auth\.user\.role, auth\.user\.id, 'statistics\.view'\)/);
  assert.doesNotMatch(endpoint, /hasRbacPermission\(matrix, auth\.user\.role, auth\.user\.id, 'statistics\.manage'\)/);
});

test('every sidebar navigation module uses effective permissions rather than role allowlists', () => {
  const sidebar = read('../src/components/Sidebar.tsx');
  const server = read('../worker/access-ai-settings.ts');
  for (const module of ['dashboard','statistics','audit','cases','documents','messages','notifications','templates','users','settings']) {
    assert.match(sidebar, new RegExp('(?:^|[ ,])' + (module === 'users' ? 'profile' : module) + ": '" + module + "'"), module + ' sidebar mapping');
  }
  assert.match(sidebar, /effectivePermissions\[menuPermissionModule\[item\.id\]\]\?\.view === true/);
  assert.doesNotMatch(sidebar, /item\.roles\.includes\(currentUser\.role\)/);
  assert.match(server, /RBAC_MODULES\.map\(module/);
  assert.match(server, /hasRbacPermission\(matrix, auth\.user\.role, auth\.user\.id/);
});
