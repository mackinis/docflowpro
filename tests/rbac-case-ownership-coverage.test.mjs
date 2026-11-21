import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../worker/case-routes.ts', import.meta.url), 'utf8');

test('advisor case list filters by effective user assignment', () => {
  assert.match(source, /app\.get\('\/api\/cases',[\s\S]*?auth\.user\.role === 'ASESOR'[\s\S]*?assignedAdvisorId === auth\.user\.id/);
});
test('all nested case endpoints check adviser ownership before handler', () => {
  assert.match(source, /app\.use\('\/api\/cases\/:id\/\*'/);
  assert.match(source, /caseObj\.assignedAdvisorId !== auth\.user\.id/);
  assert.match(source, /return c\.json\(\{ error: 'Legajo no encontrado' \}, 404\)/);
});
test('generic case edit cannot change assignment or lifecycle for advisers', () => {
  assert.match(source, /auth\.user\.role === 'ASESOR' && \(body\.assignedAdvisorId !== undefined \|\| body\.status !== undefined\)/);
});
