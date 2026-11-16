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


// La igualdad estricta solo ignora espacios: conserva tildes, signos, mayúsculas y caracteres.
const withoutSpaces = (value: string) => value.replace(/\\s+/gu, '');
const comparable = (value: string) => value.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLocaleLowerCase('es').replace(/[^a-z0-9]+/g, ' ').trim();
const similarity = (a: string, b: string): number => {
  const x = comparable(a), y = comparable(b);
  if (x === y) return 1;
  if (!x || !y) return 0;
  const previous = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const old = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (x[i - 1] === y[j - 1] ? 0 : 1));
      diagonal = old;
    }
  }
  return 1 - previous[y.length] / Math.max(x.length, y.length);
};
const requirementLines = (value: string) => value.split(/\\r?\\n/).map(line => line.trim()).filter(Boolean);
const compareRequirements = (a: string, b: string) => {
  const left = requirementLines(a), right = requirementLines(b);
  const normalized = (line: string) => comparable(line).replace(/\\b(del|de la|de los|de las)\\b/g, '').replace(/\\s+/g, ' ').trim();
  const other = [...right];
  const removed: string[] = [];
  for (const line of left) {
    const idx = other.findIndex(item => normalized(item) === normalized(line));
    if (idx >= 0) other.splice(idx, 1);
    else removed.push(line);
  }
  return { removed, added: other };
};

interface TemplatesManagerProps {
  templates: ProcessTemplate[];
  currentUser: User;
  systemSettings?: any;
  onAddTemplate: (template: ProcessTemplate) => void;
  loadState?: () => Promise<void>;
}

export default function TemplatesManager({ templates, currentUser, systemSettings, onAddTemplate, loadState }: TemplatesManagerProps) {
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);
  const [showAiModal, setShowAiModal] = useState(false);
  const [showProcessModal, setShowProcessModal] = useState(false);

  // States for Template Digitization
  const [digitizeFileBase64, setDigitizeFileBase64] = useState('');
  const [digitizeFileName, setDigitizeFileName] = useState('');
  const [digitizeText, setDigitizeText] = useState('');
  const [digitizeIndustry, setDigitizeIndustry] = useState<ProcessTemplate['industry']>('Inmobiliaria');
  const [isDigitizing, setIsDigitizing] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // States for Approving and Publishing with Role selection
  const [approvingTemplate, setApprovingTemplate] = useState<ProcessTemplate | null>(null);
  const [approveRoles, setApproveRoles] = useState<string[]>(['SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR']);

  // States for manual creation
  const [manualName, setManualName] = useState('');
  const [manualDescription, setManualDescription] = useState("Locador\nLocatario\nGarante mínimo 2\nEscribano\nDNI del locador\nDNI del locatario\nDNI de los garantes\nCopia de escritura\nBoleta de servicios");
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
        const res = await fetch(`/api/shared-documents?userId=${currentUser.id}&role=${currentUser.role}`, {
          credentials: 'include'
        });
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

  // AI-Powered Template Digitization (100% Digitalization of existing documents)
  const handleDigitizeTemplate = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    if (!digitizeFileBase64 && !digitizeText.trim()) {
      alert('Por favor, cargue un documento (arrastrando o seleccionando) o ingrese el texto de la plantilla.');
      return;
    }

    setIsDigitizing(true);

    try {
      const response = await fetch('/api/ai/digitize-template', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileBase64: digitizeFileBase64,
          fileName: digitizeFileName,
          textProposal: digitizeText,
          industry: digitizeIndustry,
          currentUserId: currentUser.id
        })
      });

      const data = await response.json();
      console.log('Respuesta recibida de digitalización por IA:', data);

      if (!response.ok || data.error) {
        alert(`Error de digitalización: ${data.error || 'No se pudo digitalizar la plantilla.'}`);
      } else if (data.template) {
        alert(`Plantilla "${data.template.name}" procesada. Revisá el texto y los campos antes de aprobarla para su uso en legajos.`);
        setShowAiModal(false);
        setDigitizeFileBase64('');
        setDigitizeFileName('');
        setDigitizeText('');
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
    if (!manualName.trim() || !manualDescription.trim()) {
      alert('Ingresá el nombre y la descripción con los requisitos del proceso.');
      return;
    }
    // Primero verificar duplicados estrictos; luego pedir confirmación ante similitudes.
    // Actualizar desde el servidor para no depender únicamente de la lista renderizada.
    let existing = templates.filter(t => !t.id.startsWith('doc-') && !t.originalDocumentContent);
    try {
      const check = await fetch('/api/templates', { credentials: 'include' });
      if (!check.ok) throw new Error('No se pudo verificar la lista de procesos.');
      const latest = await check.json();
      if (!Array.isArray(latest)) throw new Error('Respuesta inválida al verificar procesos.');
      existing = latest.filter((t: ProcessTemplate) => !t.id.startsWith('doc-') && !t.originalDocumentContent);
    } catch {
      alert('No se pudo comprobar si el proceso ya existe. Volvé a intentarlo para evitar duplicados.');
      return;
    }
    const sameIndustry = existing.filter(t => withoutSpaces(t.industry) === withoutSpaces(manualIndustry));
    const exact = sameIndustry.find(t =>
      withoutSpaces(t.name) === withoutSpaces(manualName) &&
      withoutSpaces(t.description) === withoutSpaces(manualDescription)
    );
    if (exact) {
      alert(`Duplicado confirmado: el proceso «${exact.name}» ya existe con el mismo rubro, nombre y descripción/requisitos (ignorando solamente espacios). No se guardó.`);
      return;
    }
    const similar = sameIndustry
      .map(t => ({ template: t, nameScore: similarity(t.name, manualName), descScore: similarity(t.description, manualDescription) }))
      .filter(item => item.nameScore >= 0.76 || item.descScore >= 0.86)
      .sort((a, b) => Math.max(b.nameScore, b.descScore) - Math.max(a.nameScore, a.descScore))[0];
    if (similar) {
      const diff = compareRequirements(similar.template.description, manualDescription);
      const changes = [
        diff.added.length ? 'Requisitos nuevos:\\n' + diff.added.map(line => '+ ' + line).join('\\n') : '',
        diff.removed.length ? 'Requisitos del proceso existente que no figuran en el nuevo:\\n' + diff.removed.map(line => '- ' + line).join('\\n') : '',
        !diff.added.length && !diff.removed.length ? 'Los requisitos parecen equivalentes; revisá si realmente necesitás otro proceso.' : ''
      ].filter(Boolean).join('\\n\\n');
      if (!window.confirm(`Proceso muy parecido detectado: «${similar.template.name}».\\n\\nNombre nuevo: ${manualName}\\n\\n${changes}\\n\\n¿Confirmás que querés crear otro proceso distinto?`)) return;
    }
    setIsCreatingManual(true);
    try {
      const response = await fetch('/api/templates', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: manualName,
          description: manualDescription,
          industry: manualIndustry,
          originalDocumentContent: '',
          showDocumentToAll: true,
          sharedViewMode: 'flow',
          currentUserId: currentUser.id
        })
      });

      const data = await response.json();
      if (response.ok && data.id) {
        alert(`¡Plantilla de proceso "${data.name}" creada correctamente!`);
        setShowProcessModal(false);
        setManualName('');
        setManualDescription("Locador\nLocatario\nGarante mínimo 2\nEscribano\nDNI del locador\nDNI del locatario\nDNI de los garantes\nCopia de escritura\nBoleta de servicios");
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
  const handleDuplicateTemplate = (tpl: ProcessTemplate) => {
    requestConfirmation('Duplicar plantilla', `¿Crear una copia de «${tpl.name}»?`, () => { void duplicateTemplate(tpl, `Copia de ${tpl.name}`); });
  };

  const duplicateTemplate = async (tpl: ProcessTemplate, newName: string) => {

    try {
      const response = await fetch('/api/templates', {
        method: 'POST',
        credentials: 'include',
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
      `¿Está seguro de que desea eliminar la plantilla "${templateName}"? Esta acción no se puede deshacer y afectará la creación de futuros legajos.`,
      async () => {
        try {
          const response = await fetch(`/api/templates/${templateId}?currentUserId=${currentUser.id}`, {
            method: 'DELETE',
            credentials: 'include',
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
  const handleStartEdit = (tpl: ProcessTemplate, mode: 'stages' = 'stages') => {
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
      name: type === 'document' ? 'Nuevo Documento' : type === 'form' ? 'Nuevo Formulario' : type === 'actor' ? 'Locador' : 'Nueva Tarea',
      actorRole: type === 'actor' ? 'Locador' : undefined,
      minQuantity: type === 'actor' ? 1 : undefined,
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

  const handleRequirementFieldChange = (stageIdx: number, reqId: string, field: 'name' | 'description' | 'isRequired' | 'documentSourceType' | 'linkedTemplateId' | 'linkedSharedDocumentId' | 'actorRole' | 'minQuantity', value: any) => {
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
        credentials: 'include',
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

  const handleStartApprove = (tpl: ProcessTemplate) => {
    if (!tpl.originalDocumentContent) {
      alert('Este proceso no tiene un documento original digitalizado.');
      return;
    }
    setApprovingTemplate(tpl);
    setApproveRoles(['SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR']);
  };

  const executeApproveAndPublish = async () => {
    if (!approvingTemplate) return;
    try {
      const tpl = approvingTemplate;
      const unicodeToBase64 = (str: string) => {
        return btoa(unescape(encodeURIComponent(str)));
      };
      
      const fileBase64 = `data:text/plain;base64,${unicodeToBase64(tpl.originalDocumentContent || '')}`;
      const fileName = `${tpl.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_digitalizado.txt`;

      const response = await fetch('/api/shared-documents', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${tpl.name} (Digitalizado)`,
          fileName,
          fileSize: (tpl.originalDocumentContent || '').length,
          fileBase64,
          allowedRoles: approveRoles,
          allowedUserIds: [],
          currentUserId: currentUser.id
        })
      });

      const data = await response.json();
      if (response.ok && data.id) {
        alert(`¡Documento "${tpl.name} (Digitalizado)" aprobado y guardado en la sección DOCUMENTOS exitosamente con los permisos seleccionados! Además, se eliminó de Plantillas de Procesos.`);
        
        try {
          await fetch(`/api/templates/${tpl.id}?currentUserId=${currentUser.id}`, {
            method: 'DELETE',
            credentials: 'include'
          });
        } catch (delErr) {
          console.error('Error al eliminar plantilla después de ser aprobada:', delErr);
        }

        setApprovingTemplate(null);
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
          <h2 className="text-2xl font-display font-bold text-slate-800 tracking-tight">Plantillas y Procesos</h2>
          <p className="text-sm text-slate-500">Los responsables establecen los actores, documentos y obligaciones que se exigirán en cada legajo.</p>
        </div>
        {canManageTemplates && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setShowProcessModal(true);
              }}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl shadow-md shadow-indigo-500/10 hover:shadow-indigo-500/20 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Crear Proceso</span>
            </button>
          </div>
        )}
      </div>

      {canManageTemplates && (
        <div className="bg-gradient-to-r from-indigo-900 via-slate-900 to-indigo-950 text-white p-6 rounded-2xl border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-5">
          <div className="space-y-1">
            <h3 className="text-base font-bold">Digitalización de documentos (independiente de procesos)</h3>
            <p className="text-xs text-slate-200">Convertí documentos en plantillas con espacios completables. Se revisan y aprueban antes de publicarse en Documentos; no generan procesos ni requisitos.</p>
          </div>
          <button type="button" onClick={() => setShowAiModal(true)} className="shrink-0 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl flex items-center gap-2"><Upload className="w-4 h-4"/> Digitalizar documento</button>
        </div>
      )}

      {/* Grid of Templates */}
      <div className="grid grid-cols-1 gap-4">
        {templates.filter(t => !t.id.startsWith('doc-')).map((tpl) => {
          const isExpanded = expandedTemplateId === tpl.id;
          const isDigitalDoc = !!tpl.originalDocumentContent && tpl.originalDocumentContent.trim() !== '';
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
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-3 md:p-6" onClick={() => setExpandedTemplateId(null)}>
                  <div className="w-full max-w-6xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white border border-slate-200 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                    <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-5 py-4 flex items-center justify-between gap-4">
                      <div><h3 className="text-base font-bold text-slate-900">{tpl.name}</h3><p className="text-xs text-slate-500">{tpl.industry} · Requisitos del proceso</p></div>
                      <div className="flex items-center gap-2">
                        {canManageTemplates && !isDigitalDoc && <button type="button" onClick={() => { setExpandedTemplateId(null); handleStartEdit(tpl, 'stages'); }} className="px-3 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg">Configurar requisitos</button>}
                        <button type="button" aria-label="Cerrar detalles" onClick={() => setExpandedTemplateId(null)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-700"><X className="w-5 h-5" /></button>
                      </div>
                    </div>
                    <div className="p-5 md:p-7 space-y-6">
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
                                onClick={() => handleStartApprove(tpl)}
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
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1.5">
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
                                        <span className="text-[9px] bg-indigo-50 text-indigo-700 px-1.5 ml-2 rounded font-bold uppercase">{req.isRequired ? 'Obligatorio' : 'Opcional'}</span>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>

                              {/* Forms list */}
                              {stg.requirements.some(r => r.type === 'form') && <div className="space-y-2">
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
                              </div>}
                              {/* Tasks list */}
                              {stg.requirements.some(r => r.type === 'task') && <div className="space-y-2">
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
                              </div>}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                    </div>
                  </div>
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
                        Este texto sirve de base para el documento digitalizado en cada legajo.
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
                            <button
                              type="button"
                              onClick={() => handleAddRequirement(sIdx, 'actor')}
                              className="px-2 py-1 bg-white hover:bg-violet-50 text-violet-700 border border-slate-200 rounded text-[9px] font-bold cursor-pointer transition-colors"
                            >
                              + Actor
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

                                  {req.type === 'actor' && (
                                    <div className="pl-7 flex flex-wrap gap-3 items-end">
                                      <label className="text-xs text-slate-700">Rol obligatorio
                                        <select className="block border border-slate-300 rounded p-2 bg-white text-slate-900" value={req.actorRole || 'Locador'} onChange={e => { handleRequirementFieldChange(sIdx, req.id, 'actorRole', e.target.value); handleRequirementFieldChange(sIdx, req.id, 'name', e.target.value); }}>
                                          {['Locador','Locatario','Garante','Comprador','Vendedor','Titular','Cliente','Apoderado','Escribano'].map(role => <option key={role} value={role}>{role}</option>)}
                                        </select>
                                      </label>
                                      <label className="text-xs text-slate-700">Cantidad mínima
                                        <input type="number" min="1" max="50" className="block w-24 border border-slate-300 rounded p-2 bg-white text-slate-900" value={req.minQuantity || 1} onChange={e => handleRequirementFieldChange(sIdx, req.id, 'minQuantity', Math.max(1, Number(e.target.value) || 1))} />
                                      </label>
                                    </div>
                                  )}
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
                                            {templates.filter(t => !t.id.startsWith('doc-')).map(t => (
                                              <option key={t.id} value={t.id}>{t.name}</option>
                                            ))}
                                          </select>
                                          <p className="text-[8px] text-slate-400 leading-none">Cuando el legajo avance a esta etapa, se generará y completará este contrato digital editable.</p>
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

      {/* Digitalización documental: independiente de los procesos operativos. */}
      {showAiModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-indigo-50">
              <h4 className="text-sm font-bold text-indigo-900">Digitalizar documento interactivo</h4>
              <button type="button" onClick={() => setShowAiModal(false)} className="p-1 text-indigo-700 hover:text-indigo-950 rounded" aria-label="Cerrar"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleDigitizeTemplate} className="flex-1 overflow-y-auto p-5 space-y-4">
                <p className="text-xs text-slate-500 leading-relaxed">
                  Subí un documento PDF, Word, texto o imagen. Se conservará su contenido y se identificarán espacios para completar. El responsable revisará el resultado antes de aprobarlo y publicarlo en Documentos.
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
                      accept=".pdf,.png,.jpg,.jpeg,.txt,.docx"
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
                          <p className="text-[10px] text-slate-400 mt-0.5">O haga clic para examinar su equipo (.pdf con texto, .txt, .docx, .png, .jpg)</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Checklist/Prompt text input */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-600 uppercase">Texto del documento o aclaraciones</label>
                  <textarea
                    rows={3}
                    placeholder="Pegá el texto del documento si no cargás un archivo."
                    value={digitizeText}
                    onChange={(e) => setDigitizeText(e.target.value)}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50/50"
                  />
                </div>

                {/* Industry/Rubro Selector */}
                {currentUser.role !== 'MANAGER' && (
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
                )}

                {isDigitizing && (
                  <div className="bg-indigo-50 border border-indigo-150 p-4 rounded-xl flex items-center gap-3">
                    <Loader2 className="w-5 h-5 animate-spin text-indigo-600 shrink-0" />
                    <div className="text-xs text-indigo-800">
                      <p className="font-bold">Digitalizando al 100% con Cloudflare Workers AI...</p>
                      <p className="opacity-80">Convirtiendo espacios y puntos suspensivos en campos completables. No se crearán requisitos de proceso.</p>
                    </div>
                  </div>
                )}
              </form>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setShowAiModal(false)} className="px-4 py-2 bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl">Cancelar</button>
              <button type="button" onClick={handleDigitizeTemplate} disabled={isDigitizing || (!digitizeFileBase64 && !digitizeText.trim())} className="px-5 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-xl disabled:opacity-50">
                {isDigitizing ? 'Digitalizando...' : 'Digitalizar documento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Configuración del proceso: las obligaciones nacen aquí, no en la digitalización. */}
      {showProcessModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-indigo-50 flex items-center justify-between">
              <h4 className="text-sm font-bold text-indigo-900">Crear proceso operativo</h4>
              <button type="button" onClick={() => setShowProcessModal(false)} aria-label="Cerrar" className="p-1 text-indigo-700"><X className="w-5 h-5"/></button>
            </div>
            <form id="new-process-form" onSubmit={handleCreateManualTemplate} className="overflow-y-auto p-5 space-y-4">
              <p className="text-xs text-slate-600">Definí qué deberán presentar los asesores al iniciar un legajo. Cada requisito debe ir en una línea. Podrás revisar y modificar las obligaciones y las etapas después de guardar.</p>
              <label className="block text-xs font-bold text-slate-700">Nombre del Proceso *
                <input required value={manualName} onChange={e => setManualName(e.target.value)} placeholder="Ej.: Reserva de contrato de locación" className="mt-1 w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"/>
              </label>
              <label className="block text-xs font-bold text-slate-700">Descripción / Objetivo *
                <textarea required rows={9} value={manualDescription} onChange={e => setManualDescription(e.target.value)}  className="mt-1 w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"/>
                <span className="block mt-1 text-[11px] font-normal text-slate-500">Los actores, sus mínimos y los documentos indicados se convierten en requisitos del proceso. Escribí cada obligación en una línea.</span>
              </label>
              <label className="block text-xs font-bold text-slate-700">Rubro Comercial / Industria *
                <select required value={manualIndustry} onChange={e => setManualIndustry(e.target.value as ProcessTemplate['industry'])} className="mt-1 w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                  {['Inmobiliaria','Jurídico','Seguros','Financiera','Recursos Humanos','Administrativo'].map(industry => <option key={industry} value={industry}>{industry}</option>)}
                </select>
              </label>
            </form>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setShowProcessModal(false)} className="px-4 py-2 bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl">Cancelar</button>
              <button type="submit" form="new-process-form" disabled={isCreatingManual || !manualName.trim() || !manualDescription.trim()} className="px-5 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-xl disabled:opacity-50">{isCreatingManual ? 'Guardando...' : 'Crear proceso'}</button>
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

      {/* Approving Template Role Selection Modal */}
      {approvingTemplate && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[9999]">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden p-6 space-y-4 text-left">
            <div className="flex items-center gap-3 text-emerald-600">
              <span className="p-2 bg-emerald-50 rounded-full">
                <CheckCircle className="w-6 h-6" />
              </span>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Aprobar y publicar documento</h3>
                <p className="text-[11px] text-slate-400 font-mono mt-0.5">{approvingTemplate.name}</p>
              </div>
            </div>
            
            <p className="text-xs text-slate-500 leading-relaxed">
              Define los roles autorizados para ver y descargar este documento digitalizado en la sección de <strong>DOCUMENTOS</strong>.
            </p>

            <div className="space-y-2.5 p-3.5 bg-slate-50 border border-slate-100 rounded-xl">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Roles Permitidos:
              </span>
              
              {currentUser.role !== 'MANAGER' && (
                <label className="flex items-center gap-2.5 text-xs font-semibold text-slate-700 cursor-not-allowed opacity-75">
                  <input
                    type="checkbox"
                    checked={true}
                    disabled={true}
                    className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                  />
                  <span>Superadministrador (SUPERADMIN) <span className="text-[10px] font-normal text-slate-400 font-mono">(Obligatorio)</span></span>
                </label>
              )}

              {(['ADMIN', 'MANAGER', 'ASESOR'] as const).map(role => {
                const labelMap = {
                  ADMIN: 'Administrador (ADMIN)',
                  MANAGER: 'Gerente (MANAGER)',
                  ASESOR: 'Asesor (ASESOR)'
                };
                if (currentUser.role === 'MANAGER' && role === 'ADMIN') {
                  return null;
                }
                const isChecked = approveRoles.includes(role);
                return (
                  <label key={role} className="flex items-center gap-2.5 text-xs font-semibold text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {
                        if (isChecked) {
                          setApproveRoles(approveRoles.filter(r => r !== role));
                        } else {
                          setApproveRoles([...approveRoles, role]);
                        }
                      }}
                      className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                    />
                    <span>{labelMap[role]}</span>
                  </label>
                );
              })}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setApprovingTemplate(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={executeApproveAndPublish}
                disabled={approveRoles.length === 0}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                Aprobar y publicar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
