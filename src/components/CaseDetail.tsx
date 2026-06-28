import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Calendar, 
  User, 
  Users, 
  CheckCircle, 
  AlertTriangle, 
  Upload, 
  FileText, 
  Check, 
  ChevronRight, 
  Clock, 
  Sparkles, 
  MessageSquare, 
  FileCheck2, 
  Plus, 
  CornerDownRight, 
  Eye, 
  Loader2,
  X,
  FileSpreadsheet
} from 'lucide-react';
import { 
  Case, 
  ProcessTemplate, 
  User as UserType, 
  Document as DocType, 
  Task as TaskType, 
  Observation as ObsType, 
  FormField, 
  Participant, 
  ParticipantType 
} from '../types';

interface CaseDetailProps {
  caseId: string;
  cases: Case[];
  templates: ProcessTemplate[];
  users: UserType[];
  currentUser: UserType;
  documents: DocType[];
  tasks: TaskType[];
  observations: ObsType[];
  formSubmissions: any[];
  onBack: () => void;
  onUploadDoc: (stageId: string, reqId: string, reqName: string, fileName: string, fileSize: number) => void;
  onReviewDoc: (docId: string, status: 'approved' | 'rejected', observationText?: string) => void;
  onToggleTask: (taskId: string, status: 'pending' | 'completed') => void;
  onSubmitForm: (reqId: string, values: Record<string, string | number | boolean>) => void;
  onAddObservation: (stageId: string, reqId: string | undefined, text: string) => void;
  onResolveObservation: (obsId: string, response: string) => void;
  onAdvanceStage: () => void;
  onAddParticipant: (participant: Participant) => void;
}

export default function CaseDetail({
  caseId,
  cases,
  templates,
  users,
  currentUser,
  documents,
  tasks,
  observations,
  formSubmissions,
  onBack,
  onUploadDoc,
  onReviewDoc,
  onToggleTask,
  onSubmitForm,
  onAddObservation,
  onResolveObservation,
  onAdvanceStage,
  onAddParticipant
}: CaseDetailProps) {
  const caseObj = cases.find(c => c.id === caseId);
  if (!caseObj) {
    return (
      <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
        <p className="text-slate-600 font-semibold">El expediente no existe o fue eliminado.</p>
        <button onClick={onBack} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg">Volver</button>
      </div>
    );
  }

  const template = templates.find(t => t.id === caseObj.templateId);
  const advisor = users.find(u => u.id === caseObj.assignedAdvisorId);
  const manager = users.find(u => u.id === caseObj.assignedManagerId);

  const currentStage = template?.stages[caseObj.currentStageIndex];

  // Active sub-tab inside current Stage view
  const [activeSubTab, setActiveSubTab] = useState<'docs' | 'forms' | 'tasks'>('docs');

  // Form submission temp states
  const [formValues, setFormValues] = useState<Record<string, Record<string, string | number | boolean>>>({});

  // Observation custom form states
  const [obsText, setObsText] = useState('');
  const [associatedReqId, setAssociatedReqId] = useState<string | undefined>(undefined);

  // Participant adding in detail page
  const [showAddPart, setShowAddPart] = useState(false);
  const [pType, setPType] = useState<ParticipantType>('Cliente');
  const [pName, setPName] = useState('');
  const [pLastName, setPLastName] = useState('');
  const [pDni, setPDni] = useState('');
  const [pCuit, setPCuit] = useState('');
  const [pEmail, setPEmail] = useState('');
  const [pPhone, setPPhone] = useState('');
  const [pComments, setPComments] = useState('');

  // AI Auditing loading states
  const [auditingDocId, setAuditingDocId] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<any | null>(null);

  // Advancing Stage strict validations state
  const [validation, setValidation] = useState<{ isValid: boolean; missing: string[] }>({ isValid: true, missing: [] });
  const [isAdvancing, setIsAdvancing] = useState(false);

  // Re-run stage compliance check locally
  useEffect(() => {
    if (!currentStage) return;

    const docs = documents.filter(d => d.caseId === caseObj.id && d.stageId === currentStage.id);
    const stageTasks = tasks.filter(t => t.caseId === caseObj.id && t.stageId === currentStage.id);
    const openObs = observations.filter(o => o.caseId === caseObj.id && o.stageId === currentStage.id && o.status === 'open');

    const missing: string[] = [];

    currentStage.requirements.forEach(req => {
      if (!req.isRequired) return;

      if (req.type === 'document') {
        const doc = docs.find(d => d.requirementId === req.id);
        if (!doc || doc.status === 'pending') {
          missing.push(`Documento faltante: "${req.name}"`);
        } else if (doc.status === 'rejected') {
          missing.push(`Documento rechazado: "${req.name}" (Debe solucionarse)`);
        } else if (doc.status === 'in_review' || doc.status === 'uploaded') {
          missing.push(`Documento en revisión: "${req.name}" (Manager debe aprobarlo)`);
        }
      } else if (req.type === 'task') {
        const t = stageTasks.find(task => task.requirementId === req.id);
        if (!t || t.status !== 'completed') {
          missing.push(`Tarea incompleta: "${req.name}"`);
        }
      } else if (req.type === 'form') {
        const sub = formSubmissions.find(s => s.requirementId === req.id);
        if (!sub) {
          missing.push(`Formulario sin enviar: "${req.name}"`);
        }
      }
    });

    if (openObs.length > 0) {
      missing.push(`Hay ${openObs.length} observaciones pendientes de resolución.`);
    }

    setValidation({
      isValid: missing.length === 0,
      missing
    });
  }, [caseObj, currentStage, documents, tasks, observations, formSubmissions]);

  // Handle form input change
  const handleFormInputChange = (reqId: string, fieldId: string, val: string | number | boolean) => {
    setFormValues(prev => ({
      ...prev,
      [reqId]: {
        ...(prev[reqId] || {}),
        [fieldId]: val
      }
    }));
  };

  // Submit form requirement
  const handleFormSubmit = (reqId: string) => {
    const vals = formValues[reqId] || {};
    // Check required fields
    const req = currentStage?.requirements.find(r => r.id === reqId);
    let allOk = true;
    req?.formFields?.forEach(f => {
      if (f.required && (vals[f.id] === undefined || vals[f.id] === '')) {
        allOk = false;
      }
    });

    if (!allOk) {
      alert('Por favor complete todos los campos requeridos en el formulario.');
      return;
    }

    onSubmitForm(reqId, vals);
    alert('Formulario guardado con éxito.');
  };

  // Upload file simulation
  const handleMockFileUpload = (reqId: string, reqName: string) => {
    const defaultFileNames: Record<string, string> = {
      'Reserva Firmada': 'Reserva_Firma_Firmado.pdf',
      'Escritura de Propiedad Antecedente': 'Escritura_Matriz_Certificada.pdf',
      'Plano de Mensura Aprobado': 'Plano_Catastral_Mensurado.pdf',
      'Boleto Compraventa Firmado': 'Boleto_Firmas_Certificadas.pdf',
      'Código de Oferta de Transferencia (COTI)': 'AFIP_COTI_Certificado.pdf',
      'Estado de Deuda de Impuestos': 'Libre_Deuda_Provincial.pdf',
      'Escritura Matriz Definitiva': 'Escritura_Traslativa_Dominio.pdf',
      'DNI de Locatario y Garante': 'DNI_Frente_Reverso_Locatario.pdf',
      'Demostración de Ingresos': 'Recibos_Sueldo_Ultimos3.pdf',
      'Título de Propiedad en Garantía': 'Escritura_Garantia_Inmueble.pdf',
      'Contrato de Locación Firmado': 'Contrato_Locacion_Firmado_Colegio.pdf',
      'Formulario de Solicitud de Préstamo': 'Solicitud_Mutuo_Hipotecario.pdf'
    };

    const fileName = defaultFileNames[reqName] || `${reqName.replace(/\s+/g, '_')}_Copia.pdf`;
    const fileSize = Math.floor(500 * 1024 + Math.random() * 3 * 1024 * 1024); // 500KB to 3.5MB

    onUploadDoc(currentStage!.id, reqId, reqName, fileName, fileSize);
  };

  // AI Compliance Audit Trigger
  const handleAICorrespondenceAudit = async (docId: string, docName: string, reqName: string, reqDesc: string, file: string) => {
    setAuditingDocId(docId);
    setAuditResult(null);

    try {
      const response = await fetch('/api/gemini/analyze-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: docId,
          requirementName: reqName,
          requirementDescription: reqDesc,
          fileName: file,
          uploadedBy: currentUser.id
        })
      });

      const data = await response.json();
      setAuditResult(data);
      
      // Update local context
      if (data.approved) {
        onReviewDoc(docId, 'approved');
      } else {
        onReviewDoc(docId, 'rejected', data.suggestedObservation || 'Rechazado automáticamente por la Auditoría de IA.');
      }
    } catch (e) {
      console.error(e);
      alert('Error ejecutando la auditoría de IA.');
    } finally {
      setAuditingDocId(null);
    }
  };

  // Submit Observation
  const handleAddObsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!obsText.trim() || !currentStage) return;

    onAddObservation(currentStage.id, associatedReqId, obsText);
    setObsText('');
    setAssociatedReqId(undefined);
  };

  // Submit participant additions in details page
  const handleAddParticipantSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pName || !pLastName || !pDni || !pCuit || !pEmail) {
      alert('Por favor complete los campos obligatorios del participante.');
      return;
    }

    const newPart: Participant = {
      id: `part-${Date.now()}`,
      name: pName,
      lastName: pLastName,
      dni: pDni,
      cuitCuil: pCuit,
      email: pEmail,
      phone: pPhone,
      comments: `${pType}: ${pComments}`.trim()
    };

    onAddParticipant(newPart);

    // clear fields
    setPName('');
    setPLastName('');
    setPDni('');
    setPCuit('');
    setPEmail('');
    setPPhone('');
    setPComments('');
    setShowAddPart(false);
  };

  const isAsesor = currentUser.role === 'ASESOR';
  const isManagerOrAdmin = ['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(currentUser.role);

  return (
    <div className="space-y-6">
      {/* Back button & top title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack} 
            className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 border border-indigo-100/50 px-2 rounded">
                {caseObj.code}
              </span>
              <span className="text-xs text-slate-400 font-medium">| {template?.name}</span>
            </div>
            <h2 className="text-xl font-display font-bold text-slate-800 tracking-tight">{caseObj.title}</h2>
          </div>
        </div>

        {/* Global Case state badge */}
        <div className="flex items-center gap-3 shrink-0">
          <span className={`px-3 py-1 rounded-full text-xs font-mono font-bold tracking-wider uppercase border ${
            caseObj.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
            caseObj.status === 'observed' ? 'bg-red-50 text-red-700 border-red-200' :
            caseObj.status === 'pending_review' ? 'bg-amber-50 text-amber-700 border-amber-200' :
            'bg-blue-50 text-blue-700 border-blue-200'
          }`}>
            {caseObj.status === 'completed' ? 'Finalizado' :
             caseObj.status === 'observed' ? 'Observado' :
             caseObj.status === 'pending_review' ? 'En Revisión' :
             'Activo'}
          </span>
        </div>
      </div>

      {/* STAGE TIMELINE / PROCESS STEPPER */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono mb-4">Etapas del Proceso</h3>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-y-4 relative">
          {/* Timeline bar in bg for MD+ */}
          <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-slate-100 -translate-y-1/2 hidden md:block -z-0" />

          {template?.stages.map((stg, index) => {
            const isActive = index === caseObj.currentStageIndex;
            const isCompleted = index < caseObj.currentStageIndex || caseObj.status === 'completed';
            const isUpcoming = index > caseObj.currentStageIndex && caseObj.status !== 'completed';

            return (
              <div 
                key={stg.id} 
                className={`flex items-center gap-3 md:flex-col md:text-center flex-1 relative z-10 ${
                  isActive ? 'text-indigo-600' : isCompleted ? 'text-emerald-600' : 'text-slate-400'
                }`}
              >
                {/* Stepper badge */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 transition-all ${
                  isActive ? 'bg-indigo-600 text-white ring-4 ring-indigo-50 shadow-md' :
                  isCompleted ? 'bg-emerald-500 text-white shadow-sm' :
                  'bg-slate-100 text-slate-500 border border-slate-200'
                }`}>
                  {isCompleted ? <Check className="w-4 h-4" /> : index + 1}
                </div>

                <div className="overflow-hidden md:max-w-32">
                  <p className="text-xs font-bold truncate leading-tight">{stg.name}</p>
                  <p className="text-[10px] text-slate-400 truncate md:block hidden">{stg.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CORE DETAILS ROW (PARTICIPANTS & STAGE REQUIREMENTS) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Side: Participants directory - 4 cols */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-800">Participantes del Caso</h3>
              </div>
              <button 
                onClick={() => setShowAddPart(!showAddPart)}
                className="p-1 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded transition-colors"
                title="Añadir Participante"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {/* Quick adding participant form inside detail panel */}
            {showAddPart && (
              <form onSubmit={handleAddParticipantSubmit} className="p-3 bg-slate-50 rounded-xl border border-slate-150 space-y-2.5 text-xs">
                <p className="font-bold text-slate-700">Agregar Participante</p>
                <div className="space-y-1">
                  <label className="text-[9px] text-slate-500 font-semibold uppercase">Rol</label>
                  <select value={pType} onChange={(e) => setPType(e.target.value as ParticipantType)} className="w-full text-xs p-1.5 bg-white border border-slate-200 rounded">
                    <option value="Cliente">Cliente</option>
                    <option value="Comprador">Comprador</option>
                    <option value="Vendedor">Vendedor</option>
                    <option value="Titular">Titular</option>
                    <option value="Garante">Garante</option>
                    <option value="Apoderado">Apoderado</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input required type="text" placeholder="Nombre" value={pName} onChange={(e) => setPName(e.target.value)} className="p-1.5 border border-slate-200 rounded text-xs" />
                  <input required type="text" placeholder="Apellido" value={pLastName} onChange={(e) => setPLastName(e.target.value)} className="p-1.5 border border-slate-200 rounded text-xs" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input required type="text" placeholder="DNI" value={pDni} onChange={(e) => setPDni(e.target.value)} className="p-1.5 border border-slate-200 rounded text-xs" />
                  <input required type="text" placeholder="CUIT/CUIL" value={pCuit} onChange={(e) => setPCuit(e.target.value)} className="p-1.5 border border-slate-200 rounded text-xs" />
                </div>
                <input required type="email" placeholder="Email" value={pEmail} onChange={(e) => setPEmail(e.target.value)} className="w-full p-1.5 border border-slate-200 rounded text-xs" />
                <input type="text" placeholder="Teléfono" value={pPhone} onChange={(e) => setPPhone(e.target.value)} className="w-full p-1.5 border border-slate-200 rounded text-xs" />
                <input type="text" placeholder="Comentarios" value={pComments} onChange={(e) => setPComments(e.target.value)} className="w-full p-1.5 border border-slate-200 rounded text-xs" />
                <div className="flex justify-end gap-1.5 pt-1">
                  <button type="button" onClick={() => setShowAddPart(false)} className="px-2 py-1 bg-slate-200 hover:bg-slate-300 rounded text-[10px]">Cancelar</button>
                  <button type="submit" className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded text-[10px]">Añadir</button>
                </div>
              </form>
            )}

            <div className="space-y-3.5 divide-y divide-slate-100 max-h-[350px] overflow-y-auto pr-1">
              {caseObj.participants.length === 0 ? (
                <p className="text-xs text-slate-400 italic py-4">No se han registrado participantes aún.</p>
              ) : (
                caseObj.participants.map((p, idx) => (
                  <div key={p.id || idx} className={`pt-3 ${idx === 0 ? 'pt-0' : ''}`}>
                    <div className="flex items-center justify-between text-xs font-semibold mb-1">
                      <span className="text-slate-800">{p.name} {p.lastName}</span>
                      <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[9px] font-mono tracking-wider uppercase">
                        {p.comments?.split(':')[0] || 'Miembro'}
                      </span>
                    </div>
                    <div className="space-y-0.5 text-[10px] text-slate-500 font-mono">
                      <p>DNI: {p.dni}</p>
                      <p>CUIT: {p.cuitCuil}</p>
                      <p className="truncate">Email: {p.email}</p>
                      <p>Tel: {p.phone || 'N/A'}</p>
                    </div>
                    {p.comments && p.comments.includes(':') && (
                      <p className="text-[10px] text-slate-400 italic mt-1 leading-normal">
                        "{p.comments.substring(p.comments.indexOf(':') + 1).trim()}"
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Assigned responsible */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Asignaciones</h3>
            <div className="space-y-2.5 text-xs">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                  {advisor?.name?.[0] || 'A'}
                </div>
                <div>
                  <p className="text-slate-400 text-[10px] uppercase font-mono">Asesor a Cargo</p>
                  <p className="font-bold text-slate-700">{advisor ? `${advisor.name} ${advisor.lastName}` : 'Sin asignar'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 pt-1 border-t border-slate-50">
                <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                  {manager?.name?.[0] || 'M'}
                </div>
                <div>
                  <p className="text-slate-400 text-[10px] uppercase font-mono">Manager Responsable</p>
                  <p className="font-bold text-slate-700">{manager ? `${manager.name} ${manager.lastName}` : 'Sin asignar'}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Active Stage Requirements and Operations - 8 cols */}
        <div className="lg:col-span-8 space-y-6">
          {/* Active Stage Panel */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
            {/* Header info */}
            <div className="p-5 bg-slate-50/50 border-b border-slate-100">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <span className="text-[10px] text-indigo-600 uppercase font-mono font-bold tracking-wider">Etapa en Curso</span>
                  <h3 className="text-base font-bold text-slate-800 mt-0.5">{currentStage?.name}</h3>
                  <p className="text-xs text-slate-500">{currentStage?.description}</p>
                </div>
              </div>
            </div>

            {/* Stage sub-tabs */}
            <div className="flex border-b border-slate-100 bg-slate-50/20 px-4">
              {(['docs', 'forms', 'tasks'] as const).map((tab) => {
                const label = tab === 'docs' ? 'Documentos' :
                              tab === 'forms' ? 'Formularios' : 'Tareas Check';
                const count = currentStage?.requirements.filter(r => {
                  if (tab === 'docs') return r.type === 'document';
                  if (tab === 'forms') return r.type === 'form';
                  return r.type === 'task';
                }).length || 0;

                return (
                  <button
                    key={tab}
                    onClick={() => setActiveSubTab(tab)}
                    className={`px-4 py-3 text-xs font-semibold border-b-2 transition-all -mb-[1px] ${
                      activeSubTab === tab
                        ? 'border-indigo-600 text-indigo-600 font-bold'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {label} ({count})
                  </button>
                );
              })}
            </div>

            {/* Tab content */}
            <div className="p-5">
              {/* 1. DOCUMENTS TAB */}
              {activeSubTab === 'docs' && (
                <div className="space-y-4">
                  {currentStage?.requirements.filter(r => r.type === 'document').length === 0 ? (
                    <p className="text-xs text-slate-400 italic text-center py-6">Esta etapa no requiere documentos.</p>
                  ) : (
                    currentStage?.requirements
                      .filter(r => r.type === 'document')
                      .map((req) => {
                        const doc = documents.find(d => d.caseId === caseObj.id && d.requirementId === req.id);
                        
                        return (
                          <div key={req.id} className="p-4 bg-slate-50 rounded-xl border border-slate-200/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4 group">
                            <div className="space-y-1 overflow-hidden pr-2">
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${req.isRequired ? 'bg-indigo-500' : 'bg-slate-300'}`} title={req.isRequired ? 'Obligatorio' : 'Opcional'} />
                                <h4 className="text-xs font-bold text-slate-800 truncate">{req.name}</h4>
                                {req.isRequired && <span className="text-[8px] bg-indigo-50 text-indigo-700 px-1 rounded font-bold uppercase">Obligatorio</span>}
                              </div>
                              <p className="text-[11px] text-slate-400 leading-normal">{req.description}</p>
                              
                              {/* Loaded file link */}
                              {doc && doc.fileName && (
                                <div className="flex items-center gap-1.5 pt-1 text-[11px] text-slate-500 font-mono">
                                  <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  <span className="truncate max-w-sm font-semibold">{doc.fileName}</span>
                                  <span className="text-[9px] text-slate-400 shrink-0">({Math.round(doc.fileSize! / 1024)} KB)</span>
                                </div>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              {/* Doc Status badge */}
                              {doc ? (
                                <span className={`px-2.5 py-1 rounded text-[9px] font-mono font-bold tracking-wider uppercase border shrink-0 ${
                                  doc.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                  doc.status === 'rejected' ? 'bg-red-50 text-red-700 border-red-200' :
                                  doc.status === 'uploaded' || doc.status === 'in_review' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                  'bg-slate-50 text-slate-500 border-slate-200'
                                }`}>
                                  {doc.status === 'approved' ? 'Aprobado' :
                                   doc.status === 'rejected' ? 'Rechazado' :
                                   'En Revisión'}
                                </span>
                              ) : (
                                <span className="px-2.5 py-1 rounded text-[9px] font-mono font-bold tracking-wider uppercase border bg-slate-50 text-slate-400 border-slate-200 shrink-0">
                                  Pendiente
                                </span>
                              )}

                              {/* Operations for advisors */}
                              {isAsesor && (
                                <button
                                  onClick={() => handleMockFileUpload(req.id, req.name)}
                                  className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-bold rounded-lg shadow-xs flex items-center gap-1.5 transition-all"
                                >
                                  <Upload className="w-3.5 h-3.5 text-slate-400" />
                                  <span>{doc ? 'Reemplazar' : 'Subir Documento'}</span>
                                </button>
                              )}

                              {/* Operations for Managers/Admins */}
                              {isManagerOrAdmin && doc && (
                                <div className="flex items-center gap-1.5">
                                  {doc.status !== 'approved' && (
                                    <button
                                      onClick={() => onReviewDoc(doc.id, 'approved')}
                                      className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-[10px] font-bold rounded-lg transition-colors"
                                    >
                                      Aprobar
                                    </button>
                                  )}
                                  {doc.status !== 'rejected' && (
                                    <button
                                      onClick={() => {
                                        const obs = prompt('Escribe una observación para notificar el rechazo:');
                                        if (obs !== null && obs.trim() !== '') {
                                          onReviewDoc(doc.id, 'rejected', obs);
                                        }
                                      }}
                                      className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-[10px] font-bold rounded-lg transition-colors"
                                    >
                                      Rechazar
                                    </button>
                                  )}

                                  {/* AI COMPLIANCE AUDIT CO-PILOT */}
                                  <button
                                    onClick={() => handleAICorrespondenceAudit(doc.id, doc.fileName || '', req.name, req.description, doc.fileName || '')}
                                    disabled={auditingDocId !== null}
                                    className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[10px] font-bold rounded-lg flex items-center gap-1 transition-all disabled:opacity-50 shrink-0"
                                    title="Ejecutar análisis de cumplimiento automático mediante Inteligencia Artificial"
                                  >
                                    {auditingDocId === doc.id ? (
                                      <>
                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                                        <span>IA Evaluando...</span>
                                      </>
                                    ) : (
                                      <>
                                        <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                                        <span>Auditar con IA</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              )}

              {/* 2. FORMS TAB */}
              {activeSubTab === 'forms' && (
                <div className="space-y-6">
                  {currentStage?.requirements.filter(r => r.type === 'form').length === 0 ? (
                    <p className="text-xs text-slate-400 italic text-center py-6">Esta etapa no requiere completar formularios.</p>
                  ) : (
                    currentStage?.requirements
                      .filter(r => r.type === 'form')
                      .map((req) => {
                        const submittedData = formSubmissions.find(s => s.requirementId === req.id);
                        
                        return (
                          <div key={req.id} className="p-5 bg-slate-50 rounded-xl border border-slate-200/60 space-y-4">
                            <div>
                              <div className="flex items-center gap-2">
                                <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
                                <h4 className="text-xs font-bold text-slate-800">{req.name}</h4>
                                {submittedData ? (
                                  <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase">Guardado</span>
                                ) : (
                                  <span className="bg-slate-100 text-slate-400 border border-slate-200 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase">Pendiente</span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-400 mt-0.5">{req.description}</p>
                            </div>

                            {/* Dynamically render form fields */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              {req.formFields?.map((field: FormField) => {
                                const currentVal = formValues[req.id]?.[field.id] !== undefined 
                                  ? formValues[req.id]?.[field.id] 
                                  : (submittedData?.values?.[field.id] || '');

                                return (
                                  <div key={field.id} className="space-y-1 text-xs">
                                    <label className="font-semibold text-slate-600 flex items-center gap-1">
                                      {field.label}
                                      {field.required && <span className="text-red-500">*</span>}
                                    </label>

                                    {field.type === 'select' ? (
                                      <select
                                        disabled={isManagerOrAdmin}
                                        value={currentVal as string}
                                        onChange={(e) => handleFormInputChange(req.id, field.id, e.target.value)}
                                        className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                      >
                                        <option value="">Seleccione...</option>
                                        {field.options?.map(opt => (
                                          <option key={opt} value={opt}>{opt}</option>
                                        ))}
                                      </select>
                                    ) : field.type === 'boolean' ? (
                                      <div className="flex items-center gap-2 pt-1.5">
                                        <input
                                          disabled={isManagerOrAdmin}
                                          type="checkbox"
                                          checked={!!currentVal}
                                          onChange={(e) => handleFormInputChange(req.id, field.id, e.target.checked)}
                                          className="h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                                        />
                                        <span className="text-xs text-slate-600">Acepta conformidad</span>
                                      </div>
                                    ) : (
                                      <input
                                        disabled={isManagerOrAdmin}
                                        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                                        value={currentVal as string | number}
                                        onChange={(e) => handleFormInputChange(req.id, field.id, field.type === 'number' ? Number(e.target.value) : e.target.value)}
                                        placeholder={`Escribe ${field.label.toLowerCase()}...`}
                                        className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            {/* Save Form buttons */}
                            {isAsesor && (
                              <div className="flex justify-end pt-1">
                                <button
                                  type="button"
                                  onClick={() => handleFormSubmit(req.id)}
                                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-xs transition-all"
                                >
                                  Guardar Respuestas Formulario
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })
                  )}
                </div>
              )}

              {/* 3. TASKS CHECKLIST TAB */}
              {activeSubTab === 'tasks' && (
                <div className="space-y-4">
                  {currentStage?.requirements.filter(r => r.type === 'task').length === 0 ? (
                    <p className="text-xs text-slate-400 italic text-center py-6">Esta etapa no tiene tareas asignadas.</p>
                  ) : (
                    currentStage?.requirements
                      .filter(r => r.type === 'task')
                      .map((req) => {
                        const task = tasks.find(t => t.caseId === caseObj.id && t.requirementId === req.id);
                        const isCompleted = task?.status === 'completed';

                        return (
                          <div key={req.id} className="p-4 bg-slate-50 rounded-xl border border-slate-200/60 flex items-start gap-4">
                            <input
                              type="checkbox"
                              checked={isCompleted}
                              onChange={(e) => {
                                if (task) {
                                  onToggleTask(task.id, e.target.checked ? 'completed' : 'pending');
                                } else {
                                  alert('La tarea no está cargada en base, espere un momento.');
                                }
                              }}
                              className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0"
                            />
                            <div className="space-y-0.5">
                              <h4 className={`text-xs font-bold leading-tight ${isCompleted ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                                {req.name}
                              </h4>
                              <p className="text-[11px] text-slate-400 leading-normal">{req.description}</p>
                              {isCompleted && task?.completedBy && (
                                <p className="text-[10px] text-emerald-600 font-mono pt-1">
                                  Completado por {users.find(u => u.id === task.completedBy)?.name || 'Asesor'} el {new Date(task.completedAt!).toLocaleDateString()}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              )}
            </div>
          </div>

          {/* OBSERVATIONS AND DISCUSSION BOX */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-amber-500" />
                <h3 className="text-sm font-bold text-slate-800">Observaciones y Discusión del Gestor</h3>
              </div>
              <span className="bg-amber-50 text-amber-700 text-xs px-2 py-0.5 rounded-full font-semibold font-mono">
                {observations.filter(o => o.caseId === caseObj.id && o.stageId === currentStage?.id).length} Observaciones
              </span>
            </div>

            {/* Observation list */}
            <div className="space-y-4 max-h-64 overflow-y-auto pr-1">
              {observations.filter(o => o.caseId === caseObj.id && o.stageId === currentStage?.id).length === 0 ? (
                <p className="text-xs text-slate-400 italic py-4">No hay observaciones vigentes para esta etapa del expediente.</p>
              ) : (
                observations
                  .filter(o => o.caseId === caseObj.id && o.stageId === currentStage?.id)
                  .map((obs) => {
                    const creator = users.find(u => u.id === obs.createdBy);
                    const associatedReq = currentStage?.requirements.find(r => r.id === obs.requirementId);

                    return (
                      <div key={obs.id} className="text-xs space-y-1.5 p-3 rounded-xl border border-amber-100 bg-amber-50/20 text-left">
                        <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                          <span className="font-bold text-amber-700">
                            {creator ? `${creator.name} ${creator.lastName}` : 'Auditor IA'} ({creator?.role || 'IA'})
                          </span>
                          <span>{new Date(obs.createdAt).toLocaleDateString()}</span>
                        </div>
                        
                        {associatedReq && (
                          <div className="text-[10px] bg-amber-100/60 text-amber-800 px-1.5 py-0.5 rounded inline-block font-semibold">
                            Requisito: "{associatedReq.name}"
                          </div>
                        )}

                        <p className="text-slate-700 font-medium leading-relaxed">{obs.text}</p>

                        {obs.response ? (
                          <div className="mt-2.5 pl-3 border-l-2 border-slate-300 text-[11px] text-slate-600 space-y-1">
                            <p className="font-semibold text-[10px] text-slate-500 uppercase tracking-wider">Respuesta del Asesor:</p>
                            <p className="italic">"{obs.response}"</p>
                            <p className="text-[9px] font-mono text-slate-400">Marcar como solucionado por asesor el {new Date(obs.resolvedAt!).toLocaleDateString()}</p>
                          </div>
                        ) : (
                          isAsesor && obs.status === 'open' && (
                            <div className="flex justify-end pt-1">
                              <button
                                onClick={() => {
                                  const ans = prompt('Escribe tu respuesta explicativa sobre esta observación para marcarla como solucionada:');
                                  if (ans !== null && ans.trim() !== '') {
                                    onResolveObservation(obs.id, ans);
                                  }
                                }}
                                className="px-2.5 py-1 bg-white hover:bg-slate-100 text-[10px] font-bold text-slate-700 border border-slate-200 rounded"
                              >
                                Responder & Solucionar
                              </button>
                            </div>
                          )
                        )}
                      </div>
                    );
                  })
              )}
            </div>

            {/* Add Observation Form (Managers only) */}
            {isManagerOrAdmin && (
              <form onSubmit={handleAddObsSubmit} className="space-y-3 pt-3 border-t border-slate-100">
                <p className="text-xs font-bold text-slate-700">Crear Observación de Etapa</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="sm:col-span-2">
                    <input
                      type="text"
                      placeholder="Escribe el descargo u observación específica para el asesor..."
                      value={obsText}
                      onChange={(e) => setObsText(e.target.value)}
                      className="w-full text-xs p-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <select
                      value={associatedReqId || ''}
                      onChange={(e) => setAssociatedReqId(e.target.value || undefined)}
                      className="w-full text-xs p-2 border border-slate-200 rounded-lg bg-white"
                    >
                      <option value="">(Sin vincular requisito)</option>
                      {currentStage?.requirements.map(r => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-lg shadow-xs"
                  >
                    Crear Alerta
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* ADVANCEMENT GATING PANEL (THE ABSOLUTE CORE OF THE PLATFORM) */}
          <div className="bg-slate-900 text-slate-100 p-5 rounded-2xl border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <FileCheck2 className={`w-5 h-5 ${validation.isValid ? 'text-emerald-400' : 'text-amber-400'}`} />
                <h3 className="text-sm font-bold">Control de Avance Automatizado</h3>
              </div>
              <p className="text-xs text-slate-400">
                El sistema valida automáticamente que no existan documentos pendientes, rechazados o tareas incompletas en la etapa actual.
              </p>

              {/* Blocker feedback checklist */}
              {!validation.isValid && (
                <div className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-lg text-[11px] text-amber-300 space-y-1.5 mt-2 max-w-lg">
                  <p className="font-bold flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Requisitos pendientes para poder avanzar:
                  </p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {validation.missing.map((m, idx) => (
                      <li key={idx} className="truncate">{m}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="shrink-0 flex flex-col items-center gap-1.5">
              <button
                onClick={() => {
                  setIsAdvancing(true);
                  setTimeout(() => {
                    onAdvanceStage();
                    setIsAdvancing(false);
                  }, 800);
                }}
                disabled={!validation.isValid || isAdvancing}
                className={`w-full md:w-auto px-5 py-3 rounded-xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 ${
                  validation.isValid && !isAdvancing
                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/10 hover:scale-102 cursor-pointer active:scale-98'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/60'
                }`}
              >
                {isAdvancing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>Guardando...</span>
                  </>
                ) : (
                  <>
                    <span>Avanzar de Etapa</span>
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </button>
              {validation.isValid ? (
                <span className="text-[10px] text-emerald-400 font-bold tracking-wider uppercase flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> Todo validado
                </span>
              ) : (
                <span className="text-[10px] text-red-400 font-mono tracking-wider uppercase">
                  Acceso Restringido
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* AI COMPLIANCE AUDIT DISPLAY MODAL */}
      {auditResult && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-indigo-50">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                <h4 className="text-sm font-bold text-indigo-900">Informe de Cumplimiento IA</h4>
              </div>
              <button onClick={() => setAuditResult(null)} className="p-1 text-indigo-700 hover:text-indigo-950 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className={`p-4 rounded-xl border flex items-center gap-3 ${
                auditResult.approved 
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}>
                {auditResult.approved ? (
                  <CheckCircle className="w-6 h-6 shrink-0 text-emerald-600" />
                ) : (
                  <AlertTriangle className="w-6 h-6 shrink-0 text-red-600" />
                )}
                <div>
                  <p className="font-bold text-xs">Resultado: {auditResult.approved ? 'CUMPLIMIENTO VALIDADO' : 'CUMPLIMIENTO RECHAZADO'}</p>
                  <p className="text-[11px] opacity-90">{auditResult.approved ? 'El documento cumple íntegramente las normativas de la etapa.' : 'Se detectaron observaciones requeridas para corrección.'}</p>
                </div>
              </div>

              <div className="prose prose-sm text-xs text-slate-700 max-w-none">
                {auditResult.analysis?.split('\n').map((line: string, idx: number) => {
                  if (line.startsWith('###')) {
                    return <h4 key={idx} className="font-bold text-slate-800 text-xs pt-1.5 mb-1.5">{line.replace('###', '').trim()}</h4>;
                  }
                  if (line.startsWith('**')) {
                    return <p key={idx} className="font-semibold mb-1">{line.replaceAll('**', '').trim()}</p>;
                  }
                  return <p key={idx} className="mb-1 leading-relaxed">{line}</p>;
                })}
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end">
              <button 
                onClick={() => setAuditResult(null)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
