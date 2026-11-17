import React, { useState, useEffect, useRef } from 'react';
import { 
  ArrowLeft, 
  Calendar, 
  User, 
  Users, 
  CheckCircle, 
  AlertTriangle, 
  Upload, 
  Download,
  FileText, 
  Check, 
  ChevronRight, 
  Clock, 
  History,
  Sparkles, 
  MessageSquare, 
  FileCheck2, 
  Plus, 
  CornerDownRight, 
  Eye, 
  Loader2,
  X,
  FileSpreadsheet,
  Settings,
  Pencil,
  Trash2
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
  ParticipantType,
  UploadRequest
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
  uploadRequests?: UploadRequest[];
  loadState?: () => Promise<void>;
  onBack: () => void;
  onUploadDoc: (stageId: string, reqId: string, reqName: string, fileName: string, fileSize: number, file?: File, onProgress?: (percent: number) => void) => void | Promise<void>;
  onReviewDoc: (docId: string, status: 'approved' | 'rejected', observationText?: string, allowedRoles?: string[]) => void;
  onToggleTask: (taskId: string, status: 'pending' | 'completed') => void;
  onSubmitForm: (reqId: string, values: Record<string, string | number | boolean>) => void;
  onAddObservation: (stageId: string, reqId: string | undefined, text: string) => void;
  onResolveObservation: (obsId: string, response: string) => void;
  onAdvanceStage: () => void;
  onApproveStage: () => void;
  onAddParticipant: (participant: Participant) => void;
  onRemoveParticipant?: (participantId: string) => void;
  onUpdateParticipant?: (participant: Participant) => void;
  onUpdateCaseDocument: (caseId: string, content: string, showDocumentToAll?: boolean, sharedViewMode?: 'both' | 'flow' | 'document') => void;
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
  uploadRequests = [],
  loadState,
  onBack,
  onUploadDoc,
  onReviewDoc,
  onToggleTask,
  onSubmitForm,
  onAddObservation,
  onResolveObservation,
  onAdvanceStage,
  onApproveStage,
  onAddParticipant,
  onRemoveParticipant,
  onUpdateParticipant
}: CaseDetailProps) {
  const caseObj = cases.find(c => c.id === caseId);
  if (!caseObj) {
    return (
      <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
        <p className="text-slate-600 font-semibold">El legajo no existe o fue eliminado.</p>
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Form submission temp states
  const [formValues, setFormValues] = useState<Record<string, Record<string, string | number | boolean>>>({});

  // Observation custom form states
  const [obsText, setObsText] = useState('');
  const [associatedReqId, setAssociatedReqId] = useState<string | undefined>(undefined);

  // Participant adding in detail page
  const [showAddPart, setShowAddPart] = useState(false);
  const [editingParticipantId, setEditingParticipantId] = useState<string | null>(null);
  const [pType, setPType] = useState<ParticipantType>('Vendedor');
  const [pName, setPName] = useState('');
  const [pLastName, setPLastName] = useState('');
  const [pDni, setPDni] = useState('');
  const [pCuit, setPCuit] = useState('');
  const [pEmail, setPEmail] = useState('');
  const [pPhone, setPPhone] = useState('');
  const [pBirthDate, setPBirthDate] = useState('');
  const [pComments, setPComments] = useState('');

  // AI Auditing loading states
  const [auditingDocId, setAuditingDocId] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<any | null>(null);

  // Advancing Stage strict validations state
  const [validation, setValidation] = useState<{ isValid: boolean; missing: string[] }>({ isValid: true, missing: [] });
  const [isAdvancing, setIsAdvancing] = useState(false);

  // Visibility role for approved documents
  const [approvingDoc, setApprovingDoc] = useState<{ id: string; name: string } | null>(null);
  const [selectedAllowedRole, setSelectedAllowedRole] = useState<string>('Todos');

  // Advisor upload requests state
  const [requestingForReqId, setRequestingForReqId] = useState<string | null>(null);
  const [requestedExt, setRequestedExt] = useState('.pdf');

  // Manager upload request review state
  const [reviewingRequest, setReviewingRequest] = useState<UploadRequest | null>(null);
  const [allowedExt, setAllowedExt] = useState('.pdf');
  const [allowedMaxWeight, setAllowedMaxWeight] = useState<number>(5);
  const [responseComment, setResponseComment] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [sharedDocs, setSharedDocs] = useState<any[]>([]);
  const caseFileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<string, { percent: number; status: 'uploading' | 'confirming' | 'success' }>>({});
  const uploadingRef = useRef<Set<string>>(new Set());
  const [pendingUploadContext, setPendingUploadContext] = useState<{
    reqId: string;
    reqName: string;
    allowedExt?: string;
    allowedMaxWeight?: number;
  } | null>(null);

  useEffect(() => {
    const fetchSharedDocs = async () => {
      try {
        const res = await fetch(`/api/shared-documents?userId=${currentUser.id}&role=${currentUser.role}`, {
          credentials: 'include'
        });
        if (res.ok) {
          const data = await res.json();
          setSharedDocs(data);
        }
      } catch (err) {
        console.error('Error fetching shared docs in CaseDetail:', err);
      }
    };
    fetchSharedDocs();
  }, [currentUser]);

  // Re-run stage compliance check locally
  useEffect(() => {
    if (!currentStage) return;

    const docs = documents.filter(d => d.caseId === caseObj.id && d.stageId === currentStage.id);
    const stageTasks = tasks.filter(t => t.caseId === caseObj.id && t.stageId === currentStage.id);
    const openObs = observations.filter(o => o.caseId === caseObj.id && o.stageId === currentStage.id && o.status === 'open');

    const missing: string[] = [];

    currentStage.requirements.forEach(req => {
      // El documento digitalizado es material de referencia, no un requisito documental automático.
      if (req.type === 'document' && req.documentSourceType === 'digital_contract') return;
      if (!req.isRequired || req.documentSourceType === 'digital_contract') return;
      if (req.type === 'actor') {
        const count = caseObj.participants.filter(p => p.role === req.actorRole && p.name?.trim() && p.lastName?.trim() && p.dni?.trim()).length;
        const minimum = Math.max(1, Number(req.minQuantity) || 1);
        if (count < minimum) missing.push(`Actores pendientes: ${req.actorRole || req.name} (${count}/${minimum})`);
      } else if (req.type === 'document') {
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

  // Trigger real file picker for document requirement upload (with authorization check for ASESOR)
  const handleTriggerFileUpload = (reqId: string, reqName: string) => {
    if (uploadingRef.current.has(reqId)) return;
    if (currentUser.role === 'ASESOR' && (caseObj.assignedAdvisorId !== currentUser.id || caseObj.isCurrentStageApproved)) return;
    setPendingUploadContext({ reqId, reqName });
    setTimeout(() => {
      if (caseFileInputRef.current) {
        caseFileInputRef.current.value = '';
        caseFileInputRef.current.click();
      }
    }, 0);
  };

  const handleCaseFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const ctx = pendingUploadContext;
    e.target.value = '';
    setPendingUploadContext(null);

    if (!file || !ctx || !currentStage) return;

    if (currentUser.role === 'ASESOR' && ctx.allowedExt) {
      const expectedExt = ctx.allowedExt.toLowerCase();
      if (!file.name.toLowerCase().endsWith(expectedExt)) {
        alert(`Extensión no permitida. Solo se autorizó subir archivos con extensión ${expectedExt}.`);
        return;
      }
    }

    if (currentUser.role === 'ASESOR' && ctx.allowedMaxWeight) {
      const maxBytes = ctx.allowedMaxWeight * 1024 * 1024;
      if (file.size > maxBytes) {
        alert(`El archivo excede el peso máximo autorizado de ${ctx.allowedMaxWeight} MB.`);
        return;
      }
    }

    if (uploadingRef.current.has(ctx.reqId)) return;
    uploadingRef.current.add(ctx.reqId);
    // Progreso real de bytes transferidos, sin interpolación ni temporizadores ficticios.
    setUploadProgress(prev => ({ ...prev, [ctx.reqId]: { percent: 0, status: 'uploading' } }));
    try {
      await onUploadDoc(currentStage.id, ctx.reqId, ctx.reqName, file.name, file.size, file, percent => {
        setUploadProgress(prev => ({
          ...prev,
          [ctx.reqId]: { percent: Math.min(100, Math.max(0, percent)), status: percent >= 100 ? 'confirming' : 'uploading' }
        }));
      });
      // onUploadDoc awaits loadState(), which refreshes the checklist from the server.
      setUploadProgress(prev => ({ ...prev, [ctx.reqId]: { percent: 100, status: 'success' } }));
    } catch (error) {
      setUploadProgress(prev => {
        const next = { ...prev };
        delete next[ctx.reqId];
        return next;
      });
      alert(error instanceof Error ? error.message : 'No se pudo cargar el archivo.');
    } finally {
      uploadingRef.current.delete(ctx.reqId);
    }
  };

  const handleDownloadCaseDoc = async (docId: string, fileName: string, downloadUrl?: string) => {
    try {
      const url = downloadUrl || `/api/documents/${docId}/download`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo descargar el documento desde Cloudflare R2.');
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch (err: any) {
      alert(err.message || 'Error descargando documento.');
    }
  };

  const handleCreateUploadRequestSubmit = async (stageId: string, reqId: string, reqName: string, requestedExtension: string) => {
    try {
      const response = await fetch('/api/upload-requests/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          caseId,
          stageId,
          requirementId: reqId,
          requirementName: reqName,
          requestedBy: currentUser.id,
          requestedExtension
        })
      });
      if (!response.ok) {
        throw new Error('Error al enviar la solicitud.');
      }
      alert('Solicitud de autorización enviada con éxito al Manager.');
      setRequestingForReqId(null);
      if (loadState) {
        await loadState();
      }
    } catch (err: any) {
      alert(err.message || 'Error al procesar la solicitud.');
    }
  };

  const handleReviewUploadRequestSubmit = async (reqObjId: string, status: 'approved' | 'rejected') => {
    setSubmittingReview(true);
    try {
      const response = await fetch('/api/upload-requests/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: reqObjId,
          status,
          allowedExtension: allowedExt,
          allowedMaxWeight: Number(allowedMaxWeight),
          responseComment,
          reviewedBy: currentUser.id
        })
      });
      if (!response.ok) {
        throw new Error('Error al revisar la solicitud.');
      }
      alert(`Solicitud ${status === 'approved' ? 'aprobada' : 'rechazada'} con éxito.`);
      setReviewingRequest(null);
      setResponseComment('');
      if (loadState) {
        await loadState();
      }
    } catch (err: any) {
      alert(err.message || 'Error al procesar.');
    } finally {
      setSubmittingReview(false);
    }
  };

  // Self-assign manager to case
  const [submittingAssignment, setSubmittingAssignment] = useState(false);
  const handleAcceptAssignment = async () => {
    setSubmittingAssignment(true);
    try {
      const response = await fetch(`/api/cases/${caseObj.id}/assign-manager`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          managerId: currentUser.id,
          currentUserId: currentUser.id
        })
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al aceptar la asignación del legajo.');
      }
      alert('¡Has aceptado la asignación! Ahora eres el Manager asignado a este legajo.');
      if (loadState) {
        await loadState();
      }
    } catch (err: any) {
      alert(err.message || 'Error al procesar la asignación.');
    } finally {
      setSubmittingAssignment(false);
    }
  };

  // Request review from assigned manager
  const [isRequestingReview, setIsRequestingReview] = useState(false);
  const [advisorReviewNote, setAdvisorReviewNote] = useState('');
  const [showReviewRequestModal, setShowReviewRequestModal] = useState(false);
  const [resolvingObservationId, setResolvingObservationId] = useState<string | null>(null);
  const [observationReply, setObservationReply] = useState('');

  // Request reassignment from manager to system
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [reassignReason, setReassignReason] = useState('');
  const [isRequestingReassign, setIsRequestingReassign] = useState(false);

  const handleRequestReassign = async () => {
    if (!reassignReason.trim()) {
      alert('Por favor ingrese un motivo para solicitar la reasignación.');
      return;
    }
    setIsRequestingReassign(true);
    try {
      const response = await fetch(`/api/cases/${caseObj.id}/request-reassignment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          currentUserId: currentUser.id,
          reason: reassignReason
        })
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Error al solicitar la reasignación.');
      }
      alert('¡Solicitud de reasignación enviada al sistema con éxito! Un administrador o superadmin la revisará en el apartado de Mensajes de Sistema.');
      setShowReassignModal(false);
      setReassignReason('');
      if (loadState) {
        await loadState();
      }
    } catch (err: any) {
      alert(err.message || 'Error al enviar la solicitud.');
    } finally {
      setIsRequestingReassign(false);
    }
  };

  const handleRequestReview = async () => {
    setIsRequestingReview(true);
    try {
      const response = await fetch(`/api/cases/${caseObj.id}/request-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          currentUserId: currentUser.id,
          note: advisorReviewNote
        })
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Error al solicitar la revisión.');
      }
      alert('¡Solicitud de revisión enviada al Manager con éxito!');
      setShowReviewRequestModal(false);
      setAdvisorReviewNote('');
      if (loadState) {
        await loadState();
      }
    } catch (err: any) {
      alert(err.message || 'Error al solicitar la revisión.');
    } finally {
      setIsRequestingReview(false);
    }
  };

  // AI Compliance Audit Trigger (Cloudflare Workers AI)
  const handleAICorrespondenceAudit = async (docId: string, docName: string, reqName: string, reqDesc: string, file: string) => {
    setAuditingDocId(docId);
    setAuditResult(null);

    try {
      const response = await fetch('/api/ai/analyze-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          documentId: docId,
          requirementName: reqName,
          requirementDescription: reqDesc,
          fileName: file,
          uploadedBy: currentUser.id
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Error ejecutando la auditoría con Cloudflare Workers AI.');
      }
      setAuditResult(data);

      // Worker already persists document review status, observations, and notifications in D1
      if (loadState) {
        await loadState();
      }
    } catch (e: any) {
      console.error(e);
      alert(e.message || 'Error ejecutando la auditoría de IA.');
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

  const handleStartEditParticipant = (p: Participant) => {
    setEditingParticipantId(p.id);
    setPName(p.name);
    setPLastName(p.lastName);
    setPDni(p.dni || '');
    setPCuit(p.cuitCuil || '');
    setPEmail(p.email || '');
    setPPhone(p.phone || '');
    setPBirthDate(p.birthDate || '');
    setPType(p.role || 'Vendedor');
    
    // Extract comments without role prefix
    const rolePrefix = `${p.role || p.comments?.split(':')[0]}:`;
    if (p.comments && p.comments.startsWith(rolePrefix)) {
      setPComments(p.comments.substring(rolePrefix.length).trim());
    } else {
      setPComments(p.comments || '');
    }
    setShowAddPart(true); // Open the actor creation/edit panel
  };

  // Submit participant additions/edits in details page
  const handleAddParticipantSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pName || !pLastName || !pDni || !pCuit || !pBirthDate || !pEmail || !pPhone) {
      alert('Favor de completar todos los campos obligatorios del actor (Nombre, Apellido, Fecha de Nacimiento, DNI, CUIT/CUIL, Email, Teléfono/Celular).');
      return;
    }

    if (editingParticipantId) {
      if (onUpdateParticipant) {
        onUpdateParticipant({
          id: editingParticipantId,
          name: pName,
          lastName: pLastName,
          dni: pDni,
          cuitCuil: pCuit,
          email: pEmail,
          phone: pPhone,
          birthDate: pBirthDate,
          role: pType,
          comments: `${pType}: ${pComments}`.trim()
        });
      }
      setEditingParticipantId(null);
    } else {
      const newPart: Participant = {
        id: `part-${Date.now()}`,
        name: pName,
        lastName: pLastName,
        dni: pDni,
        cuitCuil: pCuit,
        email: pEmail,
        phone: pPhone,
        birthDate: pBirthDate,
        role: pType,
        comments: `${pType}: ${pComments}`.trim()
      };
      onAddParticipant(newPart);
    }

    // clear fields
    setPName('');
    setPLastName('');
    setPDni('');
    setPCuit('');
    setPEmail('');
    setPPhone('');
    setPBirthDate('');
    setPComments('');
    setShowAddPart(false);
  };

  const isAsesor = currentUser.role === 'ASESOR';
  const isManagerOrAdmin = ['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(currentUser.role);
  const isSuperAdmin = currentUser.role === 'SUPERADMIN';
  const isAdmin = currentUser.role === 'ADMIN';
  const isAdminOrSuperAdmin = isSuperAdmin || isAdmin;

  return (
    <div className="space-y-6">
      <CaseHistoryPanel caseId={caseObj.id} createdAt={caseObj.createdAt} status={caseObj.status} />
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

          {isSuperAdmin && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg transition-colors shadow-xs cursor-pointer animate-pulse"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Eliminar Legajo</span>
            </button>
          )}
        </div>
      </div>

      {/* Único entorno del legajo: etapas y requisitos del proceso. */}
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

                <div className="min-w-0 w-full md:px-2">
                  <p className="text-xs font-bold leading-snug whitespace-normal break-words">{stg.name}</p>
                  <p className="mt-1 text-[10px] text-slate-400 leading-snug whitespace-normal break-words">{stg.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CORE DETAILS ROW (ACTORES & STAGE REQUIREMENTS) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Side: Actors directory - 4 cols */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-800">Actores del Caso</h3>
              </div>
              <button 
                onClick={() => setShowAddPart(!showAddPart)}
                className="p-1 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded transition-colors"
                title="Añadir Actor"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {/* Quick adding/editing actor form inside detail panel */}
            {showAddPart && (
              <form onSubmit={handleAddParticipantSubmit} className="p-3 bg-slate-50 rounded-xl border border-slate-150 space-y-2.5 text-xs">
                <p className="font-bold text-slate-700">{editingParticipantId ? 'Editar Actor' : 'Agregar Actor'}</p>
                <div className="space-y-1">
                  <label className="text-[9px] text-slate-500 font-semibold uppercase">Rol del Actor</label>
                  <select value={pType} onChange={(e) => setPType(e.target.value as ParticipantType)} className="w-full text-xs p-1.5 bg-white border border-slate-200 rounded">
                    <option value="Vendedor">Vendedor</option>
                    <option value="Comprador">Comprador</option>
                    <option value="Garante">Garante</option>
                    <option value="Escribano">Escribano</option>
                    <option value="Cliente">Cliente</option>
                    <option value="Titular">Titular</option>
                    <option value="Apoderado">Apoderado</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input required type="text" placeholder="Nombre *" value={pName} onChange={(e) => setPName(e.target.value)} className="p-1.5 border border-slate-200 rounded text-xs" />
                  <input required type="text" placeholder="Apellido *" value={pLastName} onChange={(e) => setPLastName(e.target.value)} className="p-1.5 border border-slate-200 rounded text-xs" />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] text-slate-500 font-semibold uppercase">Fecha de Nacimiento *</label>
                  <input required type="date" value={pBirthDate} onChange={(e) => setPBirthDate(e.target.value)} className="w-full p-1.5 border border-slate-200 rounded text-xs" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input required type="text" placeholder="DNI *" value={pDni} onChange={(e) => setPDni(e.target.value)} className="p-1.5 border border-slate-200 rounded text-xs" />
                  <input required type="text" placeholder="CUIT/CUIL *" value={pCuit} onChange={(e) => setPCuit(e.target.value)} className="p-1.5 border border-slate-200 rounded text-xs" />
                </div>
                <input required type="email" placeholder="Email *" value={pEmail} onChange={(e) => setPEmail(e.target.value)} className="w-full p-1.5 border border-slate-200 rounded text-xs" />
                <input required type="text" placeholder="Teléfono/Celular *" value={pPhone} onChange={(e) => setPPhone(e.target.value)} className="w-full p-1.5 border border-slate-200 rounded text-xs" />
                <input type="text" placeholder="Observaciones" value={pComments} onChange={(e) => setPComments(e.target.value)} className="w-full p-1.5 border border-slate-200 rounded text-xs" />
                <div className="flex justify-end gap-1.5 pt-1">
                  <button 
                    type="button" 
                    onClick={() => {
                      setEditingParticipantId(null);
                      setPName('');
                      setPLastName('');
                      setPDni('');
                      setPCuit('');
                      setPEmail('');
                      setPPhone('');
                      setPBirthDate('');
                      setPComments('');
                      setShowAddPart(false);
                    }} 
                    className="px-2 py-1 bg-slate-200 hover:bg-slate-300 rounded text-[10px]"
                  >
                    Cancelar
                  </button>
                  <button type="submit" className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded text-[10px]">
                    {editingParticipantId ? 'Guardar Cambios' : 'Añadir'}
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-3.5 divide-y divide-slate-100 max-h-[350px] overflow-y-auto pr-1">
              {caseObj.participants.length === 0 ? (
                <p className="text-xs text-slate-400 italic py-4">No se han registrado actores aún.</p>
              ) : (
                caseObj.participants.map((p, idx) => (
                  <div key={p.id || idx} className={`pt-3 ${idx === 0 ? 'pt-0' : ''}`}>
                    <div className="flex items-center justify-between text-xs font-semibold mb-1">
                      <span className="text-slate-800">{p.name} {p.lastName}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase">
                          {p.role || p.comments?.split(':')[0] || 'Actor'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleStartEditParticipant(p)}
                          className="text-slate-400 hover:text-indigo-600 p-0.5 rounded transition-colors cursor-pointer"
                          title="Editar Actor"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`¿Está seguro de eliminar al actor "${p.name} {p.lastName}"?`)) {
                              if (onRemoveParticipant) onRemoveParticipant(p.id);
                            }
                          }}
                          className="text-slate-400 hover:text-red-600 p-0.5 rounded transition-colors cursor-pointer"
                          title="Eliminar Actor"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-0.5 text-[10px] text-slate-500 font-mono">
                      <p>DNI: {p.dni || 'N/A'}</p>
                      <p>CUIT: {p.cuitCuil || 'N/A'}</p>
                      <p>F. Nac: {p.birthDate || 'N/A'}</p>
                      <p className="truncate">Email: {p.email || 'N/A'}</p>
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
              {currentUser.role === 'SUPERADMIN' ? (
                <div className="pt-2.5 border-t border-slate-100 space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Reasignar Responsable (Superadmin)</label>
                  <select
                    disabled={submittingAssignment}
                    value={caseObj.assignedManagerId || ''}
                    onChange={async (e) => {
                      const selectedId = e.target.value;
                      if (!selectedId) return;
                      setSubmittingAssignment(true);
                      try {
                        const response = await fetch(`/api/cases/${caseObj.id}/assign-manager`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          credentials: 'include',
                          body: JSON.stringify({ managerId: selectedId, currentUserId: currentUser.id })
                        });
                        if (!response.ok) {
                          const err = await response.json();
                          throw new Error(err.error);
                        }
                        alert('Legajo reasignado exitosamente por Superadmin.');
                        if (loadState) {
                          await loadState();
                        }
                      } catch (err: any) {
                        alert(`Error al reasignar: ${err.message}`);
                      } finally {
                        setSubmittingAssignment(false);
                      }
                    }}
                    className="w-full text-xs bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="" disabled>Seleccionar Responsable...</option>
                    {users.filter(u => ['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(u.role)).map(u => (
                      <option key={u.id} value={u.id}>{u.name} {u.lastName} ({u.role})</option>
                    ))}
                  </select>
                </div>
              ) : (
                <>
                  {isManagerOrAdmin && caseObj.assignedManagerId !== currentUser.id && (
                    <div className="pt-2 border-t border-slate-100 space-y-1.5">
                      <button
                        onClick={handleAcceptAssignment}
                        disabled={!!caseObj.assignedManagerId || submittingAssignment}
                        className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 text-white font-bold text-xs rounded-xl shadow-xs transition-all ${
                          caseObj.assignedManagerId 
                            ? 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300' 
                            : 'bg-emerald-600 hover:bg-emerald-700 cursor-pointer active:scale-98'
                        }`}
                      >
                        {submittingAssignment ? 'Asignando...' : caseObj.assignedManagerId ? '🔒 Asignación Cerrada' : '✍️ Aceptar Asignación'}
                      </button>
                      {caseObj.assignedManagerId && (
                        <p className="text-[10px] text-slate-400 italic text-center leading-normal">
                          Este legajo ya tiene un Manager asignado. Solo el Superadmin puede modificar la asignación directa.
                        </p>
                      )}
                    </div>
                  )}

                  {currentUser.role === 'MANAGER' && caseObj.assignedManagerId === currentUser.id && (
                    <div className="pt-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => setShowReassignModal(true)}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold text-xs rounded-xl transition-all cursor-pointer"
                      >
                        🔄 Solicitar Reasignación
                      </button>
                    </div>
                  )}
                </>
              )}
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
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-indigo-600 uppercase font-mono font-bold tracking-wider">Etapa en Curso</span>
                    {caseObj.isCurrentStageApproved && (
                      <span className="text-[9px] bg-emerald-500 text-white font-bold px-2 py-0.5 rounded-lg flex items-center gap-1 uppercase tracking-wider animate-pulse">
                        <Check className="w-3 h-3" /> Aprobada
                      </span>
                    )}
                  </div>
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
                  {currentStage?.requirements.filter(r => r.type === 'document' && r.documentSourceType !== 'digital_contract').length === 0 ? (
                    <p className="text-xs text-slate-400 italic text-center py-6">Esta etapa no requiere documentos.</p>
                  ) : (
                    currentStage?.requirements
                      .filter(r => r.type === 'document')
                      .map((req) => {
                        const originalDoc = documents.find(d => d.caseId === caseObj.id && d.requirementId === req.id);
                        const isDocVisible = !originalDoc || originalDoc.status !== 'approved' || !originalDoc.allowedRoles || originalDoc.allowedRoles.includes(currentUser.role) || currentUser.role === 'SUPERADMIN' || currentUser.role === 'ADMIN';
                        const doc = isDocVisible ? originalDoc : undefined;
                        const isDownloadAsset = req.documentSourceType === 'download_asset';
                        const linkedSharedDoc = isDownloadAsset ? sharedDocs.find(d => d.id === req.linkedSharedDocumentId) : null;
                        
                        return (
                          <div key={req.id} className="p-4 bg-slate-50 rounded-xl border border-slate-200/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4 group">
                            <div className="space-y-1 overflow-hidden pr-2">
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${req.isRequired ? 'bg-indigo-500' : 'bg-slate-300'}`} title={req.isRequired ? 'Obligatorio' : 'Opcional'} />
                                <h4 className="text-xs font-bold text-slate-800 truncate">{req.name}</h4>
                                {req.isRequired && <span className="text-[8px] bg-indigo-50 text-indigo-700 px-1 rounded font-bold uppercase">Obligatorio</span>}
                              </div>
                              <p className="text-[11px] text-slate-400 leading-normal">{req.description}</p>
                              
                              
                              {isDownloadAsset && linkedSharedDoc && (
                                <div className="mt-1.5 space-y-1 bg-emerald-50/50 p-2 rounded border border-emerald-100 text-left w-fit max-w-sm">
                                  <span className="text-[9px] text-emerald-800 font-bold uppercase tracking-wider block">📥 Archivo de la Biblioteca:</span>
                                  <p className="text-[10px] text-emerald-700 font-medium">Debe descargarse: <strong>{linkedSharedDoc.name}</strong></p>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        const url = linkedSharedDoc.downloadUrl || `/api/shared-documents/${linkedSharedDoc.id}/download`;
                                        const res = await fetch(url, { credentials: 'include' });
                                        if (!res.ok) {
                                          throw new Error('Contenido descargable no disponible en R2.');
                                        }
                                        const blob = await res.blob();
                                        const objectUrl = URL.createObjectURL(blob);
                                        const link = document.createElement('a');
                                        link.href = objectUrl;
                                        link.download = linkedSharedDoc.fileName;
                                        document.body.appendChild(link);
                                        link.click();
                                        document.body.removeChild(link);
                                        URL.revokeObjectURL(objectUrl);
                                      } catch (err: any) {
                                        alert(err.message || 'Contenido descargable no disponible.');
                                      }
                                    }}
                                    className="mt-1 flex items-center gap-1 px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[9px] font-bold cursor-pointer transition-colors"
                                  >
                                    Descargar {linkedSharedDoc.fileName}
                                  </button>
                                </div>
                              )}

                              {isManagerOrAdmin && (() => {
                                const pendingReqForManager = uploadRequests?.find(
                                  r => r.caseId === caseId && r.requirementId === req.id && r.status === 'pending'
                                );
                                if (!pendingReqForManager) return null;
                                return (
                                  <div className="mt-2.5 p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2 max-w-md">
                                    <div className="flex items-center gap-1.5 text-amber-800 text-[11px] font-bold">
                                      <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                                      <span>Solicitud de Autorización de Subida de Archivo</span>
                                    </div>
                                    <p className="text-[10px] text-amber-700">
                                      El asesor solicitó autorización para subir un archivo con extensión <strong>{pendingReqForManager.requestedExtension}</strong> para este requerimiento.
                                    </p>
                                    
                                    {reviewingRequest?.id === pendingReqForManager.id ? (
                                      <div className="space-y-3 pt-2 border-t border-amber-200/50">
                                        <div className="grid grid-cols-2 gap-2">
                                          <div>
                                            <label className="block text-[9px] font-bold text-slate-500 uppercase">Extensión Permitida</label>
                                            <select
                                              value={allowedExt}
                                              onChange={(e) => setAllowedExt(e.target.value)}
                                              className="mt-1 w-full text-[10px] p-1.5 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-500"
                                            >
                                              <option value=".pdf">.pdf (Recomendado)</option>
                                              <option value=".docx">.docx</option>
                                              <option value=".doc">.doc</option>
                                              <option value=".xlsx">.xlsx</option>
                                              <option value=".xls">.xls</option>
                                              <option value=".png">.png</option>
                                              <option value=".jpg">.jpg</option>
                                            </select>
                                          </div>
                                          <div>
                                            <label className="block text-[9px] font-bold text-slate-500 uppercase">Peso Máximo ({allowedMaxWeight}MB)</label>
                                            <select
                                              value={allowedMaxWeight}
                                              onChange={(e) => setAllowedMaxWeight(Number(e.target.value))}
                                              className="mt-1 w-full text-[10px] p-1.5 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-500"
                                            >
                                              {Array.from({ length: 25 }, (_, i) => i + 1).map(num => (
                                                <option key={num} value={num}>{num} MB</option>
                                              ))}
                                            </select>
                                          </div>
                                        </div>
                                        <div>
                                          <label className="block text-[9px] font-bold text-slate-500 uppercase">Comentario / Nota (Opcional)</label>
                                          <input
                                            type="text"
                                            value={responseComment}
                                            onChange={(e) => setResponseComment(e.target.value)}
                                            placeholder="Ej: Solo PDF firmado o motivo del rechazo..."
                                            className="mt-1 w-full text-[10px] p-1.5 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-500"
                                          />
                                        </div>
                                        <div className="flex items-center justify-end gap-2 pt-1">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setReviewingRequest(null);
                                              setResponseComment('');
                                            }}
                                            className="px-2 py-1 text-[10px] font-semibold text-slate-500 hover:text-slate-700 cursor-pointer"
                                          >
                                            Cancelar
                                          </button>
                                          <button
                                            type="button"
                                            disabled={submittingReview}
                                            onClick={() => handleReviewUploadRequestSubmit(pendingReqForManager.id, 'rejected')}
                                            className="px-2.5 py-1 text-[10px] font-bold bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 rounded-md transition-all cursor-pointer"
                                          >
                                            Rechazar
                                          </button>
                                          <button
                                            type="button"
                                            disabled={submittingReview}
                                            onClick={() => handleReviewUploadRequestSubmit(pendingReqForManager.id, 'approved')}
                                            className="px-3 py-1 text-[10px] font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-md shadow-xs transition-all cursor-pointer"
                                          >
                                            {submittingReview ? 'Procesando...' : 'Aprobar Solicitud'}
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-2 pt-1">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setReviewingRequest(pendingReqForManager);
                                            setAllowedExt(pendingReqForManager.requestedExtension || '.pdf');
                                            setAllowedMaxWeight(5);
                                            setResponseComment('');
                                          }}
                                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-[10px] shadow-xs cursor-pointer transition-colors"
                                        >
                                          Evaluar Solicitud
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}

                              {/* Loaded file link */}
                              {doc && doc.fileName && (
                                <div className="flex items-center gap-1.5 pt-1 text-[11px] text-slate-500 font-mono">
                                  <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  <span className="truncate max-w-sm font-semibold">{doc.fileName}</span>
                                  <span className="text-[9px] text-slate-400 shrink-0">({Math.round((doc.fileSize || 0) / 1024)} KB)</span>
                                  <button
                                    type="button"
                                    onClick={() => handleDownloadCaseDoc(doc.id, doc.fileName!, doc.downloadUrl)}
                                    className="ml-1 inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded text-[9px] font-bold cursor-pointer transition-colors"
                                  >
                                    <Download className="w-3 h-3" />
                                    <span>Descargar</span>
                                  </button>
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

                              {/* Carga de requisitos del legajo asignado: no requiere permiso documental general. */}
                              {isAsesor && caseObj.assignedAdvisorId === currentUser.id && !caseObj.isCurrentStageApproved && (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => handleTriggerFileUpload(req.id, req.name)}
                                    disabled={uploadProgress[req.id]?.status === 'uploading' || uploadProgress[req.id]?.status === 'confirming'}
                                    className={`relative overflow-hidden min-w-[124px] px-3 py-1.5 text-white text-[10px] font-bold rounded-lg shadow-sm flex items-center justify-center gap-1.5 transition-colors ${(uploadProgress[req.id]?.status === 'success' || (doc && !uploadProgress[req.id])) ? 'bg-green-600 hover:bg-green-700' : 'bg-indigo-600 hover:bg-indigo-700'} disabled:cursor-wait cursor-pointer`}
                                  >
                                    {(uploadProgress[req.id]?.status === 'uploading' || uploadProgress[req.id]?.status === 'confirming') && (
                                      <span
                                        aria-hidden="true"
                                        className="absolute inset-y-0 left-0 bg-green-600 transition-[width] duration-200 ease-out"
                                        style={{ width: `${uploadProgress[req.id].percent}%` }}
                                      />
                                    )}
                                    <span className="relative z-10 flex items-center gap-1.5">
                                      {(uploadProgress[req.id]?.status === 'success' || (doc && !uploadProgress[req.id])) ? <Check className="w-3.5 h-3.5" /> : <Upload className="w-3.5 h-3.5" />}
                                      <span>{(uploadProgress[req.id]?.status === 'success' || (doc && !uploadProgress[req.id])) ? 'Archivo cargado ✓' : uploadProgress[req.id]?.status === 'confirming' ? 'Guardando...' : uploadProgress[req.id]?.status === 'uploading' ? `Subiendo ${uploadProgress[req.id].percent}%` : doc ? 'Reemplazar archivo' : 'Cargar Archivo'}</span>
                                    </span>
                                  </button>
                                </div>
                              )}

                              {/* Operations for Managers/Admins */}
                              {isManagerOrAdmin && doc && (
                                <div className="flex items-center gap-1.5">
                                  {doc.status !== 'approved' && (
                                    <button
                                      disabled={caseObj.isCurrentStageApproved}
                                      onClick={() => {
                                        setApprovingDoc({ id: doc.id, name: req.name });
                                        setSelectedAllowedRole('Todos');
                                      }}
                                      className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-[10px] font-bold rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      Aprobar
                                    </button>
                                  )}
                                  {doc.status !== 'rejected' && (
                                    <button
                                      disabled={caseObj.isCurrentStageApproved}
                                      onClick={() => {
                                        const obs = prompt('Escribe una observación para notificar el rechazo:');
                                        if (obs !== null && obs.trim() !== '') {
                                          onReviewDoc(doc.id, 'rejected', obs);
                                        }
                                      }}
                                      className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-[10px] font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                      title={caseObj.isCurrentStageApproved ? "La etapa ya está aprobada" : undefined}
                                    >
                                      Rechazar
                                    </button>
                                  )}

                                  {/* AI COMPLIANCE AUDIT CO-PILOT */}
                                  <button
                                    onClick={() => handleAICorrespondenceAudit(doc.id, doc.fileName || '', req.name, req.description, doc.fileName || '')}
                                    disabled={auditingDocId !== null || caseObj.isCurrentStageApproved}
                                    className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[10px] font-bold rounded-lg flex items-center gap-1 transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
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
                <p className="text-xs text-slate-400 italic py-4">No hay observaciones vigentes para esta etapa del legajo.</p>
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
                                onClick={() => { setResolvingObservationId(obs.id); setObservationReply(''); }}
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
                <FileCheck2 className={`w-5 h-5 ${validation.isValid ? 'text-emerald-400' : 'text-red-400'}`} />
                <h3 className="text-sm font-bold">Control de Avance Automatizado</h3>
              </div>
              <p className="text-xs text-slate-400">
                El sistema valida automáticamente que no existan documentos pendientes, rechazados o tareas incompletas en la etapa actual.
              </p>

              {/* Blocker feedback checklist */}
              {!validation.isValid && (
                <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-lg text-[11px] text-red-400 space-y-1.5 mt-2 max-w-lg">
                  <p className="font-bold flex items-center gap-1.5 text-red-300">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-400" />
                    Requisitos pendientes para poder avanzar:
                  </p>
                  <ul className="list-disc list-inside space-y-0.5 text-red-300">
                    {validation.missing.map((m, idx) => (
                      <li key={idx} className="truncate">{m}</li>
                    ))}
                  </ul>
                </div>
              )}

              {caseObj.status === 'pending_review' && ['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(currentUser.role) && (
                <div className="bg-amber-500/15 border border-amber-500/30 p-3 rounded-lg text-[11px] text-amber-300 font-medium max-w-lg mt-2">
                  🔔 El Asesor ha completado el trabajo de esta etapa y solicita su revisión y aprobación.
                </div>
              )}
            </div>

            <div className="shrink-0 flex flex-col items-center gap-1.5 w-full md:w-auto">
              {currentUser.role === 'ASESOR' ? (
                <>
                  {caseObj.isCurrentStageApproved ? (
                    <div className="text-center space-y-1">
                      <div className="w-full md:w-auto px-5 py-3 rounded-xl font-bold text-sm bg-emerald-950/40 text-emerald-400 border border-emerald-500/30 flex items-center justify-center gap-2">
                        <Check className="w-4 h-4" />
                        <span>Etapa Aprobada</span>
                      </div>
                      <span className="text-[9px] text-emerald-400 font-medium block">
                        El Manager ha aprobado esta etapa.
                      </span>
                    </div>
                  ) : !caseObj.assignedManagerId ? (
                    <div className="text-center space-y-1">
                      <button
                        disabled={true}
                        className="w-full md:w-auto px-5 py-3 rounded-xl font-bold text-sm bg-slate-800 text-slate-500 border border-slate-700/60 cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        <span>Pedir Revisión de Etapa</span>
                      </button>
                      <span className="text-[9px] text-amber-400 block max-w-[200px] leading-tight">
                        ⚠️ No hay un Manager asignado para este legajo.
                      </span>
                    </div>
                  ) : caseObj.status === 'pending_review' ? (
                    <div className="text-center space-y-1">
                      <div className="w-full md:w-auto px-5 py-3 rounded-xl font-bold text-sm bg-emerald-950/40 text-emerald-400 border border-emerald-500/30 flex items-center justify-center gap-2">
                        <Clock className="w-4 h-4 animate-pulse" />
                        <span>Revisión Solicitada</span>
                      </div>
                      <span className="text-[9px] text-emerald-400 font-medium block">
                        Esperando que el Manager apruebe la etapa
                      </span>
                    </div>
                  ) : (
                    <div className="text-center space-y-1">
                      <button
                        onClick={() => setShowReviewRequestModal(true)}
                        disabled={!validation.isValid}
                        title={!validation.isValid ? 'Completá los requisitos pendientes antes de solicitar revisión' : undefined}
                        className="w-full md:w-auto px-5 py-3 bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-500/10 active:scale-98 cursor-pointer rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none disabled:cursor-not-allowed"
                      >
                        <span>Pedir Revisión al Manager</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      <span className="text-[9px] text-slate-400 block">
                        {validation.isValid ? 'Notificará a tu Manager asignado' : 'Disponible al completar los requisitos pendientes'}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {!caseObj.isCurrentStageApproved ? (
                    <button
                      onClick={() => {
                        setIsAdvancing(true);
                        setTimeout(() => {
                          onApproveStage();
                          setIsAdvancing(false);
                        }, 800);
                      }}
                      disabled={!validation.isValid || isAdvancing}
                      className={`w-full md:w-auto px-5 py-3 rounded-xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 ${
                        validation.isValid && !isAdvancing
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/10 hover:scale-102 cursor-pointer active:scale-98'
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
                          <span>Aprobar Etapa</span>
                          <CheckCircle className="w-4 h-4 text-emerald-200" />
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setIsAdvancing(true);
                        setTimeout(() => {
                          onAdvanceStage();
                          setIsAdvancing(false);
                        }, 800);
                      }}
                      disabled={isAdvancing}
                      className="w-full md:w-auto px-5 py-3 bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-500/10 hover:scale-102 cursor-pointer active:scale-98 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2"
                    >
                      {isAdvancing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-white" />
                          <span>Guardando...</span>
                        </>
                      ) : (
                        <>
                          <span>{caseObj.currentStageIndex + 1 >= (template?.stages.length || 0) ? 'Finalizar Legajo' : 'Avanzar de Etapa'}</span>
                          <ChevronRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  )}
                  {validation.isValid ? (
                    <span className="text-[10px] text-emerald-400 font-bold tracking-wider uppercase flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Todo validado
                    </span>
                  ) : (
                    <span className="text-[10px] text-red-400 font-mono tracking-wider uppercase">
                      Acceso Restringido
                    </span>
                  )}
                </>
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

      {/* DEFINE VISIBILITY ROLE FOR APPROVED DOCUMENT MODAL */}
      {approvingDoc && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-slate-150 text-left">
            <div className="p-4 border-b border-slate-100 bg-indigo-50 flex items-center justify-between">
              <div className="flex items-center gap-2 text-indigo-900">
                <FileCheck2 className="w-5 h-5 text-indigo-600" />
                <h4 className="text-sm font-bold">Definir Rol de Visibilidad</h4>
              </div>
              <button onClick={() => setApprovingDoc(null)} className="p-1 text-indigo-700 hover:text-indigo-950 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-500 leading-normal">
                Al aprobar el documento <strong>"{approvingDoc.name}"</strong>, debes indicar qué roles de la plataforma tendrán autorización para visualizarlo en el listado de documentos aprobados del legajo.
              </p>
              
              <div className="space-y-1 text-xs">
                <label className="font-semibold text-slate-700 block">
                  Rol Autorizado para Visualizar *
                </label>
                <select
                  value={selectedAllowedRole}
                  onChange={(e) => setSelectedAllowedRole(e.target.value)}
                  className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="Todos">Todos (Público para todos los roles)</option>
                  <option value="Asesor">Asesor (Asesores, Managers, Admins y Superadmins)</option>
                  <option value="Manager">Manager (Managers, Admins y Superadmins)</option>
                  <option value="Admin">Admin (Admins y Superadmins)</option>
                  <option value="Superadmin">Superadmin (Solo Superadmins)</option>
                </select>
              </div>

              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200/50 text-[11px] text-slate-600 space-y-1">
                <p className="font-bold text-slate-700">Resumen de Permisos:</p>
                <p className="leading-normal">
                  {selectedAllowedRole === 'Todos' && '✓ Todos los usuarios que participen o tengan acceso al legajo podrán visualizar este documento.'}
                  {selectedAllowedRole === 'Asesor' && '✓ Permitido para roles: ASESOR, MANAGER, ADMIN, SUPERADMIN.'}
                  {selectedAllowedRole === 'Manager' && '✓ Permitido para roles: MANAGER, ADMIN, SUPERADMIN (Oculto para Asesores).'}
                  {selectedAllowedRole === 'Admin' && '✓ Permitido para roles: ADMIN, SUPERADMIN (Oculto para Asesores y Managers).'}
                  {selectedAllowedRole === 'Superadmin' && '✓ Permitido únicamente para el SUPERADMIN.'}
                </p>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
              <button 
                onClick={() => setApprovingDoc(null)}
                className="px-4 py-2 text-slate-500 hover:text-slate-800 text-xs font-semibold rounded-xl"
              >
                Cancelar
              </button>
              <button 
                onClick={() => {
                  let roles: string[] = ['SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR'];
                  if (selectedAllowedRole === 'Asesor') {
                    roles = ['SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR'];
                  } else if (selectedAllowedRole === 'Manager') {
                    roles = ['SUPERADMIN', 'ADMIN', 'MANAGER'];
                  } else if (selectedAllowedRole === 'Admin') {
                    roles = ['SUPERADMIN', 'ADMIN'];
                  } else if (selectedAllowedRole === 'Superadmin') {
                    roles = ['SUPERADMIN'];
                  } else {
                    roles = ['SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR'];
                  }
                  
                  onReviewDoc(approvingDoc.id, 'approved', undefined, roles);
                  setApprovingDoc(null);
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl"
              >
                Aprobar y Guardar Permiso
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Solicitud de Revisión de Etapa */}
      {resolvingObservationId && (
        <div className="fixed inset-0 z-[60] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setResolvingObservationId(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="resolve-observation-title" className="w-full max-w-md rounded-2xl border border-slate-600/50 bg-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="resolve-observation-title" className="text-base font-bold text-white">Responder observación</h3>
                <p className="mt-1 text-xs text-slate-300">Explicá cómo se solucionó la observación.</p>
              </div>
              <button type="button" aria-label="Cerrar" onClick={() => setResolvingObservationId(null)} className="text-slate-300 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <label htmlFor="observation-reply" className="block text-xs font-semibold text-slate-200">Respuesta explicativa</label>
            <textarea id="observation-reply" autoFocus rows={4} value={observationReply} onChange={(e) => setObservationReply(e.target.value)} placeholder="Escribí tu respuesta..." className="w-full rounded-xl border border-slate-500 bg-slate-900/60 p-3 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setResolvingObservationId(null); setObservationReply(''); }} className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-600">Cancelar</button>
              <button type="button" disabled={!observationReply.trim()} onClick={() => { if (resolvingObservationId && observationReply.trim()) { onResolveObservation(resolvingObservationId, observationReply.trim()); setResolvingObservationId(null); setObservationReply(''); } }} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed">Responder y solucionar</button>
            </div>
          </div>
        </div>
      )}
      {showReviewRequestModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full border border-slate-100 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                <FileCheck2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800">Pedir Revisión al Manager</h3>
                <p className="text-xs text-slate-400">Solicita al manager asignado que revise la etapa actual.</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600">Mensaje o Comentario (Opcional)</label>
              <textarea
                value={advisorReviewNote}
                onChange={(e) => setAdvisorReviewNote(e.target.value)}
                placeholder="Escribe un mensaje para el manager sobre el trabajo realizado en esta etapa..."
                rows={3}
                className="w-full text-xs p-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowReviewRequestModal(false);
                  setAdvisorReviewNote('');
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleRequestReview}
                disabled={isRequestingReview}
                className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 rounded-xl shadow-md transition-all cursor-pointer"
              >
                {isRequestingReview ? 'Enviando...' : '🚀 Enviar Solicitud'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Solicitud de Reasignación / Liberación de Legajo */}
      {showReassignModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full border border-slate-100 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-red-50 flex items-center justify-center text-red-600">
                <History className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800">Solicitar Reasignación</h3>
                <p className="text-xs text-slate-400">Envía un pedido formal al sistema para reasignar este legajo.</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600">Motivo / Justificación *</label>
              <textarea
                value={reassignReason}
                onChange={(e) => setReassignReason(e.target.value)}
                placeholder="Explica los motivos por los cuales solicitas liberar o reasignar este legajo (por ejemplo: sobrecarga de tareas, viaje, etc.)..."
                rows={4}
                className="w-full text-xs p-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowReassignModal(false);
                  setReassignReason('');
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleRequestReassign}
                disabled={isRequestingReassign}
                className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-500 disabled:bg-slate-300 rounded-xl shadow-md transition-all cursor-pointer"
              >
                {isRequestingReassign ? 'Enviando...' : '🔄 Enviar Solicitud'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-xl overflow-hidden border border-slate-100 animate-in fade-in duration-200">
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3 text-rose-600">
                <div className="p-2 bg-rose-50 rounded-xl">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-800">¿Eliminar Legajo Permanentemente?</h3>
              </div>
              
              <div className="space-y-2 text-xs text-slate-600 leading-relaxed">
                <p>
                  Está a punto de eliminar permanentemente el legajo <strong className="text-slate-800 font-bold">"{caseObj.title}" ({caseObj.code})</strong>.
                </p>
                <p className="bg-rose-50 text-rose-800 p-3 rounded-lg border border-rose-100 font-medium">
                  Atención: Esta acción eliminará el legajo y todos sus datos relacionados (tareas, documentos, observaciones, etc.) de forma irreversible.
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const response = await fetch(`/api/cases/${caseObj.id}?currentUserId=${currentUser.id}`, {
                      method: 'DELETE',
                      credentials: 'include'
                    });
                    if (!response.ok) {
                      const err = await response.json();
                      throw new Error(err.error || 'No se pudo eliminar el legajo');
                    }
                    alert('Legajo eliminado exitosamente.');
                    setShowDeleteConfirm(false);
                    onBack();
                    if (loadState) {
                      await loadState();
                    }
                  } catch (err: any) {
                    alert(`Error al eliminar: ${err.message}`);
                  }
                }}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer animate-pulse"
              >
                Eliminar Permanentemente
              </button>
            </div>
          </div>
        </div>
      )}
      <input
        type="file"
        ref={caseFileInputRef}
        onChange={handleCaseFileSelected}
        className="hidden"
      />
    </div>
  );
}


type CaseHistoryEvent = {
  id: string; userName: string; userRole: string; action: string;
  entityType: string; entityName: string; createdAt: string;
};

function formatHistoryDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor((Number(ms) || 0) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return [days > 0 ? `${days} d` : '', hours > 0 ? `${hours} h` : '', `${minutes} min`].filter(Boolean).join(' · ');
}

function formatHistoryDate(value: string): string {
  return new Date(value).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23'
  });
}

function CaseHistoryPanel({ caseId, createdAt, status }: { caseId: string; createdAt: string; status: string }) {
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<CaseHistoryEvent[]>([]);
  const [historySummary, setHistorySummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const reload = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/history`, { credentials: 'include' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo obtener el historial.');
      setEvents(result.events || []);
      setHistorySummary(result);
    } catch (err: any) { setError(err.message || 'Error de consulta.'); }
    finally { setLoading(false); }
  };
  const elapsed = historySummary?.durationMs ?? Math.max(0, Date.now() - new Date(createdAt).getTime());
  const days = Math.floor(elapsed / 86400000);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800"><History className="w-4 h-4 text-indigo-500" /> Historial y Auditoría del Legajo</h3>
          <p className="text-xs text-slate-500 mt-1">Creado: {formatHistoryDate(createdAt)} · {days} días {historySummary?.durationIsFinal ? 'hasta su finalización' : 'transcurridos'} · Estado: {status}</p>
        </div>
        <button type="button" className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white" onClick={() => { setExpanded(!expanded); if (!expanded) void reload(); }}>
          {expanded ? 'Ocultar historial' : 'Ver historial'}
        </button>
      </div>
      {expanded && <div className="border-t border-slate-200 p-4 space-y-3">
        <div className="flex justify-end"><button type="button" onClick={() => void reload()} disabled={loading} className="text-xs font-semibold text-indigo-600 disabled:opacity-50">Actualizar eventos</button></div>
        {historySummary && <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 space-y-3">
          <p className="text-xs font-bold text-indigo-900">Resumen de intervenciones · {historySummary.eventCount} eventos registrados</p>
          {Array.isArray(historySummary.stageDurations) && historySummary.stageDurations.length > 0 && <div className="rounded-lg border border-indigo-100 bg-white p-3">
            <p className="text-xs font-bold text-indigo-900 mb-2">Tiempos por etapa</p>
            <div className="space-y-2">
              {historySummary.stageDurations.map((stage: { stage: string; startedAt: string; endedAt: string; durationMs: number; ongoing: boolean }, index: number) => <div key={index} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
                <span className="font-medium">{stage.stage}{stage.ongoing ? ' (en curso)' : ''}</span>
                <span>{formatHistoryDuration(stage.durationMs)}</span>
              </div>)}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Tiempos transcurridos entre eventos registrados; no equivalen al tiempo de trabajo efectivo de cada persona.</p>
          </div>}
          <p className="text-xs text-slate-700">Duración: {formatHistoryDuration(historySummary.durationMs)} · {historySummary.durationIsFinal ? 'Finalizado el ' + formatHistoryDate(historySummary.completedAt) : 'Legajo en curso (duración provisional)'}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(historySummary.contributors || []).map((person: any) => <div key={person.userId || person.userName} className="rounded-lg bg-white border border-indigo-100 p-2">
              <p className="text-xs font-bold text-slate-800">{person.userName || 'Usuario sin identificar'} · {person.userRole}</p>
              <p className="text-xs text-slate-600">{person.interventions} intervenciones · Primera: {formatHistoryDate(person.firstAt)}</p>
              <p className="text-xs text-slate-600">Última: {formatHistoryDate(person.lastAt)}</p>
              <p className="text-[11px] text-slate-500">{Object.entries(person.actions || {}).map(([action, count]) => `${action} (${count})`).join(' · ')}</p>
            </div>)}
          </div>
          {historySummary.truncated && <p className="text-xs text-amber-700">Historial parcial: se alcanzó el límite de 1000 eventos.</p>}
        </div>}
        {loading && <p className="text-xs text-slate-500">Cargando eventos…</p>}
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        {!loading && !error && events.length === 0 && <p className="text-xs text-slate-500">No se encontraron eventos vinculados a este legajo.</p>}
        <ol className="max-h-96 overflow-y-auto space-y-3">
          {events.map(event => <li key={event.id} className="rounded-lg border border-slate-200 p-3">
            <p className="text-[11px] text-slate-500">{formatHistoryDate(event.createdAt)} · {event.userName} ({event.userRole})</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{event.action}</p>
            <p className="text-xs text-slate-500">{event.entityType} · {event.entityName}</p>
          </li>)}
        </ol>
        {events.length === 1000 && <p className="text-xs text-amber-700">Se muestran los primeros 1000 eventos. La paginación está pendiente.</p>}
      </div>}
    </section>
  );
}
