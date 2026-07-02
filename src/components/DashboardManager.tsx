import React from 'react';
import { 
  FileText, 
  CheckCircle, 
  AlertTriangle, 
  Clock, 
  Users, 
  TrendingUp, 
  Activity,
  ArrowRight,
  FileCheck2
} from 'lucide-react';
import { Case, Document, User, AppDataState } from '../types';

interface DashboardManagerProps {
  state: AppDataState;
  onOpenCase: (caseId: string) => void;
  onQuickReviewDoc: (docId: string, status: 'approved' | 'rejected', observationText?: string) => void;
}

export default function DashboardManager({ state, onOpenCase, onQuickReviewDoc }: DashboardManagerProps) {
  const { cases, documents, users, auditLogs } = state;

  // Compute metrics
  const activeCases = cases.filter(c => c.status === 'active').length;
  const pendingReview = cases.filter(c => c.status === 'pending_review').length;
  const observedCases = cases.filter(c => c.status === 'observed').length;
  const completedCases = cases.filter(c => c.status === 'completed').length;
  const totalCasesCount = cases.length;

  const totalUploadedDocs = documents.length;
  const approvedDocsCount = documents.filter(d => d.status === 'approved').length;
  const complianceRate = totalUploadedDocs > 0 ? Math.round((approvedDocsCount / totalUploadedDocs) * 100) : 100;

  // Active advisors with their case count
  const advisors = users.filter(u => u.role === 'ASESOR');
  const advisorWorkloads = advisors.map(adv => {
    const count = cases.filter(c => c.assignedAdvisorId === adv.id && c.status !== 'completed').length;
    return {
      name: `${adv.name} ${adv.lastName}`,
      count,
      color: adv.id === 'usr-asesor1' ? 'bg-indigo-500' : 'bg-emerald-500'
    };
  });

  // Fetch pending review documents
  const pendingReviewDocs = documents.filter(d => d.status === 'uploaded');

  // Fetch recently observed documents / observations
  const openObservations = state.observations.filter(o => o.status === 'open').slice(0, 5);

  // Maximum case count for chart scaling
  const maxWorkload = Math.max(...advisorWorkloads.map(w => w.count), 1);

  return (
    <div className="space-y-6">
      {/* Upper header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-display font-bold text-slate-800 tracking-tight">Consola de Control del Gestor</h2>
          <p className="text-sm text-slate-500">Métricas en tiempo real, control documental y estadísticas de asesores.</p>
        </div>
        <div className="flex items-center gap-2 px-3.5 py-1.5 bg-indigo-50 border border-indigo-100 rounded-lg text-xs font-semibold text-indigo-700">
          <Activity className="w-4 h-4 animate-pulse" />
          <span>Sincronizado</span>
        </div>
      </div>

      {/* Modern Bento grid for KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Activos */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between group hover:border-slate-300 transition-all">
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Casos Activos</span>
            <p className="text-3xl font-bold text-slate-800">{activeCases}</p>
          </div>
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl group-hover:scale-110 transition-transform">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        {/* KPI 2: Pendientes */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between group hover:border-slate-300 transition-all">
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">En Revisión</span>
            <p className="text-3xl font-bold text-slate-800">{pendingReview}</p>
          </div>
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl group-hover:scale-110 transition-transform">
            <FileText className="w-6 h-6" />
          </div>
        </div>

        {/* KPI 3: Observados */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between group hover:border-slate-300 transition-all">
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Observados</span>
            <p className="text-3xl font-bold text-red-600">{observedCases}</p>
          </div>
          <div className="p-3 bg-red-50 text-red-600 rounded-xl group-hover:scale-110 transition-transform">
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>

        {/* KPI 4: Finalizados */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between group hover:border-slate-300 transition-all">
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Finalizados</span>
            <p className="text-3xl font-bold text-emerald-600">{completedCases}</p>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl group-hover:scale-110 transition-transform">
            <CheckCircle className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Two Custom Styled SVG Graphics Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Compliance Circle Chart (Radial Gauge) - 4 Cols */}
        <div className="lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col items-center justify-center">
          <h3 className="text-sm font-semibold text-slate-700 self-start mb-4">Índice de Aprobación</h3>
          
          <div className="relative w-40 h-40 flex items-center justify-center">
            {/* Background circle */}
            <svg className="absolute w-full h-full transform -rotate-90">
              <circle
                cx="80"
                cy="80"
                r="64"
                className="stroke-slate-100 fill-none"
                strokeWidth="12"
              />
              {/* Progress circle */}
              <circle
                cx="80"
                cy="80"
                r="64"
                className="stroke-indigo-600 fill-none transition-all duration-1000 ease-out"
                strokeWidth="12"
                strokeDasharray={2 * Math.PI * 64}
                strokeDashoffset={2 * Math.PI * 64 * (1 - complianceRate / 100)}
                strokeLinecap="round"
              />
            </svg>
            <div className="text-center">
              <span className="text-4xl font-display font-extrabold text-slate-800">{complianceRate}%</span>
              <p className="text-[10px] text-slate-400 font-mono tracking-wider uppercase mt-1">Compliance</p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 w-full text-center border-t border-slate-100 pt-4">
            <div>
              <span className="text-sm font-bold text-slate-700">{approvedDocsCount}</span>
              <p className="text-xs text-slate-500 mt-0.5">Aprobados</p>
            </div>
            <div>
              <span className="text-sm font-bold text-slate-700">{totalUploadedDocs}</span>
              <p className="text-xs text-slate-500 mt-0.5">Totales</p>
            </div>
          </div>
        </div>

        {/* Workloads Bar Chart - 7 Cols */}
        <div className="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-1">Carga de Trabajo por Asesor</h3>
            <p className="text-xs text-slate-500 mb-5">Cantidad de legajos activos y observados asignados a cada asesor.</p>
          </div>

          <div className="space-y-4">
            {advisorWorkloads.map((adv, index) => {
              const pct = (adv.count / maxWorkload) * 100;
              return (
                <div key={index} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700">{adv.name}</span>
                    <span className="font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold">
                      {adv.count} {adv.count === 1 ? 'Legajo' : 'Legajos'}
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
                    <div 
                      className={`${adv.color} h-full rounded-full transition-all duration-1000`} 
                      style={{ width: `${Math.max(pct, 4)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-6 text-[11px] text-slate-400 border-t border-slate-100 pt-3">
            <span className="flex items-center gap-1">
              <Users className="w-3.5 h-3.5 text-slate-400" />
              <span>Personal Capacitado</span>
            </span>
            <span>Estadística Mensual</span>
          </div>
        </div>
      </div>

      {/* Action panel: Pending document reviews & Observations list */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Pending review files - Quick Approval Panel */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileCheck2 className="w-5 h-5 text-indigo-600" />
              <h3 className="text-sm font-bold text-slate-800">Pendientes de Aprobación</h3>
            </div>
            <span className="bg-indigo-50 text-indigo-700 text-xs px-2.5 py-0.5 rounded-full font-bold">
              {pendingReviewDocs.length} Docs
            </span>
          </div>

          <div className="flex-1 overflow-y-auto max-h-80 divide-y divide-slate-100 pr-1">
            {pendingReviewDocs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400 space-y-2">
                <CheckCircle className="w-10 h-10 text-emerald-500/85" />
                <p className="text-xs font-semibold text-slate-600">¡Todo al día!</p>
                <p className="text-[11px] text-slate-400">No hay documentos pendientes de revisión.</p>
              </div>
            ) : (
              pendingReviewDocs.map((doc) => {
                const caseObj = cases.find(c => c.id === doc.caseId);
                return (
                  <div key={doc.id} className="py-3 flex items-center justify-between hover:bg-slate-50/50 rounded-lg px-2 transition-colors">
                    <div className="space-y-1 overflow-hidden pr-3">
                      <p className="text-xs font-bold text-slate-700 truncate">{doc.fileName || doc.name}</p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400">
                        <span className="font-mono bg-slate-100 px-1 py-0.5 rounded text-slate-500 uppercase">{caseObj?.code}</span>
                        <span className="truncate max-w-40">{caseObj?.title}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button 
                        onClick={() => onQuickReviewDoc(doc.id, 'approved')}
                        className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded border border-emerald-200 transition-colors"
                      >
                        Aprobar
                      </button>
                      <button 
                        onClick={() => {
                          const obs = prompt("Escribe una observación para rechazar el documento:");
                          if (obs !== null) {
                            onQuickReviewDoc(doc.id, 'rejected', obs);
                          }
                        }}
                        className="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-700 text-[10px] font-bold rounded border border-red-200 transition-colors"
                      >
                        Rechazar
                      </button>
                      <button 
                        onClick={() => onOpenCase(doc.caseId)}
                        className="p-1 text-slate-400 hover:text-slate-600 rounded"
                        title="Ver Legajo"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Observations panel */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <h3 className="text-sm font-bold text-slate-800">Observaciones Abiertas</h3>
            </div>
            <span className="bg-amber-50 text-amber-700 text-xs px-2.5 py-0.5 rounded-full font-bold">
              {openObservations.length} Activas
            </span>
          </div>

          <div className="flex-1 overflow-y-auto max-h-80 divide-y divide-slate-100 pr-1">
            {openObservations.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400 space-y-1">
                <CheckCircle className="w-10 h-10 text-emerald-500/85" />
                <p className="text-xs font-semibold text-slate-600">¡Ningún legajo observado!</p>
              </div>
            ) : (
              openObservations.map((obs) => {
                const caseObj = cases.find(c => c.id === obs.caseId);
                return (
                  <div key={obs.id} className="py-3 flex flex-col gap-1.5 hover:bg-slate-50/50 rounded-lg px-2 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
                        <span className="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold uppercase">{caseObj?.code}</span>
                        <span>{new Date(obs.createdAt).toLocaleDateString()}</span>
                      </div>
                      <button 
                        onClick={() => onOpenCase(obs.caseId)}
                        className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-0.5"
                      >
                        Resolver en caso <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-xs font-medium text-slate-700 line-clamp-2">{obs.text}</p>
                    <div className="text-[10px] text-slate-400">
                      Asociado: <span className="font-semibold text-slate-500">{obs.documentId ? 'Documento Rechazado' : 'General'}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
