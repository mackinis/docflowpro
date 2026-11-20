import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const file = new URL('../worker/advisor-quality.ts', import.meta.url);
const source = readFileSync(file, 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { caseDocumentQuality, advisorDocumentQuality, advisorQualityGrade } =
  await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(js));

test('no evidence is ungraded; approval without errors is perfect', () => {
  assert.equal(caseDocumentQuality({ approved: 0, rejected: 0, observationsCount: 0, untrackedRejected: 0 }), null);
  assert.equal(caseDocumentQuality({ approved: 1, rejected: 0, observationsCount: 0, untrackedRejected: 0 }), 100);
});

test('rejection followed by correction and approval retains historical penalty', () => {
  const initial = { approved: 0, rejected: 1, observationsCount: 1, untrackedRejected: 0 };
  const approved = { ...initial, approved: 1, rejected: 0 };
  assert.equal(caseDocumentQuality(initial), 0);
  assert.equal(caseDocumentQuality(approved), 50);
});

test('repeated rejected/re-presented cycles remain individually counted', () => {
  const oneCycle = { approved: 1, rejected: 0, observationsCount: 1, untrackedRejected: 0 };
  const threeCycles = { ...oneCycle, observationsCount: 3 };
  assert.equal(caseDocumentQuality(oneCycle), 50);
  assert.equal(caseDocumentQuality(threeCycles), 25);
});

test('observation-backed rejection is counted once, independent rejection also counts', () => {
  assert.equal(caseDocumentQuality({ approved: 1, rejected: 0, observationsCount: 1, untrackedRejected: 0 }), 50);
  assert.equal(caseDocumentQuality({ approved: 1, rejected: 0, observationsCount: 1, untrackedRejected: 1 }), 100 / 3);
});

test('multiple cases are averaged by case with evidence, not by completion status', () => {
  const rows = [
    { approved: 1, rejected: 0, observationsCount: 0, untrackedRejected: 0 },
    { approved: 1, rejected: 0, observationsCount: 3, untrackedRejected: 0 },
    { approved: 0, rejected: 0, observationsCount: 0, untrackedRejected: 0 },
  ];
  assert.deepEqual(advisorDocumentQuality(rows), { score: 63, sampleSize: 2, rejectedDocuments: 0 });
});

test('rejected document counter remains separate from historical quality errors', () => {
  assert.deepEqual(advisorDocumentQuality([{ approved: 1, rejected: 2, observationsCount: 1, untrackedRejected: 0 }]),
    { score: 50, sampleSize: 1, rejectedDocuments: 2 });
});

test('quality grading covers empty evidence and each threshold', () => {
  for (const [score, grade] of [[null, 'Sin datos'], [100, 'Excelente'], [90, 'Muy bueno'], [75, 'Bueno'], [60, 'Regular'], [40, 'Deficiente'], [10, 'Crítico']]) {
    assert.equal(advisorQualityGrade(score), grade);
  }
});

test('API matches ISO timestamps numerically rather than lexicographic datetime strings', () => {
  const routes = readFileSync(new URL('../worker/case-routes.ts', import.meta.url), 'utf8');
  assert.match(routes, /julianday\(o\.created_at\) - julianday\(e\.occurred_at\)/);
  assert.match(routes, /advisorDocumentQuality\(evidence\.results \|\| \[\]\)/);
});
