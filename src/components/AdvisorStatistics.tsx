import React from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { useAdvisorStatistics } from '../hooks/useAdvisorStatistics';
export default function AdvisorStatistics() {
  const { rows, loading, error, refresh } = useAdvisorStatistics();
  return <section className="space-y-5">
    <div className="flex items-center justify-between gap-3">
      <div><h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><Activity className="w-6 h-6 text-indigo-600" /> Estadísticas de Asesores</h2><p className="text-sm text-slate-500">Calidad histórica del trabajo documental: se consideran rechazos y observaciones durante el proceso, incluso después de finalizar el legajo.</p></div>
      <button type="button" onClick={() => void refresh(true)} disabled={loading} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm flex gap-2 items-center disabled:opacity-50"><RefreshCw className="w-4 h-4" /> Actualizar</button>
    </div>
    {error && <p role="alert" className="text-red-700 bg-red-50 rounded-xl p-4">{error}</p>}
    {!error && <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
      <table className="w-full text-sm text-left"><thead className="bg-slate-50"><tr>{['Asesor','Desempeño','Muestra','Total','Finalizados','Observados','Docs. rechazados','En revisión','Activos'].map(h => <th key={h} className="p-4 whitespace-nowrap">{h}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.advisorId} className="border-t border-slate-100"><td className="p-4 font-semibold">{row.name} {row.lastName}</td><td className="p-4"><span className="font-bold">{row.score === null ? '—' : row.score + '%'}</span><span className="block text-xs text-slate-500">{row.grade}</span></td><td className="p-4">{row.sampleSize}</td>{[row.total,row.completed,row.observed,row.rejectedDocuments,row.pendingReview,row.active].map((n,i) => <td key={i} className="p-4">{n}</td>)}</tr>)}</tbody></table>
      {!loading && rows.length === 0 && <p className="p-4 text-slate-500">No hay asesores para mostrar.</p>}
    </div>}
    {loading && <p className="text-sm text-slate-500">Consultando estadísticas…</p>}
    <p className="text-xs text-slate-500">Índice orientativo, no evaluación laboral definitiva. Fórmula: promedio por legajo con evidencia de 100 × documentos aprobados / (aprobados + rechazados + observaciones históricas). Finalizar un legajo no suma puntos. Sin evidencia documental no se asigna nota. Las observaciones pueden depender de terceros y requieren revisión humana.</p>
  </section>;
}
