import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/rbac.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { RBAC_MODULES, RBAC_ACTIONS, isApplicableRbacPermission, hasRbacPermission, isNonDelegablePermission } =
  await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(js));

test('all matrix actions have a deterministic applicable or disabled state', () => {
  for (const module of RBAC_MODULES) for (const action of RBAC_ACTIONS)
    assert.equal(typeof isApplicableRbacPermission(`${module}.${action}`), 'boolean');
});

test('AI has only real view and edit actions; no fictitious download/delete/manage', () => {
  for (const action of ['create','delete','download','manage'])
    assert.equal(isApplicableRbacPermission(`ai.${action}`), false);
  for (const action of ['view','edit'])
    assert.equal(isApplicableRbacPermission(`ai.${action}`), true);
});

test('sensitive permission is real and guards a user update field', () => {
  const routes = readFileSync(new URL('../worker/user-admin-routes.ts', import.meta.url), 'utf8');
  assert.match(routes, /hasSensitiveEditPermissionOverride !== undefined, 'userSensitive.edit'/);
  assert.equal(isApplicableRbacPermission('userSensitive.edit'), true);
  assert.equal(isApplicableRbacPermission('userSensitive.download'), false);
});

test('ineffective switches cannot authorize a request, even with persisted true overrides', () => {
  const matrix = {roles:{MANAGER:{'ai.delete':true,'settings.download':true}},users:{}};
  assert.equal(hasRbacPermission(matrix,'MANAGER','u','ai.delete'),false);
  assert.equal(hasRbacPermission(matrix,'MANAGER','u','settings.download'),false);
  assert.equal(isNonDelegablePermission('MANAGER','ai.delete'),true);
});

test('settings view and edit remain independently configurable', () => {
  const matrix={roles:{MANAGER:{'settings.view':true,'settings.edit':false}},users:{}};
  assert.equal(hasRbacPermission(matrix,'MANAGER','u','settings.view'),true);
  assert.equal(hasRbacPermission(matrix,'MANAGER','u','settings.edit'),false);
});

test('RBAC editor disables unsupported switches and cleans stale stored overrides', () => {
  const panel=readFileSync(new URL('../src/components/RbacPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /const locked=!applicable \|\| isNonDelegablePermission/);
  assert.match(panel, /isApplicableRbacPermission\(key as PermissionKey\)/);
});
