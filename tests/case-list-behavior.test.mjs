import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/utils/caseListSelectors.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { visibleCases, filterCases, countCasesByStatus } = await import(
  'data:text/javascript;charset=utf-8,' + encodeURIComponent(compiled)
);

const cases = [
  { id: '1', title: 'Sucesión', code: 'ABC-1', description: 'Trámite sucesorio', status: 'active', templateId: 't1', assignedAdvisorId: 'advisor-a' },
  { id: '2', title: 'Compraventa', code: 'XYZ-2', description: 'Boleto', status: 'observed', templateId: 't2', assignedAdvisorId: 'advisor-b' },
  { id: '3', title: 'Registro', code: 'REG-3', description: 'Trámite registral', status: 'completed', templateId: 't1', assignedAdvisorId: 'advisor-a' },
];
const advisor = { id: 'advisor-a', role: 'ASESOR' };
const manager = { id: 'manager', role: 'GERENTE' };

test('advisor can see only assigned cases, including in tab counts', () => {
  assert.deepEqual(visibleCases(cases, advisor).map(c => c.id), ['1', '3']);
  assert.equal(countCasesByStatus(cases, advisor, 'all'), 2);
  assert.equal(countCasesByStatus(cases, advisor, 'observed'), 0);
  assert.equal(countCasesByStatus(cases, advisor, 'completed'), 1);
});

test('manager sees all cases and counters are consistent with rows', () => {
  assert.equal(visibleCases(cases, manager).length, 3);
  for (const status of ['all', 'active', 'observed', 'completed']) {
    assert.equal(countCasesByStatus(cases, manager, status), filterCases(cases, manager, '', status, 'all').length);
  }
});

test('search is case insensitive across title, code and description', () => {
  assert.deepEqual(filterCases(cases, manager, 'SUCESIÓN', 'all', 'all').map(c => c.id), ['1']);
  assert.deepEqual(filterCases(cases, manager, 'xyz-2', 'all', 'all').map(c => c.id), ['2']);
  assert.deepEqual(filterCases(cases, manager, 'REGISTRAL', 'all', 'all').map(c => c.id), ['3']);
});

test('status and template filters combine with advisor visibility', () => {
  assert.deepEqual(filterCases(cases, advisor, '', 'completed', 't1').map(c => c.id), ['3']);
  assert.deepEqual(filterCases(cases, advisor, '', 'observed', 't2'), []);
  assert.deepEqual(filterCases(cases, manager, '', 'observed', 't2').map(c => c.id), ['2']);
});

test('selectors never mutate source case collection', () => {
  const original = cases.map(c => ({ ...c }));
  filterCases(cases, advisor, 'registro', 'all', 't1');
  countCasesByStatus(cases, manager, 'active');
  assert.deepEqual(cases, original);
});
