import React, { useState } from 'react';
import { 
  FolderKanban, 
  Sparkles, 
  ChevronDown, 
  ChevronUp, 
  Plus, 
  FileText, 
  CheckSquare, 
  FileSpreadsheet, 
  Building,
  Loader2,
  X,
  PlusCircle,
  Wand2,
  Edit,
  Copy,
  Trash2,
  Save,
  ArrowUp,
  ArrowDown,
  Upload,
  CheckCircle,
  Layers,
  GitCommit
} from 'lucide-react';
import { ProcessTemplate, User, Stage, Requirement, RequirementType, FormField } from '../types';

interface TemplatesManagerProps {
  templates: ProcessTemplate[];
  currentUser: User;
  systemSettings?: any;
  onAddTemplate: (template: ProcessTemplate) => void;
  loadState?: () => Promise<void>;
}

export default function TemplatesManager({ templates, currentUser, systemSettings, onAddTemplate, loadState }: TemplatesManagerProps) {
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);

  // States for Template Digitization
  const [aiTab, setAiTab] = useState<'generate' | 'digitize' | 'manual'>('generate');
  const [digitizeFileBase64, setDigitizeFileBase64] = useState('');
  const [digitizeFileName, setDigitizeFileName] = useState('');
  const [digitizeText, setDigitizeText] = useState('');
  const [digitizeIndustry, setDigitizeIndustry] = useState<ProcessTemplate['industry']>('Inmobiliaria');
  const [generateFlowCheck, setGenerateFlowCheck] = useState(false);
  const [isDigitizing, setIsDigitizing] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // States for manual creation
  const [manualName, setManualName] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [manualIndustry, setManualIndustry] = useState<ProcessTemplate['industry']>('Inmobiliaria');
  const [isCreatingManual, setIsCreatingManual] = useState(false);

  // Custom toast notifications
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Custom confirmation modal
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(prev => prev?.message === message ? null : prev);
    }, 4500);
  };

  const requestConfirmation = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModal({ title, message, onConfirm });
  };

  // States for Editing Template
  const [editingTemplate, setEditingTemplate] = useState<ProcessTemplate | null>(null);
  const [editMode, setEditMode] = useState<'digital_doc' | 'stages' | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editIndustry, setEditIndustry] = useState<ProcessTemplate['industry']>('Inmobiliaria');
  const [editStages, setEditStages] = useState<Stage[]>([]);
  const [editOriginalDocumentContent, setEditOriginalDocumentContent] = useState('');
  const [editShowDocumentToAll, setEditShowDocumentToAll] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [sharedDocs, setSharedDocs] = useState<any[]>([]);

  React.useEffect(() => {
    const fetchSharedDocs = async () => {
      try {
        const res = await fetch(`/api/shared-documents?userId=${currentUser.id}&role=${currentUser.role}`);
        if (res.ok) {
          const data = await res.json();
          setSharedDocs(data);
        }
      } catch (err) {
        console.error('Error fetching shared docs:', err);
      }
    };
    fetchSharedDocs();
  }, [currentUser]);

  const toggleExpand = (id: string) => {
    setExpandedTemplateId(expandedTemplateId === id ? null : id);
  };

  const isSuperAdmin = currentUser.role === 'SUPERADMIN';
  const allowAdminManager = systemSettings?.allowAdminManagerTemplates !== false;
  const canManageTemplates = isSuperAdmin || (['ADMIN', 'MANAGER'].includes(currentUser.role) && allowAdminManager);

  // Sub-tabs inside expanded templates to view either flow or 100% digitized document
  const [templateSubTab, setTemplateSubTab] = useState<Record<string, 'flow' | 'document'>>({});

  const renderDocumentWithHighlights = (text: string) => {
    if (!text) {
      return (
        <p className="text-slate-400 italic text-center py-8 font-sans text-xs">
          Esta plantilla no tiene un documento original digitalizado al 100%. Puedes cargarlo editando la plantilla.
        </p>
      );
    }
    const parts = text.split(/(\[[^\]]+\])/g);
    return (
      <div className="whitespace-pre-wrap leading-relaxed text-slate-800 font-serif text-xs md:text-sm space-y-1">
        {parts.map((part, index) => {
          if (part.startsWith('[') && part.endsWith(']')) {
            return (
              <span 
                key={index} 
                className="bg-amber-100 text-amber-900 border border-amber-250 rounded px-1.5 py-0.5 mx-0.5 font-mono text-[11px] font-bold shadow-2xs"
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

  // AI-Powered Template Generator
  const handleGenerateTemplateWithAI = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    if (!aiPrompt.trim()) return;

    console.log('Iniciando generación de plantilla con IA para prompt:', aiPrompt);
    setIsGenerating(true);

    try {
      const response = await fetch('/api/gemini/generate-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: aiPrompt,
          createdBy: currentUser.id
        })
      });

      const data = await response.json();
      console.log('Respuesta recibida de generación por IA:', data);

      if (data.error) {
        alert(`Error de IA: ${data.error}`);
      } else if (data.template) {
        alert(`¡Flujo de trabajo "${data.template.name}" generado exitosamente por la Inteligencia Artificial!`);
        setShowAiModal(false);
        setAiPrompt('');
        if (loadState) {
          await loadState();
        }
        setExpandedTemplateId(data.template.id);
      } else {
        alert('Ocurrió un error inesperado al procesar la respuesta de la IA.');
      }
    } catch (err) {
      console.error('Error de conexión o de ejecución en generación por IA:', err);
      alert('Error de conexión al generar la plantilla por IA.');
    } finally {
      setIsGenerating(false);
    }
  };

  // AI-Powered Template Digitization (100% Digitalization of existing documents)
  const handleDigitizeTemplate = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    console.log('Iniciando digitalización de plantilla con IA...');
    console.log('digitizeFileBase64 largo:', digitizeFileBase64 ? digitizeFileBase64.length : 0);
    console.log('digitizeText:', digitizeText);
    console.log('digitizeIndustry:', digitizeIndustry);

    if (!digitizeFileBase64 && !digitizeText.trim()) {
      alert('Por favor, cargue un documento (arrastrando o seleccionando) o ingrese el texto de la plantilla.');
      return;
    }

    setIsDigitizing(true);

    try {
      const response = await fetch('/api/gemini/digitize-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileBase64: digitizeFileBase64,
          fileName: digitizeFileName,
          textProposal: digitizeText,
          industry: digitizeIndustry,
          generateFlow: generateFlowCheck,
          currentUserId: currentUser.id
        })
      });

      const data = await response.json();
      console.log('Respuesta recibida de digitalización por IA:', data);

      if (data.error) {
        alert(`Error de digitalización: ${data.error}`);
      } else if (data.template) {
        alert(`¡Plantilla "${data.template.name}" digitalizada exitosamente al 100%!`);
        setShowAiModal(false);
        setDigitizeFileBase64('');
        setDigitizeFileName('');
        setDigitizeText('');
        setGenerateFlowCheck(false);
        if (loadState) {
          await loadState();
        }
        setExpandedTemplateId(data.template.id);
      } else {
        alert('Ocurrió un error inesperado al procesar la respuesta de la IA.');
      }
    } catch (err) {
      console.error('Error de conexión o de ejecución en digitalización por IA:', err);
      alert('Error de conexión al digitalizar la plantilla.');
    } finally {
      setIsDigitizing(false);
    }
  };

  // Manual Template Creation
  const handleCreateManualTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualName.trim()) {
      alert('Por favor ingrese el nombre de la plantilla.');
      return;
    }
    setIsCreatingManual(true);
    try {
      const response = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: manualName,
          description: manualDescription,
          industry: manualIndustry,
          stages: [],
          originalDocumentContent: '',
          showDocumentToAll: true,
          sharedViewMode: 'flow',
          currentUserId: currentUser.id
        })
      });

      const data = await response.json();
      if (response.ok && data.id) {
        alert(`¡Plantilla de proceso "${data.name}" creada correctamente!`);
        setShowAiModal(false);
        setManualName('');
        setManualDescription('');
        setManualIndustry('Inmobiliaria');
        if (loadState) {
          await loadState();
        }
        setExpandedTemplateId(data.id);
      } else {
        alert(`Error al crear plantilla: ${data.error || 'Ocurrió un error inesperado'}`);
      }
    } catch (err) {
      console.error('Error al crear plantilla manualmente:', err);
      alert('Error de conexión al crear la plantilla.');
    } finally {
      setIsCreatingManual(false);
    }
  };

  // Duplicate Template
  const handleDuplicateTemplate = async (tpl: ProcessTemplate) => {
    const newName = prompt(`Ingrese el nombre para la nueva plantilla duplicada:`, `Copia de ${tpl.name}`);
    if (!newName) return;

    try {
      const response = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          description: tpl.description,
          industry: tpl.industry,
          stages: JSON.parse(JSON.stringify(tpl.stages)), // Deep copy stages
          currentUserId: currentUser.id
        })
      });

      if (response.ok) {
        alert(`¡Plantilla "${newName}" duplicada con éxito!`);
        if (loadState) {
          await loadState();
        }
      } else {
        const data = await response.json();
        alert(`Error al duplicar la plantilla: ${data.error}`);
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión al duplicar la plantilla.');
    }
  };

  // Delete Template
  const handleDeleteTemplate = (templateId: string, templateName: string) => {
    requestConfirmation(
      'Eliminar Plantilla',
      `¿Está seguro de que desea eliminar la plantilla "${templateName}"? Esta acción no se puede deshacer y afectará la creación de futuros expedientes.`,
      async () => {
        try {
          const response = await fetch(`/api/templates/${templateId}?currentUserId=${currentUser.id}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
          });

          if (response.ok) {
            showToast(`¡Plantilla "${templateName}" eliminada con éxito!`, 'success');
            if (loadState) {
              await loadState();
            }
          } else {
            const data = await response.json();
            showToast(`Error al eliminar la plantilla: ${data.error}`, 'error');
          }
        } catch (err) {
          console.error(err);
          showToast('Error de conexión al eliminar la plantilla.', 'error');
        }
      }
    );
  };

  // Edit Template setup
  const handleStartEdit = (tpl: ProcessTemplate, mode: 'digital_doc' | 'stages' = 'digital_doc') => {
    setEditingTemplate(tpl);
    setEditMode(mode);
    setEditName(tpl.name);
    setEditDescription(tpl.description);
    setEditIndustry(tpl.industry);
    setEditStages(JSON.parse(JSON.stringify(tpl.stages))); // Deep copy
    setEditOriginalDocumentContent(tpl.originalDocumentContent || '');
    setEditShowDocumentToAll(tpl.showDocumentToAll !== undefined ? tpl.showDocumentToAll : true);
  };

  // Edit Handlers
  const handleAddStage = () => {
    const newStage: Stage = {
      id: `stg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: 'Nueva Etapa',
      description: 'Descripción de la nueva etapa.',
      requirements: []
    };
    setEditStages([...editStages, newStage]);
  };

  const handleRemoveStage = (idx: number) => {
    requestConfirmation(
      'Eliminar Etapa',
      '¿Está seguro de eliminar esta etapa de la plantilla? Se perderán todos sus requisitos.',
      () => {
        setEditStages(prev => prev.filter((_, i) => i !== idx));
      }
    );
  };

  const handleStageFieldChange = (idx: number, field: 'name' | 'description', value: string) => {
    setEditStages(prev => prev.map((stg, i) => i === idx ? { ...stg, [field]: value } : stg));
  };

  const handleMoveStage = (idx: number, direction: 'up' | 'down') => {
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === editStages.length - 1) return;

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    const list = [...editStages];
    const temp = list[idx];
    list[idx] = list[targetIdx];
    list[targetIdx] = temp;
    setEditStages(list);
  };

  const handleAddRequirement = (stageIdx: number, type: RequirementType) => {
    const newReq: Requirement = {
      id: `req-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: type === 'document' ? 'Nuevo Documento' : type === 'form' ? 'Nuevo Formulario' : 'Nueva Tarea',
      type,
      description: '',
      isRequired: true,
      formFields: type === 'form' ? [
        { id: `fld-${Date.now()}-1`, label: 'Nombre Completo', type: 'text', required: true },
        { id: `fld-${Date.now()}-2`, label: 'Fecha de Carga', type: 'date', required: true }
      ] : undefined
    };
    setEditStages(prev => prev.map((stg, i) => i === stageIdx ? { ...stg, requirements: [...stg.requirements, newReq] } : stg));
  };

  const handleRemoveRequirement = (stageIdx: number, reqId: string) => {
    setEditStages(prev => prev.map((stg, i) => i === stageIdx ? {
      ...stg,
      requirements: stg.requirements.filter(r => r.id !== reqId)
    } : stg));
  };

  const handleRequirementFieldChange = (stageIdx: number, reqId: string, field: 'name' | 'description' | 'isRequired' | 'documentSourceType' | 'linkedTemplateId' | 'linkedSharedDocumentId', value: any) => {
    setEditStages(prev => prev.map((stg, i) => i === stageIdx ? {
      ...stg,
      requirements: stg.requirements.map(r => r.id === reqId ? { ...r, [field]: value } : r)
    } : stg));
  };

  const handleUpdateFormFieldsString = (stageIdx: number, reqId: string, labelsString: string) => {
    const labels = labelsString.split(',').map(l => l.trim()).filter(Boolean);
    const formFields: FormField[] = labels.map((lbl, idx) => ({
      id: `fld-${Date.now()}-${idx}`,
      label: lbl,
      type: 'text',
      required: true
    }));
    setEditStages(prev => prev.map((stg, i) => i === stageIdx ? {
      ...stg,
      requirements: stg.requirements.map(r => r.id === reqId ? { ...r, formFields } : r)
    } : stg));
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTemplate || !editMode) return;
    setIsSaving(true);

    try {
      const payload = {
        name: editName,
        description: editDescription,
        industry: editIndustry,
        originalDocumentContent: editMode === 'digital_doc' ? editOriginalDocumentContent : (editingTemplate.originalDocumentContent || ''),
        showDocumentToAll: editMode === 'digital_doc' ? editShowDocumentToAll : (editingTemplate.showDocumentToAll !== undefined ? editingTemplate.showDocumentToAll : true),
        stages: editStages,
        currentUserId: currentUser.id
      };

      const response = await fetch(`/api/templates/${editingTemplate.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        alert(editMode === 'digital_doc' ? '¡Plantilla digital y metadatos guardados correctamente!' : '¡Etapas del proceso guardadas correctamente!');
        setEditingTemplate(null);
        setEditMode(null);
        if (loadState) {
          await loadState();
        }
      } else {
        const err = await response.json();
        alert(`Error al guardar cambios: ${err.error || 'Intente nuevamente'}`);
      }
    } catch (err) {
      console.error(err);
      alert('Error de red al actualizar la plantilla de procesos.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleApproveAndPublishToDocuments = async (tpl: ProcessTemplate) => {
    try {
      if (!tpl.originalDocumentContent) {
        alert('Este proceso no tiene un documento original digitalizado.');
        return;
      }
      
      const unicodeToBase64 = (str: string) => {
        return btoa(unescape(encodeURIComponent(str)));
      };
      
      const fileBase64 = `data:text/plain;base64,${unicodeToBase64(tpl.originalDocumentContent)}`;
      const fileName = `${tpl.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_digitalizado.txt`;

      const response = await fetch('/api/shared-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${tpl.name} (Digitalizado)`,
          fileName,
          fileSize: tpl.originalDocumentContent.length,
          fileBase64,
          allowedRoles: ['SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR'],
          allowedUserIds: [],
          currentUserId: currentUser.id
        })
      });

      const data = await response.json();
      if (response.ok && data.id) {
        alert(`¡Documento "${tpl.name} (Digitalizado)" aprobado y guardado en la sección DOCUMENTOS exitosamente! Además, se eliminó de Plantillas y Procesos.`);
        
        try {
          await fetch(`/api/templates/${tpl.id}?currentUserId=${currentUser.id}`, {
            method: 'DELETE'
          });
        } catch (delErr) {
          console.error('Error al eliminar plantilla después de ser aprobada:', delErr);
        }

        if (loadState) {
          await loadState();
        }
      } else {
        alert(`Error al guardar en documentos: ${data.error || 'Ocurrió un error inesperado'}`);
      }
    } catch (err: any) {
      console.error('Error aprobando documento:', err);
      alert('Error de conexión al aprobar el documento.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-display font-bold text-slate-800 tracking-tight">Estructura de Plantillas de Procesos</h2>
          <p className="text-sm text-slate-500">Define etapas, checklists obligatorios, formularios e indicadores de cumplimiento.</p>
        </div>
        {canManageTemplates && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setAiTab('manual');
                setShowAiModal(true);
              }}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl shadow-md shadow-indigo-500/10 hover:shadow-indigo-500/20 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Crear Proceso</span>
            </button>
          </div>
        )}
      </div>

      {/* AI DESIGN BANNER (Prompt Quick-Access) */}
      {canManageTemplates && (
        <div className="bg-gradient-to-r from-indigo-900 via-slate-900 to-indigo-950 text-white p-6 rounded-2xl border border-slate-800 shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(99,102,241,0.15),transparent)] pointer-events-none" />
          <div className="space-y-1.5 relative z-10 max-w-xl">
            <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded font-mono font-bold tracking-wider uppercase border border-indigo-500/30">
              Co-Piloto de Negocios
            </span>
            <h3 className="text-base font-display font-bold tracking-tight">¿Deseas digitalizar un nuevo proceso de oficina?</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Describe el trámite o proceso (ej: "Trámite de Préstamo", "Onboarding de Cliente", "Habilitación Comercial") y Gemini creará automáticamente las etapas, checklists y documentos requeridos.
            </p>
          </div>
          <button
            onClick={() => {
              setAiTab('generate');
              setShowAiModal(true);
            }}
            className="shrink-0 relative z-10 px-4.5 py-2.5 bg-white text-indigo-950 font-bold text-xs rounded-xl hover:bg-indigo-50 shadow-md shadow-white/5 active:scale-98 transition-all flex items-center gap-2 cursor-pointer"
          >
            <Wand2 className="w-4 h-4 text-indigo-600" />
            <span>Generar Plantilla Inteligente</span>
          </button>
        </div>
      )}

      {/* Grid of Templates */}
      <div className="grid grid-cols-1 gap-4">
        {templates.map((tpl) => {
          const isExpanded = expandedTemplateId === tpl.id;
          const isDigitalDoc = !!tpl.originalDocumentContent && tpl.originalDocumentContent.trim() !== '';
          const activeTab = tpl.stages.length === 0 ? 'document' : (templateSubTab[tpl.id] || 'flow');
          return (
            <div key={tpl.id} className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden transition-all duration-200">
              {/* Summary Block */}
              <div 
                onClick={() => toggleExpand(tpl.id)}
                className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/50 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className={`p-3 rounded-xl ${isDigitalDoc ? 'bg-amber-50 text-amber-600' : 'bg-indigo-50 text-indigo-600'}`}>
                    {isDigitalDoc ? <FileText className="w-5 h-5" /> : <FolderKanban className="w-5 h-5" />}
                  </div>
                  <div className="overflow-hidden">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-slate-800 truncate">{tpl.name}</h3>
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-semibold rounded font-mono uppercase tracking-wider">{tpl.industry}</span>
                      {isDigitalDoc && (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-semibold rounded uppercase tracking-wider">Plantilla de Documento</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xl">{tpl.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {!isDigitalDoc ? (
                    <div className="text-right text-xs font-semibold text-slate-500 font-mono bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-xl">
                      {tpl.stages.length} Etapas
                    </div>
                  ) : (
                    <div className="text-right text-xs font-semibold text-amber-700 font-mono bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-xl">
                      Documento Digital
                    </div>
                  )}
                  
                  {canManageTemplates && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleStartEdit(tpl, 'digital_doc')}
                        className="px-2.5 py-1.5 text-[11px] font-bold text-slate-500 hover:text-amber-700 hover:bg-amber-50 rounded-xl transition-all border border-transparent hover:border-amber-100 cursor-pointer flex items-center gap-1"
                        title="Editar Plantilla Digital (Metadatos y Documento Base)"
                      >
                        <Edit className="w-3.5 h-3.5" />
                        <span>Editar Plantilla</span>
                      </button>
                      <button
                        onClick={() => handleStartEdit(tpl, 'stages')}
                        className="px-2.5 py-1.5 text-[11px] font-bold text-slate-500 hover:text-indigo-700 hover:bg-indigo-50 rounded-xl transition-all border border-transparent hover:border-indigo-100 cursor-pointer flex items-center gap-1"
                        title="Configurar Etapas del Proceso (Checklists y Requisitos)"
                      >
                        <Layers className="w-3.5 h-3.5" />
                        <span>Configurar Etapas</span>
                      </button>
                      
                      <button
                        onClick={() => handleDuplicateTemplate(tpl)}
                        className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all border border-transparent hover:border-indigo-100 cursor-pointer"
                        title="Duplicar Plantilla de Proceso"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteTemplate(tpl.id, tpl.name)}
                        className="p-2 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all border border-transparent hover:border-rose-100 cursor-pointer"
                        title="Eliminar Plantilla de Proceso"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  <button 
                    onClick={() => toggleExpand(tpl.id)}
                    className="p-1.5 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                  >
                    {isExpanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                  </button>
                </div>
              </div>

              {/* Extended Details Block */}
              {isExpanded && (
                <div className="border-t border-slate-100 bg-slate-50/30 p-6 space-y-6">
                  {isDigitalDoc ? (
                    // Display ONLY the digitized document with its approval flow
                    <div className="bg-slate-100/60 p-4 rounded-2xl border border-slate-200/60 min-h-[400px] flex items-start justify-center">
                      <div className="bg-white w-full max-w-2xl shadow-xs border border-slate-200 px-6 py-8 md:px-12 md:py-14 rounded-md flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between pb-4 mb-6 border-b border-slate-100 text-[10px] text-slate-400 font-mono">
                            <span>PLANTILLA DIGITAL ORIGINAL ({tpl.industry.toUpperCase()})</span>
                            <span>SOPORTE DE VARIABLES INTEGRADAS</span>
                          </div>
                          
                          <div className="prose prose-slate max-w-none text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                            {renderDocumentWithHighlights(tpl.originalDocumentContent || '')}
                          </div>

                          {/* Botón de Aprobación para pasar a DOCUMENTOS */}
                          {currentUser && ['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(currentUser.role) && tpl.originalDocumentContent && (
                            <div className="mt-8 p-4 bg-emerald-50 border border-emerald-100 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                              <div className="space-y-0.5 text-left">
                                <p className="text-xs font-bold text-emerald-950">¿El documento digitalizado está correcto?</p>
                                <p className="text-[10px] text-emerald-700">Aprobar este documento lo guardará y publicará automáticamente en la sección <strong>DOCUMENTOS</strong> para descarga y uso general.</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleApproveAndPublishToDocuments(tpl)}
                                className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-xs transition-all cursor-pointer"
                              >
                                <CheckCircle className="w-4 h-4" />
                                <span>Aprobar y pasar a DOCUMENTOS</span>
                              </button>
                            </div>
                          )}
                        </div>
                        
                        <div className="mt-10 pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between text-[10px] text-slate-400 font-mono">
                          <span>PLANTILLA ID: {tpl.id}</span>
                          <span>DOCFLOW PRO DIGITAL ENGINE</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    // Display ONLY the stages flow
                    <div className="flex flex-col gap-5">
                      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                        <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                          <FolderKanban className="w-4 h-4 text-indigo-500" />
                          Etapas del Proceso ({tpl.stages.length})
                        </h4>
                        <span className="text-[10px] text-slate-400 font-mono">
                          FLUJO DE SEGUIMIENTO OPERATIVO
                        </span>
                      </div>

                      {tpl.stages.length === 0 ? (
                        <div className="text-center py-8 bg-white border border-dashed border-slate-200 rounded-xl">
                          <Layers className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                          <p className="text-xs font-bold text-slate-600">Este proceso aún no tiene etapas configuradas.</p>
                          <p className="text-[10px] text-slate-400 mt-1">Haz clic en "Configurar Etapas" arriba para diseñarlas paso a paso.</p>
                        </div>
                      ) : (
                        tpl.stages.map((stg, sIdx) => (
                          <div key={stg.id} className="bg-white rounded-xl border border-slate-150 p-4.5 space-y-3.5 shadow-xs relative">
                            {/* Stage title */}
                            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                              <div className="flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-slate-900 text-white font-mono font-bold text-[10px] flex items-center justify-center">
                                  {sIdx + 1}
                                </span>
                                <h4 className="text-xs font-bold text-slate-800">{stg.name}</h4>
                              </div>
                              <p className="text-[10px] text-slate-400 font-mono uppercase tracking-wider font-semibold">Etapa del Trámite</p>
                            </div>

                            <p className="text-xs text-slate-500 leading-relaxed">{stg.description}</p>

                            {/* Requirements List */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-1.5">
                              {/* Documents list */}
                              <div className="space-y-2">
                                <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider font-mono flex items-center gap-1">
                                  <FileText className="w-3.5 h-3.5 text-indigo-500" />
                                  Documentos Exigidos
                                </p>
                                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                                  {stg.requirements.filter(r => r.type === 'document').length === 0 ? (
                                    <p className="text-[10px] text-slate-400 italic">No exige documentos.</p>
                                  ) : (
                                    stg.requirements.filter(r => r.type === 'document').map(req => (
                                      <div key={req.id} className="p-2 bg-slate-50 rounded border border-slate-150 text-[10px]">
                                        <span className="font-bold text-slate-700">{req.name}</span>
                                        {req.isRequired && <span className="text-[8px] bg-indigo-50 text-indigo-700 px-1 ml-1 rounded font-bold uppercase">Oblig</span>}
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>

                              {/* Forms list */}
                              <div className="space-y-2">
                                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider font-mono flex items-center gap-1">
                                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                                  Formularios de Registro
                                </p>
                                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                                  {stg.requirements.filter(r => r.type === 'form').length === 0 ? (
                                    <p className="text-[10px] text-slate-400 italic">No exige formularios.</p>
                                  ) : (
                                    stg.requirements.filter(r => r.type === 'form').map(req => (
                                      <div key={req.id} className="p-2 bg-slate-50 rounded border border-slate-150 text-[10px] space-y-1">
                                        <span className="font-bold text-slate-700">{req.name}</span>
                                        <div className="text-[9px] text-slate-400">
                                          Campos: {req.formFields?.map(f => f.label).join(', ')}
                                        </div>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>

                              {/* Tasks list */}
                              <div className="space-y-2">
                                <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider font-mono flex items-center gap-1">
                                  <CheckSquare className="w-3.5 h-3.5 text-amber-500" />
                                  Checklist Operativo
                                </p>
                                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                                  {stg.requirements.filter(r => r.type === 'task').length === 0 ? (
                                    <p className="text-[10px] text-slate-400 italic">No exige tareas.</p>
                                  ) : (
                                    stg.requirements.filter(r => r.type === 'task').map(req => (
                                      <div key={req.id} className="p-2 bg-slate-50 rounded border border-slate-150 text-[10px]">
                                        <span className="font-bold text-slate-700">{req.name}</span>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* SUPERADMIN TEMPLATE EDITOR MODAL */}
      {editingTemplate && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className={`p-5 border-b border-slate-100 flex items-center justify-between ${
              editMode === 'stages' ? 'bg-indigo-50 text-indigo-900' : 'bg-amber-50 text-amber-900'
            }`}>
              <div className="flex items-center gap-2">
                {editMode === 'stages' ? (
                  <Layers className="w-5 h-5 text-indigo-700" />
                ) : (
                  <Edit className="w-5 h-5 text-amber-700" />
                )}
                <div>
                  <h4 className="text-sm font-bold">
                    {editMode === 'stages' ? 'Configurar Etapas del Proceso' : 'Editar Plantilla Digital'}
                  </h4>
                  <p className={`text-[11px] ${editMode === 'stages' ? 'text-indigo-700/80' : 'text-amber-700/80'}`}>
                    {editMode === 'stages' 
                      ? 'Establece las etapas de trabajo, checklists de tareas, formularios personalizados y requisitos.' 
                      : 'Modifica los metadatos generales y el texto digitalizado original completo (documento base).'}
                  </p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => { setEditingTemplate(null); setEditMode(null); }} 
                className={`p-1.5 rounded-lg cursor-pointer ${
                  editMode === 'stages' ? 'text-indigo-700 hover:text-indigo-950' : 'text-amber-700 hover:text-amber-950'
                }`}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* General details */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-150">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-600 uppercase">Nombre de Plantilla</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-600 uppercase">Rubro Rector</label>
                  <select
                    value={editIndustry}
                    onChange={(e) => setEditIndustry(e.target.value as any)}
                    className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="Inmobiliaria">Inmobiliaria</option>
                    <option value="Jurídico">Jurídico</option>
                    <option value="Seguros">Seguros</option>
                    <option value="Financiera">Financiera</option>
                    <option value="Recursos Humanos">Recursos Humanos</option>
                    <option value="Administrativo">Administrativo</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-600 uppercase">Descripción</label>
                  <input
                    type="text"
                    required
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Documento 100% Digitalizado Template Fields */}
              {editMode === 'digital_doc' && (
                <div className="bg-amber-50/40 p-4 rounded-xl border border-amber-200/60 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h5 className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                        <FileText className="w-4 h-4 text-amber-600" />
                        Documento Original Digitalizado (Completo)
                      </h5>
                      <p className="text-[10px] text-amber-800/80">
                        Este texto sirve de base para el documento digitalizado en cada expediente.
                      </p>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-amber-900 select-none">
                      <input
                        type="checkbox"
                        checked={editShowDocumentToAll}
                        onChange={(e) => setEditShowDocumentToAll(e.target.checked)}
                        className="rounded border-amber-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                      />
                      <span>Compartir con todos los usuarios</span>
                    </label>
                  </div>

                  <textarea
                    value={editOriginalDocumentContent}
                    onChange={(e) => setEditOriginalDocumentContent(e.target.value)}
                    placeholder="Aquí se encuentra el texto digitalizado original completo. Los campos entre corchetes [Variables] se autocompletarán de forma automática..."
                    className="w-full h-40 p-3 text-xs font-mono bg-white border border-amber-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 leading-relaxed resize-y"
                  />
                  <p className="text-[10px] text-slate-500 leading-normal">
                    💡 <strong>Tip de variables:</strong> El sistema puede autocompletar variables como <code>[Nombre Completo Cliente]</code>, <code>[DNI Cliente]</code>, <code>[Fecha]</code>, <code>[Asesor]</code> o campos específicos del formulario como <code>[Monto de Reserva (USD)]</code>.
                  </p>
                </div>
              )}

              {/* Stages List Header */}
              {editMode === 'stages' && (
                <>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="space-y-0.5">
                  <h5 className="text-xs font-bold text-slate-800">Etapas del Proceso ({editStages.length})</h5>
                  <p className="text-[10px] text-slate-400">Las etapas guiarán en orden cronológico el avance de las operaciones.</p>
                </div>
                <button
                  type="button"
                  onClick={handleAddStage}
                  className="flex items-center gap-1 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-bold rounded-lg cursor-pointer transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Agregar Etapa</span>
                </button>
              </div>

              {/* Stages Loop */}
              <div className="space-y-4">
                {editStages.length === 0 ? (
                  <div className="text-center py-8 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-xs text-slate-400">
                    No hay etapas configuradas. Agregue una etapa para comenzar.
                  </div>
                ) : (
                  editStages.map((stg, sIdx) => (
                    <div key={stg.id} className="p-4 bg-white border border-slate-200/95 rounded-xl shadow-xs space-y-4 relative">
                      {/* Stage Toolbar */}
                      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-slate-800 text-white font-mono font-bold text-[10px] flex items-center justify-center">
                            {sIdx + 1}
                          </span>
                          <input
                            type="text"
                            required
                            placeholder="Nombre de la etapa"
                            value={stg.name}
                            onChange={(e) => handleStageFieldChange(sIdx, 'name', e.target.value)}
                            className="text-xs font-bold text-slate-800 border-b border-transparent hover:border-slate-300 focus:border-indigo-500 bg-transparent py-0.5 px-1 focus:outline-none"
                          />
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={sIdx === 0}
                            onClick={() => handleMoveStage(sIdx, 'up')}
                            className="p-1 hover:bg-slate-100 rounded text-slate-500 disabled:opacity-40 cursor-pointer"
                            title="Subir etapa"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={sIdx === editStages.length - 1}
                            onClick={() => handleMoveStage(sIdx, 'down')}
                            className="p-1 hover:bg-slate-100 rounded text-slate-500 disabled:opacity-40 cursor-pointer"
                            title="Bajar etapa"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveStage(sIdx)}
                            className="p-1 hover:bg-rose-50 text-rose-500 hover:text-rose-700 rounded cursor-pointer"
                            title="Eliminar etapa"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Stage description input */}
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase">Breve descripción de la etapa</label>
                        <textarea
                          rows={2}
                          value={stg.description}
                          placeholder="Qué ocurre durante esta etapa..."
                          onChange={(e) => handleStageFieldChange(sIdx, 'description', e.target.value)}
                          className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>

                      {/* Requirements Section inside Stage */}
                      <div className="bg-slate-50/50 p-3 rounded-lg border border-slate-100 space-y-3">
                        <div className="flex items-center justify-between">
                          <h6 className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Requisitos de la Etapa ({stg.requirements.length})</h6>
                          
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleAddRequirement(sIdx, 'document')}
                              className="px-2 py-1 bg-white hover:bg-indigo-50 text-indigo-600 border border-slate-200 rounded text-[9px] font-bold cursor-pointer transition-colors"
                            >
                              + Documento
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAddRequirement(sIdx, 'form')}
                              className="px-2 py-1 bg-white hover:bg-emerald-50 text-emerald-600 border border-slate-200 rounded text-[9px] font-bold cursor-pointer transition-colors"
                            >
                              + Formulario
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAddRequirement(sIdx, 'task')}
                              className="px-2 py-1 bg-white hover:bg-amber-50 text-amber-600 border border-slate-200 rounded text-[9px] font-bold cursor-pointer transition-colors"
                            >
                              + Tarea
                            </button>
                          </div>
                        </div>

                        {/* Requirements List */}
                        <div className="space-y-2">
                          {stg.requirements.length === 0 ? (
                            <p className="text-[10px] text-slate-400 italic text-center py-2">No hay requisitos exigidos en esta etapa.</p>
                          ) : (
                            stg.requirements.map((req) => (
                              <div key={req.id} className="p-3 bg-white border border-slate-150 rounded-lg shadow-2xs flex flex-col md:flex-row gap-3 items-start justify-between">
                                {/* Left: Name and Info */}
                                <div className="flex-1 space-y-2 w-full">
                                  <div className="flex items-center gap-2">
                                    <span className={`p-1 rounded text-white ${
                                      req.type === 'document' ? 'bg-indigo-500' : req.type === 'form' ? 'bg-emerald-500' : 'bg-amber-500'
                                    }`}>
                                      {req.type === 'document' ? <FileText className="w-3.5 h-3.5" /> : req.type === 'form' ? <FileSpreadsheet className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5" />}
                                    </span>
                                    <input
                                      type="text"
                                      required
                                      placeholder="Nombre del requisito"
                                      value={req.name}
                                      onChange={(e) => handleRequirementFieldChange(sIdx, req.id, 'name', e.target.value)}
                                      className="text-xs font-semibold text-slate-700 bg-transparent border-b border-dashed border-slate-200 hover:border-slate-400 focus:border-indigo-500 focus:outline-none flex-1 px-1 py-0.5"
                                    />
                                  </div>

                                  {/* Sub-fields for Form Fields definition */}
                                  {req.type === 'form' && (
                                    <div className="pl-7 space-y-1">
                                      <label className="text-[8px] font-bold text-slate-400 uppercase block">Campos del Formulario (separados por coma)</label>
                                      <input
                                        type="text"
                                        placeholder="Ej: Nombre Titular, Cuil Titular, Monto Pactado, CBU Destino"
                                        value={req.formFields?.map(f => f.label).join(', ') || ''}
                                        onChange={(e) => handleUpdateFormFieldsString(sIdx, req.id, e.target.value)}
                                        className="w-full text-[10px] p-1.5 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                      />
                                      <p className="text-[8px] text-slate-400 leading-none">Crea dinámicamente casillas de texto con estos títulos en la carga del asesor.</p>
                                    </div>
                                  )}

                                  {/* Sub-fields for Document definition (digital contract or download asset or manual upload) */}
                                  {req.type === 'document' && (
                                    <div className="pl-7 space-y-3 pt-1 border-l-2 border-indigo-100/50 mt-2">
                                      <div className="space-y-1">
                                        <label className="text-[8px] font-bold text-slate-400 uppercase block">Tipo de Requisito de Documento</label>
                                        <select
                                          value={req.documentSourceType || 'manual_upload'}
                                          onChange={(e) => handleRequirementFieldChange(sIdx, req.id, 'documentSourceType', e.target.value)}
                                          className="text-[10px] p-1.5 border border-slate-200 rounded bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full"
                                        >
                                          <option value="manual_upload">📁 Carga Manual por el Asesor (Subida de Archivo)</option>
                                          <option value="digital_contract">✍️ Documento 100% Digitalizado Asociado (Plantilla)</option>
                                          <option value="download_asset">📥 Archivo de Descarga Obligatoria (de DOCUMENTOS)</option>
                                        </select>
                                      </div>

                                      {/* If digital_contract, show dropdown of templates with original document content */}
                                      {req.documentSourceType === 'digital_contract' && (
                                        <div className="space-y-1">
                                          <label className="text-[8px] font-bold text-indigo-500 uppercase block">Asociar con Plantilla de Contrato Digital</label>
                                          <select
                                            value={req.linkedTemplateId || ''}
                                            onChange={(e) => handleRequirementFieldChange(sIdx, req.id, 'linkedTemplateId', e.target.value)}
                                            className="text-[10px] p-1.5 border border-indigo-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full font-semibold text-indigo-800"
                                          >
                                            <option value="">-- Seleccionar Plantilla Digitalizada --</option>
                                            {templates.map(t => (
                                              <option key={t.id} value={t.id}>{t.name}</option>
                                            ))}
                                          </select>
                                          <p className="text-[8px] text-slate-400 leading-none">Cuando el expediente avance a esta etapa, se generará y completará este contrato digital editable.</p>
                                        </div>
                                      )}

                                      {/* If download_asset, show dropdown of available files from DOCUMENTOS */}
                                      {req.documentSourceType === 'download_asset' && (
                                        <div className="space-y-1">
                                          <label className="text-[8px] font-bold text-emerald-600 uppercase block">Seleccionar de DOCUMENTOS</label>
                                          <select
                                            value={req.linkedSharedDocumentId || ''}
                                            onChange={(e) => handleRequirementFieldChange(sIdx, req.id, 'linkedSharedDocumentId', e.target.value)}
                                            className="text-[10px] p-1.5 border border-emerald-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full font-semibold text-emerald-800"
                                          >
                                            <option value="">-- Seleccionar de Biblioteca de Documentos --</option>
                                            {sharedDocs.map(d => (
                                              <option key={d.id} value={d.id}>{d.name} ({d.fileName})</option>
                                            ))}
                                          </select>
                                          <p className="text-[8px] text-slate-400 leading-none">El asesor deberá descargar obligatoriamente este instructivo o planilla para continuar.</p>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* Right: Obligatory toggle & Delete */}
                                <div className="flex items-center gap-3 shrink-0 self-center">
                                  <label className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={req.isRequired}
                                      onChange={(e) => handleRequirementFieldChange(sIdx, req.id, 'isRequired', e.target.checked)}
                                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <span>Obligatorio</span>
                                  </label>

                                  <button
                                    type="button"
                                    onClick={() => handleRemoveRequirement(sIdx, req.id)}
                                    className="p-1.5 hover:bg-rose-50 text-rose-500 hover:text-rose-700 rounded-lg cursor-pointer transition-colors"
                                    title="Eliminar requisito"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
                </>
              )}
            </form>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => { setEditingTemplate(null); setEditMode(null); }}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={isSaving}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-xs disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                    <span>Guardando...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5 text-white" />
                    <span>Guardar Cambios</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI TEMPLATE GENERATION & DIGITIZATION MODAL */}
      {showAiModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-indigo-50">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                <h4 className="text-sm font-bold text-indigo-900">Co-Diseñador de Flujos Inteligentes</h4>
              </div>
              <button onClick={() => setShowAiModal(false)} className="p-1 text-indigo-700 hover:text-indigo-950 rounded cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-100 bg-slate-50">
              <button
                type="button"
                onClick={() => setAiTab('generate')}
                className={`flex-1 py-3 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
                  aiTab === 'generate'
                    ? 'border-indigo-600 text-indigo-600 bg-white'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                Crear desde Cero con IA
              </button>
              <button
                type="button"
                onClick={() => setAiTab('digitize')}
                className={`flex-1 py-3 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
                  aiTab === 'digitize'
                    ? 'border-indigo-600 text-indigo-600 bg-white'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                Digitalizar Plantilla / Documento
              </button>
              <button
                type="button"
                onClick={() => setAiTab('manual')}
                className={`flex-1 py-3 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
                  aiTab === 'manual'
                    ? 'border-indigo-600 text-indigo-600 bg-white'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                Crear Manualmente
              </button>
            </div>

            {aiTab === 'generate' ? (
              <form onSubmit={handleGenerateTemplateWithAI} className="flex-1 overflow-y-auto p-5 space-y-4">
                <p className="text-xs text-slate-500 leading-relaxed">
                  Describe detalladamente el proceso comercial, sus etapas y qué documentación es necesaria. El modelo de Inteligencia Artificial interpretará tu solicitud, diseñará las etapas y cargará el checklist con todos sus esquemas.
                </p>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-600 uppercase">Descripción del Proceso para la IA *</label>
                  <textarea
                    required
                    rows={4}
                    placeholder="Ej: Proceso de 3 etapas para pre-aprobación hipotecaria. Etapa 1: Análisis crediticio (pide DNI y Declaración Ganancias). Etapa 2: Tasación inmueble (pide Informe Dominio). Etapa 3: Redacción mutuo."
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50/50"
                  />
                </div>

                {isGenerating && (
                  <div className="bg-indigo-50 border border-indigo-150 p-4 rounded-xl flex items-center gap-3">
                    <Loader2 className="w-5 h-5 animate-spin text-indigo-600 shrink-0" />
                    <div className="text-xs text-indigo-800">
                      <p className="font-bold">Estructurando Proceso con Gemini...</p>
                      <p className="opacity-80">Creando etapas, requisitos documentales, checklists de tareas y esquemas de campos.</p>
                    </div>
                  </div>
                )}
              </form>
            ) : aiTab === 'digitize' ? (
              <form onSubmit={handleDigitizeTemplate} className="flex-1 overflow-y-auto p-5 space-y-4">
                <p className="text-xs text-slate-500 leading-relaxed">
                  Sube un archivo de proceso existente (PDF, foto, documento de texto) o pega su checklist. La IA de Gemini digitalizará al 100% el contenido, transformándolo en un flujo inteligente estructurado y usable inmediatamente.
                </p>

                {/* Drag and Drop File Upload Area */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-600 uppercase">Subir Documento o Plantilla Externa</label>
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragActive(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) {
                        console.log('Drop de archivo detectado:', file.name, file.type, file.size);
                        setDigitizeFileName(file.name);
                        const reader = new FileReader();
                        if (file.name.endsWith('.txt')) {
                          reader.onload = (event) => {
                            if (event.target?.result && typeof event.target.result === 'string') {
                              console.log('Texto leído con éxito de archivo .txt');
                              setDigitizeText(prev => prev ? prev + '\n' + event.target.result : (event.target.result as string));
                              const utf8Bytes = new TextEncoder().encode(event.target.result as string);
                              let binary = '';
                              const len = utf8Bytes.byteLength;
                              for (let i = 0; i < len; i++) {
                                binary += String.fromCharCode(utf8Bytes[i]);
                              }
                              const base64 = btoa(binary);
                              setDigitizeFileBase64('data:text/plain;base64,' + base64);
                            }
                          };
                          reader.onerror = (err) => console.error('Error al leer archivo de texto:', err);
                          reader.readAsText(file);
                        } else {
                          reader.onload = (event) => {
                            if (event.target?.result && typeof event.target.result === 'string') {
                              console.log('Archivo leído con éxito como data URL, largo:', event.target.result.length);
                              setDigitizeFileBase64(event.target.result);
                            }
                          };
                          reader.onerror = (err) => console.error('Error al leer archivo binario:', err);
                          reader.readAsDataURL(file);
                        }
                      }
                    }}
                    className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors relative ${
                      dragActive
                        ? 'border-indigo-500 bg-indigo-50/50'
                        : digitizeFileName
                        ? 'border-emerald-400 bg-emerald-50/10'
                        : 'border-slate-200 hover:border-indigo-400 bg-slate-50/50 hover:bg-indigo-50/10'
                    }`}
                  >
                    <input
                      type="file"
                      id="digitize-file-picker"
                      accept=".pdf,.png,.jpg,.jpeg,.txt,.doc,.docx"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          console.log('Selección manual de archivo detectada:', file.name, file.type, file.size);
                          setDigitizeFileName(file.name);
                          const reader = new FileReader();
                          if (file.name.endsWith('.txt')) {
                            reader.onload = (event) => {
                              if (event.target?.result && typeof event.target.result === 'string') {
                                console.log('Texto leído con éxito de archivo .txt');
                                setDigitizeText(prev => prev ? prev + '\n' + event.target.result : (event.target.result as string));
                                const utf8Bytes = new TextEncoder().encode(event.target.result as string);
                                let binary = '';
                                const len = utf8Bytes.byteLength;
                                for (let i = 0; i < len; i++) {
                                  binary += String.fromCharCode(utf8Bytes[i]);
                                }
                                const base64 = btoa(binary);
                                setDigitizeFileBase64('data:text/plain;base64,' + base64);
                              }
                            };
                            reader.onerror = (err) => console.error('Error al leer archivo de texto:', err);
                            reader.readAsText(file);
                          } else {
                            reader.onload = (event) => {
                              if (event.target?.result && typeof event.target.result === 'string') {
                                console.log('Archivo leído con éxito como data URL, largo:', event.target.result.length);
                                setDigitizeFileBase64(event.target.result);
                              }
                            };
                            reader.onerror = (err) => console.error('Error al leer archivo binario:', err);
                            reader.readAsDataURL(file);
                          }
                        }
                      }}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Upload className={`w-8 h-8 ${digitizeFileName ? 'text-emerald-500' : 'text-slate-400'}`} />
                      {digitizeFileName ? (
                        <div>
                          <p className="text-xs font-bold text-emerald-800">Archivo cargado:</p>
                          <p className="text-xs text-emerald-600 font-mono mt-0.5">{digitizeFileName}</p>
                          <p className="text-[10px] text-slate-400 mt-2">Haz clic o arrastra otro archivo para cambiarlo</p>
                        </div>
                      ) : (
                        <div>
                          <p className="text-xs font-semibold text-slate-700">Arrastre y suelte su archivo aquí</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">O haga clic para examinar su equipo (.pdf, .txt, .docx, .png, .jpg)</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Checklist/Prompt text input */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-600 uppercase">Texto de la Plantilla o Comentarios Adicionales</label>
                  <textarea
                    rows={3}
                    placeholder="Escriba o pegue el checklist actual aquí, o agregue indicaciones especiales para la digitalización."
                    value={digitizeText}
                    onChange={(e) => setDigitizeText(e.target.value)}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50/50"
                  />
                </div>

                {/* Industry/Rubro Selector */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-600 uppercase">Rubro Comercial / Industria *</label>
                  <select
                    value={digitizeIndustry}
                    onChange={(e) => setDigitizeIndustry(e.target.value as any)}
                    className="w-full text-xs p-2.5 border border-slate-200 bg-white rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="Inmobiliaria">Inmobiliaria</option>
                    <option value="Jurídico">Jurídico</option>
                    <option value="Seguros">Seguros</option>
                    <option value="Financiera">Financiera</option>
                    <option value="Recursos Humanos">Recursos Humanos</option>
                    <option value="Administrativo">Administrativo</option>
                  </select>
                </div>

                {/* Checkbox "Generar Flujo por Etapas" */}
                <div className="p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/50 flex items-start gap-3">
                  <div className="flex items-center h-5">
                    <input
                      id="generate-flow-checkbox"
                      type="checkbox"
                      checked={generateFlowCheck}
                      onChange={(e) => setGenerateFlowCheck(e.target.checked)}
                      className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                    />
                  </div>
                  <div className="space-y-0.5">
                    <label htmlFor="generate-flow-checkbox" className="text-xs font-bold text-slate-800 cursor-pointer select-none">
                      Generar Flujo de Seguimiento por Etapas
                    </label>
                    <p className="text-[10.5px] text-slate-500 leading-relaxed">
                      {generateFlowCheck 
                        ? 'Activado: Se analizará el documento para estructurar un checklist de 2 a 5 etapas lógicas.' 
                        : 'Desactivado (Recomendado): Solo se digitalizará el documento original de forma continua e íntegra como plantilla para completar.'
                      }
                    </p>
                  </div>
                </div>

                {isDigitizing && (
                  <div className="bg-indigo-50 border border-indigo-150 p-4 rounded-xl flex items-center gap-3">
                    <Loader2 className="w-5 h-5 animate-spin text-indigo-600 shrink-0" />
                    <div className="text-xs text-indigo-800">
                      <p className="font-bold">Digitalizando al 100% con Gemini...</p>
                      <p className="opacity-80">Procesando contenido del documento, extrayendo requisitos y adaptándolo como plantilla interactiva.</p>
                    </div>
                  </div>
                )}
              </form>
            ) : (
              <form onSubmit={handleCreateManualTemplate} className="flex-1 overflow-y-auto p-5 space-y-4">
                <p className="text-xs text-slate-500 leading-relaxed">
                  Crea una plantilla de proceso desde cero de forma manual. Podrás configurar sus etapas, checklists, formularios y tareas de seguimiento una vez creada.
                </p>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-600 uppercase">Nombre de la Plantilla de Proceso *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: Trámite de Habilitación Comercial, Onboarding, etc."
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-50/50"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-600 uppercase">Descripción / Objetivo</label>
                  <textarea
                    rows={3}
                    placeholder="Ej: Secuencia de pasos para habilitar nuevos comercios minoristas en la jurisdicción."
                    value={manualDescription}
                    onChange={(e) => setManualDescription(e.target.value)}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-50/50"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-600 uppercase">Rubro Comercial / Industria *</label>
                  <select
                    value={manualIndustry}
                    onChange={(e) => setManualIndustry(e.target.value as any)}
                    className="w-full text-xs p-2.5 border border-slate-200 bg-white rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="Inmobiliaria">Inmobiliaria</option>
                    <option value="Jurídico">Jurídico</option>
                    <option value="Seguros">Seguros</option>
                    <option value="Financiera">Financiera</option>
                    <option value="Recursos Humanos">Recursos Humanos</option>
                    <option value="Administrativo">Administrativo</option>
                  </select>
                </div>
              </form>
            )}

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowAiModal(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
              >
                Cancelar
              </button>
              {aiTab === 'generate' ? (
                <button
                  type="button"
                  onClick={handleGenerateTemplateWithAI}
                  disabled={isGenerating || !aiPrompt.trim()}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-xs disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                      <span>Procesando...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 text-white" />
                      <span>Generar Estructura</span>
                    </>
                  )}
                </button>
              ) : aiTab === 'digitize' ? (
                <button
                  type="button"
                  onClick={handleDigitizeTemplate}
                  disabled={isDigitizing || (!digitizeFileBase64 && !digitizeText.trim())}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-xs disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                >
                  {isDigitizing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                      <span>Digitalizando...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 text-white" />
                      <span>Digitalizar Plantilla</span>
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCreateManualTemplate}
                  disabled={isCreatingManual || !manualName.trim()}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-xs disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                >
                  {isCreatingManual ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                      <span>Creando...</span>
                    </>
                  ) : (
                    <>
                      <Layers className="w-3.5 h-3.5 text-white" />
                      <span>Crear Plantilla</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-5 right-5 z-[9999] p-4 rounded-xl shadow-lg border max-w-sm flex items-center justify-between gap-3 ${
          toast.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
          toast.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800' :
          'bg-indigo-50 border-indigo-200 text-indigo-800'
        }`}>
          <span className="text-xs font-semibold">{toast.message}</span>
          <button onClick={() => setToast(null)} className="p-0.5 hover:bg-slate-200/50 rounded">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Confirmation Modal Overlay */}
      {confirmModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[9999]">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden p-6 space-y-4">
            <div className="flex items-center gap-3 text-amber-600">
              <span className="p-2 bg-amber-50 rounded-full">
                <Trash2 className="w-6 h-6" />
              </span>
              <h3 className="text-sm font-bold text-slate-800">{confirmModal.title}</h3>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              {confirmModal.message}
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(null);
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
