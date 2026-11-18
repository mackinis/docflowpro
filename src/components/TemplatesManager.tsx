import React, { useEffect, useRef, useState } from 'react';
import { 
  FolderKanban, 
  Sparkles, 
  Plus, 
  FileText, 
  Users,
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
  const [isPublishing, setIsPublishing] = useState(false);
  const [approveRoles, setApproveRoles] = useState<string[]>(['SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR']);

  // States for manual creation
  const resetProcessForm = () => {
    setManualName('');
    setManualDescription('');
    reviewGeneration.current++;
    if(reviewSaveTimer.current)clearTimeout(reviewSaveTimer.current);
    setReviewSaveStatus('idle');
    setSelectedDigitalTemplateId('');
    setImportedFieldMap([]);
    setSelectedDocumentContent('');
    setManualIndustry('Inmobiliaria');
  };
  const [manualName, setManualName] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [manualIndustry, setManualIndustry] = useState<ProcessTemplate['industry']>('Inmobiliaria');
  const [selectedDigitalTemplateId,setSelectedDigitalTemplateId] = useState('');
  const [importedFieldMap,setImportedFieldMap] = useState<NonNullable<ProcessTemplate['fieldMap']>>([]);
  const [importingFields,setImportingFields] = useState(false);
  const [confirmingFieldReview,setConfirmingFieldReview] = useState(false);
  const [reviewSaveStatus,setReviewSaveStatus] = useState<'idle'|'saving'|'saved'|'error'>('idle');
  const [descriptionScrollTop,setDescriptionScrollTop] = useState(0);
  const reviewSaveTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const reviewSaving = useRef(false);
  const reviewGeneration = useRef(0);
  const [selectedDocumentContent,setSelectedDocumentContent]=useState('');
  // The source of truth is Documentos (shared_documents), not virtual
  // process templates or legacy copies of the same digitized document.
  const importDigitalFields = async (templateId:string) => {
    reviewGeneration.current++;
    if(reviewSaveTimer.current)clearTimeout(reviewSaveTimer.current);
    setReviewSaveStatus('idle');
    setSelectedDigitalTemplateId(templateId);
    setImportedFieldMap([]);
    setSelectedDocumentContent('');
    if(!templateId)return;
    const selected=digitalTemplates.find(t=>t.id===templateId);
    if(!selected)return;
    setImportingFields(true);
    try {
      const response=await fetch('/api/templates/analyze-fields',{
        method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({sharedDocumentId:templateId})
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'No se pudo interpretar la plantilla');
      const fields=data.fields as NonNullable<ProcessTemplate['fieldMap']>;
      setImportedFieldMap(fields);
      setSelectedDocumentContent(data.originalDocumentContent||'');
      setManualDescription(fields.map(f=>f.actor+' — '+f.label+' ('+f.id+')'+(f.review?' [REVISAR]':'')).join('\n'));
      if(!manualName.trim())setManualName(selected.name.replace(/\s*\(Digitalizado\)\s*$/i,''));
    }catch(error){alert(error instanceof Error?error.message:'Error al analizar campos');}
    finally{setImportingFields(false);}
  };
  // The textarea remains native and uninterrupted. Save only complete marker changes.
  const updateProcessDescription = (next:string) => {
    setManualDescription(next);
    setReviewSaveStatus('idle');
  };
  const reviewLines = manualDescription.split('\n');
  const countVisibleReviews = () => reviewLines.filter(line => /\[REVISAR\]/i.test(line)).length;
  const reviewLineIndexes = reviewLines.flatMap((line,index) => /\[REVISAR\]/i.test(line)?[index]:[]);
  const reviewHighlightStyle: React.CSSProperties = reviewLineIndexes.length ? {
    backgroundImage: reviewLineIndexes.map(() => 'linear-gradient(rgba(254, 202, 202, 0.65), rgba(254, 202, 202, 0.65))').join(','),
    backgroundSize: reviewLineIndexes.map(() => '100% 21px').join(','),
    backgroundPosition: reviewLineIndexes.map(index => '0 '+(10+index*21-descriptionScrollTop)+'px').join(','),
    backgroundRepeat: 'no-repeat'
  } : {};
  const persistFieldReviews = async () => {
    if(reviewSaving.current || !selectedDigitalTemplateId || !importedFieldMap.length)return;
    const generation=reviewGeneration.current;
    const lines=manualDescription.split('\n');
    // Match by immutable identifier, never by mutable label or line position.
    const changes=importedFieldMap.flatMap(f=>{
      const matching=lines.filter(line=>line.includes('('+f.id+')'));
      if(matching.length!==1)return [];
      const target=/\[REVISAR\]/i.test(matching[0]);
      return Boolean(f.review)===target?[]:[{id:f.id,review:target,expectedReview:Boolean(f.review)}];
    });
    if(!changes.length)return;
    reviewSaving.current=true;
    setConfirmingFieldReview(true);
    setReviewSaveStatus('saving');
    try {
      for(const change of changes){
        const response=await fetch('/api/templates/confirm-field-review',{
          method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({sharedDocumentId:selectedDigitalTemplateId,fieldId:change.id,review:change.review,expectedReview:change.expectedReview})
        });
        const data=await response.json();
        if(!response.ok || data.fieldId!==change.id || data.review!==change.review)
          throw new Error(data.error||'No se pudo guardar el estado de revisión.');
        if(generation!==reviewGeneration.current)return;
        setImportedFieldMap(prev=>prev.map(f=>f.id===change.id?{...f,review:change.review}:f));
      }
      if(generation===reviewGeneration.current)setReviewSaveStatus('saved');
    }catch(error){
      if(generation===reviewGeneration.current){
        setReviewSaveStatus('error');
        alert(error instanceof Error?error.message:'No se pudo guardar la revisión.');
      }
    }finally{
      reviewSaving.current=false;
      if(generation===reviewGeneration.current)setConfirmingFieldReview(false);
    }
  };
  useEffect(()=>{
    if(!selectedDigitalTemplateId || !importedFieldMap.length || reviewSaveStatus==='error')return;
    if(reviewSaveTimer.current)clearTimeout(reviewSaveTimer.current);
    reviewSaveTimer.current=setTimeout(()=>{void persistFieldReviews();},650);
    return ()=>{if(reviewSaveTimer.current)clearTimeout(reviewSaveTimer.current);};
  },[manualDescription,importedFieldMap,selectedDigitalTemplateId,confirmingFieldReview,reviewSaveStatus]);
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
  const [editFieldMap, setEditFieldMap] = useState<NonNullable<ProcessTemplate['fieldMap']>>([]);
  const [editReviewNotes, setEditReviewNotes] = useState<string[]>([]);
  const [editShowDocumentToAll, setEditShowDocumentToAll] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [sharedDocs, setSharedDocs] = useState<any[]>([]);
  const digitalTemplates=sharedDocs.filter(d=>
    (d.fileName||'').toLowerCase().endsWith('.txt') &&
    (/digitalizado/i.test(d.name||'') || /_digitalizado\.txt$/i.test(d.fileName||'') || d.sourceTemplateId)
  );


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

  const isSuperAdmin = currentUser.role === 'SUPERADMIN';
  const allowAdminManager = systemSettings?.allowAdminManagerTemplates !== false;
  const canManageTemplates = isSuperAdmin || (['ADMIN', 'MANAGER'].includes(currentUser.role) && allowAdminManager);

  // Display-only status: unresolved semantics are red; verified mappings remain yellow.
  const isUnidentifiedField = (actor:string,label:string) =>
    /^(dato por identificar|pendiente de identificar|sin significado identificado|dato sin identificar)$/i.test(label.trim()) ||
    /^(no determinado|por identificar)$/i.test(actor.trim());

  const fieldNeedsReview = (field?: NonNullable<ProcessTemplate['fieldMap']>[number]) =>
    !field || Boolean(field.review) ||
    /^(dato por identificar|pendiente de identificar|sin significado identificado|dato sin identificar)$/i.test((field.label || '').trim()) ||
    /^(no determinado|por identificar)$/i.test((field.actor || '').trim());

  // Sub-tabs inside expanded templates to view either flow or 100% digitized document

  const renderDocumentWithHighlights = (text: string, fieldMap: NonNullable<ProcessTemplate['fieldMap']> = []) => {
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
                className={`${fieldNeedsReview(fieldMap.find(f=>f.id===part)) ? "bg-red-100 text-red-900 border-red-400" : "bg-amber-100 text-amber-900 border-amber-300"} border rounded px-1.5 py-0.5 mx-0.5 font-mono text-[11px] font-bold shadow-2xs`}
              >
                {(() => { const info=fieldMap.find(f=>f.id===part); return info ? `[${info.actor} — ${info.label} (${part.slice(1,-1)})]` : part; })()}
              </span>
            );
          }
          return <span key={index}>{part}</span>;
        })}
      </div>
    );
  };

  // Renumber only machine markers, preserving their field identities and metadata.
  const updateDigitizedText = (nextText: string) => {
    const ordered = [...new Set(Array.from(nextText.matchAll(/\[CAMPO_\d+\*?\]/g), m => m[0]))];
    const renumbered = new Map(ordered.map((id, i) => [id, `[CAMPO_${i + 1}${id.endsWith('*]') ? '*' : ''}]`]));
    setEditOriginalDocumentContent(nextText.replace(/\[CAMPO_\d+\*?\]/g, id => renumbered.get(id) || id));
    setEditFieldMap(previous => ordered.map(id => {
      const prior = previous.find(f => f.id === id);
      return prior ? {...prior, id: renumbered.get(id)!} : {id:renumbered.get(id)!, label:'Pendiente de identificar', actor:'No determinado', source:'manual' as const, confidence:'low' as const, review:true};
    }));
  };

  const [inlineDrafts, setInlineDrafts] = useState<Record<string,string>>({});
  const liveDrafts = useRef<Record<string,string>>({});
  // Original marker identities survive visual renumbering until the save commits the new map.
  const inlineOrigins = useRef<Record<string,Record<string,string>>>({});
  const inlineLabels = useRef<Record<string,Record<string,{actor:string;label:string}>>>({});
  const captureInlineLabels = (root:HTMLElement, templateId:string) => {
    const labels:Record<string,{actor:string;label:string}>={};
    root.querySelectorAll<HTMLElement>('[data-marker]').forEach(element=>{
      const id=element.dataset.marker;
      const value=element.textContent||'';
      const match=value.match(/^\[([\s\S]*?)\s+—\s+([\s\S]*?)\s+\(CAMPO_\d+\*?\)\]$/);
      if(id && match)labels[id]={actor:match[1].trim(),label:match[2].trim()};
    });
    inlineLabels.current[templateId]=labels;
  };
  const inlineLabelDirty = (root:HTMLElement, tpl:ProcessTemplate) =>
    Array.from(root.querySelectorAll<HTMLElement>('[data-marker]')).some(element=>{
      const origin=element.dataset.origin||element.dataset.marker;
      const prior=(tpl.fieldMap||[]).find(f=>f.id===origin);
      const match=(element.textContent||'').match(/^\[([\s\S]*?)\s+—\s+([\s\S]*?)\s+\(CAMPO_\d+\*?\)\]$/);
      return !!match && (!prior || match[1].trim()!==prior.actor || match[2].trim()!==prior.label);
    });
  const [dirtyIds, setDirtyIds] = useState<Record<string,boolean>>({});
  const readEditor = (root:HTMLElement) => {
    const walk=(node:Node):string=>{
      if(node.nodeType===Node.TEXT_NODE)return node.textContent||'';
      if(node instanceof HTMLElement && node.dataset.marker)return node.dataset.marker;
      if(node.nodeName==='BR')return '\n';
      const children=Array.from(node.childNodes).map(walk).join('');
      return node!==root && (node.nodeName==='DIV'||node.nodeName==='P')?children+'\n':children;
    };
    return Array.from(root.childNodes).map(walk).join('').replace(/\n$/,'');
  };
  const [inlineSaving, setInlineSaving] = useState<string|null>(null);
  const saveInlineDocument = async (tpl: ProcessTemplate) => {
    const draft = liveDrafts.current[tpl.id] ?? inlineDrafts[tpl.id];
    if (draft === undefined || (!dirtyIds[tpl.id] && draft === (tpl.originalDocumentContent||''))) return;
    setInlineSaving(tpl.id);
    try {
      const ordered = [...new Set(Array.from(draft.matchAll(/\[CAMPO_\d+\*?\]/g), m => m[0]))];
      const renumbered = new Map(ordered.map((id,i)=>[id,`[CAMPO_${i+1}${id.endsWith('*]')?'*':''}]`]));
      const content = draft.replace(/\[CAMPO_\d+\*?\]/g,id=>renumbered.get(id)||id);
      const fieldMap = ordered.map(id=>{
        const originalId=inlineOrigins.current[tpl.id]?.[id]||id;
        const prior=(tpl.fieldMap||[]).find(f=>f.id===originalId);
        const edited=inlineLabels.current[tpl.id]?.[id];
         const corrected=edited && !isUnidentifiedField(edited.actor,edited.label) && (!prior || edited.actor!==prior.actor || edited.label!==prior.label);
         return prior ? {...prior,id:renumbered.get(id)!,...edited,...(corrected?{review:false}:{})} : {id:renumbered.get(id)!,...(edited||{label:'Pendiente de identificar',actor:'No determinado'}),source:'manual' as const,confidence:'low' as const,review:!corrected};
      });
      const response=await fetch(`/api/templates/${tpl.id}`,{
        method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...tpl,originalDocumentContent:content,fieldMap,currentUserId:currentUser.id})
      });
      if(!response.ok)throw new Error((await response.json()).error||'No se pudo guardar');
       // Update the visible badges immediately after a successful save.
       document.querySelectorAll<HTMLElement>('[data-marker]').forEach(element=>{
         const saved=fieldMap.find(f=>f.id===element.dataset.marker);
         if(!saved)return;
         element.classList.remove('bg-red-100','text-red-900','border-red-400','bg-amber-100','text-amber-900','border-amber-300');
         element.classList.add(...(fieldNeedsReview(saved)?['bg-red-100','text-red-900','border-red-400']:['bg-amber-100','text-amber-900','border-amber-300']));
       });
      delete liveDrafts.current[tpl.id];
      delete inlineOrigins.current[tpl.id];
      setInlineDrafts(prev=>{const next={...prev};delete next[tpl.id];return next;});
      setDirtyIds(prev=>({...prev,[tpl.id]:false}));
      showToast('Documento digitalizado guardado correctamente','success');
      if(loadState)await loadState();
    } catch(error:any){showToast(error?.message||'Error al guardar documento','error');}
    finally{setInlineSaving(null);}
  };

  // Recover pasted/edited descriptive placeholders as actual protected field badges.
  // Brackets alone are not enough: require the DocFlow CAMPO_N signature.
  const recoverInlineMarkers = (root:HTMLElement, tpl:ProcessTemplate) => {
    const pattern=/\[([^\]\n]*?)\s*\(CAMPO_(\d+)(\*)?\)\s*\]/g;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const nodes:Text[]=[];
    while(walker.nextNode()){
      const node=walker.currentNode as Text;
      if(node.parentElement?.closest('[data-marker]'))continue;
      if(pattern.test(node.textContent||''))nodes.push(node);
      pattern.lastIndex=0;
    }
    for(const node of nodes){
      const value=node.textContent||'';
      const fragment=document.createDocumentFragment();
      let last=0;
      for(const match of value.matchAll(pattern)){
        const index=match.index??0;
        if(index>last)fragment.appendChild(document.createTextNode(value.slice(last,index)));
        const id=`[CAMPO_${match[2]}${match[3]||''}]`;
        const prior=(tpl.fieldMap||[]).find(f=>f.id===id);
        const badge=document.createElement('span');
        badge.dataset.marker=id;
        badge.dataset.origin=id;
        badge.contentEditable='true';
        const needsReview=fieldNeedsReview(prior);
        badge.className=(needsReview?'bg-red-100 text-red-900 border-red-400':'bg-amber-100 text-amber-900 border-amber-300')+' border rounded px-1 py-0.5 mx-0.5 font-mono text-[11px] font-bold';
        badge.textContent=match[0];
        fragment.appendChild(badge);
        last=index+match[0].length;
      }
      if(last<value.length)fragment.appendChild(document.createTextNode(value.slice(last)));
      node.replaceWith(fragment);
    }
  };

  const normalizeInlineMarkers = (root:HTMLElement, templateId:string) => {
    const markers=Array.from(root.querySelectorAll<HTMLElement>('[data-marker]'));
    const origins:Record<string,string>={};
    markers.forEach((element,index)=>{
      const oldId=element.dataset.marker!;
      const origin=element.dataset.origin||inlineOrigins.current[templateId]?.[oldId]||oldId;
      const nextId=`[CAMPO_${index+1}${oldId.endsWith('*]')?'*':''}]`;
      origins[nextId]=origin;
      element.dataset.origin=origin;
      element.dataset.marker=nextId;
      // Preserve the confirmed actor/meaning in the visible badge.
      element.textContent=(element.textContent||oldId).replace(/CAMPO_\d+\*?(?=\)\]$)/,nextId.slice(1,-1));
    });
    inlineOrigins.current[templateId]=origins;
  };

  const renderInlineEditable = (tpl:ProcessTemplate) => {
    const content=inlineDrafts[tpl.id]??tpl.originalDocumentContent??'';
    const pieces=content.split(/(\[CAMPO_\d+\*?\])/g);
    return <div
      key={tpl.id}
      contentEditable={canManageTemplates && inlineSaving!==tpl.id}
      suppressContentEditableWarning
      spellCheck={false}
      role="textbox"
      aria-label="Documento digitalizado editable"
      aria-multiline="true"
      onInput={e=>{
        if(!canManageTemplates)return;
        // Preserve caret and editable field descriptions while typing.
        const next=readEditor(e.currentTarget);
        liveDrafts.current[tpl.id]=next;
        const dirty=next!==(tpl.originalDocumentContent||'') || inlineLabelDirty(e.currentTarget,tpl);
        setDirtyIds(prev=>prev[tpl.id]===dirty?prev:{...prev,[tpl.id]:dirty});
      }}
      onBlur={e=>{
        if(!canManageTemplates)return;
        recoverInlineMarkers(e.currentTarget,tpl);
        normalizeInlineMarkers(e.currentTarget,tpl.id);
        captureInlineLabels(e.currentTarget,tpl.id);
        const next=readEditor(e.currentTarget);
        liveDrafts.current[tpl.id]=next;
        if(next!==content)setInlineDrafts(prev=>({...prev,[tpl.id]:next}));
        setDirtyIds(prev=>({...prev,[tpl.id]:next!==(tpl.originalDocumentContent||'') || inlineLabelDirty(e.currentTarget,tpl)}));
      }}
      className="whitespace-pre-wrap leading-relaxed text-slate-800 font-serif text-xs md:text-sm min-h-32 outline-none rounded"
    >{pieces.map((part,i)=>{
      const info=(tpl.fieldMap||[]).find(f=>f.id===(inlineOrigins.current[tpl.id]?.[part]||part));
      return /^\[CAMPO_\d+\*?\]$/.test(part)
        ? <span key={i} data-marker={part} data-origin={inlineOrigins.current[tpl.id]?.[part]||part} contentEditable={true} className={`${fieldNeedsReview(info) ? "bg-red-100 text-red-900 border-red-400" : "bg-amber-100 text-amber-900 border-amber-300"} border rounded px-1 py-0.5 mx-0.5 font-mono text-[11px] font-bold`}>{info?`[${info.actor} — ${info.label} (${part.slice(1,-1)})]`:part}</span>
        : <React.Fragment key={i}>{part}</React.Fragment>;
    })}</div>;
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
          // Reference the published document instead of copying its contents.
          sharedDocumentId: selectedDigitalTemplateId || undefined,
          originalDocumentContent: '',
          fieldMap: [],
          showDocumentToAll: false,
          sharedViewMode: 'flow',
          currentUserId: currentUser.id
        })
      });

      const data = await response.json();
      if (response.ok && data.id) {
        alert(`¡Plantilla de proceso "${data.name}" creada correctamente!`);
        setShowProcessModal(false);
        setManualName('');
        setSelectedDigitalTemplateId('');
        setImportedFieldMap([]);
        setSelectedDocumentContent('');
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
    setEditDescription(/\(CAMPO_\d+\)/.test(tpl.description) ? 'Gestionar las etapas, los responsables y los requisitos para confeccionar el contrato de locación utilizando la hoja guía digitalizada.' : tpl.description);
    setEditIndustry(tpl.industry);
    setEditStages(JSON.parse(JSON.stringify(tpl.stages))); // Deep copy
    setEditOriginalDocumentContent(tpl.originalDocumentContent || '');
    setEditFieldMap(tpl.fieldMap || []);
    setEditReviewNotes(tpl.digitizationReviewNotes || []);
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
        fieldMap: editMode === 'digital_doc' ? editFieldMap : (editingTemplate.fieldMap || []),
        digitizationReviewNotes: editMode === 'digital_doc' ? editReviewNotes : (editingTemplate.digitizationReviewNotes || []),
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
    if (!approvingTemplate || isPublishing) return;
    setIsPublishing(true);
    try {
      const tpl = approvingTemplate;
      const unicodeToBase64 = (str: string) => {
        return btoa(unescape(encodeURIComponent(str)));
      };
      
      const originalContent = tpl.originalDocumentContent || '';
      const map = tpl.fieldMap || [];
      const publishedContent = originalContent.replace(/\[CAMPO_\d+\*?\]/g, marker => {
        const field = map.find(f => f.id === marker);
        return field ? `[${field.actor} — ${field.label} (${marker.slice(1,-1)})]` : marker;
      });
      const fileBase64 = `data:text/plain;base64,${unicodeToBase64(publishedContent)}`;
      const fileName = `${tpl.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_digitalizado.txt`;

      const response = await fetch('/api/shared-documents', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${tpl.name} (Digitalizado)`,
          fileName,
          fileSize: publishedContent.length,
          fileBase64,
          digitizationSource: originalContent,
          digitizationFieldMap: map,
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
    } finally {
      setIsPublishing(false);
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
                resetProcessForm();
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
          const isDigitalDoc = !!tpl.originalDocumentContent && tpl.originalDocumentContent.trim() !== '';
          return (
            <div key={tpl.id} className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden transition-all duration-200">
              {/* Summary Block */}
              <div 
                onClick={() => handleStartEdit(tpl, 'stages')}
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
                    <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xl">{isDigitalDoc ? (tpl.digitizationReviewNotes?.length ? "Documento digitalizado · Revisar mapa de campos" : "Documento digitalizado · Mapa de campos disponible en el detalle") : (/\(CAMPO_\d+\)/.test(tpl.description) ? 'Gestionar las etapas, los responsables y los requisitos para confeccionar el contrato de locación utilizando la hoja guía digitalizada.' : tpl.description)}</p>
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
                    onClick={() => handleStartEdit(tpl, 'stages')}
                    className="p-1.5 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                  >
                    <Layers className="w-5 h-5 text-slate-400" />
                  </button>
                </div>
              </div>

            </div>
          );
        })}
      </div>

      {/* SUPERADMIN TEMPLATE EDITOR MODAL */}
      {editingTemplate && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl h-[90vh] min-h-0 flex flex-col overflow-hidden">
            {/* Header */}
            <div className={`p-5 border-b border-slate-100 flex items-center justify-between ${
              editMode === 'stages' ? 'bg-[#252452] text-[#f8fafc]' : 'bg-[#49371d] text-[#f8fafc]'
            }`}>
              <div className="flex items-center gap-2">
                {editMode === 'stages' ? (
                  <Layers className="w-5 h-5 text-indigo-700" />
                ) : (
                  <Edit className="w-5 h-5 text-amber-700" />
                )}
                <div>
                  <h4 className="text-sm font-bold text-white">
                    {editMode === 'stages' ? 'Configurar Etapas del Proceso' : 'Editar Plantilla Digital'}
                  </h4>
                  <p className={`text-[11px] ${editMode === 'stages' ? 'text-[#dbe4ff]' : 'text-[#fde68a]'}`}>
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
                  editMode === 'stages' ? 'text-white hover:text-indigo-200' : 'text-white hover:text-amber-200'
                }`}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
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
                    onChange={(e) => updateDigitizedText(e.target.value)}
                    placeholder="Aquí se encuentra el texto digitalizado original completo. Los campos entre corchetes [Variables] se autocompletarán de forma automática..."
                    className="w-full h-40 p-3 text-xs font-mono bg-white border border-amber-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 leading-relaxed resize-y"
                  />
                  <div className="rounded-xl border border-amber-200 bg-white p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h6 className="font-bold text-sm text-slate-800">Mapa inteligente de campos</h6>
                      <span className="text-xs text-slate-500">{[...new Set([...editOriginalDocumentContent.matchAll(/\[CAMPO_\d+\*?\]/g)].map(m=>m[0]))].length} campos en el documento</span>
                    </div>
                    <p className="text-xs text-slate-600">Confirmá qué dato solicita cada campo y a qué actor corresponde. Los cambios se guardan junto a la plantilla.</p>
                    {editReviewNotes.length>0 && <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
                      <strong>Observaciones de digitalización:</strong>
                      {editReviewNotes.map((note,i)=><p key={i} className="mt-1">{note}</p>)}
                    </div>}
                    <div className="max-h-72 overflow-y-auto space-y-2">
                      {[...new Set([...editOriginalDocumentContent.matchAll(/\[CAMPO_\d+\*?\]/g)].map(m=>m[0]))].map(id=>{
                        const f=editFieldMap.find(x=>x.id===id);
                        const change=(key:'label'|'actor'|'review',value:string|boolean)=>{
                          setEditFieldMap(prev=>{
                            const fallback={id,label:'',actor:'No determinado',source:'manual' as const,confidence:'low' as const,review:true};
                            const next=prev.filter(x=>x.id!==id);
                            return [...next,{...fallback,...f,[key]:value}];
                          });
                        };
                        return <div key={id} className="grid grid-cols-1 md:grid-cols-[110px_1fr_1fr_auto] items-center gap-2 border border-slate-200 rounded-lg p-2">
                          <code className="text-xs text-indigo-700 font-bold">{id}</code>
                          <input aria-label={`Significado de ${id}`} placeholder="Dato solicitado (ej. DNI)" value={f?.label||''} onChange={e=>change('label',e.target.value)} className="border border-slate-200 rounded-md p-2 text-xs"/>
                          <input aria-label={`Actor de ${id}`} placeholder="Actor (ej. Locador 1)" value={f?.actor||''} onChange={e=>change('actor',e.target.value)} className="border border-slate-200 rounded-md p-2 text-xs"/>
                          <label className="flex gap-1 items-center text-xs text-amber-800"><input type="checkbox" checked={f?.review!==false} onChange={e=>change('review',e.target.checked)}/> Revisar</label>
                        </div>;
                      })}
                    </div>
                  </div>
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
                        <div className="flex flex-1 min-w-0 items-center gap-2 mr-3">
                          <span className="w-5 h-5 rounded-full bg-slate-800 text-white font-mono font-bold text-[10px] flex items-center justify-center">
                            {sIdx + 1}
                          </span>
                          <input
                            type="text"
                            required
                            placeholder="Nombre de la etapa"
                            value={stg.name}
                            onChange={(e) => handleStageFieldChange(sIdx, 'name', e.target.value)}
                            className="flex-1 min-w-0 w-full text-sm font-bold text-slate-800 border-b border-transparent hover:border-slate-300 focus:border-indigo-500 bg-transparent py-1 px-2 focus:outline-none"
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
                      <p className="font-bold">Digitalización al 100% con IA...</p>
                      <p className="opacity-80">Reconociendo y convirtiendo datos en campos completables.</p>
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
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-indigo-50 flex items-center justify-between">
              <h4 className="text-sm font-bold text-indigo-900">Crear proceso operativo</h4>
              <button type="button" onClick={() => setShowProcessModal(false)} aria-label="Cerrar" className="p-1 text-indigo-700"><X className="w-5 h-5"/></button>
            </div>
            <form id="new-process-form" onSubmit={handleCreateManualTemplate} className="overflow-y-auto p-5 space-y-4">
              <p className="text-xs text-slate-600">Definí qué deberán presentar los asesores al iniciar un legajo. Cada requisito debe ir en una línea. Podrás revisar y modificar las obligaciones y las etapas después de guardar.</p>
              <label className="block text-xs font-bold text-slate-700">Plantilla digitalizada asociada
                <select value={selectedDigitalTemplateId} onChange={e=>void importDigitalFields(e.target.value)}
                  className="mt-1 w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                  <option value="">Sin plantilla (ingresar requisitos manualmente)</option>
                  {digitalTemplates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <span className="block mt-1 text-[11px] font-normal text-slate-500">Al seleccionar una plantilla se interpretan sus campos amarillos y se generan requisitos editables en Descripción / Objetivo. Revisá los marcados [REVISAR].</span>
                {importingFields && <span className="text-xs text-indigo-600">Analizando campos de la plantilla...</span>}
                {!!importedFieldMap.length && <span className="text-xs text-emerald-700">· {importedFieldMap.length} campos importados · {countVisibleReviews()} para revisar{reviewSaveStatus==='saving' && <span className="text-indigo-600"> · Guardando...</span>}{reviewSaveStatus==='saved' && <span className="text-emerald-700"> · Cambios guardados</span>}{reviewSaveStatus==='error' && <span className="text-red-700"> · Error al guardar</span>}</span>}
              </label>
              <label className="block text-xs font-bold text-slate-700">Nombre del Proceso *
                <input required value={manualName} onChange={e => setManualName(e.target.value)} placeholder="Ej.: Reserva de contrato de locación" className="mt-1 w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"/>
              </label>
              <label className="block text-xs font-bold text-slate-700">Descripción / Objetivo *
                <textarea required rows={9} value={manualDescription} onChange={e => updateProcessDescription(e.target.value)} onBlur={() => void persistFieldReviews()} onScroll={e => setDescriptionScrollTop(e.currentTarget.scrollTop)} spellCheck={false} wrap="off" className="mt-1 w-full p-2.5 bg-slate-50 text-slate-900 caret-slate-900 border border-slate-200 rounded-lg text-sm leading-normal font-normal resize-y font-mono" style={{minWidth:0,...reviewHighlightStyle}} />
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
            {isPublishing && <p role="status" aria-live="polite" className="text-xs text-emerald-700 animate-pulse">Guardando documento y mapa de campos…</p>}
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
                disabled={isPublishing}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={executeApproveAndPublish}
                disabled={approveRoles.length === 0 || isPublishing}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                {isPublishing ? 'Publicando documento…' : 'Aprobar y publicar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
