import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bot, CheckCircle2, Copy, Download, FilePenLine, FileText, Loader2, Plus, Printer, Save, Search, Send, Sparkles, Trash2, X } from 'lucide-react';
import type { Case, ProcessTemplate, User } from '../types';

type Confeccion = { id:string; case_id:string; template_id:string; title:string; content:string; status:'draft'|'closed'; last_field_number:number; case_code:string; case_title:string; updated_at:string };
type ChatLine = { from:'agent'|'user'; text:string };
type Proposal = {field:string;value:string;source?:string};
type Props = { cases:Case[]; templates:ProcessTemplate[]; currentUser:User };
const marker = /\[CAMPO_(\d+)(\*)?\]/g;
async function request(url:string, init?:RequestInit) {
  const response = await fetch(url, {credentials:'include', ...init, headers: { 'Content-Type':'application/json', ...init?.headers }});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.');
  return data;
}
const maxMarker = (value:string) => Math.max(0, ...Array.from(value.matchAll(marker), m => Number(m[1])));
const exportText = (name:string, content:string) => {
  const blob = new Blob([content], {type:'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=name.replace(/[^a-z0-9áéíóúñ_-]+/gi,'_')+'.txt'; a.click();
  URL.revokeObjectURL(url);
};
export default function Confecciones({cases,templates,currentUser}:Props) {
  const [items,setItems] = useState<Confeccion[]>([]);
  const [selected,setSelected] = useState<Confeccion|null>(null);
  const [content,setContent] = useState('');
  const [lastUsed,setLastUsed] = useState(0);
  const [busy,setBusy] = useState(false);
  const [saving,setSaving] = useState(false);
  const [dirty,setDirty] = useState(false);
  const [notice,setNotice] = useState('');
  const [search,setSearch] = useState('');
  const [caseId,setCaseId] = useState('');
  const [templateId,setTemplateId] = useState('');
  const [showCreate,setShowCreate] = useState(false);
  const [instruction,setInstruction] = useState('');
  const [proposals,setProposals] = useState<Proposal[]>([]);
  const [proposalSnapshot,setProposalSnapshot] = useState('');
  const [chat,setChat] = useState<ChatLine[]>([{from:'agent',text:'Estoy listo para ayudarte. Puedo completar campos usando los datos del legajo y preguntarte cuando falte información.'}]);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef(content);
  const selectedRef = useRef(selected);
  const savedRef = useRef(content);
  const saveSequence = useRef(0);
  useEffect(() => { contentRef.current=content; },[content]);
  useEffect(() => { selectedRef.current=selected; },[selected]);
  const refresh = async () => { try {setItems(await request('/api/confecciones'));} catch(e:any){setNotice(e.message);} };
  useEffect(() => { void refresh(); },[]);
  const finalized = cases.filter(c=>c.status==='completed' && (currentUser.role!=='MANAGER'||c.assignedManagerId===currentUser.id));
  const availableTemplates = templates.filter(t=>Boolean(t.originalDocumentContent?.trim()));
  const filtered = items.filter(i=>(i.title+' '+i.case_code).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const next = Math.max(lastUsed,maxMarker(content))+1;
  const save = async (value=contentRef.current) => {
    const item=selectedRef.current;
    if (!item || item.status!=='draft' || value===savedRef.current) return;
    const seq=++saveSequence.current;
    setSaving(true);
    try {
      const response=await request('/api/confecciones/'+item.id,{method:'PUT',body:JSON.stringify({content:value})});
      savedRef.current=value;
      setLastUsed(n=>Math.max(n,response.lastFieldNumber));
      if (seq===saveSequence.current) setDirty(contentRef.current!==value);
    } finally { if (seq===saveSequence.current) setSaving(false); }
  };
  useEffect(() => {
    if (!selected || selected.status!=='draft' || !dirty) return;
    const t=setTimeout(()=>{void save().catch((e:any)=>setNotice('No se pudo guardar: '+e.message));},1200);
    return ()=>clearTimeout(t);
  },[content,selected?.id,dirty]);
  const open = (item:Confeccion) => {
    setSelected(item); selectedRef.current=item; setContent(item.content); contentRef.current=item.content; savedRef.current=item.content;
    setProposals([]);setProposalSnapshot('');
    setLastUsed(item.last_field_number); setDirty(false); setNotice(''); setChat([{from:'agent',text:'Plantilla cargada. Indicame qué datos querés completar o consultame sobre un campo.'}]);
  };
  const changeContent = (value:string) => {
    // New manual fields are normalized on completion; existing original markers remain untouched.
    const original=templates.find(t=>t.id===selected?.template_id)?.originalDocumentContent || '';
    const originals=new Set(Array.from(original.matchAll(marker),m=>m[0]));
    const existing=new Set(Array.from(contentRef.current.matchAll(marker),m=>m[0]));
    const normalized=value.replace(/\[CAMPO_(\d+)\](?=\s|$|[.,;:])/g,(token,num) =>
      originals.has(token)||existing.has(token) ? token : '[CAMPO_'+num+'*]');
    setProposals([]);setProposalSnapshot('');
    setContent(normalized);contentRef.current=normalized;setDirty(true);
  };
  const create = async () => {
    if(!caseId||!templateId)return;
    setBusy(true);setNotice('');
    try {
      const result=await request('/api/confecciones',{method:'POST',body:JSON.stringify({caseId,templateId})});
      const rows:Confeccion[]=await request('/api/confecciones');setItems(rows);
      const item=rows.find(x=>x.id===result.id);if(item)open(item);
      setShowCreate(false);
    }catch(e:any){setNotice(e.message);}finally{setBusy(false);}
  };
  const remove = async (item:Confeccion) => {
    if (!window.confirm('¿Eliminar definitivamente esta confección? Se borrará todo el documento, incluso si está finalizado. Esta acción no se puede deshacer.')) return;
    setBusy(true);setNotice('');
    try {
      await request('/api/confecciones/'+encodeURIComponent(item.id),{method:'DELETE'});
      if(selectedRef.current?.id===item.id) {selectedRef.current=null;setSelected(null);setDirty(false);}
      setItems(prev=>prev.filter(x=>x.id!==item.id));
      await refresh();
    } catch(e:any) {setNotice('No se pudo eliminar: '+e.message);}
    finally {setBusy(false);}
  };
  const send = async () => {
    const message=instruction.trim();if(!message||!selected||busy)return;
    setInstruction('');setChat(c=>[...c,{from:'user',text:message}]);setBusy(true);setNotice('');
    try {
      await save();
      const snapshot=contentRef.current;
      const data=await request('/api/confecciones/'+selected.id+'/agent',{method:'POST',body:JSON.stringify({instruction:message,content:snapshot})});
      if (contentRef.current!==snapshot) {setChat(c=>[...c,{from:'agent',text:'El documento cambió mientras analizaba. No apliqué reemplazos para proteger tus modificaciones. Volvé a pedírmelo.'}]);return;}
      const pending:Proposal[] = Array.isArray(data.replacements) ? data.replacements.filter((p:Proposal)=>typeof p.field==='string' && typeof p.value==='string' && snapshot.includes(p.field)) : [];
      setProposalSnapshot(snapshot);
      setProposals(pending);
      setChat(c=>[...c,{from:'agent',text:String(data.reply||'')+(pending.length?' · Revisá '+pending.length+' propuesta(s) antes de aplicarlas.':'')}]);
    }catch(e:any){setChat(c=>[...c,{from:'agent',text:'No pude completar la solicitud: '+e.message}]);}finally{setBusy(false);}
  };
  const applyProposals = () => {
    if (contentRef.current!==proposalSnapshot) {setNotice('El documento cambió. Pedile nuevas propuestas al agente para no sobrescribir tus correcciones.');setProposals([]);return;}
    let updated=proposalSnapshot;
    let count=0;
    for(const p of proposals) {
      if(!updated.includes(p.field))continue;
      updated=updated.replace(p.field,p.value);
      count++;
    }
    setProposals([]);setProposalSnapshot('');
    if(count) {changeContent(updated);setChat(c=>[...c,{from:'agent',text:count+' campo(s) aplicados. Revisá el documento y guardalo.'}]);}
  };
  const close = async () => {
    if(!selected || !window.confirm('¿Finalizar esta confección? El documento quedará bloqueado para edición.'))return;
    setBusy(true);try {await save();await request('/api/confecciones/'+selected.id+'/close',{method:'POST'});setSelected(null);await refresh();}
    catch(e:any){setNotice(e.message);}finally{setBusy(false);}
  };
  const goBack = async () => {try{await save();setSelected(null);await refresh();}catch(e:any){setNotice(e.message);}};
  const print = () => {
    const win=window.open('','_blank');
    if(!win){setNotice('El navegador bloqueó la ventana de impresión.');return;}
    const safe=(contentRef.current||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    win.document.write('<!doctype html><html><head><title>Confección</title><style>body{font:14px Georgia,serif;white-space:pre-wrap;margin:45px;line-height:1.5}</style></head><body>'+safe+'</body></html>');
    win.document.close();win.focus();win.print();
  };
  if(selected) return (
    <div className="space-y-5 min-w-0">
      <div className="flex flex-wrap justify-between items-start gap-3">
        <div><button onClick={()=>void goBack()} className="flex items-center gap-2 text-sm text-indigo-500 font-semibold mb-3"><ArrowLeft size={16}/> Archivo de Confecciones</button>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">{selected.title}</h1>
          <p className="text-sm text-slate-500 mt-1">{selected.case_code} · {selected.status==='closed'?'Finalizada':'En confección'} · {saving?'Guardando...':dirty?'Cambios pendientes':'Guardado'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={()=>void remove(selected)} disabled={busy} className="px-3 py-2 rounded-lg border border-red-400 text-red-500 flex gap-2 items-center text-sm disabled:opacity-50"><Trash2 size={16}/> Eliminar</button>
          <button onClick={print} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 flex gap-2 items-center text-sm dark:text-white"><Printer size={16}/> Imprimir / PDF</button>
          <button onClick={()=>exportText(selected.title,content)} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 flex gap-2 items-center text-sm dark:text-white"><Download size={16}/> Exportar TXT</button>
          {selected.status==='draft'&&<><button onClick={()=>void save().catch((e:any)=>setNotice(e.message))} className="px-3 py-2 rounded-lg bg-indigo-600 text-white flex gap-2 items-center text-sm"><Save size={16}/> Guardar</button>
          <button onClick={()=>void close()} disabled={busy} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm flex gap-2 items-center"><CheckCircle2 size={16}/> Finalizar</button></>}
        </div>
      </div>
      {notice&&<p role="alert" className="text-amber-500 text-sm">{notice}</p>}
      <div className="flex flex-wrap gap-3 items-center rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
        <span className="text-sm text-slate-500">Último usado: <strong className="text-slate-900 dark:text-white">[CAMPO_{lastUsed||maxMarker(content)}{lastUsed && !content.includes('[CAMPO_'+lastUsed+']')?'*':''}]</strong></span>
        <span className="text-sm text-slate-500">Próximo a usar: <strong className="text-indigo-500">[CAMPO_{next}*]</strong></span>
        {selected.status==='draft'&&<button onClick={()=>navigator.clipboard.writeText('[CAMPO_'+next+'*]')} className="flex gap-1 items-center text-xs text-indigo-500 font-semibold"><Copy size={14}/> Copiar campo</button>}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
        <section className="min-w-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex gap-2 items-center text-slate-800 dark:text-white font-bold"><FileText size={18}/> Plantilla interactiva <span className="ml-auto text-xs font-normal text-slate-500">Edición directa · Guardado automático</span></div>
          <textarea ref={editorRef} spellCheck={false} aria-label="Documento editable" readOnly={selected.status==='closed'} value={content} onChange={e=>changeContent(e.target.value)} className="w-full min-h-[68vh] resize-y p-6 md:p-9 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 leading-7 text-sm font-serif outline-none" />
        </section>
        <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden xl:sticky xl:top-4">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 font-bold dark:text-white"><Bot size={19} className="text-indigo-500"/> Agente de confección <Sparkles size={15} className="text-amber-500 ml-auto"/></div>
          <div className="p-4 h-[420px] overflow-y-auto flex flex-col gap-3">
            {chat.map((line,i)=><div key={i} className={'rounded-xl p-3 text-sm whitespace-pre-wrap '+(line.from==='user'?'bg-indigo-600 text-white ml-5':'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-white mr-5')}>{line.text}</div>)}
            {busy&&<div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="animate-spin" size={15}/> Analizando...</div>}
          </div>
          {selected.status==='draft'&&proposals.length>0&&<div className="border-t border-amber-300 bg-amber-50 dark:bg-slate-900 p-3 space-y-2">
            <p className="text-xs font-bold text-amber-900 dark:text-amber-300">Propuestas del agente · confirmar antes de escribir</p>
            <div className="max-h-44 overflow-y-auto space-y-1">{proposals.map((p,i)=><div key={i} className="flex gap-2 items-start text-xs dark:text-white"><code className="shrink-0">{p.field}</code><span className="break-words flex-1">{p.value}</span><button aria-label={'Descartar '+p.field} title="Descartar propuesta" onClick={()=>setProposals(prev=>prev.filter((_,j)=>j!==i))} className="text-red-600"><X size={14}/></button></div>)}</div>
            <div className="flex gap-2"><button onClick={applyProposals} className="bg-emerald-600 text-white rounded-lg px-3 py-2 text-xs font-semibold">Aplicar propuestas</button><button onClick={()=>setProposals([])} className="border border-slate-300 rounded-lg px-3 py-2 text-xs dark:text-white">Descartar todas</button></div>
          </div>}
          {selected.status==='draft'&&<form onSubmit={e=>{e.preventDefault();void send();}} className="border-t border-slate-200 dark:border-slate-700 p-3 flex gap-2">
            <textarea aria-label="Mensaje al agente" value={instruction} onChange={e=>setInstruction(e.target.value)} placeholder="Pedile que complete campos o consultale datos faltantes..." rows={3} className="min-w-0 flex-1 bg-slate-50 dark:bg-slate-900 dark:text-white rounded-lg p-3 text-sm resize-none outline-none"/>
            <button type="submit" disabled={busy||!instruction.trim()} aria-label="Enviar al agente" className="self-end bg-indigo-600 text-white rounded-lg p-3 disabled:opacity-40"><Send size={17}/></button>
          </form>}
        </section>
      </div>
    </div>
  );
  return <div className="space-y-6">
    <div className="flex flex-wrap justify-between gap-3 items-start"><div><h1 className="text-2xl font-black text-slate-900 dark:text-white">Archivo de Confecciones</h1><p className="text-sm text-slate-500 mt-1">Prepará documentos con IA a partir de legajos finalizados.</p></div>
      <button onClick={()=>setShowCreate(v=>!v)} className="bg-indigo-600 text-white px-5 py-3 rounded-xl font-bold text-sm flex items-center gap-2"><Plus size={18}/> Nueva confección</button></div>
    {notice&&<p role="alert" className="text-amber-500 text-sm">{notice}</p>}
    {showCreate&&<div className="bg-white dark:bg-slate-800 border border-indigo-300 dark:border-indigo-700 rounded-2xl p-5 space-y-4">
      <div className="flex justify-between items-center"><h2 className="font-bold dark:text-white">Nueva confección</h2><button onClick={()=>setShowCreate(false)}><X size={18}/></button></div>
      <div className="grid md:grid-cols-2 gap-4">
        <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">Legajo finalizado<select value={caseId} onChange={e=>setCaseId(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white p-3"><option value="">Seleccionar legajo...</option>{finalized.map(c=><option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">Plantilla digitalizada<select value={templateId} onChange={e=>setTemplateId(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white p-3"><option value="">Seleccionar plantilla...</option>{availableTemplates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      </div><button disabled={busy||!caseId||!templateId} onClick={()=>void create()} className="px-5 py-3 rounded-lg bg-indigo-600 text-white font-bold text-sm disabled:opacity-40">Crear y abrir editor</button>
    </div>}
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 space-y-4">
      <label className="flex gap-3 items-center rounded-xl border border-slate-300 dark:border-slate-600 px-4 py-3"><Search size={18} className="text-slate-500"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por código, legajo o documento..." className="bg-transparent outline-none flex-1 min-w-0 dark:text-white text-sm"/></label>
      <div className="flex gap-4 text-xs font-semibold text-slate-500"><span>Todas ({items.length})</span><span>En confección ({items.filter(i=>i.status==='draft').length})</span><span>Finalizadas ({items.filter(i=>i.status==='closed').length})</span></div>
    </div>
    {filtered.length===0?<div className="border border-dashed border-slate-300 dark:border-slate-600 rounded-2xl p-12 text-center text-slate-500"><FilePenLine size={34} className="mx-auto mb-3 text-indigo-500"/><p className="font-semibold">Todavía no hay confecciones para mostrar.</p><p className="text-sm mt-2">Seleccioná «Nueva confección» para comenzar.</p></div>:
    <div className="space-y-3">{filtered.map(i=><div key={i.id} className="relative"><button onClick={()=>open(i)} className="w-full text-left bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 flex flex-wrap justify-between gap-3 hover:border-indigo-500 transition-colors"><div className="flex gap-3 items-start"><FilePenLine className="text-indigo-500 mt-1"/><div><div className="font-bold text-slate-900 dark:text-white">{i.title}</div><div className="text-xs text-slate-500 mt-2">{i.case_code} · {new Date(i.updated_at).toLocaleString('es-AR')}</div></div></div><span className={'rounded-full px-3 py-1 text-xs font-bold h-fit '+(i.status==='closed'?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-800')}>{i.status==='closed'?'Finalizada':'En confección'}</span></button><button onClick={()=>void remove(i)} disabled={busy} aria-label={'Eliminar '+i.title} title="Eliminar definitivamente" className="absolute right-4 bottom-3 p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-40"><Trash2 size={17}/></button></div>)}</div>}
  </div>;
}
