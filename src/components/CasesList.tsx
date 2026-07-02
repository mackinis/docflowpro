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
  Upload,
  Pencil
} from 'lucide-react';
import { Case, ProcessTemplate, User as UserType, Participant, ParticipantType } from '../types';

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
  const [caseToDelete, setCaseToDelete] = useState<Case | null>(null);
  const isTemplateRequired = systemSettings?.processTemplateRequired !== false;
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending_review' | 'observed' | 'completed' | 'pending_assignment'>('all');
  const [templateFilter, setTemplateFilter] = useState('all');

  const base64ToUnicode = (str: string) => {
    try {
      const base64Part = str.includes(',') ? str.split(',')[1] : str;
      return decodeURIComponent(escape(atob(base64Part)));
    } catch (e) {
      try {
        const base64Part = str.includes(',') ? str.split(',')[1] : str;
        return atob(base64Part);
      } catch (err) {
        return '';
      }
    }
  };

  const availableDigitizedDocs = (sharedDocuments || []).filter(doc => {
    const isDigital = doc.name?.toLowerCase().includes('digitalizado') || 
                      doc.fileName?.endsWith('_digitalizado.txt') || 
                      doc.fileName?.endsWith('.txt');
    if (!isDigital) return false;
    
    if (currentUser.role === 'SUPERADMIN' || currentUser.role === 'ADMIN') return true;
    const roleAllowed = doc.allowedRoles?.includes(currentUser.role);
    const userAllowed = doc.allowedUserIds?.includes(currentUser.id);
    return roleAllowed || userAllowed;
  });

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

    setUploadedFileName(file.name);
    setIsExtractingFile(true);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (file.name.toLowerCase().endsWith('.txt')) {
        setCustomDocumentContent(text);
      } else {
        // Simple simulated extractor for docx/pdf to give a lovely visual experience
        const simulatedText = `CONTRATO DE ADHESIÓN DIGITALIZADO - ${file.name.replace(/\.[^/.]+$/, "")}\n\nEn la ciudad de Buenos Aires, a los [Fecha] días del mes de [Mes], entre el Sr./Sra. [Nombre Completo Cliente], DNI [DNI Cliente] por una parte, y la empresa por la otra, se conviene la presente transacción sobre la propiedad bajo el proceso de la plantilla seleccionada.\n\nVALOR DE LA OPERACIÓN: $[Monto del Contrato]\n\nEste documento se cargó desde el archivo original digitalizado: ${file.name}.`;
        setCustomDocumentContent(simulatedText);
      }
      setIsExtractingFile(false);
    };
    reader.readAsText(file);
  };
  
  React.useEffect(() => {
    const isTemplateRequired = systemSettings?.processTemplateRequired !== false;
    if (showCreateModal && templates.length > 0) {
      setNewTemplateId(isTemplateRequired ? templates[0].id : '');
    }
  }, [showCreateModal, templates, systemSettings]);
  
  // Participant/Actor quantities and type states
  const [expectedVendedores, setExpectedVendedores] = useState(0);
  const [expectedCompradores, setExpectedCompradores] = useState(0);
  const [expectedGarantes, setExpectedGarantes] = useState(0);
  const [escribanoADesignar, setEscribanoADesignar] = useState(true);

  // Participant form states
  const [participants, setParticipants] = useState<Participant[]>([]);
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

  const [submitAttempted, setSubmitAttempted] = useState(false);

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
      errors.push('Falta seleccionar una Plantilla de Proceso.');
    }

    // Actores mínimos requeridos
    const vendedoresActuales = participants.filter(p => p.role === 'Vendedor').length;
    const compradoresActuales = participants.filter(p => p.role === 'Comprador').length;
    const garantesActuales = participants.filter(p => p.role === 'Garante').length;
    const escribanosActuales = participants.filter(p => p.role === 'Escribano').length;

    if (participants.length === 0) {
      errors.push('Falta agregar actores. El legajo no puede crearse con 0 actores (se requiere al menos 1).');
    }

    if (vendedoresActuales < expectedVendedores) {
      errors.push(`Falta(n) ${expectedVendedores - vendedoresActuales} Vendedor(es) (Cargados: ${vendedoresActuales} de ${expectedVendedores}).`);
    }
    if (compradoresActuales < expectedCompradores) {
      errors.push(`Falta(n) ${expectedCompradores - compradoresActuales} Comprador(es) (Cargados: ${compradoresActuales} de ${expectedCompradores}).`);
    }
    if (garantesActuales < expectedGarantes) {
      errors.push(`Falta(n) ${expectedGarantes - garantesActuales} Garante(s) (Cargados: ${garantesActuales} de ${expectedGarantes}).`);
    }
    if (!escribanoADesignar && escribanosActuales < 1) {
      errors.push('Falta agregar el Escribano (o tildar "Escribano a designar").');
    }

    // Actores individuales con datos incompletos
    participants.forEach((p, idx) => {
      const missing: string[] = [];
      if (!p.name?.trim()) missing.push('Nombre');
      if (!p.lastName?.trim()) missing.push('Apellido');
      if (!p.birthDate?.trim()) missing.push('Fecha de Nacimiento');
      if (!p.dni?.trim()) missing.push('DNI');
      if (!p.cuitCuil?.trim()) missing.push('CUIT/CUIL');
      if (!p.email?.trim()) missing.push('Email');
      if (!p.phone?.trim()) missing.push('Teléfono/Celular');

      if (missing.length > 0) {
        const displayName = p.name || p.lastName ? `${p.name || ''} ${p.lastName || ''}`.trim() : `Actor #${idx + 1}`;
        errors.push(`Actor "${displayName}" (${p.role || 'Sin rol'}): Falta completar [ ${missing.join(', ')} ].`);
      }
    });

    return errors;
  };

  const isManagerOrAdmin = ['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(currentUser.role);

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
  };

  const handleAddParticipant = () => {
    if (!pName || !pLastName || !pDni || !pCuit || !pBirthDate || !pEmail || !pPhone) {
      alert('Favor de completar todos los campos obligatorios del actor (Nombre, Apellido, Fecha de Nacimiento, DNI, CUIT/CUIL, Email, Teléfono/Celular).');
      return;
    }

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
            comments: `${pType}: ${pComments}`.trim()
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
        comments: `${pType}: ${pComments}`.trim()
      };
      setParticipants([...participants, newPart]);
    }

    // Clear inputs
    setPName('');
    setPLastName('');
    setPDni('');
    setPCuit('');
    setPEmail('');
    setPPhone('');
    setPBirthDate('');
    setPComments('');
  };

  const handleRemoveParticipant = (id: string) => {
    if (editingParticipantId === id) {
      setEditingParticipantId(null);
    }
    setParticipants(participants.filter(p => p.id !== id));
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);

    const errors = getValidationErrors();
    if (errors.length > 0) {
      let msg = 'No se puede crear el legajo debido a los siguientes requisitos pendientes:\n\n' + 
                errors.join('\n') + 
                '\n\nPor favor complete todos los datos requeridos e intente nuevamente.';
      alert(msg);
      return;
    }

    const assignedAdvisorId = currentUser.role === 'ASESOR' ? currentUser.id : (newAdvisorId || users.find(u => u.role === 'ASESOR')?.id || '');
    const assignedManagerId = currentUser.role === 'ASESOR' ? '' : currentUser.id;

    onCreateCase({
      title: newTitle,
      description: newDescription,
      templateId: newTemplateId,
      assignedAdvisorId,
      assignedManagerId,
      participants,
      documentContent: customDocumentContent || undefined
    });

    // Reset forms
    setNewTitle('');
    setNewDescription('');
    setParticipants([]);
    setExpectedVendedores(0);
    setExpectedCompradores(0);
    setExpectedGarantes(0);
    setEscribanoADesignar(true);
    setCustomDocumentContent('');
    setUploadedFileName('');
    setSubmitAttempted(false);
    setShowCreateModal(false);
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
      {/* Upper Panel */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-display font-bold text-slate-800 tracking-tight">Archivo de Legajos</h2>
          <p className="text-sm text-slate-500">Visualiza, busca y administra todos los procesos activos de la oficina.</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
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
                  className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 hover:bg-slate-50/50 cursor-pointer transition-colors"
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
                    {currentUser.role === 'SUPERADMIN' && (
                      <button
                        title="Eliminar Legajo"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCaseToDelete(c);
                        }}
                        className="p-1 text-rose-500 hover:bg-rose-50 hover:text-rose-700 rounded transition-all cursor-pointer shrink-0 z-10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* CREATE CASE MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-lg font-bold text-slate-800">Crear Nuevo Legajo</h3>
                <p className="text-xs text-slate-400 mt-0.5">Define el proceso, asigna asesores y carga participantes.</p>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="p-1 text-slate-400 hover:text-slate-600 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
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
                    Plantilla de Proceso {isTemplateRequired ? '*' : '(Opcional)'}
                  </label>
                  <select
                    value={newTemplateId}
                    onChange={(e) => setNewTemplateId(e.target.value)}
                    required={isTemplateRequired}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">-- Seleccionar Plantilla de Proceso --</option>
                    {(() => {
                      const regularTemplates = templates.filter(t => !t.id.startsWith('doc-'));
                      const virtualTemplates = templates.filter(t => t.id.startsWith('doc-'));
                      const allowedVirtualTemplates = virtualTemplates.filter(vt => {
                        const docId = vt.id.replace('doc-', '');
                        const docObj = (sharedDocuments || []).find(d => d.id === docId);
                        if (!docObj) return false;
                        
                        if (currentUser.role === 'SUPERADMIN' || currentUser.role === 'ADMIN') return true;
                        const roleAllowed = docObj.allowedRoles?.includes(currentUser.role);
                        const userAllowed = docObj.allowedUserIds?.includes(currentUser.id);
                        return roleAllowed || userAllowed;
                      });

                      return (
                        <>
                          {regularTemplates.length > 0 && (
                            <optgroup label="Plantillas de Procesos Creadas">
                              {regularTemplates.map(t => (
                                <option key={t.id} value={t.id}>{t.name} ({t.industry})</option>
                              ))}
                            </optgroup>
                          )}
                          {allowedVirtualTemplates.length > 0 && (
                            <optgroup label="Documentos Compartidos Disponibles">
                              {allowedVirtualTemplates.map(t => (
                                <option key={t.id} value={t.id}>📄 {t.name.replace('Documento: ', '')}</option>
                              ))}
                            </optgroup>
                          )}
                        </>
                      );
                    })()}
                  </select>
                  {['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(currentUser.role) && (
                    <div className="mt-1 flex items-center gap-1.5 bg-slate-50 p-1.5 rounded-lg border border-slate-200/60">
                      <input
                        type="checkbox"
                        id="toggle-template-required-inline"
                        checked={systemSettings?.processTemplateRequired !== false}
                        onChange={async (e) => {
                          const newValue = e.target.checked;
                          try {
                            const res = await fetch('/api/system-settings', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                settings: {
                                  processTemplateRequired: newValue
                                },
                                currentUserId: currentUser.id
                              })
                            });
                            if (res.ok && loadState) {
                              await loadState();
                            }
                          } catch (err) {
                            console.error('Error updating template setting:', err);
                          }
                        }}
                        className="w-3.5 h-3.5 text-indigo-600 focus:ring-indigo-500 border-slate-300 rounded cursor-pointer"
                      />
                      <label htmlFor="toggle-template-required-inline" className="text-[10px] font-semibold text-slate-600 cursor-pointer">
                        Configurar como campo obligatorio
                      </label>
                    </div>
                  )}
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

              {/* Actores Cantidad Requerida Section */}
              <div className="border-t border-slate-100 pt-5 space-y-3 font-sans">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-600" />
                  <h4 className="text-sm font-bold text-slate-800">Cantidad de Actores Requeridos</h4>
                </div>
                <p className="text-[11px] text-slate-500">
                  Indica la cantidad mínima esperada para cada rol. El sistema validará que los cargues antes de crear el legajo.
                </p>
                
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-150 grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Vendedores</label>
                    <input
                      type="number"
                      min={0}
                      value={expectedVendedores}
                      onChange={(e) => setExpectedVendedores(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Compradores</label>
                    <input
                      type="number"
                      min={0}
                      value={expectedCompradores}
                      onChange={(e) => setExpectedCompradores(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Garantes</label>
                    <input
                      type="number"
                      min={0}
                      value={expectedGarantes}
                      onChange={(e) => setExpectedGarantes(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold"
                    />
                  </div>
                  <div className="flex flex-col justify-center space-y-1 pt-2 sm:pt-0 sm:pl-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="escribano-a-designar"
                        checked={escribanoADesignar}
                        onChange={(e) => setEscribanoADesignar(e.target.checked)}
                        className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 border-slate-300 rounded cursor-pointer"
                      />
                      <label htmlFor="escribano-a-designar" className="text-xs font-semibold text-slate-700 cursor-pointer select-none">
                        Escribano a designar
                      </label>
                    </div>
                    <p className="text-[10px] text-slate-400">
                      {escribanoADesignar ? 'Queda pendiente de designación.' : 'Debe cargar 1 Escribano.'}
                    </p>
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
                    Mínimo Requerido: {expectedVendedores + expectedCompradores + expectedGarantes + (escribanoADesignar ? 0 : 1)} | Cargados: {participants.length}
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
                      <option value="Vendedor">Vendedor</option>
                      <option value="Comprador">Comprador</option>
                      <option value="Garante">Garante</option>
                      <option value="Escribano">Escribano</option>
                      <option value="Cliente">Cliente</option>
                      <option value="Titular">Titular</option>
                      <option value="Apoderado">Apoderado</option>
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
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-500">Fecha de Nacimiento *</label>
                    <input type="date" value={pBirthDate} onChange={(e) => setPBirthDate(e.target.value)} className="w-full text-[11px] p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-500">DNI *</label>
                    <input type="text" value={pDni} onChange={(e) => setPDni(e.target.value)} placeholder="Ej. 32.145.980" className="w-full text-[11px] p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-500">CUIT/CUIL *</label>
                    <input type="text" value={pCuit} onChange={(e) => setPCuit(e.target.value)} placeholder="Ej. 20-32145980-4" className="w-full text-[11px] p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-500">Email *</label>
                    <input required type="email" value={pEmail} onChange={(e) => setPEmail(e.target.value)} placeholder="Ej. mendez@email.com" className="w-full text-[11px] p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-500">Teléfono/Celular *</label>
                    <input required type="text" value={pPhone} onChange={(e) => setPPhone(e.target.value)} placeholder="Ej. 11 4432-8761" className="w-full text-[11px] p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-500">Observaciones del Actor</label>
                    <input type="text" value={pComments} onChange={(e) => setPComments(e.target.value)} placeholder="Comentarios, facultades..." className="w-full text-[11px] p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
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
                    <button
                      type="button"
                      onClick={handleAddParticipant}
                      className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg transition-colors border border-indigo-700 shadow-xs"
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
                      method: 'DELETE'
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
