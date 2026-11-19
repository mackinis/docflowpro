import type { Hono } from 'hono';
import type { Env, AppVariables, QueueJob } from './types';
import { getAllSharedDocuments, createAudit, canUserManageTemplates } from './db';
import { decodeDataUrl, guessMimeType, sanitizeFileName } from './document-parser';

type WorkerApp = Hono<{ Bindings: Env; Variables: AppVariables }>;

/** Shared-document library: permissions, D1 metadata and R2 storage. */
export function registerSharedDocumentRoutes(app: WorkerApp, dispatchQueueJob: (env: Env, job: QueueJob) => Promise<void>) {
// ============================================================================
// 8. Shared Documents Library (R2 + D1)
// ============================================================================
app.get('/api/shared-documents', async (c) => {
  const auth = c.get('auth')!;
  const allDocs = await getAllSharedDocuments(c.env);
  if (auth.user.role === 'SUPERADMIN') {
    return c.json(allDocs);
  }
  const visible = allDocs.filter((doc) => {
    const roleAllowed = doc.allowedRoles && doc.allowedRoles.includes(auth.user.role);
    const userAllowed = doc.allowedUserIds && doc.allowedUserIds.includes(auth.user.id);
    return roleAllowed || userAllowed;
  });
  return c.json(visible);
});

app.get('/api/shared-documents/:id/content', async (c) => {
  const auth = c.get('auth')!;
  const { id } = c.req.param();
  const doc = await c.env.DB.prepare('SELECT * FROM shared_documents WHERE id = ?').bind(id).first<any>();
  if (!doc) return c.json({ error: 'Documento no encontrado.' }, 404);

  const roles: string[] = doc.allowed_roles_json ? JSON.parse(doc.allowed_roles_json) : [];
  const userIds: string[] = doc.allowed_user_ids_json ? JSON.parse(doc.allowed_user_ids_json) : [];
  if (
    auth.user.role !== 'SUPERADMIN' &&
    !roles.includes(auth.user.role) &&
    !userIds.includes(auth.user.id)
  ) {
    return c.json({ error: 'Acceso denegado.' }, 403);
  }

  const obj = await c.env.R2_BUCKET.get(doc.r2_key);
  if (!obj) return c.json({ error: 'Contenido no encontrado en R2.' }, 404);
  const text = await obj.text();
  return c.json({ content: text });
});

app.get('/api/shared-documents/:id/download', async (c) => {
  const auth = c.get('auth')!;
  const { id } = c.req.param();
  const doc = await c.env.DB.prepare('SELECT * FROM shared_documents WHERE id = ?').bind(id).first<any>();
  if (!doc) return c.json({ error: 'Documento no encontrado.' }, 404);

  const roles: string[] = doc.allowed_roles_json ? JSON.parse(doc.allowed_roles_json) : [];
  const userIds: string[] = doc.allowed_user_ids_json ? JSON.parse(doc.allowed_user_ids_json) : [];
  if (
    auth.user.role !== 'SUPERADMIN' &&
    !roles.includes(auth.user.role) &&
    !userIds.includes(auth.user.id)
  ) {
    return c.json({ error: 'Acceso denegado.' }, 403);
  }

  const obj = await c.env.R2_BUCKET.get(doc.r2_key);
  if (!obj) return c.json({ error: 'Archivo no encontrado en R2.' }, 404);

  await createAudit(
    c.env.DB,
    auth.user.id,
    `Visualizó / descargó documento compartido "${doc.name}"`,
    'SharedDocument',
    doc.id,
    doc.name
  );

  return new Response(obj.body, {
    headers: {
      'Content-Type': doc.mime_type || guessMimeType(doc.file_name),
      'Content-Disposition': `attachment; filename="${sanitizeFileName(doc.file_name)}"`,
    },
  });
});

app.post('/api/shared-documents', async (c) => {
  const auth = c.get('auth')!;
  if (auth.user.role !== 'SUPERADMIN' && !(await canUserManageTemplates(c.env.DB, auth.user.id))) {
    return c.json({ error: 'No tienes permisos suficientes para subir documentos compartidos.' }, 403);
  }

  const contentType = c.req.header('Content-Type') || '';
  let name = '';
  let fileName = '';
  let fileSize = 0;
  let mimeType = 'application/octet-stream';
  let fileBytes: Uint8Array | null = null;
  let allowedRoles: string[] = ['SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR'];
  let allowedUserIds: string[] = [];
  let digitizationSource: string | null = null;
  let digitizationFieldMap: any[] | null = null;

  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    name = String(form.get('name') || '');
    const file = form.get('file') as File | null;
    if (file) {
      fileName = file.name;
      fileSize = file.size;
      mimeType = guessMimeType(file.name, file.type);
      fileBytes = new Uint8Array(await file.arrayBuffer());
    }
    const rolesRaw = form.get('allowedRoles');
    const usersRaw = form.get('allowedUserIds');
    if (rolesRaw) allowedRoles = JSON.parse(String(rolesRaw));
    if (usersRaw) allowedUserIds = JSON.parse(String(usersRaw));
  } else {
    const body = await c.req.json();
    name = body.name || '';
    fileName = body.fileName || '';
    fileSize = body.fileSize || 0;
    allowedRoles = body.allowedRoles || allowedRoles;
    allowedUserIds = body.allowedUserIds || [];
    if (typeof body.digitizationSource === 'string' && Array.isArray(body.digitizationFieldMap)) {
      digitizationSource = body.digitizationSource;
      digitizationFieldMap = body.digitizationFieldMap;
    }
    if (body.fileBase64) {
      const decoded = decodeDataUrl(body.fileBase64, guessMimeType(fileName));
      fileBytes = decoded.bytes;
      mimeType = decoded.mimeType;
      fileSize = decoded.bytes.byteLength;
    }
  }

  if (!name || !fileName || !fileBytes) {
    return c.json({ error: 'Faltan campos obligatorios (nombre, nombre de archivo o contenido).' }, 400);
  }

  const docId = `sh-doc-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
  const r2Key = `shared/${docId}/${sanitizeFileName(fileName)}`;
  await c.env.R2_BUCKET.put(r2Key, fileBytes, { httpMetadata: { contentType: mimeType } });
  if (digitizationSource !== null && digitizationFieldMap !== null) {
    await c.env.R2_BUCKET.put(r2Key + '.fieldmap.json', JSON.stringify({originalDocumentContent:digitizationSource,fieldMap:digitizationFieldMap}), {httpMetadata:{contentType:'application/json'}});
  }

  const uploadedByLabel = `${auth.user.name} ${auth.user.lastName} (${auth.user.role})`;
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO shared_documents (id, name, file_name, mime_type, file_size, r2_key, uploaded_by, uploaded_at, allowed_roles_json, allowed_user_ids_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      docId,
      name,
      fileName,
      mimeType,
      fileSize,
      r2Key,
      uploadedByLabel,
      now,
      JSON.stringify(allowedRoles),
      JSON.stringify(allowedUserIds)
    )
    .run();

  await createAudit(c.env.DB, auth.user.id, `Subió documento compartido "${name}"`, 'SharedDocument', docId, name);

  const allUsers = await c.env.DB.prepare('SELECT id, role FROM users WHERE active = 1').all<{ id: string; role: string }>();
  const targetUserIds = (allUsers.results || [])
    .filter(
      (u) =>
        u.id !== auth.user.id &&
        (allowedRoles.includes(u.role) || allowedUserIds.includes(u.id))
    )
    .map((u) => u.id);

  if (targetUserIds.length > 0) {
    await dispatchQueueJob(c.env, {
      type: 'notification_fanout',
      payload: {
        userIds: targetUserIds,
        title: 'Nuevo Documento Compartido',
        message: `Se ha subido el documento "${name}" a la biblioteca para tu descarga.`,
        notifType: 'info',
      },
    });
  }

  return c.json(
    {
      id: docId,
      name,
      fileName,
      mimeType,
      fileSize,
      r2Key,
      uploadedBy: uploadedByLabel,
      uploadedAt: now,
      allowedRoles,
      allowedUserIds,
      downloadUrl: `/api/shared-documents/${docId}/download`,
    },
    201
  );
});

app.put('/api/shared-documents/:id', async (c) => {
  const auth = c.get('auth')!;
  const { id } = c.req.param();
  const body = await c.req.json();
  const doc = await c.env.DB.prepare('SELECT * FROM shared_documents WHERE id = ?').bind(id).first<any>();
  if (!doc) return c.json({ error: 'Documento no encontrado.' }, 404);

  if ((body.allowedRoles || body.allowedUserIds) && auth.user.role !== 'SUPERADMIN') {
    return c.json({ error: 'Sólo el Superadmin puede actualizar los permisos de acceso.' }, 403);
  }

  let nextFileSize = body.fileSize !== undefined ? body.fileSize : doc.file_size;
  if (body.dataUrl !== undefined) {
    const decoded = decodeDataUrl(body.dataUrl, doc.mime_type || guessMimeType(doc.file_name));
    await c.env.R2_BUCKET.put(doc.r2_key, decoded.bytes, {
      httpMetadata: { contentType: decoded.mimeType },
    });
    nextFileSize = decoded.bytes.byteLength;
  } else if (body.textContent !== undefined) {
    const bytes = new TextEncoder().encode(String(body.textContent));
    await c.env.R2_BUCKET.put(doc.r2_key, bytes, {
      httpMetadata: { contentType: 'text/plain; charset=utf-8' },
    });
    nextFileSize = bytes.byteLength;
  }

  const nextName = body.name || doc.name;
  const nextRoles = body.allowedRoles ? JSON.stringify(body.allowedRoles) : doc.allowed_roles_json;
  const nextUsers = body.allowedUserIds ? JSON.stringify(body.allowedUserIds) : doc.allowed_user_ids_json;

  await c.env.DB.prepare(
    'UPDATE shared_documents SET name = ?, file_size = ?, allowed_roles_json = ?, allowed_user_ids_json = ? WHERE id = ?'
  )
    .bind(nextName, nextFileSize, nextRoles, nextUsers, id)
    .run();

  await createAudit(c.env.DB, auth.user.id, `Actualizó el documento compartido "${nextName}"`, 'SharedDocument', id, nextName);
  const updated = (await getAllSharedDocuments(c.env)).find((d) => d.id === id);
  return c.json({ success: true, doc: updated });
});

app.delete('/api/shared-documents/:id', async (c) => {
  const auth = c.get('auth')!;
  if (auth.user.role !== 'SUPERADMIN') {
    return c.json({ error: 'Sólo el Superadmin puede eliminar documentos de la biblioteca.' }, 403);
  }
  const { id } = c.req.param();
  const doc = await c.env.DB.prepare('SELECT * FROM shared_documents WHERE id = ?').bind(id).first<any>();
  if (!doc) return c.json({ error: 'Documento no encontrado en la biblioteca.' }, 404);

  if (doc.r2_key) {
    await c.env.R2_BUCKET.delete(doc.r2_key);
  }
  await c.env.DB.prepare('DELETE FROM shared_documents WHERE id = ?').bind(id).run();
  await createAudit(c.env.DB, auth.user.id, `Eliminó documento compartido "${doc.name}"`, 'SharedDocument', id, doc.name);
  return c.json({ success: true, id });
});


}
