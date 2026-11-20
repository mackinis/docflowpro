import type { Case, User } from '../types';

export type CaseStatusFilter = 'all' | Case['status'];

/** The advisor visibility rule is shared by the table and status counters. */
export function visibleCases(cases: Case[], currentUser: Pick<User, 'id' | 'role'>): Case[] {
  return cases.filter(c => currentUser.role !== 'ASESOR' || c.assignedAdvisorId === currentUser.id);
}

export function filterCases(
  cases: Case[],
  currentUser: Pick<User, 'id' | 'role'>,
  searchTerm: string,
  statusFilter: CaseStatusFilter,
  templateFilter: string,
): Case[] {
  const search = searchTerm.toLowerCase();
  return visibleCases(cases, currentUser).filter(c =>
    (c.title.toLowerCase().includes(search) ||
      c.code.toLowerCase().includes(search) ||
      c.description.toLowerCase().includes(search)) &&
    (statusFilter === 'all' || c.status === statusFilter) &&
    (templateFilter === 'all' || c.templateId === templateFilter),
  );
}

export function countCasesByStatus(
  cases: Case[],
  currentUser: Pick<User, 'id' | 'role'>,
  status: CaseStatusFilter,
): number {
  return visibleCases(cases, currentUser).filter(c => status === 'all' || c.status === status).length;
}
