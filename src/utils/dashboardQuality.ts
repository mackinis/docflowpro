import type { Case, Document, Observation } from '../types';

/** Quality proxy based on retained evidence, not case completion status. */
export function calculateAdvisorQuality(cases: Case[], documents: Document[], observations: Observation[]) {
  const caseScores = cases.map(item => {
    const caseDocs = documents.filter(doc => doc.caseId === item.id);
    const approved = caseDocs.filter(doc => doc.status === 'approved').length;
    const rejected = caseDocs.filter(doc => doc.status === 'rejected').length;
    const observationsCount = observations.filter(obs => obs.caseId === item.id).length;
    const total = approved + rejected + observationsCount;
    return total > 0 ? 100 * approved / total : null;
  }).filter((value): value is number => value !== null);
  const score = caseScores.length ? Math.round(caseScores.reduce((sum, value) => sum + value, 0) / caseScores.length) : null;
  const grade = score === null ? 'Sin datos' : score >= 95 ? 'Excelente' : score >= 85 ? 'Muy bueno' : score >= 70 ? 'Bueno' : score >= 55 ? 'Regular' : score >= 35 ? 'Deficiente' : 'Crítico';
  return { score, grade, assessedCases: caseScores.length };
}
