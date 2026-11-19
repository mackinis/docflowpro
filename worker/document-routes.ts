import { Hono, type Context } from 'hono';
import type { Env, AppVariables } from './types';
import { createAudit, createNotification, getCaseById, getAllDocuments, findTemplateOrVirtualById } from './db';
import { decodeDataUrl, guessMimeType, sanitizeFileName } from './document-parser';

type WorkerApp = Hono<{ Bindings: Env; Variables: AppVariables }>;
type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

/** Case documents, R2 versions, upload requests and review endpoints. */
export function registerDocumentRoutes(app: WorkerApp) {
// ============================================================================
// 9. Case Documents (R2 Storage + D1 Metadata & Versions)
// ============================================================================
app.get('/api/cases/:caseId/documents', async (c) => {
  const auth = c.get('auth')!;
  const { caseId } = c.req.param();
  const allDocs = (await getAllDocuments(c.env.DB)).filter((d) => d.caseId === caseId);
  const caseObj = await getCaseById(c.env.DB, caseId);
  return c.json(allDocs.filter(d => {
    if (d.status !== 'approved') return true;
    if (d.allowedRoles?.includes('PRIVATE_CASE_ADVISOR')) {
      return ['SUPERADMIN', 'ADMIN'].includes(auth.user.role) ||
        (auth.user.role === 'MANAGER' && caseObj?.assignedManagerId === auth.user.id) ||
        (auth.user.role === 'ASESOR' && caseObj?.assignedAdvisorId === auth.user.id);
    }
    return ['SUPERADMIN', 'ADMIN'].includes(auth.user.role) ||
      !d.allowedRoles?.length || d.allowedRoles.includes(auth.user.role);
  }));
});

async function handleDocumentUpload(c: AppContext) {
  const auth = c.get('auth')!;
  const contentType = c.req.header('Content-Type') || '';

  let caseId = '';
  let stageId = '';
  let requirementId = '';
  let name = '';
  let fileName = '';
  let fileSize = 0;
  let mimeType = 'application/octet-stream';
  let fileBytes: Uint8Array | null = null;

  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    caseId = String(form.get('caseId') || '');
    stageId = String(form.get('stageId') || '');
    requirementId = String(form.get('requirementId') || '');
    name = String(form.get('name') || '');
    const file = form.get('file') as File | null;
    if (file) {
      fileName = file.name;
      fileSize = file.size;
      mimeType = guessMimeType(file.name, file.type);
      fileBytes = new Uint8Array(await file.arrayBuffer());
    }
  } else {
    const body = await c.req.json();
    caseId = body.caseId || '';
    stageId = body.stageId || '';
    requirementId = body.requirementId || '';
    name = body.name || '';
    fileName = body.fileName || '';
    fileSize = body.fileSize || 0;
    if (body.fileBase64) {
      const decoded = decodeDataUrl(body.fileBase64, guessMimeType(fileName));
      fileBytes = decoded.bytes;
      mimeType = decoded.mimeType;
      fileSize = decoded.bytes.byteLength;
    } else if (body.textContent !== undefined) {
      fileBytes = new TextEncoder().encode(String(body.textContent));
      mimeType = 'text/plain; charset=utf-8';
      fileSize = fileBytes.byteLength;
    }
  }

  if (!caseId || !stageId || !requirementId) {
    return c.json({ error: 'caseId, stageId y requirementId son obligatorios.' }, 400);
  }

  // Permiso acotado: un asesor solo carga requisitos de la etapa actual de su legajo asignado.
  // La autorización no se extiende a la sección general Documentos ni a otros legajos.
  const targetCase = await getCaseById(c.env.DB, caseId);
  if (!targetCase) return c.json({ error: 'Legajo no encontrado.' }, 404);
  const targetTemplate = await findTemplateOrVirtualById(c.env, targetCase.templateId);
  const targetStage = targetTemplate?.stages[targetCase.currentStageIndex];
  if (!targetStage || targetStage.id !== stageId ||
      !targetStage.requirements.some((r) => r.id === requirementId && r.type === 'document')) {
    return c.json({ error: 'El documento no corresponde a un requisito de la etapa actual.' }, 403);
  }
  if (auth.user.role === 'ASESOR') {
    if (targetCase.assignedAdvisorId !== auth.user.id || targetCase.isCurrentStageApproved) {
      return c.json({ error: 'No autorizado para cargar documentos en este legajo o etapa.' }, 403);
    }
  } else if (!['MANAGER', 'ADMIN', 'SUPERADMIN'].includes(auth.user.role)) {
    return c.json({ error: 'No autorizado.' }, 403);
  }

  // Enforce upload authorization constraints for ASESOR if an approved request exists
  if (auth.user.role === 'ASESOR') {
    const approvedReq = await c.env.DB.prepare(
      "SELECT * FROM upload_requests WHERE case_id = ? AND requirement_id = ? AND status = 'approved' ORDER BY reviewed_at DESC LIMIT 1"
    )
      .bind(caseId, requirementId)
      .first<any>();

    const caseObjCheck = await getCaseById(c.env.DB, caseId);
    const tpl = caseObjCheck ? await findTemplateOrVirtualById(c.env, caseObjCheck.templateId) : null;
    const reqDef = tpl?.stages.flatMap((s) => s.requirements).find((r) => r.id === requirementId);
    const isDigitalContract = reqDef?.documentSourceType === 'digital_contract';

    if (!isDigitalContract && approvedReq) {
      const maxBytes = (approvedReq.allowed_max_weight || 5) * 1024 * 1024;
      if (fileSize > maxBytes) {
        return c.json(
          { error: `El archivo excede el tamaño máximo autorizado (${approvedReq.allowed_max_weight || 5} MB).` },
          400
        );
      }
      if (
        approvedReq.allowed_extension &&
        fileName &&
        !fileName.toLowerCase().endsWith(String(approvedReq.allowed_extension).toLowerCase())
      ) {
        return c.json(
          { error: `Extensión no autorizada. Se requiere ${approvedReq.allowed_extension}.` },
          400
        );
      }
    }
  }

  let resolvedName = name;
  if (!resolvedName && requirementId) {
    if (requirementId.startsWith('req-digital-')) {
      const sId = requirementId.replace(/^req-digital-/, '');
      const shared = await c.env.DB.prepare('SELECT name FROM shared_documents WHERE id = ?')
        .bind(sId)
        .first<{ name: string }>();
      resolvedName = shared?.name || fileName || 'Documento';
    } else {
      const templates = await getAllTemplates(c.env.DB);
      const reqObj = templates.flatMap((t) => t.stages).flatMap((s) => s.requirements).find((r) => r.id === requirementId);
      resolvedName = reqObj?.name || fileName || 'Documento';
    }
  } else if (!resolvedName) {
    resolvedName = fileName || 'Documento';
  }

  const finalFileName = fileName || `${sanitizeFileName(resolvedName)}.pdf`;
  const now = new Date().toISOString();

  const existingDoc = await c.env.DB.prepare(
    'SELECT * FROM documents WHERE case_id = ? AND requirement_id = ?'
  )
    .bind(caseId, requirementId)
    .first<any>();

  const docId = existingDoc ? existingDoc.id : `doc-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
  const versionId = `ver-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
  const r2Key = `cases/${caseId}/${docId}/${versionId}-${sanitizeFileName(finalFileName)}`;

  if (fileBytes) {
    await c.env.R2_BUCKET.put(r2Key, fileBytes, {
      httpMetadata: { contentType: mimeType },
    });
  } else {
    // Digital contract snapshot placeholder if only text was persisted on case
    const caseRow = await c.env.DB.prepare('SELECT document_content FROM cases WHERE id = ?')
      .bind(caseId)
      .first<{ document_content: string }>();
    const contentBytes = new TextEncoder().encode(caseRow?.document_content || resolvedName);
    mimeType = 'text/plain; charset=utf-8';
    fileSize = contentBytes.byteLength;
    await c.env.R2_BUCKET.put(r2Key, contentBytes, {
      httpMetadata: { contentType: mimeType },
    });
  }

  if (existingDoc) {
    await c.env.DB.prepare(
      `UPDATE documents SET status = 'uploaded', file_name = ?, mime_type = ?, file_size = ?, r2_key = ?, uploaded_by = ?, uploaded_at = ?
       WHERE id = ?`
    )
      .bind(finalFileName, mimeType, fileSize, r2Key, auth.user.id, now, docId)
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO documents (id, case_id, stage_id, requirement_id, name, status, file_name, mime_type, file_size, r2_key, uploaded_by, uploaded_at)
       VALUES (?, ?, ?, ?, ?, 'uploaded', ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        docId,
        caseId,
        stageId,
        requirementId,
        resolvedName,
        finalFileName,
        mimeType,
        fileSize,
        r2Key,
        auth.user.id,
        now
      )
      .run();
  }

  await c.env.DB.prepare(
    `INSERT INTO document_versions (id, document_id, file_name, mime_type, file_size, r2_key, uploaded_by, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(versionId, docId, finalFileName, mimeType, fileSize, r2Key, auth.user.id, now)
    .run();

  const caseObj = await getCaseById(c.env.DB, caseId);
  if (caseObj && caseObj.status !== 'observed') {
    await c.env.DB.prepare("UPDATE cases SET status = 'pending_review', updated_at = ? WHERE id = ?")
      .bind(now, caseId)
      .run();
  }

  await createAudit(c.env.DB, auth.user.id, `Cargó documento "${resolvedName}"`, 'Document', docId, resolvedName);
  if (caseObj && caseObj.assignedManagerId) {
    await createNotification(
      c.env.DB,
      caseObj.assignedManagerId,
      'Documento para Revisar',
      `El asesor cargó "${resolvedName}" en el legajo ${caseObj.code}`,
      'info',
      caseId
    );
  }

  const allDocs = await getAllDocuments(c.env.DB);
  return c.json(allDocs.find((d) => d.id === docId), 201);
}

app.post('/api/documents', handleDocumentUpload);
app.post('/api/documents/upload', handleDocumentUpload);

app.get('/api/documents/:id/download', async (c) => {
  const auth = c.get('auth')!;
  const { id } = c.req.param();
  const versionId = c.req.query('versionId');

  const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<any>();
  if (!doc) return c.json({ error: 'Documento no encontrado.' }, 404);

  if (doc.status === 'approved' && doc.allowed_roles_json) {
    const allowed: string[] = JSON.parse(doc.allowed_roles_json);
    const caseObj = await getCaseById(c.env.DB, doc.case_id);
    const privateAccess = ['SUPERADMIN', 'ADMIN'].includes(auth.user.role) ||
      (auth.user.role === 'MANAGER' && caseObj?.assignedManagerId === auth.user.id) ||
      (auth.user.role === 'ASESOR' && caseObj?.assignedAdvisorId === auth.user.id);
    if (allowed.includes('PRIVATE_CASE_ADVISOR') ? !privateAccess :
      (!['SUPERADMIN', 'ADMIN'].includes(auth.user.role) && allowed.length > 0 && !allowed.includes(auth.user.role))) {
      return c.json({ error: 'No tienes permiso para descargar este documento.' }, 403);
    }
  }

  let r2Key = doc.r2_key;
  let fileName = doc.file_name || 'documento';
  let mimeType = doc.mime_type || guessMimeType(fileName);

  if (versionId) {
    const ver = await c.env.DB.prepare(
      'SELECT * FROM document_versions WHERE id = ? AND document_id = ?'
    )
      .bind(versionId, id)
      .first<any>();
    if (!ver) return c.json({ error: 'Versión no encontrada.' }, 404);
    r2Key = ver.r2_key;
    fileName = ver.file_name;
    mimeType = ver.mime_type || guessMimeType(fileName);
  }

  if (!r2Key) {
    return c.json({ error: 'Este documento no tiene archivo almacenado en R2.' }, 404);
  }

  const obj = await c.env.R2_BUCKET.get(r2Key);
  if (!obj) return c.json({ error: 'Archivo no encontrado en R2.' }, 404);

  await createAudit(c.env.DB, auth.user.id, `Descargó documento "${doc.name}"`, 'Document', doc.id, doc.name);
  return new Response(obj.body, {
    headers: {
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${sanitizeFileName(fileName)}"`,
    },
  });
});

app.post('/api/upload-requests/create', async (c) => {
  const auth = c.get('auth')!;
  const { caseId, stageId, requirementId, requirementName, requestedExtension } = await c.req.json();
  if (!caseId || !requirementId) {
    return c.json({ error: 'Faltan parámetros obligatorios.' }, 400);
  }

  const id = `uprq-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
  const now = new Date().toISOString();
  const reqName = requirementName || 'Documento';
  const ext = requestedExtension || '.pdf';

  await c.env.DB.prepare(
    `INSERT INTO upload_requests (id, case_id, stage_id, requirement_id, requirement_name, requested_by, requested_at, status, requested_extension)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  )
    .bind(id, caseId, stageId, requirementId, reqName, auth.user.id, now, ext)
    .run();

  const caseObj = await getCaseById(c.env.DB, caseId);
  await createAudit(
    c.env.DB,
    auth.user.id,
    `Solicitó permiso para subir archivo para "${reqName}" (Extensión: ${ext})`,
    'Case',
    caseId,
    caseObj?.title || 'Legajo'
  );

  if (caseObj) {
    let notifyId = caseObj.assignedManagerId;
    if (!notifyId) {
      const mgr = await c.env.DB.prepare(
        "SELECT id FROM users WHERE role IN ('MANAGER', 'ADMIN', 'SUPERADMIN') AND active = 1 LIMIT 1"
      ).first<{ id: string }>();
      notifyId = mgr?.id || '';
    }
    if (notifyId) {
      await createNotification(
        c.env.DB,
        notifyId,
        'Solicitud de Subida de Archivo',
        `El asesor ${auth.user.name} solicita subir un archivo ${ext} para "${reqName}" en legajo ${caseObj.code}`,
        'warning',
        caseId
      );
    }
  }

  return c.json(
    {
      id,
      caseId,
      stageId,
      requirementId,
      requirementName: reqName,
      requestedBy: auth.user.id,
      requestedAt: now,
      status: 'pending',
      requestedExtension: ext,
    },
    201
  );
});

app.post('/api/upload-requests/review', async (c) => {
  const auth = c.get('auth')!;
  if (!['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(auth.user.role)) {
    return c.json({ error: 'No autorizado para revisar solicitudes de carga.' }, 403);
  }
  const { id, status, allowedExtension, allowedMaxWeight, responseComment } = await c.req.json();
  const reqObj = await c.env.DB.prepare('SELECT * FROM upload_requests WHERE id = ?').bind(id).first<any>();
  if (!reqObj) return c.json({ error: 'Solicitud no encontrada.' }, 404);

  const now = new Date().toISOString();
  const finalExt = allowedExtension || reqObj.requested_extension;
  const finalWeight = allowedMaxWeight ? Number(allowedMaxWeight) : 5;

  await c.env.DB.prepare(
    `UPDATE upload_requests SET status = ?, allowed_extension = ?, allowed_max_weight = ?, response_comment = ?, reviewed_by = ?, reviewed_at = ?
     WHERE id = ?`
  )
    .bind(status, finalExt, finalWeight, responseComment || '', auth.user.id, now, id)
    .run();

  const caseObj = await getCaseById(c.env.DB, reqObj.case_id);
  await createAudit(
    c.env.DB,
    auth.user.id,
    `${status === 'approved' ? 'Aprobó' : 'Rechazó'} solicitud de subida para "${reqObj.requirement_name}"`,
    'Case',
    reqObj.case_id,
    caseObj?.title || 'Legajo'
  );

  await createNotification(
    c.env.DB,
    reqObj.requested_by,
    status === 'approved' ? 'Solicitud de Subida Aprobada' : 'Solicitud de Subida Rechazada',
    `Tu solicitud para subir "${reqObj.requirement_name}" fue ${status === 'approved' ? 'APROBADA' : 'RECHAZADA'} por ${auth.user.name}. ${status === 'approved' ? `Peso máx: ${finalWeight}MB, Ext: ${finalExt}` : `Nota: ${responseComment || ''}`}`,
    status === 'approved' ? 'success' : 'error',
    reqObj.case_id
  );

  return c.json({
    id: reqObj.id,
    caseId: reqObj.case_id,
    stageId: reqObj.stage_id,
    requirementId: reqObj.requirement_id,
    requirementName: reqObj.requirement_name,
    requestedBy: reqObj.requested_by,
    requestedAt: reqObj.requested_at,
    status,
    requestedExtension: reqObj.requested_extension,
    allowedExtension: finalExt,
    allowedMaxWeight: finalWeight,
    responseComment: responseComment || '',
    reviewedBy: auth.user.id,
    reviewedAt: now,
  });
});

async function handleDocumentReview(c: AppContext) {
  const auth = c.get('auth')!;
  if (!['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(auth.user.role)) {
    return c.json({ error: 'No autorizado para revisar documentos.' }, 403);
  }
  const { id } = c.req.param();
  const { status, observationText, allowedRoles } = await c.req.json();
  const docRow = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<any>();
  if (!docRow) return c.json({ error: 'Documento no encontrado' }, 404);
  if (!['approved', 'rejected', 'uploaded'].includes(status)) return c.json({ error: 'Estado inválido.' }, 400);
  if (docRow.status === 'approved' && status === 'rejected') {
    return c.json({ error: 'Primero debe revertir la aprobación para rechazar el documento.' }, 409);
  }
  if (status === 'uploaded' && docRow.status !== 'approved') {
    return c.json({ error: 'Solo se puede revertir un documento aprobado.' }, 409);
  }
  if (status === 'rejected' && (!observationText || !String(observationText).trim())) {
    return c.json({ error: 'Debe indicar una observación para el rechazo.' }, 400);
  }

  const rolesJson =
    status === 'approved'
      ? JSON.stringify(Array.isArray(allowedRoles) && allowedRoles.length ? allowedRoles : ['PRIVATE_CASE_ADVISOR'])
      : docRow.allowed_roles_json;

  await c.env.DB.prepare('UPDATE documents SET status = ?, allowed_roles_json = ? WHERE id = ?')
    .bind(status, rolesJson, id)
    .run();

  await createAudit(
    c.env.DB,
    auth.user.id,
    `Documento ${status === 'approved' ? 'aprobado' : status === 'uploaded' ? 'con aprobación revertida' : 'rechazado'}: "${docRow.name}"`,
    'Document',
    id,
    docRow.name
  );

  const caseObj = await getCaseById(c.env.DB, docRow.case_id);
  const now = new Date().toISOString();

  if (status === 'rejected') {
    const obsId = `obs-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
    const obsText = observationText || 'Documento rechazado por el gestor. Favor de verificar.';
    await c.env.DB.prepare(
      `INSERT INTO observations (id, case_id, stage_id, requirement_id, document_id, text, created_by, created_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`
    )
      .bind(obsId, docRow.case_id, docRow.stage_id, docRow.requirement_id, docRow.id, obsText, auth.user.id, now)
      .run();

    if (caseObj) {
      await c.env.DB.prepare("UPDATE cases SET status = 'observed', updated_at = ? WHERE id = ?")
        .bind(now, caseObj.id)
        .run();
      await createNotification(
        c.env.DB,
        caseObj.assignedAdvisorId,
        'Documento Rechazado',
        `Tu documento "${docRow.name}" en ${caseObj.code} fue rechazado. Motivo: ${obsText}`,
        'error',
        docRow.case_id
      );
    }
  } else if (caseObj) {
    const stageDocs = await c.env.DB.prepare(
      'SELECT status FROM documents WHERE case_id = ? AND stage_id = ?'
    )
      .bind(caseObj.id, docRow.stage_id)
      .all<{ status: string }>();
    const openObs = await c.env.DB.prepare(
      "SELECT id FROM observations WHERE case_id = ? AND stage_id = ? AND status = 'open' LIMIT 1"
    )
      .bind(caseObj.id, docRow.stage_id)
      .first();

    const hasObserved =
      Boolean(openObs) || (stageDocs.results || []).some((d) => d.status === 'rejected');
    const hasPendingReview = (stageDocs.results || []).some((d) => d.status === 'uploaded');
    const nextStatus = hasObserved ? 'observed' : hasPendingReview ? 'pending_review' : 'active';

    await c.env.DB.prepare('UPDATE cases SET status = ?, updated_at = ? WHERE id = ?')
      .bind(nextStatus, now, caseObj.id)
      .run();

    if (status === 'approved') await createNotification(
      c.env.DB,
      caseObj.assignedAdvisorId,
      'Documento Aprobado',
      `¡Excelente! Tu documento "${docRow.name}" en ${caseObj.code} fue aprobado.`,
      'success',
      docRow.case_id
    );
  }

  const allDocs = await getAllDocuments(c.env.DB);
  return c.json({
    doc: allDocs.find((d) => d.id === id),
    case: await getCaseById(c.env.DB, docRow.case_id),
  });
}

app.post('/api/documents/:id/review', handleDocumentReview);
app.put('/api/documents/:id/review', handleDocumentReview);


}
