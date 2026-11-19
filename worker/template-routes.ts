import type { Hono } from 'hono';
import type { ProcessTemplate } from '../src/types';
import type { Env, AppVariables } from './types';
import { getAllTemplates, canUserManageTemplates, findTemplateOrVirtualById, createAudit } from './db';

type WorkerApp = Hono<{ Bindings: Env; Variables: AppVariables }>;

// ============================================================================
// 6. Process Templates (Normalized D1 Tables)
// ============================================================================
export async function saveTemplateInDb(db: D1Database, tpl: ProcessTemplate, isUpdate = false): Promise<void> {
  const now = new Date().toISOString();
  if (isUpdate) {
    await db
      .prepare(
        `UPDATE process_templates SET name = ?, description = ?, industry = ?, original_document_content = ?,
         show_document_to_all = ?, shared_view_mode = ?, updated_at = ? WHERE id = ?`
      )
      .bind(
        tpl.name,
        tpl.description || '',
        tpl.industry,
        tpl.originalDocumentContent || '',
        tpl.showDocumentToAll !== false ? 1 : 0,
        tpl.sharedViewMode || 'both',
        now,
        tpl.id
      )
      .run();
    await db.prepare('DELETE FROM template_stages WHERE template_id = ?').bind(tpl.id).run();
  } else {
    await db
      .prepare(
        `INSERT INTO process_templates (id, name, description, industry, original_document_content, show_document_to_all, shared_view_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        tpl.id,
        tpl.name,
        tpl.description || '',
        tpl.industry,
        tpl.originalDocumentContent || '',
        tpl.showDocumentToAll !== false ? 1 : 0,
        tpl.sharedViewMode || 'both',
        now,
        now
      )
      .run();
  }

  // Keep the semantic map synchronized with the exact markers present in the text.
  await db.prepare(`CREATE TABLE IF NOT EXISTS template_field_maps
    (template_id TEXT PRIMARY KEY, fields_json TEXT NOT NULL DEFAULT '[]', notes_json TEXT NOT NULL DEFAULT '[]')`).run();
  const markers = [...(tpl.originalDocumentContent || '').matchAll(/\[CAMPO_\d+\*?\]/g)].map(m => m[0]);
  const unique = [...new Set(markers)];
  const fieldMap = unique.map(id => {
    const prior = (tpl.fieldMap || []).find(f => f.id === id);
    return prior || { id, label: 'Pendiente de identificar', actor: 'No determinado', source: 'manual', confidence: 'low', review: true };
  });
  await db.prepare(`INSERT INTO template_field_maps (template_id, fields_json, notes_json) VALUES (?, ?, ?)
    ON CONFLICT(template_id) DO UPDATE SET fields_json = excluded.fields_json, notes_json = excluded.notes_json`)
    .bind(tpl.id, JSON.stringify(fieldMap), JSON.stringify(tpl.digitizationReviewNotes || [])).run();

  const stmts: D1PreparedStatement[] = [];
  (tpl.stages || []).forEach((stg, sIdx) => {
    const stageId = stg.id || `stg-${sIdx}-${Date.now()}`;
    stmts.push(
      db
        .prepare(
          `INSERT INTO template_stages (id, template_id, stage_order, name, description)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(stageId, tpl.id, sIdx, stg.name, stg.description || '')
    );

    (stg.requirements || []).forEach((req, rIdx) => {
      const reqId = req.id || `req-${sIdx}-${rIdx}-${Date.now()}`;
      stmts.push(
        db
          .prepare(
            `INSERT INTO stage_requirements (id, stage_id, template_id, req_order, name, type, description, is_required, form_fields_json, document_source_type, linked_template_id, linked_shared_document_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            reqId,
            stageId,
            tpl.id,
            rIdx,
            req.name,
            req.type === 'actor' ? 'task' : req.type, // Legacy D1 CHECK allows document/form/task only.
            req.description || '',
            req.isRequired !== false ? 1 : 0,
            req.type === 'actor' ? JSON.stringify({ requirementKind: 'actor', actorRole: req.actorRole, minQuantity: Math.max(1, Number(req.minQuantity) || 1) }) : (req.formFields ? JSON.stringify(req.formFields) : null),
            req.documentSourceType || null,
            req.linkedTemplateId || null,
            req.linkedSharedDocumentId || null
          )
      );
    });
  });

  if (stmts.length > 0) {
    await db.batch(stmts);
  }
}


export function registerTemplateRoutes(app: WorkerApp) {
app.get('/api/templates', async (c) => {
  const templates = await getAllTemplates(c.env.DB);
  return c.json(templates);
});

/**
 * Process descriptions are authored by responsible users. Convert explicit
 * line-by-line obligations to persisted stage requirements; never use the
 * digitization pipeline to determine what an advisor must provide.
 */
function requirementsFromProcessDescription(description: string): ProcessTemplate['stages'] {
  const lines = description.split(/\r?\n|;/).map(x => x.replace(/^\s*[-*•\d.)]+\s*/, '').trim()).filter(Boolean);
  const requirements: ProcessTemplate['stages'][number]['requirements'] = [];
  const unrecognized: string[] = [];
  const actorRoles: Record<string, string> = {
    locador: 'Locador', locatario: 'Locatario', garante: 'Garante',
    vendedor: 'Vendedor', comprador: 'Comprador', titular: 'Titular',
    cliente: 'Cliente', apoderado: 'Apoderado', escribano: 'Escribano'
  };
  const normalized = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const add = (name: string, type: 'actor' | 'document' | 'task', role?: string, minimum?: number) => {
    const existing = requirements.find(req => req.type === type && normalized(req.name) === normalized(name));
    if (existing) { if (type === 'actor') existing.minQuantity = Math.max(existing.minQuantity || 1, minimum || 1); return; }
    requirements.push({
      id: `req-${crypto.randomUUID()}`, name, type,
      description: '', isRequired: true,
      ...(role ? { actorRole: role as any, minQuantity: minimum || 1 } : {})
    });
  };
  for (const line of lines) {
    const clean = normalized(line);
    const actor = Object.entries(actorRoles).find(([key]) => new RegExp(`\\b${key}(?:es|s)?\\b`).test(clean));
    if (actor && !/(dni|document|copia|escritura|boleta|servicio|boleto|certificado|informe|credito|comprobante|constancia|recibo|factura)/.test(clean)) {
      const number = clean.match(/\b(?:minimo|minima|al menos|cantidad|requiere|exigir)\s*:?\s*(\d+)\b/) || clean.match(/^\s*(\d+)\s+/);
      const minimum = number ? Math.max(1, Number(number[1])) : /\bdos\b/.test(clean) ? 2 : /\btres\b/.test(clean) ? 3 : 1;
      add(actor[1], 'actor', actor[1], minimum);
      continue;
    }
    const stripped = line.replace(/^(documentaci[oó]n requerida|documentos requeridos|documentos|adjuntar|presentar|copia de|copia del)\s*:?\s*/i, '').trim();
    const low = normalized(stripped);
    if (!stripped || /^(documentacion requerida|documentos requeridos|documentos|actores|partes):?$/.test(low)) continue;
    if (/(dni|documento de identidad|escritura|boleta|servicio|boleto|certificado|informe|credito|comprobante|constancia|recibo|factura|documentacion|contrato|titulo de propiedad)/.test(low)) {
      const subject = actor?.[1];
      const canonical = /\b(dni|documento de identidad)\b/.test(low) ? (subject ? `DNI del ${subject.toLowerCase()}` : 'DNI') : /\bescritura\b|titulo de propiedad/.test(low) ? 'Copia de escritura' : /\b(boleta|servicios?)\b/.test(low) ? 'Boleta de servicios' : stripped;
      add(canonical, 'document');
    } else if (/^(tarea|verificar|comprobar|revisar|confirmar)\b/.test(low)) {
      add(stripped, 'task');
    } else {
      unrecognized.push(line);
    }
  }
  if (unrecognized.length) throw new Error(`Requisitos sin interpretar: ${unrecognized.join(' | ')}. Revisá las líneas antes de guardar.`);
  if (!requirements.length) throw new Error('Debés indicar al menos un requisito válido.');
  return [{ id: `stage-${crypto.randomUUID()}`, name: 'Presentación y revisión de requisitos', description: 'Requisitos establecidos por el responsable del proceso', requirements }];
}

function identifyDigitizedFields(source:string) {
  const unique=[...new Set([...source.matchAll(/\[CAMPO_\d+\*?\]/g)].map(m=>m[0]))];
  const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const roles=/\b(LOCADOR(?:ES|\/S)?|LOCATARIO(?:S|\/S)?|FIADOR(?:ES|\/S)?|GARANTE(?:S|\/S)?)\s*:/gi;
  const fields=unique.map(field=>{
    const at=source.indexOf(field);
    const before=source.slice(0,at);
    const roleMatches=[...before.matchAll(roles)];
    const lastRole=roleMatches[roleMatches.length-1];
    let actor=lastRole?normalize(lastRole[1]).includes('locatario')?'Locatario':normalize(lastRole[1]).includes('locador')?'Locador':'Garante':'Operación';
    // Section headings override the last named person. Rental terms are
    // properties of the operation, never of the tenant or their spouse.
    const operationHeading=[...before.matchAll(/(?:CONDICIONES\s+DE\s+ALQUILER|DURACI[ÓO]N\s+CONTRATO|DATOS\s+DE\s+LA\s+PROPIEDAD)\s*[:;]/gi)].pop();
    const operationStart=operationHeading?.index??-1;
    const roleStart=lastRole?.index??-1;
    const isOperation=operationStart>roleStart;
    if(isOperation)actor='Condiciones de la operación';
    const section=isOperation?before.slice(operationStart):lastRole?before.slice((lastRole.index||0)+lastRole[0].length):before;
    const spouseHeading=[...section.matchAll(/NOMBRE\s+Y\s+APELLIDO\s+(?:DEL?\s+)?C[ÓO]NYUGE\s*:/gi)].pop();
    if(spouseHeading && !isOperation){
      const spouseTail=section.slice((spouseHeading.index||0)+spouseHeading[0].length);
      const spouseCount=(spouseTail.match(/\[CAMPO_\d+\*?\]/g)||[]).length;
      if(spouseCount<4)actor='Cónyuge del '+actor.toLowerCase();
    }
    const line=before.slice(before.lastIndexOf('\n')+1);
    const tokens=[...line.matchAll(/(FECHA DE NACIMIENTO|NOMBRE Y APELLIDO(?:\s+(?:DEL?\s+)?C[ÓO]NYUGE)?|DOMICILIO ACTUAL|ESTADO CIVIL|DURACI[ÓO]N(?:\s+CONTRATO)?|MESES DE GRACIA|VALOR DE LA LOCACI[ÓO]N INICIAL|IMPORTE DE MES DE DEP[ÓO]SITO[^\n]*|SERVICIOS? QUE ABONA[^\n]*|POSESI[ÓO]N|INVENTARIO|AJUSTE|MAIL|DNI|A PARTIR|HASTA|INDICAR)\s*:?\s*$/gi)];
    let label=tokens.length?tokens[tokens.length-1][1]:'';
    if(!label){
      const nearest=section.slice(Math.max(0,section.length-110));
      const m=nearest.match(/(?:DURACI[ÓO]N\s+CONTRATO|NOMBRE\s+Y\s+APELLIDO\s+C[ÓO]NYUGE)\s*[:;]?\s*$/i);
      if(m)label=m[0].trim();
    }
    if(/^(A PARTIR|HASTA|INDICAR)$/i.test(label))label=label==='INDICAR'?'Meses de gracia':label==='HASTA'?'Fecha de finalización del contrato':'Fecha de inicio del contrato';
    if(!label)label='Dato por identificar';
    const review=label==='Dato por identificar'||label==='Dato solicitado en el contexto anterior'||actor==='Operación'&&!/(contrato|alquiler|locaci[oó]n|dep[oó]sito|ajuste|inventario|servicio|posesi[oó]n|gracia|inicio|finalizaci[oó]n)/i.test(label);
    return {id:field,label,actor,source:'semantic' as const,confidence:review?'low' as const:'medium' as const,review};
  });
  return fields;
}

// Interpret highlighted fields before creating a process, rather than asking
// the Confecciones agent to rediscover their meaning at the end of the workflow.
app.post('/api/templates/analyze-fields', async (c) => {
  const auth=c.get('auth')!;
  if (!(await canUserManageTemplates(c.env.DB,auth.user.id))) return c.json({error:'No autorizado.'},403);
  const {sharedDocumentId}=await c.req.json();
  const doc=await c.env.DB.prepare('SELECT * FROM shared_documents WHERE id = ?').bind(String(sharedDocumentId||'')).first<any>();
  if(!doc)return c.json({error:'El documento digitalizado no existe en Documentos.'},404);
  const allowedRoles:string[]=doc.allowed_roles_json?JSON.parse(doc.allowed_roles_json):[];
  const allowedUsers:string[]=doc.allowed_user_ids_json?JSON.parse(doc.allowed_user_ids_json):[];
  if(auth.user.role!=='SUPERADMIN'&&!allowedRoles.includes(auth.user.role)&&!allowedUsers.includes(auth.user.id))
    return c.json({error:'No tenés acceso al documento seleccionado.'},403);
  if(!String(doc.file_name||doc.fileName||'').toLowerCase().endsWith('.txt'))
    return c.json({error:'Seleccioná un documento digitalizado de texto.'},400);
  const object=await c.env.R2_BUCKET.get(doc.r2_key);
  if(!object)return c.json({error:'El archivo del documento no está disponible en R2.'},404);
  const publishedText=await object.text();
  const metadataObject=await c.env.R2_BUCKET.get(doc.r2_key+'.fieldmap.json');
  const metadata=metadataObject ? await metadataObject.json() as {originalDocumentContent?:string;fieldMap?:any[]} : null;
  const source=metadata?.originalDocumentContent || publishedText;
  const matches=[...source.matchAll(/\[CAMPO_\d+\*?\]/g)];
  // Keep process requirements in the document's natural order. New
  // digitizations already assign consecutive IDs at their source.
  const unique=[...new Set(matches.map(m=>m[0]))];
  if(!unique.length)return c.json({error:'La plantilla no tiene campos amarillos.'},400);
  if (metadata?.fieldMap?.length) {
    const fields=metadata.fieldMap.filter((f:any)=>unique.includes(f.id));
    if(fields.length!==unique.length)return c.json({error:'El mapa de campos publicado está incompleto.'},409);
    return c.json({fields,originalDocumentContent:source});
  }
  // Reuse the reviewed map saved when the document was digitized.
  // Exact source matching prevents using meanings from another marker version.
  const original=await c.env.DB.prepare(
    'SELECT id FROM process_templates WHERE original_document_content = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(source).first<{id:string}>();
  if(!original)return c.json({error:'No se encontró el mapa original de esta digitalización. Revisá la plantilla antes de crear el proceso.'},409);
  const saved=await findTemplateOrVirtualById(c.env,original.id);
  const fields=(saved?.fieldMap||[]).filter(f=>unique.includes(f.id));
  if(fields.length!==unique.length)
    return c.json({error:'El mapa de digitalización está incompleto. Revisá la plantilla antes de crear el proceso.'},409);
  return c.json({fields,originalDocumentContent:source});
});
// Confirm a review flag in the published R2 field map before changing the UI.
app.post('/api/templates/confirm-field-review', async (c) => {
  const auth=c.get('auth')!;
  if (!(await canUserManageTemplates(c.env.DB,auth.user.id))) return c.json({error:'No autorizado.'},403);
  const {sharedDocumentId,fieldId,review,expectedReview}=await c.req.json() as {sharedDocumentId?:string;fieldId?:string;review?:boolean;expectedReview?:boolean};
  const targetReview=typeof review==='boolean'?review:false;
  if(typeof expectedReview!=='boolean')return c.json({error:'Falta el estado previo del campo.'},400);
  if(!sharedDocumentId || !/^\[CAMPO_\d+\*?\]$/.test(String(fieldId||''))) return c.json({error:'Identificador de campo inválido.'},400);
  const doc=await c.env.DB.prepare('SELECT * FROM shared_documents WHERE id = ?').bind(sharedDocumentId).first<any>();
  if(!doc)return c.json({error:'Documento no encontrado.'},404);
  const roles:string[]=doc.allowed_roles_json?JSON.parse(doc.allowed_roles_json):[];
  const users:string[]=doc.allowed_user_ids_json?JSON.parse(doc.allowed_user_ids_json):[];
  if(auth.user.role!=='SUPERADMIN'&&!roles.includes(auth.user.role)&&!users.includes(auth.user.id))
    return c.json({error:'Acceso denegado.'},403);
  const key=doc.r2_key+'.fieldmap.json';
  const obj=await c.env.R2_BUCKET.get(key);
  if(!obj)return c.json({error:'No existe el mapa de campos publicado.'},409);
  const metadata=await obj.json() as {originalDocumentContent?:string;fieldMap?:any[]};
  if(!Array.isArray(metadata.fieldMap))return c.json({error:'Mapa de campos inválido.'},409);
  const matches=metadata.fieldMap.filter(f=>f.id===fieldId);
  if(matches.length!==1)return c.json({error:'El identificador no es único o no existe.'},409);
  const field=matches[0];
  if(!String(metadata.originalDocumentContent||'').includes(fieldId))
    return c.json({error:'El campo no coincide con el documento publicado.'},409);
  if(/^(dato por identificar|pendiente de identificar|sin significado identificado|dato sin identificar)$/i.test(String(field.label||'').trim()) ||
     /^(no determinado|por identificar)$/i.test(String(field.actor||'').trim()))
    return c.json({error:'Primero corregí el significado del campo en la digitalización.'},409);
  if(Boolean(field.review)!==expectedReview)return c.json({error:'El campo cambió en otra sesión. Volvé a cargarlo.'},409);
  if(Boolean(field.review)===targetReview)return c.json({fieldId,review:targetReview});
  const next={...metadata,fieldMap:metadata.fieldMap.map(f=>f.id===fieldId?{...f,review:targetReview}:f)};
  await c.env.R2_BUCKET.put(key,JSON.stringify(next),{httpMetadata:{contentType:'application/json'}});
  const check=await c.env.R2_BUCKET.get(key);
  const persisted=check?await check.json() as typeof next:null;
  if(!persisted?.fieldMap?.some(f=>f.id===fieldId && f.review===targetReview))
    return c.json({error:'No se pudo confirmar la persistencia de la corrección.'},500);
  await createAudit(c.env.DB,auth.user.id,(targetReview?'Marcó para revisión ':'Confirmó revisión de ')+fieldId,'SharedDocument',doc.id,doc.name);
  return c.json({fieldId,review:targetReview});
});
app.post('/api/templates', async (c) => {
  const auth = c.get('auth')!;
  if (!(await canUserManageTemplates(c.env.DB, auth.user.id))) {
    return c.json({ error: 'No tienes permisos suficientes para crear plantillas de procesos.' }, 403);
  }
  const body = await c.req.json();
  let parsedStages: ProcessTemplate['stages'];
  try {
    if(body.sharedDocumentId) {
      // A process references the already published document; never re-publish or copy its text.
      const doc=await c.env.DB.prepare('SELECT * FROM shared_documents WHERE id = ?').bind(String(body.sharedDocumentId)).first<any>();
      if(!doc)return c.json({error:'El documento digitalizado asociado no existe.'},404);
      const roles:string[]=doc.allowed_roles_json?JSON.parse(doc.allowed_roles_json):[];
      const users:string[]=doc.allowed_user_ids_json?JSON.parse(doc.allowed_user_ids_json):[];
      if(auth.user.role!=='SUPERADMIN'&&!roles.includes(auth.user.role)&&!users.includes(auth.user.id))
        return c.json({error:'No tenés acceso al documento digitalizado.'},403);
      const metadataObj=await c.env.R2_BUCKET.get(doc.r2_key+'.fieldmap.json');
      if(!metadataObj)return c.json({error:'El documento no tiene un mapa de campos publicado.'},409);
      const metadata=await metadataObj.json() as {originalDocumentContent?:string;fieldMap?:any[]};
      const fields=metadata.fieldMap;
      if(!Array.isArray(fields)||!fields.length)return c.json({error:'El mapa de campos publicado está vacío.'},409);
      const requirements=fields.map((f:any)=>({
        id:'req-'+crypto.randomUUID(),name:String(f.actor)+' — '+String(f.label)+' ('+String(f.id)+')',
        type:'task' as const,description:'Dato a recopilar para completar '+String(f.id),
        linkedSharedDocumentId:String(body.sharedDocumentId),
        isRequired:!f.review
      }));
      parsedStages=[{id:'stage-'+crypto.randomUUID(),name:'Recolección de datos de la plantilla',description:'Verificar los campos identificados antes de confeccionar el documento',requirements}];
    }
    else if(Array.isArray(body.stages) && body.stages.length) parsedStages=body.stages;
    else if(Array.isArray(body.fieldMap) && body.fieldMap.length && body.originalDocumentContent) {
      const sourceFields=body.fieldMap.filter((f:any)=>typeof f.id==='string' && typeof f.label==='string' && typeof f.actor==='string');
      const requirements=sourceFields.map((f:any)=>({
        id:'req-'+crypto.randomUUID(),name:f.actor+' — '+f.label+' ('+f.id+')',
        type:'task' as const,description:'Dato a recopilar para completar '+f.id,
        isRequired:!f.review
      }));
      parsedStages=[{id:'stage-'+crypto.randomUUID(),name:'Recolección de datos de la plantilla',description:'Verificar los campos identificados antes de confeccionar el documento',requirements}];
    } else parsedStages=requirementsFromProcessDescription(body.description||'');
  }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : 'No se pudieron interpretar los requisitos.' }, 400); }
  const newTemplate: ProcessTemplate = {
    id: `tmpl-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`,
    name: body.name,
    description: body.sharedDocumentId ? 'Organizar las etapas, responsables y requisitos del proceso «' + String(body.name || 'operativo') + '», utilizando el documento previamente digitalizado.' : (body.description || ''),
    industry: body.industry || 'Inmobiliaria',
    stages: parsedStages,
    originalDocumentContent: body.sharedDocumentId ? '' : (body.originalDocumentContent || ''),
    fieldMap: body.sharedDocumentId ? [] : (Array.isArray(body.fieldMap) ? body.fieldMap : []),
    digitizationReviewNotes: [],
    showDocumentToAll: body.sharedDocumentId ? false : (body.showDocumentToAll !== undefined ? body.showDocumentToAll : true),
    sharedViewMode: body.sharedViewMode || 'both',
  };

  await saveTemplateInDb(c.env.DB, newTemplate, false);
  await createAudit(c.env.DB, auth.user.id, 'Plantilla de proceso creada', 'ProcessTemplate', newTemplate.id, newTemplate.name);
  return c.json(newTemplate, 201);
});

app.put('/api/templates/:id', async (c) => {
  const auth = c.get('auth')!;
  if (!(await canUserManageTemplates(c.env.DB, auth.user.id))) {
    return c.json({ error: 'No tienes permisos suficientes para modificar plantillas de procesos.' }, 403);
  }
  const { id } = c.req.param();
  const existing = (await getAllTemplates(c.env.DB)).find((t) => t.id === id);
  if (!existing) {
    return c.json({ error: 'Plantilla de proceso no encontrada.' }, 404);
  }
  const body = await c.req.json();
  const updated: ProcessTemplate = {
    ...existing,
    name: body.name || existing.name,
    description: body.description !== undefined ? body.description : existing.description,
    industry: body.industry || existing.industry,
    stages: body.stages !== undefined ? body.stages : existing.stages,
    originalDocumentContent:
      body.originalDocumentContent !== undefined
        ? body.originalDocumentContent
        : existing.originalDocumentContent,
    fieldMap: Array.isArray(body.fieldMap) ? body.fieldMap : existing.fieldMap,
    digitizationReviewNotes: Array.isArray(body.digitizationReviewNotes) ? body.digitizationReviewNotes : existing.digitizationReviewNotes,
    showDocumentToAll:
      body.showDocumentToAll !== undefined ? body.showDocumentToAll : existing.showDocumentToAll ?? true,
    sharedViewMode: body.sharedViewMode !== undefined ? body.sharedViewMode : existing.sharedViewMode ?? 'both',
  };

  await saveTemplateInDb(c.env.DB, updated, true);
  await createAudit(c.env.DB, auth.user.id, 'Plantilla de proceso actualizada', 'ProcessTemplate', id, updated.name);
  return c.json(updated);
});

app.delete('/api/templates/:id', async (c) => {
  const auth = c.get('auth')!;
  if (!(await canUserManageTemplates(c.env.DB, auth.user.id))) {
    return c.json({ error: 'No tienes permisos suficientes para eliminar plantillas de procesos.' }, 403);
  }
  const { id } = c.req.param();
  const existing = await c.env.DB.prepare('SELECT name FROM process_templates WHERE id = ?')
    .bind(id)
    .first<{ name: string }>();
  if (!existing) {
    return c.json({ error: 'Plantilla de proceso no encontrada.' }, 404);
  }
  await c.env.DB.prepare('DELETE FROM process_templates WHERE id = ?').bind(id).run();
  await createAudit(c.env.DB, auth.user.id, 'Plantilla de proceso eliminada', 'ProcessTemplate', id, existing.name);
  return c.json({ success: true, id });
});


}
