import type { Hono } from 'hono';
import type { Env, AppVariables } from './types';
import { createAudit, getCaseById, getAllDocuments, findTemplateOrVirtualById } from './db';
import { extractTextFromDocx, extractTextFromPdf, guessMimeType } from './document-parser';

type WorkerApp = Hono<{ Bindings: Env; Variables: AppVariables }>;

/** Independent Confecciones lifecycle, chat and AI agent routes. */
export function registerConfeccionesRoutes(app: WorkerApp) {
/** Confecciones: persistent, independent copies of finalized case templates. */
async function ensureConfecciones(db: Env['DB']) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS confecciones (
    id TEXT PRIMARY KEY, case_id TEXT NOT NULL, template_id TEXT NOT NULL,
    title TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
    last_field_number INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS confeccion_chat (
    id TEXT PRIMARY KEY, confeccion_id TEXT NOT NULL, sender TEXT NOT NULL,
    message TEXT NOT NULL, created_at TEXT NOT NULL
  )`).run();
}
const confeccionesRoles = ['SUPERADMIN', 'ADMIN', 'MANAGER'];
app.get('/api/confecciones', async (c) => {
  const auth = c.get('auth')!;
  if (!confeccionesRoles.includes(auth.user.role)) return c.json({ error: 'No autorizado.' }, 403);
  await ensureConfecciones(c.env.DB);
  const rows = await c.env.DB.prepare(`SELECT f.*, cs.code AS case_code, cs.title AS case_title
    FROM confecciones f JOIN cases cs ON cs.id = f.case_id WHERE (? != 'MANAGER' OR cs.assigned_manager_id = ?) ORDER BY f.updated_at DESC`).bind(auth.user.role, auth.user.id).all();
  return c.json(rows.results || []);
});
app.get('/api/confecciones/:id/chat', async (c) => {
  const auth=c.get('auth')!;
  if (!confeccionesRoles.includes(auth.user.role)) return c.json({error:'No autorizado.'},403);
  await ensureConfecciones(c.env.DB);
  const row=await c.env.DB.prepare('SELECT case_id FROM confecciones WHERE id = ?').bind(c.req.param('id')).first<{case_id:string}>();
  if (!row) return c.json({error:'Confección inexistente.'},404);
  const caseObj=await getCaseById(c.env.DB,row.case_id);
  if (!caseObj || (auth.user.role==='MANAGER' && caseObj.assignedManagerId!==auth.user.id)) return c.json({error:'No autorizado.'},403);
  const rows=await c.env.DB.prepare('SELECT sender, message FROM confeccion_chat WHERE confeccion_id = ? ORDER BY created_at DESC, id DESC LIMIT 80')
    .bind(c.req.param('id')).all<{sender:string;message:string}>();
  return c.json((rows.results||[]).reverse().map(x=>({from:x.sender,text:x.message})));
});
app.post('/api/confecciones', async (c) => {
  const auth = c.get('auth')!;
  if (!confeccionesRoles.includes(auth.user.role)) return c.json({ error: 'No autorizado.' }, 403);
  const { caseId, templateId } = await c.req.json();
  const caseObj = await getCaseById(c.env.DB, String(caseId || ''));
  if (!caseObj || caseObj.status !== 'completed') return c.json({ error: 'Seleccioná un legajo finalizado.' }, 400);
  if (auth.user.role === 'MANAGER' && caseObj.assignedManagerId !== auth.user.id) return c.json({ error: 'Legajo fuera de tu responsabilidad.' }, 403);
  const template = await findTemplateOrVirtualById(c.env, String(templateId || ''));
  if (!template?.originalDocumentContent?.trim()) return c.json({ error: 'La plantilla no tiene contenido digitalizado.' }, 400);
  // Fill only unambiguous structured attributes whose marker meanings were
  // explicitly saved on this exact digitized template. Never use AI guesses.
  const originalContent = template.originalDocumentContent;
  const participants = Array.isArray(caseObj.participants) ? caseObj.participants as any[] : [];
  const normalized = (v:string) => v.toLocaleLowerCase('es-AR').normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
  const roleFor = (v:string):string => {
    const x=normalized(v);
    if(/conyuge|espos/.test(x))return 'spouse';
    if(/locatario|inquilino/.test(x))return 'locatario';
    if(/locador|propietario/.test(x))return 'locador';
    if(/garante|fiador/.test(x))return 'garante';
    return '';
  };
  const keysFor = (v:string):string[] => {
    const x=normalized(v);
    if(x==='dni'||x.includes('documentodeidentidad'))return ['dni','documentNumber','document_number'];
    if(/mail|email|correo/.test(x))return ['email','mail'];
    if(/fechadenacimiento|nacimiento/.test(x))return ['birthDate','birth_date','dateOfBirth','fechaNacimiento'];
    if(/estadocivil/.test(x))return ['maritalStatus','marital_status','estadoCivil'];
    if(/domicilioactual|direccion/.test(x))return ['address','domicilio','domicilioActual'];
    if(/nombreyapellido|nombrecompleto/.test(x))return ['fullName','name','nombreCompleto'];
    return [];
  };
  let content=originalContent;
  for(const field of template.fieldMap||[]){
    if(field.review || !field.label || !field.actor)continue;
    const kind=roleFor(String(field.actor));
    const keys=keysFor(String(field.label));
    if(!kind || !keys.length)continue;
    const candidates=participants.filter(p=>roleFor(String(p.role||p.type||''))===kind);
    if(candidates.length!==1)continue;
    const values=[...new Set(keys.map(k=>candidates[0][k]).filter(v=>typeof v==='string'&&v.trim()))];
    if(values.length!==1)continue;
    const value=String(values[0]).trim();
    if(value.length>2000 || /\[CAMPO_\d+\*?\]/.test(value))continue;
    content=content.split(field.id).join(value);
  }
  const lastField = Math.max(0, ...Array.from(originalContent.matchAll(/\[CAMPO_(\d+)\*?\]/g), m => Number(m[1])));
  await ensureConfecciones(c.env.DB);
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await c.env.DB.prepare(`INSERT INTO confecciones
    (id, case_id, template_id, title, content, status, last_field_number, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`)
    .bind(id, caseObj.id, template.id, template.name + ' — ' + caseObj.title, content, lastField, auth.user.id, now, now).run();
  await createAudit(c.env.DB, auth.user.id, 'Inició confección', 'Case', caseObj.id, template.name);
  return c.json({ success: true, id }, 201);
});
app.delete('/api/confecciones/:id', async (c) => {
  const auth = c.get('auth')!;
  if (!confeccionesRoles.includes(auth.user.role)) return c.json({ error: 'No autorizado.' }, 403);
  await ensureConfecciones(c.env.DB);
  const { id } = c.req.param();
  const row = await c.env.DB.prepare('SELECT * FROM confecciones WHERE id = ?').bind(id).first<any>();
  if (!row) return c.json({ error: 'Confección no encontrada.' }, 404);
  const caseObj = await getCaseById(c.env.DB, row.case_id);
  if (auth.user.role === 'MANAGER' && caseObj?.assignedManagerId !== auth.user.id) return c.json({ error: 'No autorizado.' }, 403);
  await c.env.DB.prepare('DELETE FROM confeccion_chat WHERE confeccion_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM confecciones WHERE id = ?').bind(id).run();
  await createAudit(c.env.DB, auth.user.id, 'Eliminó definitivamente confección', 'Case', row.case_id, row.title);
  return c.json({ success: true });
});
app.put('/api/confecciones/:id', async (c) => {
  const auth = c.get('auth')!;
  if (!confeccionesRoles.includes(auth.user.role)) return c.json({ error: 'No autorizado.' }, 403);
  await ensureConfecciones(c.env.DB);
  const { id } = c.req.param();
  const existing = await c.env.DB.prepare('SELECT * FROM confecciones WHERE id = ?').bind(id).first<any>();
  if (!existing) return c.json({ error: 'Confección no encontrada.' }, 404);
  const caseObj = await getCaseById(c.env.DB, existing.case_id);
  if (auth.user.role === 'MANAGER' && caseObj?.assignedManagerId !== auth.user.id) return c.json({ error: 'No autorizado.' }, 403);
  if (existing.status !== 'draft') return c.json({ error: 'La confección está cerrada.' }, 409);
  const body = await c.req.json();
  if (typeof body.content !== 'string' || body.content.length > 500000) return c.json({ error: 'Contenido inválido.' }, 400);
  const maxInText = Math.max(0, ...Array.from(body.content.matchAll(/\[CAMPO_(\d+)\*?\]/g), (m: RegExpMatchArray) => Number(m[1])));
  const lastField = Math.max(existing.last_field_number, maxInText);
  const now = new Date().toISOString();
  await c.env.DB.prepare('UPDATE confecciones SET content = ?, last_field_number = ?, updated_at = ? WHERE id = ?')
    .bind(body.content, lastField, now, id).run();
  return c.json({ success: true, updatedAt: now, lastFieldNumber: lastField });
});
app.post('/api/confecciones/:id/close', async (c) => {
  const auth = c.get('auth')!;
  if (!confeccionesRoles.includes(auth.user.role)) return c.json({ error: 'No autorizado.' }, 403);
  await ensureConfecciones(c.env.DB);
  const { id } = c.req.param();
  const row = await c.env.DB.prepare('SELECT * FROM confecciones WHERE id = ?').bind(id).first<any>();
  if (!row) return c.json({ error: 'Confección no encontrada.' }, 404);
  const caseObj = await getCaseById(c.env.DB, row.case_id);
  if (auth.user.role === 'MANAGER' && caseObj?.assignedManagerId !== auth.user.id) return c.json({ error: 'No autorizado.' }, 403);
  if (row.status !== 'draft') return c.json({ error: 'Ya está cerrada.' }, 409);
  if (/\[CAMPO_\d+\*?\]/.test(row.content)) return c.json({ error: 'Quedan campos sin completar. Revisalos antes de cerrar.' }, 409);
  const now = new Date().toISOString();
  await c.env.DB.prepare("UPDATE confecciones SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ?")
    .bind(now, now, id).run();
  await createAudit(c.env.DB, auth.user.id, 'Finalizó confección', 'Case', row.case_id, row.title);
  return c.json({ success: true });
});
app.post('/api/confecciones/:id/agent', async (c) => {
  const auth = c.get('auth')!;
  if (!confeccionesRoles.includes(auth.user.role)) return c.json({ error: 'No autorizado.' }, 403);
  await ensureConfecciones(c.env.DB);
  const { id } = c.req.param();
  const row = await c.env.DB.prepare('SELECT * FROM confecciones WHERE id = ?').bind(id).first<any>();
  if (!row || row.status !== 'draft') return c.json({ error: 'Confección inexistente o cerrada.' }, 409);
  const caseObj = await getCaseById(c.env.DB, row.case_id);
  if (!caseObj) return c.json({ error: 'Legajo inexistente.' }, 404);
  if (auth.user.role === 'MANAGER' && caseObj.assignedManagerId !== auth.user.id) return c.json({ error: 'No autorizado.' }, 403);
  const { instruction, content, conversation } = await c.req.json();
  if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 2500 || typeof content !== 'string' || content.length > 500000) return c.json({ error: 'Instrucción o documento inválido.' }, 400);
  const current = await c.env.DB.prepare('SELECT content FROM confecciones WHERE id = ?').bind(id).first<{content: string}>();
  if (current?.content !== content) return c.json({ error: 'Guardá los cambios del documento antes de consultar al agente.' }, 409);
  const docs = (await getAllDocuments(c.env.DB)).filter(d => d.caseId === caseObj.id)
    .map(d => ({ name: d.name, fileName: d.fileName, status: d.status }));
  // Read actual R2 contents where a safe text extractor is available. Never claim
  // scanned images or unsupported formats were read successfully.
  const documentEvidence: Array<{name:string;status:string;text?:string;note?:string}> = [];
  for (const doc of (await getAllDocuments(c.env.DB)).filter(d=>d.caseId===caseObj.id).slice(0,60)) {
    const entry:{name:string;status:string;text?:string;note?:string} = {name:doc.name,status:doc.status};
    const key=doc.r2Key || doc.versions?.[doc.versions.length-1]?.r2Key;
    const mime=guessMimeType(doc.fileName || doc.name,doc.mimeType);
    if (!key) entry.note='Sin archivo disponible en almacenamiento';
    else if (!/^(text\/plain|application\/json|application\/pdf|application\/vnd.openxmlformats-officedocument.wordprocessingml.document)/.test(mime)) entry.note='Formato pendiente de lectura visual o conversión';
    else {
      try {
        const obj=await c.env.R2_BUCKET.get(key);
        if (!obj) entry.note='Archivo no encontrado';
        else if (obj.size>8_000_000) entry.note='Archivo demasiado grande para extracción directa';
        else {
          const bytes=new Uint8Array(await obj.arrayBuffer());
          const value=mime.includes('wordprocessingml')?extractTextFromDocx(bytes):mime.includes('pdf')?extractTextFromPdf(bytes):new TextDecoder().decode(bytes);
          if(value.trim()) entry.text=value.slice(0,30000);
          else entry.note='No se pudo extraer texto; requiere OCR o revisión manual';
        }
      } catch (e) {
        console.warn('Confecciones attachment extraction failed', {documentId:doc.id,error:e});
        entry.note='Extracción fallida; requiere revisión';
      }
    }
    documentEvidence.push(entry);
  }
  const template = await findTemplateOrVirtualById(c.env, row.template_id);
  // A confección may use a digitized document while the case belongs to an
  // operational process. Prefer the process's reviewed semantic map ONLY when
  // both documents share the exact marker meanings (same original text).
  const processTemplate = caseObj.templateId ? await findTemplateOrVirtualById(c.env,caseObj.templateId) : null;
  const sameSource = Boolean(processTemplate?.originalDocumentContent &&
    processTemplate.originalDocumentContent === template?.originalDocumentContent);
  const authoritativeMap = sameSource && processTemplate?.fieldMap?.length
    ? processTemplate.fieldMap : (template?.fieldMap || []);
  const storedFieldMap = authoritativeMap.filter(f => content.includes(f.id));
  const markers = [...new Set(Array.from(content.matchAll(/\[CAMPO_\d+\*?\]/g), m => m[0]))];
  // Infer each marker's meaning from the original template itself, even when
  // legacy digitizations have no semantic fieldMap.
  const inferField = (field:string) => {
    const at=content.indexOf(field);
    if(at<0)return {id:field,label:'Dato pendiente de identificar',actor:'No determinado'};
    const before=content.slice(Math.max(0,at-700),at);
    const after=content.slice(at+field.length,at+field.length+100);
    const actorMatch=[...before.matchAll(/\b(LOCADOR(?:ES|\/S)?|LOCATARIO(?:S|\/S)?|FIADOR(?:ES|\/S)?|GARANTE(?:S|\/S)?)\s*:/gi)].pop();
    const actorBase=actorMatch?actorMatch[1].toUpperCase():'No determinado';
    const currentLine=before.slice(before.lastIndexOf('\n')+1);
    // A spouse's details belong to a distinct person. The spouse context may
    // span adjacent markers (name, DNI, email) and must not inherit the main actor.
    const sectionTail=actorMatch?before.slice((actorMatch.index||0)+actorMatch[0].length):before;
    const spouseStart=[...sectionTail.matchAll(/(?:NOMBRE\s+Y\s+APELLIDO\s+(?:DEL?\s+)?C[ÓO]NYUGE|DATOS\s+DEL?\s+C[ÓO]NYUGE)\s*:/gi)].pop();
    const spouseContext=spouseStart?sectionTail.slice((spouseStart.index||0)+spouseStart[0].length):'';
    const spouseFields=spouseContext.match(/\[CAMPO_\d+\*?\]/g)||[];
    const actor=spouseStart && spouseFields.length<3 ? 'CÓNYUGE DE '+actorBase : actorBase;
    const labelMatch=[...currentLine.matchAll(/(FECHA DE NACIMIENTO|NOMBRE Y APELLIDO(?: DEL? C[ÓO]NYUGE)?|DOMICILIO ACTUAL|ESTADO CIVIL|DURACI[ÓO]N(?: DEL? CONTRATO)?|MESES DE GRACIA|VALOR DE LA LOCACI[ÓO]N INICIAL|IMPORTE DE MES DE DEP[ÓO]SITO|SERVICIOS? QUE ABONA (?:EL )?(?:LOCADOR|LOCATARIO)|POSESI[ÓO]N|INVENTARIO|AJUSTE|MAIL|DNI|A PARTIR|HASTA|INDICAR)\s*:?\s*$/gi)].pop();
    let label=labelMatch?.[1]||'';
    if(!label){
      const tail=currentLine.split(/[;:]/).pop()?.trim()||'';
      if(tail.length>=3&&tail.length<=65)label=tail;
    }
    if(!label && /^\s*(?:,|\.|;|\n)/.test(after))label='Dato solicitado en el contexto anterior';
    if(actor.startsWith('CÓNYUGE') && !label) label='Dato del cónyuge';
    return {id:field,label:label||'Dato pendiente de identificar',actor};
  };
  const fieldMap=markers.map(field=>{
    const inferred=inferField(field);
    const stored=storedFieldMap.find(f=>f.id===field);
    return {...inferred,...stored,
      label:stored?.label && !/^(pendiente de identificar|sin significado identificado|dato sin identificar)$/i.test(stored.label)?stored.label:inferred.label,
      actor:stored?.actor && !/^(no determinado|por identificar)$/i.test(stored.actor)?stored.actor:inferred.actor};
  });
  // Fill structured actor attributes without an LLM. The semantic map is the
  // source of truth; never substitute a different participant or spouse.
  const normalizeRole = (value:string) => value.toLocaleLowerCase('es-AR').normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
  const actorKind = (actor:string):string => {
    const a=normalizeRole(actor);
    if(/conyuge|espos/.test(a))return 'spouse';
    if(/locatario|inquilino/.test(a))return 'locatario';
    if(/locador|propietario/.test(a))return 'locador';
    if(/garante|fiador/.test(a))return 'garante';
    return '';
  };
  const propertyFor = (label:string):string => {
    const v=normalizeRole(label);
    if(/\bdni\b|documentodeidentidad/.test(v))return 'dni';
    if(/\bmail\b|correo|email/.test(v))return 'email';
    if(/fechadenacimiento|nacimiento|fnac/.test(v))return 'birthDate';
    if(/estadocivil/.test(v))return 'maritalStatus';
    if(/domicilioactual|direccion/.test(v))return 'address';
    if(/nombreyapellido|nombrecompleto/.test(v))return 'name';
    return '';
  };
  const structuredProposals:Array<{field:string;value:string;source:string}> = [];
  const actors=Array.isArray(caseObj.participants)?caseObj.participants as any[]:[];
  for(const entry of fieldMap){
    const kind=actorKind(String(entry.actor||''));
    const property=propertyFor(String(entry.label||''));
    if(!kind || kind==='spouse' || !property)continue;
    const matching=actors.filter(p=>actorKind(String(p.role||p.type||''))===kind);
    // Multiple actors of the same role require explicit disambiguation.
    if(matching.length!==1)continue;
    const actor=matching[0];
    const keys:Record<string,string[]>={
      dni:['dni','documentNumber','document_number'],
      email:['email','mail'],birthDate:['birthDate','birth_date','dateOfBirth','fechaNacimiento'],
      maritalStatus:['maritalStatus','marital_status','estadoCivil'],
      address:['address','domicilio','domicilioActual'],
      name:['fullName','name','nombreCompleto']
    };
    const values=(keys[property]||[]).map(k=>actor[k]).filter(v=>typeof v==='string'&&v.trim());
    if(values.length!==1)continue;
    const value=String(values[0]).trim();
    if(value.length>2000 || /\[CAMPO_\d+\*?\]/.test(value))continue;
    structuredProposals.push({field:entry.id,value,source:'Dato estructurado del legajo · '+kind+' · '+property});
  }
  const coverage = (proposed: Array<{field:string;value:string;source:string}>) => {
    const matched = new Set(proposed.map(p => p.field));
    const unresolved = markers.filter(field => !matched.has(field)).map(field => {
      const entry = fieldMap.find(f => f.id === field);
      return {field, label: entry?.label || 'Dato pendiente de identificar', status:'sin_dato_verificado'};
    });
    return {total:markers.length, proposed:matched.size, unresolved:unresolved.length, fields:unresolved};
  };
  const questionFor = (field:string):string => {
    const entry=fieldMap.find(f=>f.id===field);
    const at=content.indexOf(field);
    const preceding=at>=0?content.slice(Math.max(0,at-220),at):'';
    const lastLine=preceding.split(/\r?\n/).pop() || '';
    const suffix=lastLine.split(/[.;]/).pop()?.trim() || '';
    const label=entry?.label && entry.label!=='Pendiente de identificar'
      ? entry.label : (suffix.match(/(?:DNI|MAIL|EMAIL|ESTADO CIVIL|DOMICILIO|FECHA DE NACIMIENTO|NOMBRE Y APELLIDO|CUIT)\s*:?\s*$/i)?.[0] || suffix.slice(-45)).trim();
    const role=entry?.actor || 'actor correspondiente';
    return '¿Me indicás '+(label||'el valor')+' de '+role+' para '+field+'? Podés responder "'+field+' = valor".';
  };
  const missingSummary = () => 'Vamos a completar la plantilla juntos. '+questionFor(markers.find(m=>!structuredProposals.some(p=>p.field===m))||markers[0]);
  if (!markers.length) return c.json({ reply: 'La plantilla no tiene campos pendientes para completar.', replacements: [], pendingFields: 0, coverage:coverage([]) });
  // Deterministic operator entry: a confirmed field/value must not depend on AI availability.
  const directMatch=instruction.match(/^\s*(\[?CAMPO_(\d+)(\*)?\]?)\s*(?:=|:|es\s+)\s*(.+?)\s*$/is);
  if (directMatch) {
    const field='[CAMPO_'+directMatch[2]+(directMatch[3]?'*':'')+']';
    const value=directMatch[4].trim();
    if (!markers.includes(field)) return c.json({reply:'Ese campo no está pendiente en esta plantilla.',replacements:[],pendingFields:markers.length,coverage:coverage([])});
    if (!value || value.length>2000 || /\[CAMPO_\d+\*?\]/.test(value))
      return c.json({reply:'Necesito un valor concreto para '+field+'. '+questionFor(field),replacements:[],pendingFields:markers.length,coverage:coverage([])});
    const proposal={field,value,source:'Respuesta explícita del operador'};
    const next=markers.find(m=>m!==field);
    const reply='Registré una propuesta para '+field+'. Revisala y aplicala. '+(next?questionFor(next):'No quedan otros marcadores pendientes.');
    const now=new Date().toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO confeccion_chat (id, confeccion_id, sender, message, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(),id,'user',instruction.trim(),now),
      c.env.DB.prepare('INSERT INTO confeccion_chat (id, confeccion_id, sender, message, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(),id,'agent',reply,now)
    ]);
    return c.json({reply,replacements:[proposal],pendingFields:markers.length,coverage:coverage([proposal])});
  }
  // Persist the conversation per confection, so confirmed operator answers survive
  // navigation and later requests. Client-provided history is not trusted as evidence.
  await c.env.DB.prepare('INSERT INTO confeccion_chat (id, confeccion_id, sender, message, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(),id,'user',instruction.trim(),new Date().toISOString()).run();
  const storedChat=await c.env.DB.prepare('SELECT sender, message FROM confeccion_chat WHERE confeccion_id = ? ORDER BY created_at DESC, id DESC LIMIT 40')
    .bind(id).all<{sender:string;message:string}>();
  const history=(storedChat.results||[]).reverse().map(m=>({role:m.sender,text:m.message.slice(0,2000)}));
  const rememberReply = async (reply:string) => {
    await c.env.DB.prepare('INSERT INTO confeccion_chat (id, confeccion_id, sender, message, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(),id,'agent',reply.slice(0,3000),new Date().toISOString()).run();
  };
  const baseEvidence = {
    semanticFieldMap:fieldMap,
    code:caseObj.code, title:caseObj.title, description:caseObj.description,
    participants:caseObj.participants
  };
  const caseEvidence = String(caseObj.documentContent || '');
  const evidenceFor = (batch:string[]):string => {
    const terms = batch.flatMap(field => {
      const entry=fieldMap.find(f=>f.id===field);
      const at=content.indexOf(field);
      const context=at>=0?content.slice(Math.max(0,at-110),Math.min(content.length,at+field.length+110)):'';
      return [entry?.label||'',entry?.actor||'',context];
    }).join(' ').toLocaleLowerCase('es-AR');
    const keywords=[...new Set(terms.match(/[a-záéíóúñü]{4,}/g)||[])]
      .filter(w=>!['campo','para','esta','este','datos','parte','debe','donde','sobre','entre','documento','plantilla','completar'].includes(w))
      .slice(0,35);
    const snippets=(value:string,limit:number):string => {
      if(value.length<=limit)return value;
      const windows:Array<{at:number;score:number}>=[];
      for(let at=0;at<value.length;at+=850) {
        const chunk=value.slice(at,at+1100).toLocaleLowerCase('es-AR');
        const score=keywords.reduce((n,k)=>n+(chunk.includes(k)?1:0),0);
        windows.push({at,score});
      }
      const chosen=windows.sort((a,b)=>b.score-a.score||a.at-b.at).slice(0,Math.max(1,Math.floor(limit/1100)))
        .sort((a,b)=>a.at-b.at);
      return chosen.map(w=>'[posición '+w.at+'] '+value.slice(w.at,w.at+1050)).join('\n[…]\n').slice(0,limit);
    };
    // Reserve space for every attachment's status, even when its text is unreadable.
    const docs= documentEvidence.map((d,i)=>({
      name:d.name,status:d.status,note:d.note,
      excerpt:d.text?snippets(d.text,Math.min(2500,Math.max(180,Math.floor(18000/Math.max(1,documentEvidence.length))))):undefined,
      index:i+1
    }));
    return JSON.stringify({
      ...baseEvidence,
      caseDocumentContent:snippets(caseEvidence,4500),
      documents:docs
    });
  };
  // Process every marker in bounded batches instead of truncating the marker list.
  const batches: string[][] = [];
  for (let i=0;i<markers.length;i+=6) batches.push(markers.slice(i,i+6));
  const promptFor = (batch:string[], index:number) => `Sos un copiloto de confección documental inmobiliaria argentina.
Tu tarea es completar todos los campos que tengan evidencia verificable y continuar preguntando al operador hasta terminar. No te detengas por datos faltantes: resolvé los que sí tengan datos.
Respondé exclusivamente JSON {"reply":"mensaje breve o pregunta concreta","replacements":[{"field":"[CAMPO_1]","value":"valor","source":"origen concreto"}]}.
Cada reemplazo debe tener evidencia en los datos suministrados o en una respuesta explícita del operador. Nunca inventes DNI, fechas, personas, montos ni condiciones. No confundas locador, locatario ni cónyuges. No modifiques texto fuera de marcadores. Si hay contradicciones, preguntá antes de proponer.
Si faltan datos, hacé una pregunta específica y útil al operador, no una negativa genérica. Algunos documentos incluyen texto extraído y otros solo metadatos o notas de extracción. Usá únicamente el texto realmente presente; no afirmes haber leído archivos sin texto.
Lote ${index+1}/${batches.length}. Marcadores: ${JSON.stringify(batch)}
Campos y contexto: ${JSON.stringify(batch.map(field => {
 const entry=fieldMap.find(f=>f.id===field);
 const positions=[...content.matchAll(/\[CAMPO_\d+\*?\]/g)].filter(m=>m[0]===field).slice(0,4).map(m=>content.slice(Math.max(0,(m.index||0)-220),Math.min(content.length,(m.index||0)+field.length+220)));
 return {field,label:entry?.label,actor:entry?.actor,contexts:positions};
}))}
Datos disponibles del legajo (pueden incluir contenido digitalizado; extractos identificados por posición): ${evidenceFor(batch)}
Conversación histórica de esta confección (las afirmaciones del operador son datos declarados; verificá el actor y pedí confirmación ante contradicciones): ${JSON.stringify(history)}
Instrucción actual: ${instruction}`;
  const extractJson = (raw: string): any => {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return JSON.parse(cleaned); } catch {}
    const start = cleaned.indexOf('{');
    if (start < 0) return null;
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { return null; }
      }
    }
    return null;
  };
  try {
    const seen = new Set<string>();
    const valid: Array<{field:string;value:string;source:string}> = [...structuredProposals];
    structuredProposals.forEach(p=>seen.add(p.field));
    // A model's claim of a source is not proof. Only propose literal values
    // actually found in the case evidence or explicitly supplied by the operator.
    const normalizeEvidence=(v:string)=>v.toLocaleLowerCase('es-AR').normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
    const evidenceCorpus=normalizeEvidence(JSON.stringify({
      participants:caseObj.participants,description:caseObj.description,
      documentContent:caseObj.documentContent,documents:documentEvidence.map(d=>d.text||''),
      operatorStatements:history.filter(m=>m.role==='user').map(m=>m.text)
    }));
    const supportedValue=(value:string)=> {
      const normalized=normalizeEvidence(value);
      return normalized.length>=3 && evidenceCorpus.includes(normalized);
    };
    const roleCompatible=(field:string,value:string,source:string):boolean => {
      const entry=fieldMap.find(f=>f.id===field);
      if(!entry)return false;
      const expected=String(entry.actor||'').toLocaleLowerCase('es-AR');
      const declared=source.toLocaleLowerCase('es-AR');
      const spouse=/c[óo]nyuge|espos[ao]/i.test(expected);
      if(!spouse){
        const kind=actorKind(String(entry.actor||''));
        const property=propertyFor(String(entry.label||''));
        if(kind && property){
          const aliases:Record<string,string[]>={
            dni:['dni','documentNumber','document_number'],
            email:['email','mail'],birthDate:['birthDate','birth_date','dateOfBirth','fechaNacimiento'],
            maritalStatus:['maritalStatus','marital_status','estadoCivil'],
            address:['address','domicilio','domicilioActual'],
            name:['fullName','name','nombreCompleto']
          };
          const matches=actors.filter(p=>actorKind(String(p.role||p.type||''))===kind);
          if(matches.length>1)return false;
          const normalizedValue=normalizeEvidence(value);
          // If the value is a known attribute of a different actor, reject it.
          const otherActors=actors.filter(p=>actorKind(String(p.role||p.type||''))!==kind);
          if(otherActors.some(p=>(aliases[property]||[]).some(k=>
            typeof p[k]==='string' && normalizeEvidence(p[k])===normalizedValue)))return false;
          if(matches.length===1){
            const known=(aliases[property]||[]).map(k=>matches[0][k])
              .filter(v=>typeof v==='string'&&v.trim());
            if(known.length && !known.some(v=>normalizeEvidence(v)===normalizedValue)){
              // The operator can override contradictory structured data only
              // through an explicit field assignment, not a model inference.
              return false;
            }
          }
        }
        return true;
      }
      // No spouse proposal can be based solely on the main participant's
      // record or generic case data, even if the literal value exists there.
      if(!/c[óo]nyuge|espos[ao]/i.test(declared))return false;
      const primaryActors=caseObj.participants||[];
      const primaryValues=Array.isArray(primaryActors)?primaryActors.filter((p:any)=>
        !/c[óo]nyuge|espos[ao]/i.test(String(p.role||p.type||''))):[];
      const normalized=normalizeEvidence(value);
      if(primaryValues.some((p:any)=>Object.values(p).some(v=>typeof v==='string'&&normalizeEvidence(v)===normalized)))
        return false;
      return true;
    };
    const replies: string[] = [];
    let failures = 0;
    let lastFailure = '';
    const models = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct-fast'] as const;
    const runAgentBatch = async (batch:string[], index:number):Promise<any> => {
      if (!c.env.AI) throw new Error('Binding Workers AI no disponible');
      let lastError = '';
      for (const model of models) {
        // Retry on a smaller, structured prompt if the primary context is rejected.
        for (const compact of [false,true]) {
          try {
            const compactPrompt = JSON.stringify({
              task:'Completar marcadores con datos verificados. No inventar. Responder solo JSON: {"reply":"texto","replacements":[{"field":"[CAMPO_1]","value":"dato","source":"fuente"}]}',
              fields:batch.map(field=>({field,label:fieldMap.find(f=>f.id===field)?.label,actor:fieldMap.find(f=>f.id===field)?.actor,
                context:content.slice(Math.max(0,content.indexOf(field)-130),content.indexOf(field)+field.length+130)})),
              caseData:{code:caseObj.code,title:caseObj.title,participants:caseObj.participants},
              evidence:evidenceFor(batch).slice(0,6500),
              instruction,history:history.slice(-6)
            });
            const response = await (c.env.AI as any).run(model,{
              messages:[
                {role:'system',content:'Sos un asistente documental. Solo JSON válido. Proponé únicamente datos respaldados por evidencia; no inventes.'},
                {role:'user',content:compact?compactPrompt:promptFor(batch,index)}
              ],
              temperature:0,max_tokens:compact?1200:1600
            });
            const raw=typeof response?.response==='string'?response.response:
              typeof response==='string'?response:
              typeof response?.choices?.[0]?.message?.content==='string'?response.choices[0].message.content:'';
            const parsed=extractJson(raw);
            if (parsed && typeof parsed==='object') return parsed;
            lastError='Respuesta no interpretable del modelo '+model;
          } catch (error) {
            lastError=error instanceof Error?error.message:String(error);
            console.warn('Confecciones AI retry',{batch:index,model,compact,error:lastError.slice(0,250)});
          }
        }
      }
      throw new Error(lastError||'Los modelos no devolvieron una respuesta válida');
    };
    for (let i=0;i<batches.length;i++) {
      if(batches[i].every(field=>seen.has(field)))continue;
      try {
        const parsed = await runAgentBatch(batches[i],i);
        if (typeof parsed.reply === 'string' && parsed.reply.trim()) replies.push(parsed.reply.trim().slice(0,500));
        if (!Array.isArray(parsed.replacements)) continue;
        for (const x of parsed.replacements) {
          if (typeof x?.field !== 'string' || !batches[i].includes(x.field) || seen.has(x.field) ||
              typeof x.value !== 'string' || !x.value.trim() || x.value.length > 2000 ||
              /\[CAMPO_\d+\*?\]/.test(x.value) ||
              typeof x.source !== 'string' || !x.source.trim() || !supportedValue(x.value) || !roleCompatible(x.field,x.value,x.source)) continue;
          seen.add(x.field);
          valid.push({field:x.field,value:x.value.trim(),source:x.source.trim()});
        }
      } catch (batchError) {
        failures++;
        lastFailure = batchError instanceof Error ? batchError.message : String(batchError);
        console.error('Confecciones AI batch error', {batch:i,error:batchError});
      }
    }
    const unresolved = markers.filter(field=>!seen.has(field));
    const reply = valid.length
      ? 'Encontré '+valid.length+' propuestas verificables de '+markers.length+' campos. '+(unresolved.length ? 'Quedan '+unresolved.length+' pendientes. ' : 'No quedan marcadores pendientes de propuesta. ')+(replies[0]||'Revisá las propuestas y confirmá antes de aplicarlas.')
      : (failures === batches.length ? 'El servicio de IA falló en los '+batches.length+' lotes. '+(lastFailure?'Diagnóstico: '+lastFailure.slice(0,160)+'. ':'')+'No se modificó la plantilla. '+missingSummary() : (replies.find(r=>r.includes('¿')) || missingSummary()));
    await rememberReply(reply);
    return c.json({reply, replacements:valid, pendingFields:markers.length, coverage:coverage(valid), partialFailure:failures>0, batches:batches.length, failedBatches:failures});
  } catch (error) {
    console.error('Confecciones AI service error:', error);
    return c.json({reply:'El servicio de IA no respondió en este momento. No modifiqué la plantilla. ' + missingSummary(), replacements:[], pendingFields:markers.length, coverage:coverage([]), fallback:true});
  }
});


}
