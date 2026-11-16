import type {
  AppDataState,
  AuditLog,
  Case,
  Document,
  DocumentVersion,
  FormDataValue,
  Notification,
  Observation,
  Participant,
  ProcessTemplate,
  Role,
  SharedDocument,
  Stage,
  SystemMessage,
  SystemSettings,
  Task,
  UploadRequest,
  User,
} from '../src/types';
import type { Env } from './types';

export const DEFAULT_VERIFICATION_POLICIES = {
  global: 'admin_approval' as const,
  ASESOR: 'admin_approval' as const,
  MANAGER: 'admin_approval' as const,
  ADMIN: 'admin_approval' as const,
};

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  aiModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  aiAllowedRoles: ['ADMIN', 'MANAGER'],
  aiSettingsRoles: [],
  roleMessagingConfigs: {
    SUPERADMIN: { allowed: true, rule: 'free' },
    ADMIN: { allowed: true, rule: 'free' },
    MANAGER: { allowed: true, rule: 'free' },
    ASESOR: { allowed: true, rule: 'free' },
  },
  allowAdminManagerTemplates: true,
  processTemplateRequired: true,
};

export function mapUserRow(row: any, includeSensitive = false): User {
  const user: User = {
    id: row.id,
    name: row.name,
    lastName: row.last_name,
    email: row.email,
    role: row.role as Role,
    avatar: row.avatar || undefined,
    phone: row.phone || '',
    active: row.active === 1 || row.active === true,
    address: row.address || '',
    city: row.city || '',
    province: row.province || '',
    country: row.country || '',
    isVerified: row.is_verified === 1 || row.is_verified === true,
    hasSensitiveEditPermissionOverride:
      row.has_sensitive_edit_override === null || row.has_sensitive_edit_override === undefined
        ? undefined
        : row.has_sensitive_edit_override === 1,
  };
  if (includeSensitive) {
    user.passwordHash = row.password_hash;
    user.tokenCreatedAt = row.token_created_at || undefined;
  }
  return user;
}

export async function getSystemConfigValue<T>(db: D1Database, key: string, fallback: T): Promise<T> {
  const row = await db
    .prepare('SELECT value FROM system_config WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export async function setSystemConfigValue(db: D1Database, key: string, value: any): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(key, JSON.stringify(value), now)
    .run();
}

export async function createAudit(
  db: D1Database,
  userId: string,
  action: string,
  entityType: string,
  entityId: string,
  entityName: string
): Promise<AuditLog> {
  const userRow = await db
    .prepare('SELECT name, last_name, role FROM users WHERE id = ?')
    .bind(userId)
    .first<{ name: string; last_name: string; role: string }>();

  const userName = userRow ? `${userRow.name} ${userRow.last_name}`.trim() : 'Sistema';
  const userRole = userRow ? userRow.role : 'SYSTEM';

  const log: AuditLog = {
    id: `log-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
    userId,
    userName,
    userRole,
    action,
    entityType,
    entityId,
    entityName,
    createdAt: new Date().toISOString(),
  };

  await db
    .prepare(
      `INSERT INTO audit_logs (id, user_id, user_name, user_role, action, entity_type, entity_id, entity_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      log.id,
      log.userId,
      log.userName,
      log.userRole,
      log.action,
      log.entityType,
      log.entityId,
      log.entityName,
      log.createdAt
    )
    .run();

  return log;
}

export async function createNotification(
  db: D1Database,
  userId: string,
  title: string,
  message: string,
  type: 'info' | 'success' | 'warning' | 'error',
  caseId?: string
): Promise<Notification> {
  const notif: Notification = {
    id: `notif-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
    userId,
    title,
    message,
    type,
    read: false,
    createdAt: new Date().toISOString(),
    caseId,
  };

  await db
    .prepare(
      `INSERT INTO notifications (id, user_id, title, message, type, read, created_at, case_id)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .bind(notif.id, notif.userId, notif.title, notif.message, notif.type, notif.createdAt, notif.caseId ?? null)
    .run();

  return notif;
}

export async function canUserManageTemplates(db: D1Database, userId: string): Promise<boolean> {
  const user = await db
    .prepare('SELECT role FROM users WHERE id = ?')
    .bind(userId)
    .first<{ role: string }>();
  if (!user) return false;
  if (user.role === 'SUPERADMIN') return true;
  if (user.role === 'ASESOR') return false;
  const settings = await getSystemConfigValue<SystemSettings>(
    db,
    'systemSettings',
    DEFAULT_SYSTEM_SETTINGS
  );
  return settings.allowAdminManagerTemplates !== false;
}

export async function getAllTemplates(db: D1Database): Promise<ProcessTemplate[]> {
  const [tplRows, stageRows, reqRows] = await Promise.all([
    db.prepare('SELECT * FROM process_templates ORDER BY created_at ASC').all<any>(),
    db.prepare('SELECT * FROM template_stages ORDER BY stage_order ASC').all<any>(),
    db.prepare('SELECT * FROM stage_requirements ORDER BY req_order ASC').all<any>(),
  ]);

  const reqsByStage = new Map<string, any[]>();
  for (const r of reqRows.results || []) {
    const arr = reqsByStage.get(r.stage_id) || [];
    const actorMetadata = r.type === 'task' && r.form_fields_json ? JSON.parse(r.form_fields_json) : null;
    const isActor = r.type === 'actor' || actorMetadata?.requirementKind === 'actor';
    arr.push({
      id: r.id,
      name: r.name,
      type: isActor ? 'actor' : r.type,
      description: r.description || '',
      isRequired: r.is_required === 1,
      formFields: r.type === 'form' && r.form_fields_json ? JSON.parse(r.form_fields_json) : undefined,
      actorRole: isActor && r.form_fields_json ? JSON.parse(r.form_fields_json).actorRole : undefined,
      minQuantity: isActor && r.form_fields_json ? JSON.parse(r.form_fields_json).minQuantity : undefined,
      documentSourceType: r.document_source_type || undefined,
      linkedTemplateId: r.linked_template_id || undefined,
      linkedSharedDocumentId: r.linked_shared_document_id || undefined,
    });
    reqsByStage.set(r.stage_id, arr);
  }

  const stagesByTpl = new Map<string, Stage[]>();
  for (const s of stageRows.results || []) {
    const arr = stagesByTpl.get(s.template_id) || [];
    arr.push({
      id: s.id,
      name: s.name,
      description: s.description || '',
      requirements: reqsByStage.get(s.id) || [],
    });
    stagesByTpl.set(s.template_id, arr);
  }

  return (tplRows.results || []).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description || '',
    industry: t.industry as ProcessTemplate['industry'],
    stages: stagesByTpl.get(t.id) || [],
    originalDocumentContent: t.original_document_content || '',
    showDocumentToAll: t.show_document_to_all === 1,
    sharedViewMode: (t.shared_view_mode || 'both') as ProcessTemplate['sharedViewMode'],
  }));
}

export async function findTemplateOrVirtualById(
  env: Env,
  templateId: string
): Promise<ProcessTemplate | null> {
  const all = await getAllTemplates(env.DB);
  const direct = all.find((t) => t.id === templateId);
  if (direct) return direct;

  if (templateId && templateId.startsWith('doc-')) {
    const docId = templateId.replace(/^doc-/, '');
    const shared = await env.DB.prepare('SELECT * FROM shared_documents WHERE id = ?')
      .bind(docId)
      .first<any>();
    if (!shared) return null;

    let decodedContent = '';
    if (shared.r2_key && (shared.file_name?.endsWith('.txt') || shared.mime_type?.startsWith('text/'))) {
      const obj = await env.R2_BUCKET.get(shared.r2_key);
      if (obj) {
        decodedContent = await obj.text();
      }
    }

    const activeIndustry = await getSystemConfigValue<string>(
      env.DB,
      'activeIndustry',
      'Inmobiliaria'
    );

    return {
      id: templateId,
      name: shared.name,
      description: `Proceso creado a partir del documento: ${shared.name}`,
      industry: activeIndustry as ProcessTemplate['industry'],
      stages: [
        {
          id: `stage-digital-${docId}`,
          name: 'Revisión y Firma',
          description: 'Etapa inicial para la edición, revisión y firma del documento digitalizado',
          requirements: [
            {
              id: `req-digital-${docId}`,
              name: shared.name,
              type: 'document',
              description: `Complete los campos y firme el documento: ${shared.name}`,
              isRequired: true,
              documentSourceType: 'digital_contract',
              linkedSharedDocumentId: docId,
            },
          ],
        },
      ],
      originalDocumentContent: decodedContent,
      showDocumentToAll: true,
      sharedViewMode: 'both',
    };
  }

  return null;
}

export async function getAllCases(db: D1Database): Promise<Case[]> {
  const [casesRes, partsRes] = await Promise.all([
    db.prepare('SELECT * FROM cases ORDER BY created_at DESC').all<any>(),
    db.prepare('SELECT * FROM case_participants').all<any>(),
  ]);

  const partsByCase = new Map<string, Participant[]>();
  for (const p of partsRes.results || []) {
    const arr = partsByCase.get(p.case_id) || [];
    arr.push({
      id: p.id,
      name: p.name,
      lastName: p.last_name,
      dni: p.dni || '',
      cuitCuil: p.cuit_cuil || '',
      email: p.email || '',
      phone: p.phone || '',
      birthDate: p.birth_date || undefined,
      role: (p.role || 'Vendedor') as Participant['role'],
      comments: p.comments || '',
    });
    partsByCase.set(p.case_id, arr);
  }

  return (casesRes.results || []).map((c) => ({
    id: c.id,
    code: c.code,
    title: c.title,
    description: c.description || '',
    status: c.status as Case['status'],
    templateId: c.template_id || '',
    currentStageIndex: c.current_stage_index ?? 0,
    assignedAdvisorId: c.assigned_advisor_id || '',
    assignedManagerId: c.assigned_manager_id || '',
    participants: partsByCase.get(c.id) || [],
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    documentContent: c.document_content || '',
    showDocumentToAll: c.show_document_to_all === 1,
    sharedViewMode: (c.shared_view_mode || 'both') as Case['sharedViewMode'],
    isCurrentStageApproved: c.is_current_stage_approved === 1,
  }));
}

export async function getCaseById(db: D1Database, caseId: string): Promise<Case | null> {
  const c = await db.prepare('SELECT * FROM cases WHERE id = ?').bind(caseId).first<any>();
  if (!c) return null;
  const partsRes = await db
    .prepare('SELECT * FROM case_participants WHERE case_id = ?')
    .bind(caseId)
    .all<any>();

  return {
    id: c.id,
    code: c.code,
    title: c.title,
    description: c.description || '',
    status: c.status as Case['status'],
    templateId: c.template_id || '',
    currentStageIndex: c.current_stage_index ?? 0,
    assignedAdvisorId: c.assigned_advisor_id || '',
    assignedManagerId: c.assigned_manager_id || '',
    participants: (partsRes.results || []).map((p) => ({
      id: p.id,
      name: p.name,
      lastName: p.last_name,
      dni: p.dni || '',
      cuitCuil: p.cuit_cuil || '',
      email: p.email || '',
      phone: p.phone || '',
      birthDate: p.birth_date || undefined,
      role: (p.role || 'Vendedor') as Participant['role'],
      comments: p.comments || '',
    })),
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    documentContent: c.document_content || '',
    showDocumentToAll: c.show_document_to_all === 1,
    sharedViewMode: (c.shared_view_mode || 'both') as Case['sharedViewMode'],
    isCurrentStageApproved: c.is_current_stage_approved === 1,
  };
}

export async function getAllDocuments(db: D1Database): Promise<Document[]> {
  const [docsRes, verRes] = await Promise.all([
    db.prepare('SELECT * FROM documents').all<any>(),
    db.prepare('SELECT * FROM document_versions ORDER BY uploaded_at ASC').all<any>(),
  ]);

  const versByDoc = new Map<string, DocumentVersion[]>();
  for (const v of verRes.results || []) {
    const arr = versByDoc.get(v.document_id) || [];
    arr.push({
      id: v.id,
      fileName: v.file_name,
      mimeType: v.mime_type || undefined,
      fileSize: v.file_size || 0,
      r2Key: v.r2_key || undefined,
      uploadedBy: v.uploaded_by,
      uploadedAt: v.uploaded_at,
    });
    versByDoc.set(v.document_id, arr);
  }

  return (docsRes.results || []).map((d) => ({
    id: d.id,
    caseId: d.case_id,
    stageId: d.stage_id,
    requirementId: d.requirement_id,
    name: d.name,
    status: d.status as Document['status'],
    fileName: d.file_name || undefined,
    mimeType: d.mime_type || undefined,
    fileSize: d.file_size || 0,
    r2Key: d.r2_key || undefined,
    uploadedBy: d.uploaded_by || undefined,
    uploadedAt: d.uploaded_at || undefined,
    versions: versByDoc.get(d.id) || [],
    allowedRoles: d.allowed_roles_json ? JSON.parse(d.allowed_roles_json) : undefined,
  }));
}

export async function getAllSharedDocuments(env: Env): Promise<SharedDocument[]> {
  const res = await env.DB.prepare('SELECT * FROM shared_documents ORDER BY uploaded_at DESC').all<any>();
  return (res.results || []).map((d) => ({
    id: d.id,
    name: d.name,
    fileName: d.file_name,
    mimeType: d.mime_type || undefined,
    fileSize: d.file_size || 0,
    r2Key: d.r2_key,
    uploadedBy: d.uploaded_by,
    uploadedAt: d.uploaded_at,
    allowedRoles: d.allowed_roles_json ? JSON.parse(d.allowed_roles_json) : [],
    allowedUserIds: d.allowed_user_ids_json ? JSON.parse(d.allowed_user_ids_json) : [],
    downloadUrl: `/api/shared-documents/${d.id}/download`,
  }));
}

export async function getFullState(
  env: Env,
  requestingUser: User,
  realUser: User
): Promise<AppDataState> {
  const isSuper = requestingUser.role === 'SUPERADMIN' || realUser.role === 'SUPERADMIN';
  const db = env.DB;

  const [
    usersRes,
    templates,
    cases,
    documents,
    tasksRes,
    obsRes,
    notifsRes,
    auditRes,
    formSubsRes,
    uploadReqsRes,
    sharedDocs,
    msgsRes,
    msgAttsRes,
    activeIndustry,
    verificationPolicies,
    systemSettings,
  ] = await Promise.all([
    db.prepare('SELECT * FROM users ORDER BY created_at ASC').all<any>(),
    getAllTemplates(db),
    getAllCases(db),
    getAllDocuments(db),
    db.prepare('SELECT * FROM tasks').all<any>(),
    db.prepare('SELECT * FROM observations ORDER BY created_at DESC').all<any>(),
    db.prepare('SELECT * FROM notifications ORDER BY created_at DESC').all<any>(),
    db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500').all<any>(),
    db.prepare('SELECT * FROM form_submissions').all<any>(),
    db.prepare('SELECT * FROM upload_requests ORDER BY requested_at DESC').all<any>(),
    getAllSharedDocuments(env),
    db.prepare('SELECT * FROM system_messages ORDER BY created_at DESC').all<any>(),
    db.prepare('SELECT * FROM message_attachments').all<any>(),
    getSystemConfigValue<string>(db, 'activeIndustry', 'Inmobiliaria'),
    getSystemConfigValue<any>(db, 'verificationPolicies', DEFAULT_VERIFICATION_POLICIES),
    getSystemConfigValue<SystemSettings>(db, 'systemSettings', DEFAULT_SYSTEM_SETTINGS),
  ]);

  const allUsers = (usersRes.results || []).map((r) => mapUserRow(r, false));
  const superadminIds = new Set(allUsers.filter((u) => u.role === 'SUPERADMIN').map((u) => u.id));

  const filteredUsers = isSuper ? allUsers : allUsers.filter((u) => u.role !== 'SUPERADMIN');

  const tasks: Task[] = (tasksRes.results || []).map((t) => ({
    id: t.id,
    caseId: t.case_id,
    stageId: t.stage_id,
    requirementId: t.requirement_id,
    name: t.name,
    description: t.description || '',
    status: t.status as Task['status'],
    completedBy: t.completed_by || undefined,
    completedAt: t.completed_at || undefined,
  }));

  const observations: Observation[] = (obsRes.results || []).map((o) => ({
    id: o.id,
    caseId: o.case_id,
    stageId: o.stage_id,
    requirementId: o.requirement_id || undefined,
    documentId: o.document_id || undefined,
    text: o.text,
    createdBy: o.created_by,
    createdAt: o.created_at,
    status: o.status as Observation['status'],
    resolvedBy: o.resolved_by || undefined,
    resolvedAt: o.resolved_at || undefined,
    response: o.response || undefined,
  }));

  const notifications: Notification[] = (notifsRes.results || []).map((n) => ({
    id: n.id,
    userId: n.user_id,
    title: n.title,
    message: n.message,
    type: n.type as Notification['type'],
    read: n.read === 1,
    createdAt: n.created_at,
    caseId: n.case_id || undefined,
  }));

  const rawLogs: AuditLog[] = (auditRes.results || []).map((l) => ({
    id: l.id,
    userId: l.user_id,
    userName: l.user_name,
    userRole: l.user_role,
    action: l.action,
    entityType: l.entity_type,
    entityId: l.entity_id,
    entityName: l.entity_name,
    createdAt: l.created_at,
  }));

  const filteredAuditLogs = isSuper
    ? rawLogs
    : rawLogs.filter((log) => {
        if (superadminIds.has(log.userId)) return false;
        if (log.userRole === 'SUPERADMIN') return false;
        if (log.action && (log.action.includes('SUPERADMIN') || log.action.includes('Superadmin'))) {
          return false;
        }
        if (
          log.entityName &&
          (log.entityName.includes('SUPERADMIN') || log.entityName.includes('Superadmin'))
        ) {
          return false;
        }
        return true;
      });

  const formSubmissions: FormDataValue[] = (formSubsRes.results || []).map((f) => ({
    requirementId: f.requirement_id,
    values: JSON.parse(f.values_json),
    submittedBy: f.submitted_by,
    submittedAt: f.submitted_at,
  }));

  const uploadRequests: UploadRequest[] = (uploadReqsRes.results || []).map((r) => ({
    id: r.id,
    caseId: r.case_id,
    stageId: r.stage_id,
    requirementId: r.requirement_id,
    requirementName: r.requirement_name,
    requestedBy: r.requested_by,
    requestedAt: r.requested_at,
    status: r.status as UploadRequest['status'],
    requestedExtension: r.requested_extension,
    allowedExtension: r.allowed_extension || undefined,
    allowedMaxWeight: r.allowed_max_weight ?? undefined,
    responseComment: r.response_comment || undefined,
    reviewedBy: r.reviewed_by || undefined,
    reviewedAt: r.reviewed_at || undefined,
  }));

  const attsByMsg = new Map<string, any[]>();
  for (const a of msgAttsRes.results || []) {
    const arr = attsByMsg.get(a.message_id) || [];
    arr.push({
      id: a.id,
      name: a.name,
      mimeType: a.mime_type || undefined,
      size: a.size || 0,
      r2Key: a.r2_key,
      downloadUrl: `/api/system-messages/attachments/${a.id}/download`,
    });
    attsByMsg.set(a.message_id, arr);
  }

  const rawMsgs: SystemMessage[] = (msgsRes.results || []).map((m) => ({
    id: m.id,
    senderId: m.sender_id,
    senderName: m.sender_name,
    senderRole: m.sender_role,
    receiverId: m.receiver_id,
    receiverName: m.receiver_name,
    receiverRole: m.receiver_role,
    subject: m.subject,
    content: m.content,
    createdAt: m.created_at,
    read: m.read === 1,
    deletedBySender: m.deleted_by_sender === 1,
    deletedByReceiver: m.deleted_by_receiver === 1,
    permanentDeletedBySender: m.permanent_deleted_by_sender === 1,
    permanentDeletedByReceiver: m.permanent_deleted_by_receiver === 1,
    attachments: attsByMsg.get(m.id) || [],
  }));

  const filteredMessages = isSuper
    ? rawMsgs
    : rawMsgs.filter(
        (m) => !superadminIds.has(m.senderId) && !superadminIds.has(m.receiverId)
      );

  // Build virtual templates for text/digitized shared documents
  const virtualTemplates: ProcessTemplate[] = [];
  for (const doc of sharedDocs) {
    const isDigital =
      doc.name.toLowerCase().includes('digitalizado') ||
      doc.fileName.endsWith('.txt');
    let decodedContent = '';
    if (isDigital && doc.r2Key) {
      try {
        const obj = await env.R2_BUCKET.get(doc.r2Key);
        if (obj) {
          decodedContent = await obj.text();
        }
      } catch {
        decodedContent = '';
      }
    }

    virtualTemplates.push({
      id: `doc-${doc.id}`,
      name: `Documento: ${doc.name}`,
      description: `Proceso creado a partir del documento compartido: ${doc.name}`,
      industry: activeIndustry as ProcessTemplate['industry'],
      stages: [
        {
          id: `stage-digital-${doc.id}`,
          name: 'Revisión y Firma',
          description: 'Etapa inicial para la edición, revisión y firma del documento digitalizado',
          requirements: [
            {
              id: `req-digital-${doc.id}`,
              name: doc.name,
              type: 'document',
              description: `Complete los campos y firme el documento: ${doc.name}`,
              isRequired: true,
              documentSourceType: 'digital_contract',
              linkedSharedDocumentId: doc.id,
            },
          ],
        },
      ],
      originalDocumentContent: decodedContent,
      showDocumentToAll: true,
      sharedViewMode: 'both',
    });
  }

  return {
    users: filteredUsers,
    templates: [...templates, ...virtualTemplates],
    cases,
    documents,
    tasks,
    observations,
    notifications,
    auditLogs: filteredAuditLogs,
    formSubmissions,
    uploadRequests,
    activeIndustry,
    verificationPolicies,
    systemSettings,
    systemMessages: filteredMessages,
    sharedDocuments: sharedDocs,
  };
}

export async function validateStageRequirements(
  db: D1Database,
  caseId: string,
  stageId: string,
  template: ProcessTemplate
): Promise<{ isValid: boolean; missing: string[] }> {
  const stage = template.stages.find((s) => s.id === stageId);
  if (!stage) return { isValid: false, missing: ['Etapa no válida'] };

  const [docsRes, tasksRes, obsRes, subsRes, participantsRes] = await Promise.all([
    db
      .prepare('SELECT requirement_id, status FROM documents WHERE case_id = ? AND stage_id = ?')
      .bind(caseId, stageId)
      .all<any>(),
    db
      .prepare('SELECT requirement_id, status FROM tasks WHERE case_id = ? AND stage_id = ?')
      .bind(caseId, stageId)
      .all<any>(),
    db
      .prepare(
        "SELECT id FROM observations WHERE case_id = ? AND stage_id = ? AND status = 'open'"
      )
      .bind(caseId, stageId)
      .all<any>(),
    db.prepare('SELECT requirement_id, values_json FROM form_submissions WHERE case_id = ? AND stage_id = ?').bind(caseId, stageId).all<any>(),
    db.prepare('SELECT role, name, last_name, dni FROM case_participants WHERE case_id = ?').bind(caseId).all<any>(),
  ]);

  const docs = docsRes.results || [];
  const tasks = tasksRes.results || [];
  const openObs = obsRes.results || [];
  const subs = new Map((subsRes.results || []).map((s: any) => [s.requirement_id, JSON.parse(s.values_json || '{}')]));
  const participants = participantsRes.results || [];

  const missing: string[] = [];

  for (const req of stage.requirements) {
    if (!req.isRequired || (req.type === 'document' && req.documentSourceType === 'digital_contract')) continue;

    if (req.type === 'actor') {
      const count = participants.filter((p: any) => p.role === req.actorRole && p.name?.trim() && p.last_name?.trim() && p.dni?.trim()).length;
      const minimum = Math.max(1, Number(req.minQuantity) || 1);
      if (count < minimum) missing.push(`Actores pendientes: ${req.actorRole || req.name} (${count}/${minimum})`);
      continue;
    }

    if (req.type === 'document') {
      const doc = docs.find((d: any) => d.requirement_id === req.id);
      if (!doc || doc.status === 'pending') {
        missing.push(`Documento faltante: "${req.name}"`);
      } else if (doc.status === 'rejected') {
        missing.push(`Documento rechazado: "${req.name}" (Debe ser aprobado)`);
      } else if (doc.status === 'in_review' || doc.status === 'uploaded') {
        missing.push(`Documento en revisión: "${req.name}" (Requiere aprobación del Manager)`);
      }
    } else if (req.type === 'task') {
      const task = tasks.find((t: any) => t.requirement_id === req.id);
      if (!task || task.status !== 'completed') {
        missing.push(`Tarea pendiente: "${req.name}"`);
      }
    } else if (req.type === 'form') {
      if (!subs.has(req.id)) {
        missing.push(`Formulario pendiente: "${req.name}"`);
      }
    }
  }

  if (openObs.length > 0) {
    missing.push(
      `Observación abierta: Hay ${openObs.length} observaciones pendientes de resolución.`
    );
  }

  return {
    isValid: missing.length === 0,
    missing,
  };
}
