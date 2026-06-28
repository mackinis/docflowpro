import React, { useState } from 'react';
import { 
  FileText, 
  CheckCircle, 
  AlertTriangle, 
  FileCheck2, 
  Clock, 
  Activity, 
  ArrowRight,
  ClipboardList,
  Upload,
  UserCheck
} from 'lucide-react';
import { Case, Document, Task, Observation, AppDataState } from '../types';

interface DashboardAdvisorProps {
  state: AppDataState;
  onOpenCase: (caseId: string) => void;
  onToggleTask: (taskId: string, status: 'pending' | 'completed') => void;
  onReplaceDoc: (caseId: string, stageId: string, reqId: string, docName: string, file: File) => void;
  onResolveObs: (obsId: string, responseText: string) => void;
}

export default function DashboardAdvisor({ 
  state, 
  onOpenCase, 
  onToggleTask,
  onReplaceDoc,
  onResolveObs
}: DashboardAdvisorProps) {
  const { cases, documents, tasks, observations } = state;
  const currentAdvisorId = 'usr-asesor1'; // Lucía (standard advisor)

  // Filter items for current advisor
  const myCases = cases.filter(c => c.assignedAdvisorId === currentAdvisorId);
  const myCasesIds = myCases.map(c => c.id);

  // Stats
  const activeCasesCount = myCases.filter(c => c.status === 'active' || c.status === 'pending_review').length;
  const observedCount = myCases.filter(c => c.status === 'observed').length;
  
  // Pending tasks for my cases
  const myTasks = tasks.filter(t => myCasesIds.includes(t.caseId) && t.status === 'pending');
  // Documents for my cases
  const myDocs = documents.filter(d => myCasesIds.includes(d.caseId));
  // Rejected/observed documents
  const myObservedDocs = myDocs.filter(d => d.status === 'rejected');
  // Open observations for my cases
  const myOpenObs = observations.filter(o => myCasesIds.includes(o.caseId) && o.status === 'open');

  // Interactive replacement states
  const [resolvingObsId, setResolvingObsId] = useState<string | null>(null);
  const [responseComment, setResponseComment] = useState('');

  const handleResolveSubmit = (obsId: string) => {
    if (!responseComment.trim()) return;
    onResolveObs(obsId, responseComment);
    setResolvingObsId(null);
    setResponseComment('');
  };

  return (
    <div className="space-y-6">
      {/* Upper header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-display font-bold text-slate-800 tracking-tight">Mi Panel de Asesor</h2>
          <p className="text-sm text-slate-500">Gestión ágil de expedientes, checklists y observaciones del equipo.</p>
        </div>
        <div className="flex items-center gap-2 px-3.5 py-1.5 bg-blue-50 border border-blue-100 rounded-lg text-xs font-semibold text-blue-700">
          <UserCheck className="w-4 h-4" />
          <span>Lucía Fernández (Asesor)</span>
        </div>
      </div>

      {/* Stats Bento */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between group hover:border-slate-300 transition-all">
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Mis Expedientes</span>
            <p className="text-3xl font-bold text-slate-800">{myCases.length}</p>
          </div>
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl group-hover:scale-110 transition-transform">
            <FileText className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between group hover:border-slate-300 transition-all">
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Casos Activos</span>
            <p className="text-3xl font-bold text-slate-800">{activeCasesCount}</p>
          </div>
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl group-hover:scale-110 transition-transform">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between group hover:border-slate-300 transition-all">
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Documentos Rechazados</span>
            <p className="text-3xl font-bold text-red-600">{myObservedDocs.length}</p>
          </div>
          <div className="p-3 bg-red-50 text-red-600 rounded-xl group-hover:scale-110 transition-transform">
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between group hover:border-slate-300 transition-all">
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Tareas Pendientes</span>
            <p className="text-3xl font-bold text-amber-600">{myTasks.length}</p>
          </div>
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl group-hover:scale-110 transition-transform">
            <ClipboardList className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Main panels: Blockers and Checklist */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Blocked documents & observations (Actionable resolution list) */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <h3 className="text-sm font-bold text-slate-800">Documentos Observados a Resolver</h3>
            </div>
            <span className="bg-red-50 text-red-700 text-xs px-2.5 py-0.5 rounded-full font-bold">
              Bloqueados
            </span>
          </div>

          <div className="flex-1 overflow-y-auto max-h-96 divide-y divide-slate-100 pr-1">
            {myOpenObs.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-center p-8 text-slate-400 space-y-2">
                <CheckCircle className="w-10 h-10 text-emerald-500/85" />
                <p className="text-xs font-semibold text-slate-600">¡Súper limpio!</p>
                <p className="text-[11px] text-slate-400">No tienes ninguna observación abierta ni bloqueo.</p>
              </div>
            ) : (
              myOpenObs.map((obs) => {
                const caseObj = myCases.find(c => c.id === obs.caseId);
                const isDocObs = !!obs.documentId;
                
                return (
                  <div key={obs.id} className="py-3.5 space-y-2 text-left hover:bg-slate-50/50 rounded-lg px-2 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[10px] font-mono">
                        <span className="bg-red-50 text-red-700 px-1.5 py-0.5 rounded font-bold uppercase">{caseObj?.code}</span>
                        <span className="text-slate-400">Observado el {new Date(obs.createdAt).toLocaleDateString()}</span>
                      </div>
                      <button 
                        onClick={() => onOpenCase(obs.caseId)}
                        className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-0.5"
                      >
                        Ver expediente <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="bg-red-50/50 p-2.5 rounded border border-red-100 text-xs text-red-800 font-medium">
                      <p className="font-semibold mb-0.5">{isDocObs ? 'Rechazo de Documento:' : 'Observación de Proceso:'}</p>
                      {obs.text}
                    </div>

                    {resolvingObsId === obs.id ? (
                      <div className="space-y-2 p-2 border border-slate-200 rounded bg-white">
                        <textarea
                          placeholder="Explica qué corrección realizaste o escribe una respuesta para el gestor..."
                          value={responseComment}
                          onChange={(e) => setResponseComment(e.target.value)}
                          className="w-full text-xs p-2 border border-slate-200 rounded focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                          rows={2}
                        />
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setResolvingObsId(null)}
                            className="px-2 py-1 text-[10px] font-semibold text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 rounded"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={() => handleResolveSubmit(obs.id)}
                            className="px-2.5 py-1 text-[10px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-xs"
                          >
                            Responder & Marcar Resuelto
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1.5">
                        {isDocObs && (
                          <label className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[10px] font-bold rounded cursor-pointer transition-colors flex items-center gap-1">
                            <Upload className="w-3 h-3" />
                            Cargar reemplazo
                            <input 
                              type="file" 
                              className="hidden" 
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  onReplaceDoc(obs.caseId, obs.stageId, obs.requirementId!, 'Reemplazo de Documento', file);
                                  alert(`Se cargó el archivo ${file.name} como reemplazo.`);
                                }
                              }} 
                            />
                          </label>
                        )}
                        <button
                          onClick={() => setResolvingObsId(obs.id)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold rounded border border-slate-300 transition-colors"
                        >
                          Escribir respuesta
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Pending checklist */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-indigo-600" />
              <h3 className="text-sm font-bold text-slate-800">Mis Tareas de Etapa Pendientes</h3>
            </div>
            <span className="bg-indigo-50 text-indigo-700 text-xs px-2.5 py-0.5 rounded-full font-bold">
              {myTasks.length} Tareas
            </span>
          </div>

          <div className="flex-1 overflow-y-auto max-h-96 divide-y divide-slate-100 pr-1">
            {myTasks.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-center p-8 text-slate-400 space-y-1">
                <CheckCircle className="w-10 h-10 text-emerald-500/85" />
                <p className="text-xs font-semibold text-slate-600">¡Checklist al 100%!</p>
                <p className="text-[11px] text-slate-400">No posees tareas pendientes en tus expedientes.</p>
              </div>
            ) : (
              myTasks.map((task) => {
                const caseObj = myCases.find(c => c.id === task.caseId);
                return (
                  <div key={task.id} className="py-3 flex items-start justify-between hover:bg-slate-50/50 rounded-lg px-2 transition-colors gap-3">
                    <div className="flex items-start gap-3">
                      <input 
                        type="checkbox" 
                        checked={task.status === 'completed'}
                        onChange={() => onToggleTask(task.id, 'completed')}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                      <div className="space-y-0.5">
                        <p className="text-xs font-bold text-slate-700">{task.name}</p>
                        <p className="text-[11px] text-slate-400 leading-relaxed">{task.description}</p>
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono pt-1">
                          <span className="bg-slate-150 text-slate-600 px-1 py-0.5 rounded font-bold uppercase">{caseObj?.code}</span>
                          <span className="truncate max-w-40">{caseObj?.title}</span>
                        </div>
                      </div>
                    </div>

                    <button 
                      onClick={() => onOpenCase(task.caseId)}
                      className="p-1 text-slate-400 hover:text-indigo-600 rounded hover:bg-indigo-50 transition-colors shrink-0"
                      title="Ver Expediente"
                    >
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Advisor Cases List Overview */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <h3 className="text-sm font-bold text-slate-800 mb-4">Mis Expedientes Asignados</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs divide-y divide-slate-100">
            <thead>
              <tr className="text-slate-400 font-mono uppercase tracking-wider">
                <th className="py-2.5 pb-3">Código</th>
                <th className="py-2.5 pb-3">Título</th>
                <th className="py-2.5 pb-3">Estado</th>
                <th className="py-2.5 pb-3">Fecha de Alta</th>
                <th className="py-2.5 pb-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {myCases.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/40">
                  <td className="py-3 font-mono font-bold text-indigo-600">{c.code}</td>
                  <td className="py-3">
                    <div>
                      <p className="font-semibold text-slate-800">{c.title}</p>
                      <p className="text-[10px] text-slate-400 truncate max-w-sm">{c.description}</p>
                    </div>
                  </td>
                  <td className="py-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold tracking-wider uppercase ${
                      c.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                      c.status === 'observed' ? 'bg-red-50 text-red-700 border border-red-100' :
                      c.status === 'pending_review' ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                      'bg-blue-50 text-blue-700 border border-blue-100'
                    }`}>
                      {c.status === 'completed' ? 'Finalizado' :
                       c.status === 'observed' ? 'Observado' :
                       c.status === 'pending_review' ? 'En Revisión' :
                       'Activo'}
                    </span>
                  </td>
                  <td className="py-3 text-slate-500 font-mono">{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td className="py-3 text-right">
                    <button
                      onClick={() => onOpenCase(c.id)}
                      className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-[10px] font-bold text-slate-700 rounded transition-colors"
                    >
                      Gestionar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
