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
  onUploadDoc: (stageId: string, reqId: string, reqName: string, fileName: string, fileSize: number) => void;
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
  onUpdateParticipant,
  onUpdateCaseDocument
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

  // View mode switcher: 'flow' (checklist stages) or 'document' (100% digitalized word document)
  const [caseViewMode, setCaseViewMode] = useState<'flow' | 'document'>('flow');
  const [editableDocText, setEditableDocText] = useState('');
  const [isEditingDocText, setIsEditingDocText] = useState(false);
  const [isSavingDoc, setIsSavingDoc] = useState(false);
  const [showDocumentToAllLocal, setShowDocumentToAllLocal] = useState(true);
  const [sharedViewModeLocal, setSharedViewModeLocal] = useState<'both' | 'flow' | 'document'>('both');

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

  useEffect(() => {
    const fetchSharedDocs = async () => {
      try {
        const res = await fetch(`/api/shared-documents?userId=${currentUser.id}&role=${currentUser.role}`);
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

  useEffect(() => {
    setEditableDocText(caseObj.documentContent || template?.originalDocumentContent || '');
  }, [caseObj.documentContent, template?.originalDocumentContent]);

  useEffect(() => {
    setShowDocumentToAllLocal(caseObj.showDocumentToAll !== undefined ? caseObj.showDocumentToAll : true);
  }, [caseObj.showDocumentToAll]);

  useEffect(() => {
    setSharedViewModeLocal(caseObj.sharedViewMode || 'both');
  }, [caseObj.sharedViewMode]);

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

  // Upload file simulation with approved request verification
  const handleMockFileUpload = (reqId: string, reqName: string) => {
    if (currentUser.role === 'ASESOR') {
      const approvedReq = uploadRequests?.find(
        r => r.caseId === caseId && r.requirementId === reqId && r.status === 'approved'
      );
      if (!approvedReq) {
        alert('No tienes autorización aprobada para subir este documento.');
        return;
      }
      
      const ext = approvedReq.allowedExtension || '.pdf';
      const maxWeightMb = approvedReq.allowedMaxWeight || 5;

      const baseName = reqName.replace(/\s+/g, '_');
      const fileName = `${baseName}${ext}`;
      
      const allowedSizeBytes = maxWeightMb * 1024 * 1024;
      const fileSize = Math.floor(Math.min(2 * 1024 * 1024, allowedSizeBytes - 100 * 1024)); // Under limit, max 2MB

      onUploadDoc(currentStage!.id, reqId, reqName, fileName, fileSize);
      alert(`Documento "${fileName}" subido con éxito bajo la autorización del Manager (Límite: ${maxWeightMb}MB, Ext: ${ext})`);
    } else {
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
    }
  };

  const handleCreateUploadRequestSubmit = async (stageId: string, reqId: string, reqName: string, requestedExtension: string) => {
    try {
      const response = await fetch('/api/upload-requests/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  // 100% Digital Document Autocomplete Logic
  const handleAutoFillDocument = () => {
    let text = editableDocText || caseObj.documentContent || template?.originalDocumentContent || '';
    if (!text) {
      alert('El documento digital no tiene contenido para autocompletar.');
      return;
    }

    // 1. Case generic variables
    text = text.replace(/\[Fecha\]/gi, new Date().getDate().toString());
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    text = text.replace(/\[Mes\]/gi, monthNames[new Date().getMonth()]);
    text = text.replace(/\[Año\]/gi, new Date().getFullYear().toString());
    text = text.replace(/\[Título del Caso\]/gi, caseObj.title);
    text = text.replace(/\[Código del Legajo\]/gi, caseObj.code);
    text = text.replace(/\[Código\]/gi, caseObj.code);
    text = text.replace(/\[Descripción\]/gi, caseObj.description);
    text = text.replace(/\[Asesor\]/gi, advisor ? `${advisor.name} ${advisor.lastName}` : '');
    text = text.replace(/\[Manager\]/gi, manager ? `${manager.name} ${manager.lastName}` : '');

    // 2. Form submission variables
    template?.stages.forEach(stg => {
      stg.requirements.forEach(req => {
        if (req.type === 'form' && req.formFields) {
          const sub = formSubmissions.find(s => s.requirementId === req.id);
          if (sub && sub.values) {
            req.formFields.forEach(f => {
              const val = sub.values[f.id];
              if (val !== undefined && val !== null && val !== '') {
                // Replace by [Label] (e.g. [Monto de Reserva (USD)])
                const escapedLabel = f.label.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                const regexLabel = new RegExp(`\\[${escapedLabel}\\]`, 'gi');
                text = text.replace(regexLabel, String(val));

                // Also replace by [Id] (e.g. [f-comp-nombre])
                const regexId = new RegExp(`\\[${f.id}\\]`, 'gi');
                text = text.replace(regexId, String(val));
              }
            });
          }
        }
      });
    });

    // 3. Participant variables
    caseObj.participants.forEach(p => {
      const role = p.comments?.split(':')[0]?.trim() || '';
      const rolesToTry = role ? [role] : ['Cliente', 'Comprador', 'Vendedor', 'Titular', 'Garante', 'Apoderado'];
      
      rolesToTry.forEach(r => {
        text = text.replace(new RegExp(`\\[Nombre Completo ${r}\\]`, 'gi'), `${p.name} ${p.lastName}`);
        text = text.replace(new RegExp(`\\[DNI ${r}\\]`, 'gi'), p.dni);
        text = text.replace(new RegExp(`\\[CUIT ${r}\\]`, 'gi'), p.cuitCuil);
        text = text.replace(new RegExp(`\\[Email ${r}\\]`, 'gi'), p.email);
        text = text.replace(new RegExp(`\\[Teléfono ${r}\\]`, 'gi'), p.phone || '');
        text = text.replace(new RegExp(`\\[${r}\\]`, 'gi'), `${p.name} ${p.lastName}`);
      });
    });

    setEditableDocText(text);
    alert('¡Sincronización exitosa! Los datos del legajo se han volcado en los campos del documento.');
  };

  // Save the edited document content back to the server
  const handleSaveDocument = async () => {
    setIsSavingDoc(true);
    try {
      await onUpdateCaseDocument(caseObj.id, editableDocText, showDocumentToAllLocal, sharedViewModeLocal);
      
      // Auto-validate/upload any requirement of type digital_contract in current stage
      if (currentStage) {
        const digitalReqs = currentStage.requirements.filter(r => r.type === 'document' && r.documentSourceType === 'digital_contract');
        for (const req of digitalReqs) {
          const existing = documents.find(d => d.caseId === caseObj.id && d.requirementId === req.id);
          if (!existing) {
            await onUploadDoc(
              currentStage.id, 
              req.id, 
              req.name, 
              `${req.name.replace(/\s+/g, '_')}_digital_completado.pdf`, 
              editableDocText.length
            );
          }
        }
      }

      setIsEditingDocText(false);
      alert('¡Documento digitalizado guardado con éxito!');
    } catch (e) {
      console.error(e);
      alert('Error guardando los cambios del documento.');
    } finally {
      setIsSavingDoc(false);
    }
  };

  // Update sharedViewMode in real-time
  const handleUpdateSharedViewMode = async (newMode: 'both' | 'flow' | 'document') => {
    setSharedViewModeLocal(newMode);
    try {
      await onUpdateCaseDocument(caseObj.id, editableDocText, showDocumentToAllLocal, newMode);
    } catch (e) {
      console.error('Error al actualizar el modo de vista compartido:', e);
    }
  };

  // Render document with variables highlighted in an orange badge style
  const renderDocumentWithHighlights = (text: string) => {
    if (!text) {
      return (
        <p className="text-slate-400 italic text-center py-8 font-sans">
          El documento digitalizado se encuentra vacío. Presiona "Editar Texto" para agregar contenido.
        </p>
      );
    }
    const parts = text.split(/(\[[^\]]+\])/g);
    return (
      <div className="whitespace-pre-wrap leading-relaxed text-slate-800 font-serif text-sm md:text-base space-y-1">
        {parts.map((part, index) => {
          if (part.startsWith('[') && part.endsWith(']')) {
            return (
              <span 
                key={index} 
                className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 font-mono text-xs font-semibold mx-0.5 hover:bg-amber-100 transition-colors cursor-help"
                title="Sincroniza desde el checklist para completar automáticamente"
              >
                {part}
              </span>
            );
          }
          return <span key={index}>{part}</span>;
        })}
      </div>
    );
  };

  const isAsesor = currentUser.role === 'ASESOR';
  const isManagerOrAdmin = ['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(currentUser.role);
  const isSuperAdmin = currentUser.role === 'SUPERADMIN';
  const isAdmin = currentUser.role === 'ADMIN';
  const isAdminOrSuperAdmin = isSuperAdmin || isAdmin;

  // Decide which tabs/modes are allowed for the current user
  const hasStages = !!(template && template.stages && template.stages.length > 0);
  const allowFlow = hasStages && (isAdminOrSuperAdmin || sharedViewModeLocal !== 'document');
  const allowDoc = !hasStages || isAdminOrSuperAdmin || (sharedViewModeLocal !== 'flow' && caseObj.showDocumentToAll !== false);

  useEffect(() => {
    if (template) {
      const hasStagesLocal = !!(template.stages && template.stages.length > 0);
      if (!hasStagesLocal) {
        setCaseViewMode('document');
      } else if (caseObj.sharedViewMode === 'document') {
        setCaseViewMode('document');
      } else if (caseObj.sharedViewMode === 'flow') {
        setCaseViewMode('flow');
      }
    }
  }, [template, caseObj.sharedViewMode]);

  useEffect(() => {
    if (!allowFlow && caseViewMode === 'flow') {
      setCaseViewMode('document');
    } else if (!allowDoc && caseViewMode === 'document') {
      setCaseViewMode('flow');
    }
  }, [allowFlow, allowDoc, caseViewMode]);

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

      {/* PANEL DE CONTROL SUPERADMIN: CONFIGURACIÓN DE VISIBILIDAD PARA EL RESTO DE USUARIOS */}
      {isAdminOrSuperAdmin && (
        <div className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white p-5 rounded-2xl border border-slate-800 shadow-lg space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="p-1.5 bg-indigo-500/20 text-indigo-300 rounded-lg border border-indigo-500/30">
                <Settings className="w-4 h-4 text-indigo-400" />
              </span>
              <div>
                <h4 className="text-xs font-bold tracking-wide uppercase text-indigo-200">Panel de Control Administrativo (Superadmin)</h4>
                <p className="text-[11px] text-slate-300">Determina cuál de los dos entornos operativos se comparte y visualiza para el resto de los usuarios (Asesores, Managers, etc.):</p>
              </div>
            </div>
            <span className="text-[10px] font-mono bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-2 py-0.5 rounded uppercase font-bold tracking-wider select-none">
              Configuración en Tiempo Real
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Option 1: Both */}
            <button
              type="button"
              onClick={() => handleUpdateSharedViewMode('both')}
              className={`p-3.5 rounded-xl border text-left transition-all relative cursor-pointer flex flex-col justify-between h-full ${
                sharedViewModeLocal === 'both'
                  ? 'bg-indigo-600/20 border-indigo-500 text-white ring-1 ring-indigo-500/50'
                  : 'bg-slate-900/50 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-bold">Ambos Entornos Disponibles</span>
                  <input
                    type="radio"
                    checked={sharedViewModeLocal === 'both'}
                    onChange={() => handleUpdateSharedViewMode('both')}
                    className="text-indigo-500 focus:ring-indigo-500 bg-slate-950 border-slate-800 w-3.5 h-3.5 cursor-pointer animate-none"
                  />
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Los asesores y managers tendrán acceso tanto al Flujo de Etapas como al Documento Digitalizado Word.
                </p>
              </div>
            </button>

            {/* Option 2: Flow Only */}
            <button
              type="button"
              onClick={() => handleUpdateSharedViewMode('flow')}
              className={`p-3.5 rounded-xl border text-left transition-all relative cursor-pointer flex flex-col justify-between h-full ${
                sharedViewModeLocal === 'flow'
                  ? 'bg-indigo-600/20 border-indigo-500 text-white ring-1 ring-indigo-500/50'
                  : 'bg-slate-900/50 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-bold">Solo Flujo Inteligente por Etapas</span>
                  <input
                    type="radio"
                    checked={sharedViewModeLocal === 'flow'}
                    onChange={() => handleUpdateSharedViewMode('flow')}
                    className="text-indigo-500 focus:ring-indigo-500 bg-slate-950 border-slate-800 w-3.5 h-3.5 cursor-pointer animate-none"
                  />
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Se oculta el Documento Digitalizado para otros roles. Solo podrán seguir el proceso secuencialmente.
                </p>
              </div>
              <span className="text-[8px] bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-1.5 py-0.5 rounded font-mono font-bold uppercase tracking-wider self-start mt-2 select-none">
                Documento restringido a Admin
              </span>
            </button>

            {/* Option 3: Document Only */}
            <button
              type="button"
              onClick={() => handleUpdateSharedViewMode('document')}
              className={`p-3.5 rounded-xl border text-left transition-all relative cursor-pointer flex flex-col justify-between h-full ${
                sharedViewModeLocal === 'document'
                  ? 'bg-indigo-600/20 border-indigo-500 text-white ring-1 ring-indigo-500/50'
                  : 'bg-slate-900/50 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-bold">Solo Documento 100% Digitalizado</span>
                  <input
                    type="radio"
                    checked={sharedViewModeLocal === 'document'}
                    onChange={() => handleUpdateSharedViewMode('document')}
                    className="text-indigo-500 focus:ring-indigo-500 bg-slate-950 border-slate-800 w-3.5 h-3.5 cursor-pointer animate-none"
                  />
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Se oculta el Flujo de Etapas para otros roles. Solo completarán y previsualizarán el documento original directamente.
                </p>
              </div>
              <span className="text-[8px] bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-1.5 py-0.5 rounded font-mono font-bold uppercase tracking-wider self-start mt-2 select-none">
                Flujo restringido a Admin
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Visual Workspace Mode Tab Selector */}
      {(allowFlow && allowDoc) && (
        <div className="flex border-b border-slate-200 bg-white/60 p-1 rounded-xl shadow-xs gap-1">
          {allowFlow && (
            <button
              onClick={() => setCaseViewMode('flow')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold tracking-wide uppercase rounded-lg transition-all cursor-pointer ${
                caseViewMode === 'flow'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50 font-semibold'
              }`}
            >
              <Calendar className="w-4 h-4" />
              Control de Flujo por Etapas
            </button>
          )}
          {allowDoc && (
            <button
              onClick={() => setCaseViewMode('document')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold tracking-wide uppercase rounded-lg transition-all cursor-pointer ${
                caseViewMode === 'document'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50 font-semibold'
              }`}
            >
              <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
              Documento 100% Digitalizado (Word)
            </button>
          )}
        </div>
      )}

      {caseViewMode === 'flow' ? (
        <>
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
                  {currentStage?.requirements.filter(r => r.type === 'document').length === 0 ? (
                    <p className="text-xs text-slate-400 italic text-center py-6">Esta etapa no requiere documentos.</p>
                  ) : (
                    currentStage?.requirements
                      .filter(r => r.type === 'document')
                      .map((req) => {
                        const originalDoc = documents.find(d => d.caseId === caseObj.id && d.requirementId === req.id);
                        const isDocVisible = !originalDoc || originalDoc.status !== 'approved' || !originalDoc.allowedRoles || originalDoc.allowedRoles.includes(currentUser.role) || currentUser.role === 'SUPERADMIN' || currentUser.role === 'ADMIN';
                        const doc = isDocVisible ? originalDoc : undefined;
                        const isDigitalContract = req.documentSourceType === 'digital_contract';
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
                              
                              {/* Extra information for special document types */}
                              {isDigitalContract && (
                                <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-indigo-600 font-semibold bg-indigo-50/50 px-2 py-1 rounded border border-indigo-100 w-fit">
                                  <Sparkles className="w-3.5 h-3.5 animate-pulse text-indigo-500" />
                                  <span>✍️ Contrato Digitalizado: Edítalo en la pestaña "Documento 100% Digitalizado"</span>
                                </div>
                              )}
                              
                              {isDownloadAsset && linkedSharedDoc && (
                                <div className="mt-1.5 space-y-1 bg-emerald-50/50 p-2 rounded border border-emerald-100 text-left w-fit max-w-sm">
                                  <span className="text-[9px] text-emerald-800 font-bold uppercase tracking-wider block">📥 Archivo de la Biblioteca:</span>
                                  <p className="text-[10px] text-emerald-700 font-medium">Debe descargarse: <strong>{linkedSharedDoc.name}</strong></p>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (linkedSharedDoc.dataUrl) {
                                        // Log client-side action in backend
                                        fetch('/api/audit-logs/log', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({
                                            userId: currentUser.id,
                                            action: `Visualizó / descargó documento "${linkedSharedDoc.fileName}"`,
                                            entityType: 'Document',
                                            entityId: linkedSharedDoc.id,
                                            entityName: linkedSharedDoc.fileName
                                          })
                                        }).catch(err => console.error('Failed to log audit:', err));

                                        const link = document.createElement('a');
                                        link.href = linkedSharedDoc.dataUrl;
                                        link.download = linkedSharedDoc.fileName;
                                        document.body.appendChild(link);
                                        link.click();
                                        document.body.removeChild(link);
                                      } else {
                                        alert('Contenido descargable no disponible.');
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
                                <div className="flex flex-col items-end gap-1.5">
                                  {isDigitalContract && (
                                    <button
                                      type="button"
                                      onClick={() => setCaseViewMode('document')}
                                      className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[10px] font-bold rounded-lg shadow-xs flex items-center gap-1 transition-all cursor-pointer mb-1"
                                    >
                                      <FileText className="w-3.5 h-3.5 text-indigo-500" />
                                      <span>Completar Contrato</span>
                                    </button>
                                  )}
                                  
                                  {(() => {
                                    const approvedReq = uploadRequests?.find(
                                      r => r.caseId === caseId && r.requirementId === req.id && r.status === 'approved'
                                    );
                                    const pendingReq = uploadRequests?.find(
                                      r => r.caseId === caseId && r.requirementId === req.id && r.status === 'pending'
                                    );
                                    const rejectedReq = uploadRequests?.find(
                                      r => r.caseId === caseId && r.requirementId === req.id && r.status === 'rejected'
                                    );

                                    if (approvedReq) {
                                      return (
                                        <div className="flex flex-col items-end gap-1">
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-[10px] text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-semibold">
                                              Autorizado (Máx: {approvedReq.allowedMaxWeight}MB, Ext: {approvedReq.allowedExtension})
                                            </span>
                                            <button
                                              onClick={() => handleMockFileUpload(req.id, req.name)}
                                              className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-bold rounded-lg shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
                                            >
                                              <Upload className="w-3.5 h-3.5 text-slate-400" />
                                              <span>{doc ? 'Reemplazar' : 'Subir Documento'}</span>
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    }

                                    if (pendingReq) {
                                      return (
                                        <div className="flex items-center gap-2 text-amber-600 bg-amber-50/60 border border-amber-200/50 px-2.5 py-1.5 rounded-lg text-[10px]">
                                          <Clock className="w-3.5 h-3.5 text-amber-500 animate-spin shrink-0" />
                                          <span>Permiso solicitado ({pendingReq.requestedExtension}) [Pendiente]</span>
                                        </div>
                                      );
                                    }

                                    return (
                                      <div className="flex flex-col items-end gap-1">
                                        {rejectedReq && (
                                          <div className="text-red-600 bg-red-50 border border-red-100 px-2.5 py-1.5 rounded-lg text-[10px] max-w-xs text-right mb-1">
                                            <p className="font-semibold">Rechazado ({rejectedReq.requestedExtension})</p>
                                            {rejectedReq.responseComment && <p className="text-[9px] text-slate-500 italic">Motivo: "{rejectedReq.responseComment}"</p>}
                                          </div>
                                        )}
                                        {requestingForReqId === req.id ? (
                                          <div className="flex items-center gap-1 bg-slate-100 p-1.5 rounded-lg border border-slate-200">
                                            <select
                                              value={requestedExt}
                                              onChange={(e) => setRequestedExt(e.target.value)}
                                              className="text-[10px] font-mono border-0 bg-transparent py-0.5 px-1 focus:ring-0 focus:outline-none"
                                            >
                                              <option value=".pdf">.pdf</option>
                                              <option value=".docx">.docx</option>
                                              <option value=".doc">.doc</option>
                                              <option value=".xlsx">.xlsx</option>
                                              <option value=".xls">.xls</option>
                                              <option value=".png">.png</option>
                                              <option value=".jpg">.jpg</option>
                                            </select>
                                            <button
                                              onClick={() => handleCreateUploadRequestSubmit(currentStage!.id, req.id, req.name, requestedExt)}
                                              className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold rounded cursor-pointer"
                                            >
                                              Solicitar
                                            </button>
                                            <button
                                              onClick={() => setRequestingForReqId(null)}
                                              className="px-1.5 py-1 text-slate-400 hover:text-slate-600 text-[10px] font-bold"
                                            >
                                              <X className="w-3.5 h-3.5" />
                                            </button>
                                          </div>
                                        ) : (
                                          <button
                                            onClick={() => {
                                              setRequestingForReqId(req.id);
                                              setRequestedExt('.pdf');
                                            }}
                                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold rounded-lg shadow-sm flex items-center gap-1 transition-all cursor-pointer"
                                          >
                                            <Settings className="w-3.5 h-3.5 text-indigo-200" />
                                            <span>{rejectedReq ? 'Volver a Solicitar' : 'Solicitar Permiso de Subida'}</span>
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })()}
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
                        className="w-full md:w-auto px-5 py-3 bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-500/10 hover:scale-102 active:scale-98 cursor-pointer rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2"
                      >
                        <span>Pedir Revisión al Manager</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      <span className="text-[9px] text-slate-400 block">
                        Notificará a tu Manager asignado
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
    </>
  ) : (
        <div className="space-y-6">
          {/* Header/Tools Panel */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <span className="text-[10px] text-indigo-600 uppercase font-mono font-bold tracking-wider">Documento Digital Activo</span>
              <h3 className="text-base font-bold text-slate-800 mt-0.5">Editor de Plantilla Completa</h3>
              <p className="text-xs text-slate-500 mb-2">
                Visualiza, edita y autocompleta el documento original al 100% conservando sus condiciones y estructura literal.
              </p>
              {isSuperAdmin && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-50/70 border border-indigo-100 rounded-lg text-xs font-semibold text-indigo-900 select-none">
                  <input
                    type="checkbox"
                    id="case-share-toggle"
                    checked={showDocumentToAllLocal}
                    onChange={(e) => setShowDocumentToAllLocal(e.target.checked)}
                    className="rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                  />
                  <label htmlFor="case-share-toggle" className="cursor-pointer">
                    Compartir este documento con el resto de los usuarios (Asesores, Managers, etc.)
                  </label>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Autofill Button */}
              <button
                onClick={handleAutoFillDocument}
                className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer active:scale-95"
                title="Rellenar placeholders automáticamente con datos de formularios y participantes"
              >
                <Sparkles className="w-4 h-4 text-amber-500" />
                <span>Autocompletar Datos</span>
              </button>

              {/* Edit/View Toggle */}
              <button
                onClick={() => setIsEditingDocText(!isEditingDocText)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer active:scale-95 border ${
                  isEditingDocText 
                    ? 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200' 
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <FileText className="w-4 h-4 text-indigo-500" />
                <span>{isEditingDocText ? 'Ver Documento' : 'Editar Texto'}</span>
              </button>

              {/* Save Button */}
              <button
                onClick={handleSaveDocument}
                disabled={isSavingDoc}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSavingDoc ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>Guardando...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 text-white" />
                    <span>Guardar Cambios</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Guidelines info card */}
          <div className="bg-indigo-50/50 border border-indigo-100 p-4 rounded-xl text-xs text-indigo-800 leading-normal flex gap-2.5 items-start">
            <Sparkles className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold mb-0.5">¿Cómo completar el documento digital?</p>
              <p className="opacity-90">
                Los textos resaltados en naranja/amarillo como <code className="bg-amber-100 px-1 rounded text-amber-800 font-mono text-[11px]">[Nombre]</code> representan variables pendientes. 
                Completa los <strong>Formularios de la etapa</strong> o agrega <strong>Actores</strong> del legajo, y luego haz clic en <strong>"Autocompletar Datos"</strong> para volcar la información de manera inmediata sobre el documento tal como se lee en el Word.
              </p>
            </div>
          </div>

          {/* Actual Sheet of paper */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center justify-between text-xs text-slate-500">
              <span className="font-mono tracking-wider uppercase font-semibold">Previsualización (A4 Layout - Word Integrado)</span>
              <span className="font-sans font-medium text-[11px]">Sincronizado al 100%</span>
            </div>

            <div className="bg-slate-100/60 p-4 sm:p-8 md:p-12 min-h-[700px] flex items-start justify-center">
              <div className="bg-white w-full max-w-2xl min-h-[800px] shadow-lg border border-slate-200 px-8 py-12 md:px-16 md:py-20 rounded-md flex flex-col justify-between">
                {isEditingDocText ? (
                  <textarea
                    value={editableDocText}
                    onChange={(e) => setEditableDocText(e.target.value)}
                    placeholder="Escribe o pega el documento original aquí..."
                    className="w-full h-[650px] resize-none focus:outline-hidden text-sm md:text-base font-mono text-slate-800 leading-relaxed border-0 bg-slate-50/50 p-4 rounded-lg focus:ring-1 focus:ring-indigo-500"
                  />
                ) : (
                  <div>
                    {renderDocumentWithHighlights(editableDocText)}
                  </div>
                )}
                
                {/* Footer of the sheet */}
                <div className="mt-16 pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-400 font-mono">
                  <span>LEGAJO: {caseObj.code}</span>
                  <span>GENERADO POR DOCFLOW PRO</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
                      method: 'DELETE'
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
    </div>
  );
}
