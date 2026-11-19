import type { AppDataState } from '../types';
import { calculateAdvisorQuality } from '../utils/dashboardQuality';

/** Single source of truth for advisor dashboard filtering and historical quality. */
export function selectAdvisorDashboard(state: AppDataState, advisorId: string) {
  const myCases = state.cases.filter(c => c.assignedAdvisorId === advisorId);
  const caseIds = new Set(myCases.map(c => c.id));
  const observedCount = myCases.filter(c => c.status === 'observed').length;
  const myTasks = state.tasks.filter(t => caseIds.has(t.caseId) && t.status === 'pending');
  const myDocs = state.documents.filter(d => caseIds.has(d.caseId));
  const myObservedDocs = myDocs.filter(d => d.status === 'rejected');
  const myOpenObs = state.observations.filter(o => caseIds.has(o.caseId) && o.status === 'open');
  const { score, grade } = calculateAdvisorQuality(myCases, state.documents, state.observations);
  return { myCases, observedCount, myTasks, myDocs, myObservedDocs, myOpenObs, score, grade };
}
