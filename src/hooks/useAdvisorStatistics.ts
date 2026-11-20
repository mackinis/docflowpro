import { useCallback, useEffect, useState } from 'react';
import { fetchAdvisorStatistics, type AdvisorStatisticsRow } from '../services/advisorStatistics';

/** Owns loading, refresh and error state; view only renders results. */
export function useAdvisorStatistics() {
  const [rows, setRows] = useState<AdvisorStatisticsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    setError('');
    try {
      setRows(await fetchAdvisorStatistics(force));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  return { rows, loading, error, refresh };
}
