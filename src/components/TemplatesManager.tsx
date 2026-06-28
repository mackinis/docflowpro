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
  ArrowDown
} from 'lucide-react';
import { ProcessTemplate, User, Stage, Requirement, RequirementType, FormField } from '../types';

interface TemplatesManagerProps {
  templates: ProcessTemplate[];
  currentUser: User;
  onAddTemplate: (template: ProcessTemplate) => void;
  loadState?: () => Promise<void>;
}

export default function TemplatesManager({ templates, currentUser, onAddTemplate, loadState }: TemplatesManagerProps) {
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);

  // States for Editing Template
  const [editingTemplate, setEditingTemplate] = useState<ProcessTemplate | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editIndustry, setEditIndustry] = useState<ProcessTemplate['industry']>('Inmobiliaria');
  const [editStages, setEditStages] = useState<Stage[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const toggleExpand = (id: string) => {
    setExpandedTemplateId(expandedTemplateId === id ? null : id);
  };

  const isSuperAdmin = currentUser.role === 'SUPERADMIN';
  const isManagerOrAdmin = ['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(currentUser.role);

  // AI-Powered Template Generator
  const handleGenerateTemplateWithAI = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim()) return;

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

      if (data.error) {
        alert(`Error de IA: ${data.error}`);
      } else if (data.template) {
        onAddTemplate(data.template);
        alert(`¡Flujo de trabajo "${data.template.name}" generado exitosamente por la Inteligencia Artificial!`);
        setShowAiModal(false);
        setAiPrompt('');
        setExpandedTemplateId(data.template.id);
      } else {
        alert('Ocurrió un error inesperado al procesar la respuesta de la IA.');
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión al generar la plantilla por IA.');
    } finally {
      setIsGenerating(false);
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

  // Edit Template setup
  const handleStartEdit = (tpl: ProcessTemplate) => {
    setEditingTemplate(tpl);
    setEditName(tpl.name);
    setEditDescription(tpl.description);
    setEditIndustry(tpl.industry);
    setEditStages(JSON.parse(JSON.stringify(tpl.stages))); // Deep copy
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
    if (confirm('¿Está seguro de eliminar esta etapa de la plantilla? Se perderán todos sus requisitos.')) {
      setEditStages(editStages.filter((_, i) => i !== idx));
    }
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

  const handleRequirementFieldChange = (stageIdx: number, reqId: string, field: 'name' | 'description' | 'isRequired', value: any) => {
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
    if (!editingTemplate) return;
    setIsSaving(true);

    try {
      const response = await fetch(`/api/templates/${editingTemplate.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          description: editDescription,
          industry: editIndustry,
          stages: editStages,
          currentUserId: currentUser.id
        })
      });

      if (response.ok) {
        alert('¡Plantilla de proceso guardada correctamente!');
        setEditingTemplate(null);
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

  return (
    <div className="space-y-6">
      {/* Header toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-display font-bold text-slate-800 tracking-tight">Estructura de Plantillas de Procesos</h2>
          <p className="text-sm text-slate-500">Define etapas, checklists obligatorios, formularios e indicadores de cumplimiento.</p>
        </div>
        {isManagerOrAdmin && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAiModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl shadow-md shadow-indigo-500/10 hover:shadow-indigo-500/20 transition-all cursor-pointer"
            >
              <Sparkles className="w-4 h-4 animate-pulse" />
              <span>Diseñar con IA</span>
            </button>
          </div>
        )}
      </div>

      {/* AI DESIGN BANNER (Prompt Quick-Access) */}
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
          onClick={() => setShowAiModal(true)}
          className="shrink-0 relative z-10 px-4.5 py-2.5 bg-white text-indigo-950 font-bold text-xs rounded-xl hover:bg-indigo-50 shadow-md shadow-white/5 active:scale-98 transition-all flex items-center gap-2 cursor-pointer"
        >
          <Wand2 className="w-4 h-4 text-indigo-600" />
          <span>Generar Plantilla Inteligente</span>
        </button>
      </div>

      {/* Grid of Templates */}
      <div className="grid grid-cols-1 gap-4">
        {templates.map((tpl) => {
          const isExpanded = expandedTemplateId === tpl.id;
          return (
            <div key={tpl.id} className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden transition-all duration-200">
              {/* Summary Block */}
              <div 
                onClick={() => toggleExpand(tpl.id)}
                className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/50 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
                    <FolderKanban className="w-5 h-5" />
                  </div>
                  <div className="overflow-hidden">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-slate-800 truncate">{tpl.name}</h3>
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-semibold rounded font-mono uppercase tracking-wider">{tpl.industry}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xl">{tpl.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <div className="text-right text-xs font-semibold text-slate-500 font-mono">
                    {tpl.stages.length} Etapas
                  </div>
                  
                  {isSuperAdmin && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleStartEdit(tpl)}
                        className="p-2 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded-xl transition-all border border-transparent hover:border-amber-100 cursor-pointer"
                        title="Editar Plantilla de Proceso"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDuplicateTemplate(tpl)}
                        className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all border border-transparent hover:border-indigo-100 cursor-pointer"
                        title="Duplicar Plantilla de Proceso"
                      >
                        <Copy className="w-4 h-4" />
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
                  <div className="flex flex-col gap-5">
                    {tpl.stages.map((stg, sIdx) => (
                      <div key={stg.id} className="bg-white rounded-xl border border-slate-150 p-4.5 space-y-3.5 shadow-xs relative">
                        {/* Stage title */}
                        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-slate-900 text-white font-mono font-bold text-[10px] flex items-center justify-center">
                              {sIdx + 1}
                            </span>
                            <h4 className="text-xs font-bold text-slate-800">{stg.name}</h4>
                          </div>
                          <p className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Etapa del Trámite</p>
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
                    ))}
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
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-amber-50">
              <div className="flex items-center gap-2">
                <Edit className="w-5 h-5 text-amber-700" />
                <div>
                  <h4 className="text-sm font-bold text-amber-900">Editar Estructura de Plantilla</h4>
                  <p className="text-[11px] text-amber-700/80">Establece etapas, requisitos, y checklists que guiarán los expedientes.</p>
                </div>
              </div>
              <button onClick={() => setEditingTemplate(null)} className="p-1.5 text-amber-700 hover:text-amber-950 rounded-lg cursor-pointer">
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

              {/* Stages List Header */}
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
            </form>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setEditingTemplate(null)}
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

      {/* AI TEMPLATE GENERATION MODAL */}
      {showAiModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[80vh] flex flex-col overflow-hidden">
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

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowAiModal(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleGenerateTemplateWithAI}
                disabled={isGenerating || !aiPrompt.trim()}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-xs disabled:opacity-50 flex items-center gap-1.5"
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
