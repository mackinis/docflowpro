import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');

test('large feature views do not own transport endpoint routing', () => {
  for (const file of ['../src/components/CasesList.tsx', '../src/components/CaseDetail.tsx', '../src/components/TemplatesManager.tsx']) {
    const source = read(file);
    assert.doesNotMatch(source, /\b(?:fetch|apiRequest)\s*\(/, `${file} must call feature services`);
  }
});

test('application controller delegates direct HTTP operations to feature service', () => {
  const source = read('../src/hooks/useAppController.ts');
  assert.doesNotMatch(source, /\b(?:fetch|apiRequest)\s*\(/);
  for (const method of ['impersonateUser', 'reviewDocument', 'submitCaseForm', 'advanceCaseStage', 'approveCaseStage', 'reopenCase']) {
    assert.match(source, new RegExp(`\\b${method}\\s*\\(`));
  }
});

test('feature API modules retain credentialed requests and do not silently retry mutations', () => {
  const transport = read('../src/services/apiTransport.ts');
  assert.match(transport, /return fetch\(input, init\)/);
  for (const file of ['../src/services/caseOperations.ts', '../src/services/caseDetailOperations.ts', '../src/services/templateOperations.ts', '../src/services/controllerOperations.ts']) {
    assert.match(read(file), /apiRequest\(/, `${file} should delegate transport`);
  }
});
