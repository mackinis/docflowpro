import React, { useState } from 'react';
import { 
  Plus, 
  Search, 
  Filter, 
  FileText, 
  Calendar, 
  User, 
  Building2, 
  CheckCircle, 
  AlertTriangle, 
  Trash2,
  Users,
  ChevronRight,
  X,
  Pencil
} from 'lucide-react';
import { Case, ProcessTemplate, User as UserType, Participant, ParticipantType } from '../types';

type DraftRecord = {
  id: string; title: string; description: string; templateId: string; advisorId: string;
  participants: Participant[]; fieldValues: Record<string,string>; pendingActor: Record<string,string>;
  documentContent: string; escribano: boolean; updatedAt: string;
};
const normalizedActor = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const roleForField = (actor: string): ParticipantType | null => {
  const a = normalizedActor(actor);
  if (/locador/.test(a)) return 'Locador';
  if (/locatario/.test(a)) return 'Locatario';
  if (/garante/.test(a)) return 'Garante';
  if (/vendedor/.test(a)) return 'Vendedor';
  if (/comprador/.test(a)) return 'Comprador';
  if (/titular/.test(a)) return 'Titular';
  if (/apoderado/.test(a)) return 'Apoderado';
  return null;
};
const importedField = (name: string) => {
  const match = name.match(/^(.*?)\s+—\s+(.*?)\s+\(\[?(CAMPO_\d+)\]?\)/i);
  return match ? { actor: match[1].trim(), label: match[2].trim(), id: match[3].toUpperCase() } : null;
};

interface CasesListProps {
  cases: Case[];
  templates: ProcessTemplate[];
  users: UserType[];
  currentUser: UserType;
  onOpenCase: (caseId: string) => void;
  onCreateCase: (caseData: {
    title: string;
    description: string;
    templateId: string;
    assignedAdvisorId: string;
    assignedManagerId: string;
    participants: Participant[];
    documentContent?: string;
  }) => void;
  sharedDocuments?: any[];
  systemSettings?: any;
  loadState?: () => Promise<void>;
}

export default function CasesList({ 
  cases, 
  templates, 
  users, 
  currentUser,
  onOpenCase, 
  onCreateCase,
  sharedDocuments = [],
  systemSettings,
  loadState
}: CasesListProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [generalFieldValues, setGeneralFieldValues] = useState<Record<string,string>>({});
  const [actorFieldValues, setActorFieldValues] = useState<Record<string,string>>({});
  const [draftBusy, setDraftBusy] = useState(false);
  const refreshDrafts = async () => {
    const response = await fetch('/api/case-drafts', {credentials:'include'});
    if (!response.ok) throw new Error('No se pudieron cargar los borradores');
    setDrafts(await response.json());
  };
  React.useEffect(() => { void refreshDrafts().catch(console.error); }, [currentUser.id]);
  const [caseToDelete, setCaseToDelete] = useState<Case | null>(null);
  const [pendingCreationDocs, setPendingCreationDocs] = useState<string[] | null>(null);
  const isTemplateRequired = true;
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending_review' | 'observed' | 'completed' | 'pending_assignment'>('all');
  const [templateFilter, setTemplateFilter] = useState('all');

  // Form states for new Case
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newTemplateId, setNewTemplateId] = useState('');
  const [newAdvisorId, setNewAdvisorId] = useState(currentUser.role === 'ASESOR' ? currentUser.id : (users.find(u => u.role === 'ASESOR')?.id || ''));
  const [customDocumentContent, setCustomDocumentContent] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [isExtractingFile, setIsExtractingFile] = useState(false);

  const handleCustomFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.txt') && !lowerName.endsWith('.md') && !lowerName.endsWith('.csv')) {
      setUploadedFileName('');
      e.target.value = '';
      alert('Para extraer texto real de archivos PDF, Word o imágenes utiliza "Plantillas y Procesos -> Digitalizar Plantilla / Documento" (procesado por Cloudflare Workers AI), o selecciona un archivo de texto (.txt).');
      return;
    }

    setUploadedFileName(file.name);
    setIsExtractingFile(true);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = (event.target?.result as string) || '';
      setCustomDocumentContent(text);
      setIsExtractingFile(false);
    };
    reader.onerror = () => {
      setIsExtractingFile(false);
      alert('No se pudo leer el archivo seleccionado.');
    };
    reader.readAsText(file, 'utf-8');
  };
  
  React.useEffect(() => {
    const isTemplateRequired = systemSettings?.processTemplateRequired !== false;
    if (showCreateModal && templates.length > 0 && !newTemplateId) {
      setNewTemplateId(isTemplateRequired ? (templates.find(t => !t.id.startsWith('doc-') && !t.id.startsWith('tmpl-dig-') && !t.originalDocumentContent)?.id || '') : '');
    }
  }, [showCreateModal, templates, systemSettings]);
  
  // Participant/Actor quantities and type states
  const [escribanoADesignar, setEscribanoADesignar] = useState(false);

  // Participant form states
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [editingParticipantId, setEditingParticipantId] = useState<string | null>(null);
  const [pType, setPType] = useState<ParticipantType>('Vendedor');
  const [pName, setPName] = useState('');
  const [pLastName, setPLastName] = useState('');
  const [pDni, setPDni] = useState('');
  const formatCuitCuil = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    return digits.length === 11 ? `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}` : value;
  };
  const [pCuit, setPCuit] = useState('');
  const [pEmail, setPEmail] = useState('');
  const [pPhone, setPPhone] = useState('');
  const [pBirthDate, setPBirthDate] = useState('');
  const [pComments, setPComments] = useState('');

  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [docRequirementId, setDocRequirementId] = useState('');
  const [actorFiles, setActorFiles] = useState<Record<string, Record<string, File>>>({});
  const [savingCase, setSavingCase] = useState(false);
  const [missingActorDocsWarning, setMissingActorDocsWarning] = useState(false);
  const filePickerRef = React.useRef<HTMLInputElement>(null);
  const process = templates.find(t => t.id === newTemplateId && !t.originalDocumentContent);
  const requiredDocs = process?.stages.flatMap(stage => stage.requirements.filter(r => r.type === 'document' && r.isRequired).map(r => ({ ...r, stageId: stage.id }))) || [];
  const normalized = (v: string) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const belongsTo = (name: string, role: string) => {
    const n = normalized(name), r = normalized(role);
    if (r === 'garante') return /garant/.test(n);
    if (r === 'locador') return /locador|propietario|escritura|servicio|impuesto/.test(n);
    if (r === 'locatario') return /locatario|inquilino/.test(n);
    if (r === 'vendedor') return /vendedor|escritura/.test(n);
    return n.includes(r);
  };
  const draftKey = editingParticipantId || pType + ':' + pDni.replace(/\D/g, '');
  const mappedFields = process?.stages.flatMap(stage => stage.requirements).map(req => ({ req, field: importedField(req.name) })).filter((item): item is {req: typeof item.req; field: NonNullable<typeof item.field>} => !!item.field) || [];
  const mappedActorFields = mappedFields.filter(item => roleForField(item.field.actor));
  const mappedGeneralFields = mappedFields.filter(item => !roleForField(item.field.actor));
  const roleFields = mappedActorFields.filter(item => roleForField(item.field.actor) === pType);
  const inferredRoles = Array.from(new Set(mappedActorFields.map(item => roleForField(item.field.actor)).filter((role): role is ParticipantType => !!role)));
  const actorRulesForForm = process?.stages.flatMap(s => s.requirements).filter(r => r.type === 'actor' && r.isRequired) || [];
  // Mostrar únicamente los roles cuya cantidad mínima todavía no se completó.
  // Si se requieren varios actores del mismo rol, conservarlo hasta alcanzar ese mínimo.
  const requiredCountByRole = new Map<ParticipantType, number>();
  for (const rule of actorRulesForForm) {
    const role = rule.actorRole as ParticipantType | undefined;
    if (!role || role === 'Escribano') continue;
    requiredCountByRole.set(role, Math.max(requiredCountByRole.get(role) || 0, Math.max(1, Number(rule.minQuantity) || 1)));
  }
  for (const role of inferredRoles) {
    if (!requiredCountByRole.has(role)) requiredCountByRole.set(role, 1);
  }
  const expectedActores = [...requiredCountByRole.entries()].filter(([role]) => role !== 'Garante').reduce((sum, [, count]) => sum + count, 0);
  const expectedGarantes = requiredCountByRole.get('Garante') || 0;
  const remainingRoles = [...requiredCountByRole.entries()]
    .filter(([role, minimum]) => participants.filter(p => p.role === role).length < minimum)
    .map(([role]) => role);
  const availableRoles = [...remainingRoles, ...(escribanoADesignar && !participants.some(p => p.role === 'Escribano') ? ['Escribano' as ParticipantType] : [])];
  React.useEffect(() => {
    if (!editingParticipantId && availableRoles.length && !availableRoles.includes(pType)) setPType(availableRoles[0]);
  }, [newTemplateId, participants, escribanoADesignar, editingParticipantId, pType]);
  const actorRequiredDocs = requiredDocs.filter(req => belongsTo(req.name, pType));
  const missingDraftDocs = actorRequiredDocs.filter(req => !actorFiles[draftKey]?.[req.id]);
  const onActorFileSelected = (file?: File) => {
    setMissingActorDocsWarning(false);
    if (!file || !docRequirementId) return;
    if (!file.size || file.size > 20 * 1024 * 1024) { alert('El archivo debe tener contenido y pesar menos de 20 MB.'); return; }
    setActorFiles(prev => ({ ...prev, [draftKey]: { ...prev[draftKey], [docRequirementId]: file } }));
    setDocModalOpen(false);
    setDocRequirementId('');
  };

  React.useEffect(() => {
    if (showCreateModal) {
      setSubmitAttempted(false);
    }
  }, [showCreateModal]);

  const getValidationErrors = (): string[] => {
    const errors: string[] = [];

    // General fields
    const isTemplateRequired = systemSettings?.processTemplateRequired !== false;
    if (!newTitle.trim()) {
      errors.push('Falta ingresar el Título del Legajo.');
    }
    if (!newDescription.trim()) {
      errors.push('Falta ingresar la Descripción General.');
    }
    if (isTemplateRequired && !newTemplateId) {
      errors.push('Falta seleccionar un tipo de proceso.');
    }

    // Reglas de actores del proceso, definidas por los responsables.
    const selectedProcess = templates.find(t => t.id === newTemplateId && !t.originalDocumentContent);
    const actorRules = selectedProcess?.stages.flatMap(st => st.requirements).filter(req => req.type === 'actor' && req.isRequired) || [];
    for (const rule of actorRules) {
      if (rule.actorRole === 'Escribano') continue; // El escribano solo se exige si se activa su interruptor.
      const count = participants.filter(p => p.role === rule.actorRole && p.name.trim() && p.lastName.trim() && p.dni.trim()).length;
      const minimum = Math.max(1, Number(rule.minQuantity) || 1);
      if (count < minimum) errors.push(`Faltan ${minimum - count} ${rule.actorRole || rule.name} (mínimo ${minimum}).`);
    }

    for (const role of inferredRoles) {
      if (!participants.some(p => p.role === role && p.name.trim() && p.lastName.trim() && p.dni.trim())) errors.push('Falta cargar el actor requerido: ' + role);
    }

    // Los documentos exigidos se resumen en una sola línea, sin repetir el listado en otro panel.
    // Su carga y aprobación se realizan en el legajo, donde se vinculan a cada requisito.
    const requiredDocuments = selectedProcess?.stages.flatMap(st => st.requirements)
      .filter(req => req.type === 'document' && req.isRequired) || [];
    if (requiredDocuments.length > 0) {
      errors.push(`Documentos para cargar en el legajo: ${requiredDocuments.map(req => req.name).join(' / ')}.`);
    }

    // Actores mínimos requeridos
    const escribanosActuales = participants.filter(p => p.role === 'Escribano').length;



    if (escribanoADesignar && escribanosActuales < 1) {
      errors.push('Activaste Escribano: debés agregar al menos un actor con rol Escribano.');
    }

    // Actores individuales con datos incompletos
    participants.forEach((p, idx) => {
      const missing: string[] = [];
      if (!p.name?.trim()) missing.push('Nombre');
      if (!p.lastName?.trim()) missing.push('Apellido');
      if (!p.dni?.trim()) missing.push('DNI');

      if (missing.length > 0) {
        const displayName = p.name || p.lastName ? `${p.name || ''} ${p.lastName || ''}`.trim() : `Actor #${idx + 1}`;
        errors.push(`Actor "${displayName}" (${p.role || 'Sin rol'}): Falta completar [ ${missing.join(', ')} ].`);
      }
    });

    return errors;
  };

  const isManagerOrAdmin = ['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(currentUser.role);

  const valuesForParticipant = () => {
    const values = {...actorFieldValues};
    for (const item of roleFields) {
      const label = normalizedActor(item.field.label);
      if (/conyuge/.test(normalizedActor(item.field.actor))) continue; // Spouse values must never inherit the primary actor's identity.
      if (/^dni$|documento de identidad/.test(label)) values[item.field.id] = pDni;
      else if (/mail|correo|e-mail/.test(label)) values[item.field.id] = pEmail;
      else if (/fecha de nacimiento/.test(label)) values[item.field.id] = pBirthDate;
      else if (/cuit|cuil/.test(label)) values[item.field.id] = pCuit;
      else if (/telefono|celular/.test(label)) values[item.field.id] = pPhone;
      else if (/nombre y apellido/.test(label) && !/conyuge/.test(normalizedActor(item.field.actor))) values[item.field.id] = (pName+' '+pLastName).trim();
    }
    return values;
  };
  const handleStartEditParticipant = (p: Participant) => {
    setMissingActorDocsWarning(false);
    setEditingParticipantId(p.id);
    setActorFieldValues(p.fieldValues || {});
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
  };

  const handleAddParticipant = (confirmedMissingDocuments = false) => {
    if (!editingParticipantId && !availableRoles.includes(pType)) { alert('No quedan roles pendientes de carga para este proceso.'); return; }
    if (!pName || !pLastName || !pDni) {
      alert('Completá el nombre, apellido y DNI del actor. Los demás datos se solicitan según la plantilla.');
      return;
    }

    if (missingDraftDocs.length && !confirmedMissingDocuments) { setMissingActorDocsWarning(true); return; }
    setMissingActorDocsWarning(false);
    if (editingParticipantId) {
      setParticipants(prev => prev.map(p => {
        if (p.id === editingParticipantId) {
          return {
            ...p,
            name: pName,
            lastName: pLastName,
            dni: pDni,
            cuitCuil: pCuit,
            email: pEmail,
            phone: pPhone,
            birthDate: pBirthDate || undefined,
            role: pType,
            comments: `${pType}: ${pComments}`.trim(),
            fieldValues: valuesForParticipant()
          };
        }
        return p;
      }));
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
        birthDate: pBirthDate || undefined,
        role: pType,
        comments: `${pType}: ${pComments}`.trim(),
        fieldValues: valuesForParticipant()
      };
      setParticipants([...participants, newPart]);
      setActorFiles(prev => ({ ...prev, [newPart.id]: prev[draftKey] || {} }));
    }

    // Clear inputs
    setPName('');
    setPLastName('');
    setPDni('');
    setPCuit('');
    setPEmail('');
    setPPhone('');
    setPBirthDate('');
    setPComments(''); setActorFieldValues({});
    setMissingActorDocsWarning(false);
  };

  const handleRemoveParticipant = (id: string) => {
    if (editingParticipantId === id) {
      setEditingParticipantId(null);
    }
    setParticipants(participants.filter(p => p.id !== id));
    setActorFiles(prev => { const next = { ...prev }; delete next[id]; return next; });
  };

  const startNewCase = () => {
    setEditingDraftId(null); setNewTitle(''); setNewDescription(''); setNewTemplateId('');
    setParticipants([]); setGeneralFieldValues({}); setActorFieldValues({});
    setPName(''); setPLastName(''); setPDni(''); setPCuit(''); setPEmail(''); setPPhone(''); setPBirthDate(''); setPComments('');
    setEditingParticipantId(null); setEscribanoADesignar(false); setActorFiles({});
    setCustomDocumentContent(''); setUploadedFileName(''); setShowCreateModal(true);
  };
  const resumeDraft = (draft: DraftRecord) => {
    setEditingDraftId(draft.id); setNewTitle(draft.title || ''); setNewDescription(draft.description || '');
    setNewTemplateId(draft.templateId || ''); setNewAdvisorId(draft.advisorId || '');
    setParticipants(draft.participants || []); setGeneralFieldValues(draft.fieldValues || {});
    setActorFieldValues(draft.pendingActor?.fieldValues ? JSON.parse(draft.pendingActor.fieldValues) : {});
    setPType((draft.pendingActor?.role || 'Vendedor') as ParticipantType);
    setPName(draft.pendingActor?.name || ''); setPLastName(draft.pendingActor?.lastName || '');
    setPDni(draft.pendingActor?.dni || ''); setPCuit(draft.pendingActor?.cuit || '');
    setPEmail(draft.pendingActor?.email || ''); setPPhone(draft.pendingActor?.phone || '');
    setPBirthDate(draft.pendingActor?.birthDate || ''); setPComments(draft.pendingActor?.comments || '');
    setEditingParticipantId(draft.pendingActor?.editingId || null);
    setCustomDocumentContent(draft.documentContent || ''); setEscribanoADesignar(!!draft.escribano);
    setActorFiles({}); setShowCreateModal(true);
  };
  const saveDraft = async () => {
    if (draftBusy || savingCase) return;
    setDraftBusy(true);
    try {
      const id = editingDraftId || 'draft-' + crypto.randomUUID();
      const payload = {
        title:newTitle,description:newDescription,templateId:newTemplateId,advisorId:newAdvisorId,
        participants,fieldValues:generalFieldValues,documentContent:customDocumentContent,escribano:escribanoADesignar,
        pendingActor:{role:pType,name:pName,lastName:pLastName,dni:pDni,cuit:pCuit,email:pEmail,phone:pPhone,birthDate:pBirthDate,comments:pComments,editingId:editingParticipantId || '',fieldValues:JSON.stringify(actorFieldValues)}
      };
      const response = await fetch('/api/case-drafts/'+id,{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      if (!response.ok) throw new Error((await response.json()).error || 'No se pudo guardar el borrador');
      setEditingDraftId(id);
      await refreshDrafts(); setShowCreateModal(false);
      if (Object.values(actorFiles).some(files => Object.keys(files).length)) alert('Borrador guardado. Los archivos seleccionados todavía no fueron subidos y deberán adjuntarse al retomarlo.');
    } catch (error:any) { alert(error?.message || 'Error al guardar el borrador'); }
    finally {setDraftBusy(false);}
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);
    const errors = getValidationErrors().filter(error => !error.startsWith('Documentos para cargar en el legajo:'));
    const assignedFiles = participants.flatMap(actor => Object.entries(actorFiles[actor.id] || {}).map(([requirementId, file]) => ({ requirementId, file, actor })));
    if (errors.length) { alert('Requisitos pendientes:\n' + errors.join('\n')); return; }
    const pendingDocs = participants.flatMap(actor => requiredDocs.filter(r => belongsTo(r.name, actor.role || '') && !actorFiles[actor.id]?.[r.id]).map(r => `${r.name} — ${actor.name} ${actor.lastName}`));
    if (pendingDocs.length && pendingCreationDocs === null) { setPendingCreationDocs(pendingDocs); return; }
    if (savingCase) return;
    setSavingCase(true);
    let createdId = '';
    try {
      const advisorId = currentUser.role === 'ASESOR' ? currentUser.id : (newAdvisorId || users.find(u => u.role === 'ASESOR')?.id || '');
      const response = await fetch('/api/cases', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle, description: newDescription, templateId: newTemplateId, assignedAdvisorId: advisorId, assignedManagerId: currentUser.role === 'ASESOR' ? '' : currentUser.id, participants, generalFieldValues, pendingDocumentNames: pendingDocs, documentContent: customDocumentContent || undefined })
      });
      const created = await response.json();
      if (!response.ok) throw new Error(created.error || 'No se pudo crear el legajo.');
      createdId = created.id;
      if (!createdId) throw new Error('El servidor no devolvió el identificador del legajo.');
      for (const { requirementId, file, actor } of assignedFiles) {
        const req = requiredDocs.find(r => r.id === requirementId);
        if (!req) continue;
        const data = new FormData();
        data.append('caseId', createdId);
        data.append('stageId', req.stageId);
        data.append('requirementId', requirementId);
        data.append('name', req.name + ' — ' + actor.name + ' ' + actor.lastName);
        data.append('file', file);
        const upload = await fetch('/api/documents/upload', { method: 'POST', credentials: 'include', body: data });
        if (!upload.ok) { const detail = await upload.json().catch(() => ({})); throw new Error(detail.error || 'Error al almacenar ' + req.name + ' en R2.'); }
      }
      if (editingDraftId) {
        await fetch('/api/case-drafts/'+editingDraftId,{method:'DELETE',credentials:'include'});
        await refreshDrafts(); setEditingDraftId(null);
      }
      await loadState?.();
      setNewTitle(''); setNewDescription(''); setParticipants([]); setActorFiles({});
      setEscribanoADesignar(false);
      setCustomDocumentContent(''); setUploadedFileName(''); setSubmitAttempted(false);
      setShowCreateModal(false); setPendingCreationDocs(null);
      onOpenCase(createdId);
    } catch (error: any) {
      alert((createdId ? 'El legajo fue creado, pero no se completó la carga de documentos. Abrilo para verificar los archivos pendientes. ' : '') + (error?.message || 'Error al crear el legajo.'));
      if (createdId) { await loadState?.(); setShowCreateModal(false); onOpenCase(createdId); }
    } finally { setSavingCase(false); }
  };

  // Filter cases based on search and tab selections
  const filteredCases = cases.filter(c => {
    const matchesSearch = c.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          c.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          c.description.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    const matchesTemplate = templateFilter === 'all' || c.templateId === templateFilter;
    
    // Advisors can only see cases where they are the assigned advisor.
    // Managers and Admins can see all cases (since they might need to accept pending ones).
    const matchesAdvisor = currentUser.role !== 'ASESOR' || c.assignedAdvisorId === currentUser.id;

    return matchesSearch && matchesStatus && matchesTemplate && matchesAdvisor;
  });

  return (
    <div className="space-y-6">
      {docModalOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 p-4" onClick={() => setDocModalOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-slate-600 bg-slate-800 p-6 shadow-2xl space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white">Identificar documento del actor</h3>
            <p className="text-sm text-slate-200">Seleccioná qué documento vas a subir para {pName || 'el actor'} {pLastName}. Se vinculará con este actor y con el requisito del proceso.</p>
            <label className="block text-sm font-semibold text-white" htmlFor="legajo-doc-type">Documento que se está subiendo</label>
            <select id="legajo-doc-type" value={docRequirementId} onChange={e => setDocRequirementId(e.target.value)} className="w-full rounded-lg border border-slate-500 bg-slate-900 p-3 text-white">
              <option value="">-- Seleccionar documento --</option>
              {actorRequiredDocs.map(req => <option key={req.id} value={req.id}>{req.name}{actorFiles[draftKey]?.[req.id] ? ' (cargado)' : ''}</option>)}
            </select>
            {actorRequiredDocs.length === 0 && <p className="text-sm text-amber-200">No hay documentos asociados a este rol en el proceso seleccionado.</p>}
            <input ref={filePickerRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp" onChange={e => { onActorFileSelected(e.target.files?.[0]); e.target.value = ''; }} />
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setDocModalOpen(false)} className="rounded-lg bg-slate-600 px-4 py-2 text-sm font-semibold text-white">Cancelar</button>
              <button type="button" disabled={!docRequirementId} onClick={() => filePickerRef.current?.click()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Buscar archivo</button>
            </div>
          </div>
        </div>
      )}

      {/* Upper Panel */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-display font-bold text-slate-800 tracking-tight">Archivo de Legajos</h2>
          <p className="text-sm text-slate-500">Visualiza, busca y administra todos los procesos activos de la oficina.</p>
        </div>
        <button
          onClick={startNewCase}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl shadow-md shadow-indigo-500/10 hover:shadow-indigo-500/20 active:scale-98 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>{currentUser.role === 'ASESOR' ? 'Solicitar Inicio Legajo' : 'Crear Legajo'}</span>
        </button>
      </div>

      {/* Filters & Search Toolbar */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        {/* Top Row: Search and Template Filter */}
        <div className="flex flex-col md:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por código, título o descripción..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full text-sm pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-slate-50/50"
            />
          </div>

          {/* Template filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400 shrink-0" />
            <select
              value={templateFilter}
              onChange={(e) => setTemplateFilter(e.target.value)}
              className="text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-700 min-w-[180px]"
            >
              <option value="all">Todas las Plantillas</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Bottom Row: Status Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-slate-100 rounded-xl select-none">
          {(['all', 'active', 'pending_assignment', 'pending_review', 'observed', 'completed'] as const).map((st) => {
            const label = st === 'all' ? 'Todos' :
                          st === 'active' ? 'Activos' :
                          st === 'pending_assignment' ? 'Pendientes' :
                          st === 'pending_review' ? 'En Revisión' :
                          st === 'observed' ? 'Observados' : 'Finalizados';
            const count = cases.filter(c => {
              const matchesAdvisor = currentUser.role !== 'ASESOR' || c.assignedAdvisorId === currentUser.id;
              return matchesAdvisor && (st === 'all' || c.status === st);
            }).length;

            return (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  statusFilter === st
                    ? 'bg-white text-slate-800 shadow-xs font-bold'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-white/40'
                }`}
              >
                {label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {drafts.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
          <h3 className="font-bold text-amber-900">Borradores ({drafts.length})</h3>
          {drafts.map(draft => <div key={draft.id} className="flex items-center justify-between gap-3 rounded-xl bg-white border border-amber-200 p-3">
            <button type="button" onClick={() => resumeDraft(draft)} className="text-left min-w-0 flex-1">
              <span className="text-xs font-bold text-amber-700 mr-2">BORRADOR</span>
              <span className="text-sm font-semibold text-slate-800">{draft.title || 'Sin título'}</span>
              <p className="text-xs text-slate-500">Último guardado: {new Date(draft.updatedAt).toLocaleString('es-AR')} · Continuar carga</p>
            </button>
            <button type="button" className="text-xs text-rose-700 hover:underline" onClick={async () => {
              if (!window.confirm('¿Eliminar este borrador?')) return;
              const response = await fetch('/api/case-drafts/'+draft.id,{method:'DELETE',credentials:'include'});
              if (response.ok) await refreshDrafts(); else alert('No se pudo eliminar el borrador');
            }}>Eliminar</button>
          </div>)}
        </section>
      )}

      {/* Grid of Cases / Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        {filteredCases.length === 0 ? (
          <div className="p-12 text-center text-slate-400 space-y-3">
            <FileText className="w-12 h-12 text-slate-300 mx-auto" />
            <p className="text-sm font-semibold text-slate-600">No se encontraron legajos</p>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">Prueba cambiando los filtros o agregando un nuevo legajo desde la consola.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredCases.map((c) => {
              const template = templates.find(t => t.id === c.templateId);
              const advisor = users.find(u => u.id === c.assignedAdvisorId);
              
              return (
                <div 
                  key={c.id} 
                  onClick={() => onOpenCase(c.id)}
                  className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-700/60 cursor-pointer transition-colors"
                >
                  <div className="space-y-1.5 flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-2.5">
                      <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 border border-indigo-100/50 px-2.5 py-0.5 rounded-lg">
                        {c.code}
                      </span>
                      <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(c.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    
                    <h3 className="text-base font-bold text-slate-800 tracking-tight truncate hover:text-indigo-600 transition-colors">
                      {c.title}
                    </h3>
                    
                    <p className="text-xs text-slate-500 truncate max-w-2xl">{c.description}</p>
                    
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-[11px] text-slate-400">
                      <span className="flex items-center gap-1 font-medium text-slate-500">
                        <Building2 className="w-3.5 h-3.5 text-slate-400" />
                        {template?.name || 'Proceso'}
                      </span>
                      <span className="flex items-center gap-1">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        Asesor: {advisor ? `${advisor.name} ${advisor.lastName}` : 'Sin asignar'}
                      </span>
                      <span className="flex items-center gap-1 font-mono">
                        <Users className="w-3.5 h-3.5 text-slate-400" />
                        {c.participants.length} Actores
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {c.status === 'pending_assignment' ? (
                    <div className="flex flex-col sm:items-end gap-1">
                      <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded-md">
                        Solicitud Pendiente
                      </span>
                      {currentUser.role === 'MANAGER' && !c.assignedManagerId && (
                        <button
                          onClick={async () => {
                            try {
                              const response = await fetch(`/api/cases/${c.id}/assign-manager`, {
                                method: 'POST',
                                credentials: 'include',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ managerId: currentUser.id, currentUserId: currentUser.id })
                              });
                              if (!response.ok) {
                                const err = await response.json();
                                throw new Error(err.error);
                              }
                              alert('Has aceptado el legajo exitosamente.');
                              if (loadState) {
                                await loadState();
                              }
                            } catch (err: any) {
                              alert(`Error al aceptar: ${err.message}`);
                            }
                          }}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] rounded-lg transition-colors cursor-pointer shadow-xs"
                        >
                          Aceptar Legajo
                        </button>
                      )}
                      {['ADMIN', 'SUPERADMIN'].includes(currentUser.role) && (
                        <select
                          onChange={async (e) => {
                            const selectedId = e.target.value;
                            if (!selectedId) return;
                            try {
                              const response = await fetch(`/api/cases/${c.id}/assign-manager`, {
                                method: 'POST',
                                credentials: 'include',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ managerId: selectedId, currentUserId: currentUser.id })
                              });
                              if (!response.ok) {
                                const err = await response.json();
                                throw new Error(err.error);
                              }
                              alert('Legajo asignado al Manager exitosamente.');
                              if (loadState) {
                                await loadState();
                              }
                            } catch (err: any) {
                              alert(`Error al asignar: ${err.message}`);
                            }
                          }}
                          className="text-[10px] bg-white border border-slate-200 rounded px-1.5 py-1 text-slate-700 focus:outline-none"
                          defaultValue=""
                        >
                          <option value="" disabled>Asignar Manager...</option>
                          {users.filter(u => u.role === 'MANAGER').map(u => (
                            <option key={u.id} value={u.id}>{u.name} {u.lastName}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  ) : (
                    <div className="text-left sm:text-right space-y-1">
                      <div className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">Etapa actual</div>
                      <p className="text-xs font-bold text-slate-700">
                        {template && template.stages && template.stages.length > 0
                          ? (template.stages[c.currentStageIndex]?.name || 'Finalizado')
                          : 'Plantilla Digital'}
                      </p>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-1 rounded-xl text-[10px] font-mono font-bold tracking-wider uppercase border ${
                      c.isCurrentStageApproved ? 'bg-emerald-500 text-white border-emerald-600' :
                      c.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                      c.status === 'observed' ? 'bg-red-50 text-red-700 border-red-100' :
                      c.status === 'pending_review' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                      c.status === 'pending_assignment' ? 'bg-amber-100 text-amber-800 border-amber-200' :
                      'bg-blue-50 text-blue-700 border-blue-100'
                    }`}>
                      {c.isCurrentStageApproved ? (
                        (template?.stages && template.stages.length === 1) ? 'Aprobado y Finalizado' : 'Aprobado'
                      ) :
                       c.status === 'completed' ? 'Finalizado' :
                       c.status === 'observed' ? 'Observado' :
                       c.status === 'pending_review' ? 'En Revisión' :
                       c.status === 'pending_assignment' ? 'Sin Asignar' :
                       'Activo'}
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {pendingCreationDocs !== null && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4" onMouseDown={e => { if (e.target === e.currentTarget && !savingCase) setPendingCreationDocs(null); }}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="observed-confirm-title" aria-describedby="observed-confirm-description" className="w-full max-w-lg rounded-2xl border border-slate-600 bg-slate-800 shadow-2xl overflow-hidden">
            <div className="p-6 space-y-4">
              <div className="flex gap-3 items-start">
                <div className="rounded-xl bg-amber-500/15 p-3 text-amber-400 shrink-0"><AlertTriangle className="w-6 h-6" /></div>
                <div><h3 id="observed-confirm-title" className="text-lg font-bold text-white">Crear legajo con observaciones</h3>
                <p id="observed-confirm-description" className="mt-2 text-sm leading-relaxed text-slate-300">Faltan <strong className="text-amber-300">{pendingCreationDocs.length} documentos obligatorios</strong>. Podés continuar: el expediente quedará <strong className="text-rose-300">OBSERVADO</strong>, requerirá intervención del responsable y afectará tus indicadores de desempeño.</p></div>
              </div>
              <div className="rounded-xl border border-slate-600 bg-slate-900/60 p-3">
                <p className="text-xs font-bold text-slate-300 mb-2">Documentación pendiente</p>
                <ul className="max-h-40 overflow-y-auto space-y-1.5 text-xs text-slate-300">{pendingCreationDocs.map((name, index) => <li key={index} className="flex gap-2"><span className="text-amber-400">•</span><span>{name}</span></li>)}</ul>
              </div>
            </div>
            <div className="border-t border-slate-600 px-6 py-4 flex flex-wrap justify-end gap-3 bg-slate-900/40">
              <button type="button" disabled={savingCase} onClick={() => setPendingCreationDocs(null)} className="rounded-xl border border-slate-500 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50">Volver a completar</button>
              <button type="button" disabled={savingCase} onClick={() => { const form = document.getElementById('create-case-form') as HTMLFormElement | null; form?.requestSubmit(); }} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">{savingCase ? 'Creando…' : 'Crear legajo observado'}</button>
            </div>
          </div>
        </div>
      )}
      {/* CREATE CASE MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-lg font-bold text-slate-800">{editingDraftId ? 'Continuar borrador' : 'Crear Nuevo Legajo'}</h3>
                <p className="text-xs text-slate-400 mt-0.5">Define el proceso, asigna asesores y carga participantes.</p>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="p-1 text-slate-400 hover:text-slate-600 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form id="create-case-form" onSubmit={handleCreateSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Dynamic validation alert inside form popup */}
              {getValidationErrors().length > 0 && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 text-rose-800 font-bold text-xs uppercase tracking-wider">
                    <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
                    <span>Requisitos Pendientes de Carga ({getValidationErrors().length})</span>
                  </div>
                  <div className="text-rose-700 text-xs font-medium space-y-1.5 pl-1">
                    {getValidationErrors().map((err, idx) => (
                      <div key={idx} className="flex items-start gap-1.5">
                        <span className="text-rose-500 font-bold select-none shrink-0">•</span>
                        <span>{err}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Core info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">Título del Legajo *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. Compraventa - Depto Belgrano 4 ambientes"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">
                    Tipo de proceso {isTemplateRequired ? '*' : '(Opcional)'}
                  </label>
                  <select
                    value={newTemplateId}
                    onChange={(e) => setNewTemplateId(e.target.value)}
                    required={isTemplateRequired}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">-- Seleccionar Tipo de proceso --</option>
                    {(() => {
                      const regularTemplates = templates.filter(t => !t.id.startsWith('doc-') && !t.id.startsWith('tmpl-dig-') && !t.originalDocumentContent);
                      return (
                        <>
                          {regularTemplates.length > 0 && (
                            <optgroup label="Procesos configurados por responsables">
                              {regularTemplates.map(t => (
                                <option key={t.id} value={t.id}>{t.name} ({t.industry})</option>
                              ))}
                            </optgroup>
                          )}

                        </>
                      );
                    })()}
                  </select>

                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-semibold text-slate-600">Descripción General *</label>
                  <textarea
                    required
                    placeholder="Indica de manera descriptiva el alcance, montos involucrados o datos referenciales del legajo..."
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    rows={2}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div className="space-y-1.5 font-sans">
                  <label className="text-xs font-semibold text-slate-600">Asesor de Carga Asignado *</label>
                  <select
                    value={newAdvisorId}
                    onChange={(e) => setNewAdvisorId(e.target.value)}
                    disabled={currentUser.role === 'ASESOR'}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-50 disabled:text-slate-500"
                  >
                    {currentUser.role === 'ASESOR' ? (
                      <option value={currentUser.id}>{currentUser.name} {currentUser.lastName}</option>
                    ) : (
                      users.filter(u => u.role === 'ASESOR').map(u => (
                        <option key={u.id} value={u.id}>{u.name} {u.lastName}</option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              {mappedGeneralFields.length > 0 && <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <h4 className="text-sm font-bold text-slate-800">Datos de la operación según la hoja digitalizada</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {mappedGeneralFields.map(item => <label key={item.field.id} className="text-xs font-semibold text-slate-600">
                    {item.field.label} ({item.field.id})
                    <input type="text" value={generalFieldValues[item.field.id] || ''} onChange={e => setGeneralFieldValues(prev => ({...prev,[item.field.id]:e.target.value}))} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs" />
                  </label>)}
                </div>
              </section>}
              {/* Actores Cantidad Requerida Section */}
              <div className="border-t border-slate-100 pt-5 space-y-3 font-sans">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-600" />
                  <h4 className="text-sm font-bold text-slate-800">Cantidad de Actores Requeridos</h4>
                </div>
                <p className="text-[11px] text-slate-500">
                  Cantidades definidas automáticamente por la plantilla del proceso. Solo podés decidir si cargar el escribano ahora.
                </p>
                
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-150 grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Actores requeridos</label>
                    <input type="number" readOnly aria-readonly="true" value={expectedActores}
                      className="w-full text-xs p-2 bg-slate-100 border border-slate-200 rounded-lg font-semibold cursor-default [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                    <p className="text-[10px] text-slate-500">Vendedor, comprador, locador, locatario u otros actores, excepto garantes y escribano.</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Garantes</label>
                    <input type="number" readOnly aria-readonly="true" value={expectedGarantes}
                      className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                  </div>
                  <div className="flex flex-col justify-center gap-2">
                    <label className="text-xs font-semibold text-slate-700">Cargar escribano ahora</label>
                    <button type="button" role="switch" aria-checked={escribanoADesignar}
                      onClick={() => setEscribanoADesignar(v => !v)}
                      className={`relative h-7 w-12 rounded-full border transition-colors ${escribanoADesignar ? 'bg-indigo-600 border-indigo-500' : 'bg-slate-400 border-slate-500'}`}>
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${escribanoADesignar ? 'left-6' : 'left-1'}`} />
                    </button>
                    <p className="text-[10px] text-slate-500">{escribanoADesignar ? 'Obligatorio: agregá 1 escribano abajo.' : 'Datos del escribano pospuestos.'}</p>
                  </div>
                </div>
              </div>

              {/* Actores Section */}
              <div className="border-t border-slate-100 pt-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-indigo-600" />
                    <h4 className="text-sm font-bold text-slate-800">Actores del Legajo ({participants.length})</h4>
                  </div>
                  
                  {/* Status Indicator bubble */}
                  <div className="text-[10px] px-2 py-1 bg-indigo-50 text-indigo-700 rounded-lg font-semibold border border-indigo-100">
                    Mínimo Requerido: {actorRulesForForm.filter(r => r.actorRole !== 'Escribano').reduce((n,r) => n + Math.max(1,Number(r.minQuantity)||1),0) + (escribanoADesignar ? 1 : 0)} | Cargados: {participants.length}
                  </div>
                </div>

                {/* Form to add one Actor */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-150 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-500">Rol del Actor</label>
                    <select
                      value={pType}
                      onChange={(e) => setPType(e.target.value as ParticipantType)}
                      className="w-full text-[11px] p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      {(editingParticipantId ? Array.from(new Set([pType, ...availableRoles])) : availableRoles).map(role => <option key={role} value={role}>{role}</option>)}

                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-500">Nombre *</label>
                    <input type="text" value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Ej. Roberto" className="w-full text-[11px] p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-500">Apellido *</label>
                    <input type="text" value={pLastName} onChange={(e) => setPLastName(e.target.value)} placeholder="Ej. Méndez" className="w-full text-[11px] p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
                  {(!mappedActorFields.length || roleFields.some(item => !/conyuge/.test(normalizedActor(item.field.actor)) && /fecha de nacimiento/.test(normalizedActor(item.field.label)))) && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-500">Fecha de Nacimiento</label>
                    <input type="date" aria-label="Fecha de nacimiento: abrir calendario" value={pBirthDate} onChange={(e) => setPBirthDate(e.target.value)} className="legajo-birth-date w-full text-[11px] p-2 pr-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
                  )}
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-500">DNI *</label>
                    <input type="text" value={pDni} onChange={(e) => setPDni(e.target.value)} placeholder="Ej. 32.145.980" className="w-full text-[11px] p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
                  {(!mappedActorFields.length || roleFields.some(item => !/conyuge/.test(normalizedActor(item.field.actor)) && /cuit|cuil/.test(normalizedActor(item.field.label)))) && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-500">CUIT/CUIL</label>
                    <input type="text" value={pCuit} onChange={(e) => setPCuit(e.target.value)} onBlur={() => setPCuit(current => formatCuitCuil(current))} inputMode="numeric" placeholder="Ej. 20-32145980-4" className="w-full text-[11px] p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
                  )}
                  {(!mappedActorFields.length || roleFields.some(item => !/conyuge/.test(normalizedActor(item.field.actor)) && /mail|correo|e-mail/.test(normalizedActor(item.field.label)))) && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-500">Email</label>
                    <input type="email" value={pEmail} onChange={(e) => setPEmail(e.target.value)} placeholder="Ej. mendez@email.com" className="w-full text-[11px] p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
                  )}
                  {(!mappedActorFields.length || roleFields.some(item => !/conyuge/.test(normalizedActor(item.field.actor)) && /telefono|celular/.test(normalizedActor(item.field.label)))) && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-500">Teléfono/Celular</label>
                    <input type="tel" value={pPhone} onChange={(e) => setPPhone(e.target.value)} onFocus={(e) => { if (!pPhone.trim()) { setPPhone('+54'); requestAnimationFrame(() => { e.target.setSelectionRange(3, 3); }); } }} placeholder="Ej. +54 11 4432-8761" className="w-full text-[11px] p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
                  )}
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-500">Observaciones del Actor</label>
                    <input type="text" value={pComments} onChange={(e) => setPComments(e.target.value)} placeholder="Comentarios, facultades..." className="w-full text-[11px] p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
                  {roleFields.length > 0 && <div className="sm:col-span-3 rounded-lg border border-indigo-100 bg-white p-3 space-y-3">
                    <p className="text-xs font-bold text-indigo-800">Datos de {pType} según la hoja digitalizada</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {roleFields.filter(item => /conyuge/.test(normalizedActor(item.field.actor)) || !/^(dni|mail|correo|fecha de nacimiento|cuit|cuil|telefono|celular)$/i.test(normalizedActor(item.field.label))).map(item => (
                        <label key={item.field.id} className="block text-[11px] font-semibold text-slate-600">
                          {item.field.actor} — {item.field.label} ({item.field.id})
                          <input type="text" value={actorFieldValues[item.field.id] || ''} onChange={e => setActorFieldValues(prev => ({...prev,[item.field.id]:e.target.value}))} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs" />
                        </label>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-500">DNI, correo, fecha de nacimiento y otros datos comunes se vinculan automáticamente con su CAMPO correspondiente.</p>
                  </div>}
                  {missingActorDocsWarning && <div role="alertdialog" aria-label="Documentos pendientes del actor" className="sm:col-span-3 rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-2">
                    <p className="text-sm font-bold text-amber-900">Documentos pendientes</p>
                    <p className="text-xs text-amber-900">No cargaste: {missingDraftDocs.map(r => r.name).join(', ')}. Podés continuar agregando actores. Si faltan documentos al crear el legajo, el sistema aplicará la política configurada por el administrador: permitirlo como OBSERVADO o impedir su creación.</p>
                    <div className="flex justify-end gap-2"><button type="button" onClick={() => setMissingActorDocsWarning(false)} className="rounded-lg border border-amber-400 px-3 py-2 text-xs">Volver a cargar documentos</button><button type="button" onClick={() => handleAddParticipant(true)} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white">Continuar sin documentos</button></div>
                  </div>}
                  <div className="sm:col-span-3 flex justify-end gap-2 pt-1.5">
                    {editingParticipantId && (
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
                        }}
                        className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-lg transition-colors border border-slate-300"
                      >
                        Cancelar Edición
                      </button>
                    )}
                    <button type="button" onClick={() => { setDocRequirementId(''); setDocModalOpen(true); }} className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-white font-bold text-xs rounded-lg border border-slate-500">
                      Cargar Doc. {actorRequiredDocs.length ? '(' + (actorRequiredDocs.length - missingDraftDocs.length) + '/' + actorRequiredDocs.length + ')' : ''}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddParticipant()}
                      className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs rounded-lg transition-colors border border-indigo-700 shadow-xs"
                    >
                      {editingParticipantId ? 'Guardar Cambios' : 'Añadir Actor'}
                    </button>
                  </div>
                </div>

                {/* Display added participants in list */}
                {participants.length > 0 && (
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {participants.map((p) => (
                      <div key={p.id} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="text-xs">
                          <p className="font-bold text-slate-700">
                            {p.name} {p.lastName} <span className="text-[10px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-sm font-semibold ml-1">{p.role || p.comments?.split(':')[0]}</span>
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            DNI: {p.dni || 'N/A'} | CUIT: {p.cuitCuil || 'N/A'} | F. Nac: {p.birthDate || 'N/A'} | Email: {p.email || 'N/A'} | Tel: {p.phone || 'N/A'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleStartEditParticipant(p)}
                            className="text-slate-400 hover:text-indigo-600 p-1"
                            title="Editar Actor"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveParticipant(p.id)}
                            className="text-slate-400 hover:text-red-500 p-1"
                            title="Eliminar Actor"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </form>

            {/* Footer buttons */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-xl"
              >
                Cancelar
              </button>
              <button type="button" disabled={draftBusy || savingCase} onClick={() => void saveDraft()} className="px-4 py-2 rounded-xl border border-amber-300 bg-amber-100 text-amber-900 text-xs font-bold disabled:opacity-50">
                {draftBusy ? 'Guardando borrador…' : 'Guardar borrador'}
              </button>
              <button
                type="button"
                onClick={handleCreateSubmit}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-xs"
              >
                Crear Legajo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Delete Confirmation Modal */}
      {caseToDelete && (
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
                  Está a punto de eliminar permanentemente el legajo <strong className="text-slate-800 font-bold">"{caseToDelete.title}" ({caseToDelete.code})</strong>.
                </p>
                <p className="bg-rose-50 text-rose-800 p-3 rounded-lg border border-rose-100 font-medium">
                  Atención: Esta acción eliminará el legajo y todos sus datos relacionados (tareas, documentos, observaciones, etc.) de forma irreversible.
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setCaseToDelete(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const response = await fetch(`/api/cases/${caseToDelete.id}?currentUserId=${currentUser.id}`, {
                      method: 'DELETE',
                      credentials: 'include'
                    });
                    if (!response.ok) {
                      const err = await response.json();
                      throw new Error(err.error || 'No se pudo eliminar el legajo');
                    }
                    alert('Legajo eliminado exitosamente.');
                    setCaseToDelete(null);
                    if (loadState) {
                      await loadState();
                    }
                  } catch (err: any) {
                    alert(`Error al eliminar: ${err.message}`);
                  }
                }}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer"
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
