import { useEffect } from 'react';

/** Best-effort navigation audit; excludes form values and sensitive URL parameters. */
export function useNavigationAudit(enabled: boolean, tab: string, caseId: string | null, userId?: string): void {
  useEffect(() => {
    if (!enabled) return;
    void fetch('/api/audit/navigation', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tab, caseId })
    }).catch(() => {});
  }, [tab, caseId, userId]);
}
