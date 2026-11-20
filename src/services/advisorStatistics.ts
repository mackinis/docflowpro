import { cachedJson } from '../utils/requestCache';

export type AdvisorStatisticsRow = {
  advisorId: string;
  name: string;
  lastName: string;
  total: number;
  completed: number;
  observed: number;
  pendingReview: number;
  active: number;
  rejectedDocuments: number;
  score: number | null;
  grade: string;
  sampleSize: number;
  factors: {
    completionRate: number | null;
    documentQuality: number | null;
    observedAvoidance: number | null;
  };
};

/** Network/cache boundary for advisor statistics. Scoring is owned by the API. */
export async function fetchAdvisorStatistics(force = false): Promise<AdvisorStatisticsRow[]> {
  const response = await cachedJson<{ advisors: AdvisorStatisticsRow[] }>(
    'statistics:advisors',
    '/api/statistics/advisors',
    force,
  );
  if (!response || !Array.isArray(response.advisors)) {
    throw new Error('Respuesta de estadísticas inválida');
  }
  return response.advisors;
}
