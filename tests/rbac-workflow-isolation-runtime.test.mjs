import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
const start = source.indexOf('// Authorize adviser workflow resources');
const end = source.indexOf('// A finalized case is read-only', start);
assert.ok(start >= 0 && end > start);
const snippet = source.slice(start, end);
const js = ts.transpileModule(snippet, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
let handler;
runInNewContext(js, { app: { use(_path, callback) { handler = callback; } } });
assert.equal(typeof handler, 'function');

function mock({ path, method = 'GET', user = 'advisor-1', role = 'ASESOR', resourceCase = 'case-a', owner = 'advisor-1', body = {}, existingCase = null }) {
  const queries = [];
  const db = { prepare(sql) { return { bind(...args) { return { async first() {
    queries.push({ sql, args });
    if (sql.includes('FROM cases')) return owner ? { assigned_advisor_id: owner } : null;
    if (sql.includes('FROM form_submissions') && sql.includes('requirement_id') && method === 'POST') return existingCase ? { case_id: existingCase } : null;
    return resourceCase ? { case_id: resourceCase } : null;
  } }; } }; } };
  const ctx = {
    req: { path, method, raw: { clone() { return { async json() { return body; } }; } } },
    env: { DB: db },
    get(key) { return key === 'auth' ? { user: { id: user, role } } : null; },
    json(value, status = 200) { return { status, value }; },
  };
  let proceeded = false;
  return { run: async () => { const response = await handler(ctx, () => { proceeded = true; }); return { response, proceeded, queries }; } };
}

test('advisor cannot read tasks or observations belonging to another case', async () => {
  for (const path of ['/api/cases/case-b/tasks', '/api/cases/case-b/observations', '/api/tasks/task-b', '/api/observations/obs-b/resolve', '/api/forms/form-b']) {
    const result = await mock({ path, owner: 'advisor-2' }).run();
    assert.equal(result.response.status, 404, path);
    assert.equal(result.proceeded, false, path);
  }
});
test('assigned advisor can reach their case workflow handlers', async () => {
  for (const path of ['/api/cases/case-a/tasks', '/api/tasks/task-a', '/api/observations/obs-a/resolve', '/api/forms/form-a']) {
    const result = await mock({ path }).run();
    assert.equal(result.proceeded, true, path);
  }
});
test('advisor cannot submit observation or form to another case', async () => {
  for (const path of ['/api/observations', '/api/forms/submit']) {
    const result = await mock({ path, method: 'POST', owner: 'advisor-2', body: { caseId: 'case-b', requirementId: 'req-b' } }).run();
    assert.equal(result.response.status, 404);
    assert.equal(result.proceeded, false);
  }
});
test('form upsert cannot overwrite an existing requirement from another case', async () => {
  const result = await mock({ path: '/api/forms/submit', method: 'POST', body: { caseId: 'case-a', requirementId: 'req-other' }, existingCase: 'case-b' }).run();
  assert.equal(result.response.status, 404);
  assert.equal(result.proceeded, false);
});
test('manager and admin paths retain their supervising access', async () => {
  for (const role of ['MANAGER', 'ADMIN', 'SUPERADMIN']) {
    assert.equal((await mock({ path: '/api/tasks/task-b', role, owner: 'advisor-2' }).run()).proceeded, true);
  }
});
