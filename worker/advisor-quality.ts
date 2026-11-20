/**
 * Historical documentary quality is based on immutable observations and
 * rejection transitions. An approval never erases an earlier error.
 */
export type CaseQualityEvidence = {
  approved: number;
  rejected: number;
  observationsCount: number;
  untrackedRejected: number;
};

export function caseDocumentQuality(evidence: CaseQualityEvidence): number | null {
  const approved = Math.max(0, Number(evidence.approved) || 0);
  const errors = Math.max(0, Number(evidence.observationsCount) || 0) +
    Math.max(0, Number(evidence.untrackedRejected) || 0);
  return approved + errors > 0 ? 100 * approved / (approved + errors) : null;
}

export function advisorDocumentQuality(evidence: CaseQualityEvidence[]): {
  score: number | null;
  sampleSize: number;
  rejectedDocuments: number;
} {
  const scores = evidence.map(caseDocumentQuality).filter((score): score is number => score !== null);
  return {
    score: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
    sampleSize: scores.length,
    rejectedDocuments: evidence.reduce((sum, item) => sum + Math.max(0, Number(item.rejected) || 0), 0),
  };
}

export function advisorQualityGrade(score: number | null): string {
  return score === null ? 'Sin datos' : score >= 95 ? 'Excelente' : score >= 85 ? 'Muy bueno' :
    score >= 70 ? 'Bueno' : score >= 55 ? 'Regular' : score >= 35 ? 'Deficiente' : 'Crítico';
}
