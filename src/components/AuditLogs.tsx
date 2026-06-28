import React, { useState } from 'react';
import { ShieldAlert, Search, Trash2, ShieldCheck, Database, Calendar } from 'lucide-react';
import { AuditLog, User } from '../types';

interface AuditLogsProps {
  logs: AuditLog[];
  users: User[];
}

export default function AuditLogs({ logs, users }: AuditLogsProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'info' | 'warning' | 'error' | 'success'>('all');

  const getSeverityAndDetails = (log: AuditLog) => {
    const act = log.action.toLowerCase();
    let severity: 'info' | 'success' | 'warning' | 'error' = 'info';
    
    if (act.includes('rechaz') || act.includes('error') || act.includes('bloqueo')) {
      severity = 'error';
    } else if (act.includes('aprob') || act.includes('complet') || act.includes('cread') || act.includes('exito') || act.includes('avanz')) {
      severity = 'success';
    } else if (act.includes('subi') || act.includes('observ') || act.includes('reemplaz')) {
      severity = 'warning';
    }

    const details = `${log.entityType ? `[${log.entityType}] ` : ''}${log.entityName || ''}`.trim() || 'Acción general de plataforma';

    return { severity, details };
  };

  const filteredLogs = logs.filter(log => {
    const { details } = getSeverityAndDetails(log);
    const matchesSearch = log.action.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          details.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          log.userId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          log.userName.toLowerCase().includes(searchTerm.toLowerCase());
    
    const { severity } = getSeverityAndDetails(log);
    const matchesSeverity = severityFilter === 'all' || severity === severityFilter;
    
    return matchesSearch && matchesSeverity;
  }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-display font-bold text-slate-800 tracking-tight">Auditoría</h2>
          <p className="text-sm text-slate-500">Registro inmutable de accesos, aprobaciones documentales, transiciones de etapas y auditoría de IA.</p>
        </div>
        <div className="flex items-center gap-2 px-3.5 py-1.5 bg-indigo-50 border border-indigo-100 rounded-lg text-xs font-semibold text-indigo-700 shrink-0">
          <Database className="w-4 h-4" />
          <span>Base de Datos Segura</span>
        </div>
      </div>

      {/* Toolbar Filter */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por acción, detalles, usuario..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full text-sm pl-10 pr-4 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-50/50"
          />
        </div>

        {/* Severity */}
        <div className="flex items-center gap-2">
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as any)}
            className="text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-700"
          >
            <option value="all">Todas las Severidades</option>
            <option value="info">Información (INFO)</option>
            <option value="success">Éxito (SUCCESS)</option>
            <option value="warning">Alerta (WARNING)</option>
            <option value="error">Error Crítico (ERROR)</option>
          </select>
        </div>
      </div>

      {/* Logs View Container */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        {filteredLogs.length === 0 ? (
          <div className="p-12 text-center text-slate-400 space-y-3">
            <ShieldCheck className="w-12 h-12 text-slate-300 mx-auto" />
            <p className="text-sm font-semibold text-slate-600">No se encontraron logs de auditoría</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs divide-y divide-slate-100">
              <thead className="bg-slate-50 font-mono text-slate-400 uppercase tracking-wider">
                <tr>
                  <th className="p-4 py-3">Fecha y Hora</th>
                  <th className="p-4 py-3">Nivel</th>
                  <th className="p-4 py-3">Usuario</th>
                  <th className="p-4 py-3">Operación / Acción</th>
                  <th className="p-4 py-3">Detalles</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-[11px] text-slate-600">
                {filteredLogs.map((log) => {
                  const user = users.find(u => u.id === log.userId);
                  const { severity, details } = getSeverityAndDetails(log);
                  
                  return (
                    <tr key={log.id} className="hover:bg-slate-50/30">
                      <td className="p-4 whitespace-nowrap text-slate-400 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />
                        {new Date(log.createdAt).toLocaleDateString()} {new Date(log.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase border ${
                          severity === 'error' ? 'bg-red-50 text-red-700 border-red-100' :
                          severity === 'warning' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                          severity === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                          'bg-blue-50 text-blue-700 border-blue-100'
                        }`}>
                          {severity}
                        </span>
                      </td>
                      <td className="p-4 whitespace-nowrap font-sans font-semibold text-slate-700">
                        {log.userName || (user ? `${user.name} ${user.lastName}` : 'Sistema IA')}
                      </td>
                      <td className="p-4 font-sans font-bold text-slate-800">{log.action}</td>
                      <td className="p-4 font-sans text-slate-500 min-w-80 max-w-lg leading-relaxed">{details}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
