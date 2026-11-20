import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('case table and counters share advisor visibility selectors', () => {
  const view = read('../src/components/CasesList.tsx');
  const selectors = read('../src/utils/caseListSelectors.ts');
  assert.match(view, /filterCases\(cases, currentUser, searchTerm, statusFilter, templateFilter\)/);
  assert.match(view, /countCasesByStatus\(cases, currentUser, st\)/);
  assert.match(selectors, /return visibleCases\(cases, currentUser\)\.filter/);
  assert.match(selectors, /currentUser\.role !== 'ASESOR' \|\| c\.assignedAdvisorId === currentUser\.id/);
});

test('case search and filters preserve the original case matching fields', () => {
  const selectors = read('../src/utils/caseListSelectors.ts');
  for (const field of ['title', 'code', 'description']) {
    assert.match(selectors, new RegExp(`c\\.${field}\\.toLowerCase\\(\\)\\.includes\\(search\\)`));
  }
  assert.match(selectors, /statusFilter === 'all' \|\| c\.status === statusFilter/);
  assert.match(selectors, /templateFilter === 'all' \|\| c\.templateId === templateFilter/);
});
