import type { Hono } from 'hono';
import type { Env, AppVariables, QueueJob } from './types';
import type { ProcessTemplate, Participant } from '../src/types';
import { checkLoginRateLimit, recordFailedLoginAttempt, verifyPassword } from './crypto';
import { createAudit, createNotification, getAllCases, getCaseById, getSystemConfigValue, findTemplateOrVirtualById, validateStageRequirements } from './db';

type WorkerApp = Hono<{ Bindings: Env; Variables: AppVariables }>;

/** Legajos, participantes, borradores, estadísticas y permisos operativos. */
export function registerCaseRoutes(app: WorkerApp, dependencies: {
  dispatchQueueJob: (env: Env, job: QueueJob) => Promise<void>;
  getClientIp: (req: Request) => string;
}) {
const { dispatchQueueJob, getClientIp } = dependencies;
// ============================================================================
// 7. Cases (Expedientes / Legajos) & Participants
// ============================================================================
// Advisor statistics use persisted cases and audit events, never client-supplied scores.
// Personal activity feed: scoped to the authenticated advisor, never arbitrary user input.
app.get('/api/cases/my-activity', async (c) => {
  const auth = c.get('auth')!;
  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.user_name, a.user_role, a.action, a.entity_type,
            a.entity_name, a.created_at,
            CASE WHEN a.entity_type = 'Case' THEN a.entity_id
                 WHEN a.entity_type = 'Document' THEN d.case_id
                 WHEN a.entity_type = 'Observation' THEN o.case_id
                 WHEN a.entity_type = 'Participant' THEN p.case_id END AS case_id
     FROM audit_logs a
     LEFT JOIN documents d ON a.entity_type = 'Document' AND a.entity_id = d.id
     LEFT JOIN observations o ON a.entity_type = 'Observation' AND a.entity_id = o.id
     LEFT JOIN case_participants p ON a.entity_type = 'Participant' AND a.entity_id = p.id
     WHERE (a.entity_type = 'Case' AND a.entity_id IN (SELECT id FROM cases WHERE assigned_advisor_id = ?))
        OR (a.entity_type = 'Document' AND d.case_id IN (SELECT id FROM cases WHERE assigned_advisor_id = ?))
        OR (a.entity_type = 'Observation' AND o.case_id IN (SELECT id FROM cases WHERE assigned_advisor_id = ?))
        OR (a.entity_type = 'Participant' AND p.case_id IN (SELECT id FROM cases WHERE assigned_advisor_id = ?))
     ORDER BY a.created_at DESC, a.id DESC LIMIT 50`
  ).bind(auth.user.id, auth.user.id, auth.user.id, auth.user.id).all<any>();
  return c.json((rows.results || []).map((row: any) => ({
    id: row.id, userName: row.user_name, userRole: row.user_role,
    action: row.action, entityType: row.entity_type,
    entityName: row.entity_name, createdAt: row.created_at, caseId: row.case_id
  })));
});

// Team-level statistics: only users with statistics.manage may inspect other advisors.
app.get('/api/statistics/advisors', async (c) => {
  const auth = c.get('auth')!;
  const { hasRbacPermission } = await import('../src/rbac');
  const matrix = await getSystemConfigValue(c.env.DB, 'rbacMatrix', { roles: {}, users: {} });
  if (!hasRbacPermission(matrix, auth.user.role, auth.user.id, 'statistics.manage')) {
    return c.json({ error: 'No tiene permiso para consultar estadísticas del equipo.' }, 403);
  }
  const rows = await c.env.DB.prepare(
    `SELECT u.id AS advisorId, u.name AS name, u.last_name AS lastName,
       COUNT(cs.id) AS total,
       SUM(CASE WHEN cs.status = 'completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN cs.status = 'observed' THEN 1 ELSE 0 END) AS observed,
       SUM(CASE WHEN cs.status = 'pending_review' THEN 1 ELSE 0 END) AS pendingReview,
       SUM(CASE WHEN cs.status = 'active' THEN 1 ELSE 0 END) AS active
     FROM users u LEFT JOIN cases cs ON cs.assigned_advisor_id = u.id
     WHERE u.role = 'ASESOR'
     GROUP BY u.id, u.name, u.last_name ORDER BY total DESC, u.name ASC`
  ).all<any>();
  const advisors = await Promise.all((rows.results || []).map(async (row: any) => {
    const total = Number(row.total || 0);
    const completed = Number(row.completed || 0);
    const observed = Number(row.observed || 0);
    // Score document evidence, never completion status. Historical observations remain counted once, including after resolution.
    const evidence = await c.env.DB.prepare(
      `SELECT cs.id AS caseId,
        (SELECT COUNT(*) FROM documents d WHERE d.case_id = cs.id AND d.status = 'approved') AS approved,
        (SELECT COUNT(*) FROM documents d WHERE d.case_id = cs.id AND d.status = 'rejected') AS rejected,
        (SELECT COUNT(*) FROM document_history_events e WHERE e.case_id = cs.id AND e.event_type = 'observation') AS observationsCount,
        (SELECT COUNT(*) FROM document_history_events e WHERE e.case_id = cs.id AND e.event_type = 'rejection'
           AND NOT EXISTS (SELECT 1 FROM observations o WHERE o.document_id = e.document_id
             AND o.created_at BETWEEN datetime(e.occurred_at, '-1 minute') AND datetime(e.occurred_at, '+1 minute'))) AS untrackedRejected
       FROM cases cs WHERE cs.assigned_advisor_id = ?`
    ).bind(row.advisorId).all<any>();
    const samples = (evidence.results || []).map((item: any) => {
      const approved = Number(item.approved || 0);
      const errors = Number(item.untrackedRejected || 0) + Number(item.observationsCount || 0);
      return approved + errors > 0 ? 100 * approved / (approved + errors) : null;
    }).filter((value: number | null): value is number => value !== null);
    const rejectedDocuments = (evidence.results || []).reduce((sum: number, item: any) => sum + Number(item.rejected || 0), 0);
    const score = samples.length ? Math.round(samples.reduce((sum: number, value: number) => sum + value, 0) / samples.length) : null;
    const grade = score === null ? 'Sin datos' : score >= 95 ? 'Excelente' : score >= 85 ? 'Muy bueno' : score >= 70 ? 'Bueno' : score >= 55 ? 'Regular' : score >= 35 ? 'Deficiente' : 'Crítico';
    return {
      ...row, total, completed, observed, rejectedDocuments,
      pendingReview: Number(row.pendingReview || 0), active: Number(row.active || 0),
      score, grade, sampleSize: samples.length,
      factors: { completionRate: null, documentQuality: score, observedAvoidance: null }
    };
  }));
  return c.json({
    advisors,
    methodology: 'Promedio de calidad documental por legajo con evidencia: 100 × documentos aprobados / (aprobados + observaciones históricas + rechazos sin observación). El cierre del legajo no suma puntos. Sin evidencia no se califica.',
    note: 'Índice orientativo, no evaluación laboral definitiva: una observación puede depender del cliente o del responsable. No mide demoras atribuibles individualmente ni reemplaza la revisión humana.'
  });
});

app.get('/api/cases/advisor-statistics', async (c) => {
  const auth = c.get('auth')!;
  const requestedAdvisor = c.req.query('advisorId') || auth.user.id;
  const { hasRbacPermission } = await import('../src/rbac');
  const matrix = await getSystemConfigValue(c.env.DB, 'rbacMatrix', { roles: {}, users: {} });
  const own = requestedAdvisor === auth.user.id;
  const permission: 'statistics.view' | 'statistics.manage' = own ? 'statistics.view' : 'statistics.manage';
  if (!hasRbacPermission(matrix, auth.user.role, auth.user.id, permission)) {
    return c.json({ error: 'No tiene permiso para consultar estas estadísticas.' }, 403);
  }
  const rows = await c.env.DB.prepare(
    `SELECT assigned_advisor_id AS advisorId,
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN status = 'observed' THEN 1 ELSE 0 END) AS observed,
       SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END) AS pendingReview,
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN status = 'pending_assignment' THEN 1 ELSE 0 END) AS pendingAssignment,
       ROUND(AVG(CASE WHEN status = 'completed' AND julianday(updated_at) >= julianday(created_at)
         THEN (julianday(updated_at) - julianday(created_at)) * 24 END), 1) AS averageCompletedHours,
       MIN(CASE WHEN status = 'completed' THEN created_at END) AS firstCompletedCaseCreatedAt,
       MAX(CASE WHEN status = 'completed' THEN updated_at END) AS lastCompletedCaseUpdatedAt
     FROM cases WHERE assigned_advisor_id = ? GROUP BY assigned_advisor_id`
  ).bind(requestedAdvisor).first<any>();
  const summary = rows || { advisorId: requestedAdvisor, total: 0, completed: 0, observed: 0, pendingReview: 0, active: 0, pendingAssignment: 0, averageCompletedHours: null, firstCompletedCaseCreatedAt: null, lastCompletedCaseUpdatedAt: null };
  const completionEvents = await c.env.DB.prepare(
    `SELECT cs.id AS caseId, cs.created_at AS createdAt, MIN(a.created_at) AS completedAt
     FROM cases cs JOIN audit_logs a ON a.entity_type = 'Case'
       AND a.entity_id = cs.id AND a.action = 'Finalizó legajo'
     WHERE cs.assigned_advisor_id = ? AND cs.status = 'completed'
     GROUP BY cs.id, cs.created_at`
  ).bind(requestedAdvisor).all<any>();
  const durations = (completionEvents.results || [])
    .map((row: any) => (Date.parse(row.completedAt) - Date.parse(row.createdAt)) / 3600000)
    .filter((hours: number) => Number.isFinite(hours) && hours >= 0);
  const averageCompletedHours = durations.length
    ? Math.round(durations.reduce((sum: number, hours: number) => sum + hours, 0) / durations.length * 10) / 10
    : null;
  return c.json({
    ...summary,
    averageCompletedHours,
    completedCasesWithAudit: durations.length,
    note: 'Tiempo desde la creación hasta el primer evento auditado de finalización. Solo incluye legajos con evento registrado; no mide responsabilidad individual ni constituye calificación de desempeño.'
  });
});

// Drafts are private, incomplete forms; they never create cases, tasks or notifications.
app.get('/api/case-drafts', async (c) => {
  const auth = c.get('auth')!;
  const rows = await c.env.DB.prepare('SELECT id, payload_json, created_at, updated_at FROM case_drafts WHERE owner_id = ? ORDER BY updated_at DESC').bind(auth.user.id).all<any>();
  return c.json((rows.results || []).map(row => ({ id: row.id, ...JSON.parse(row.payload_json), createdAt: row.created_at, updatedAt: row.updated_at })));
});
app.put('/api/case-drafts/:id', async (c) => {
  const auth = c.get('auth')!;
  const id = c.req.param('id');
  if (!/^draft-[a-zA-Z0-9-]{8,100}$/.test(id)) return c.json({error:'Identificador de borrador inválido'},400);
  const payload = await c.req.json();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || JSON.stringify(payload).length > 250000) return c.json({error:'Datos de borrador inválidos'},400);
  const now = new Date().toISOString();
  await c.env.DB.prepare(`INSERT INTO case_drafts (id, owner_id, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at
    WHERE case_drafts.owner_id = excluded.owner_id`).bind(id,auth.user.id,JSON.stringify(payload),now,now).run();
  const row = await c.env.DB.prepare('SELECT id FROM case_drafts WHERE id = ? AND owner_id = ?').bind(id,auth.user.id).first();
  if (!row) return c.json({error:'No tenés acceso a este borrador'},403);
  return c.json({id,updatedAt:now});
});
app.delete('/api/case-drafts/:id', async (c) => {
  const auth = c.get('auth')!;
  await c.env.DB.prepare('DELETE FROM case_drafts WHERE id = ? AND owner_id = ?').bind(c.req.param('id'),auth.user.id).run();
  return c.json({ok:true});
});

app.get('/api/cases', async (c) => {
  const cases = await getAllCases(c.env.DB);
  return c.json(cases);
});

app.post('/api/cases', async (c) => {
  const auth = c.get('auth')!;
  const body = await c.req.json();
  const {
    title,
    description,
    templateId,
    assignedAdvisorId,
    assignedManagerId,
    participants,
    documentContent,
    pendingDocumentNames,
    generalFieldValues,
  } = body;

  if (!templateId || String(templateId).startsWith('doc-') || String(templateId).startsWith('tmpl-dig-')) {
    return c.json({ error: 'Seleccione un tipo de proceso configurado por un responsable. Los documentos digitalizados no son procesos.' }, 400);
  }
  let template = templateId ? await findTemplateOrVirtualById(c.env, templateId) : null;
  if (template?.originalDocumentContent) return c.json({ error: 'Un documento digitalizado no es un proceso operativo.' }, 400);
  if (!template) {
    if (!templateId) {
      const activeIndustry = await getSystemConfigValue<string>(c.env.DB, 'activeIndustry', 'Inmobiliaria');
      template = {
        id: '',
        name: 'Sin Plantilla',
        description: 'Proceso personalizado sin plantilla predefinida',
        industry: activeIndustry as ProcessTemplate['industry'],
        stages: [
          {
            id: 'stage-default',
            name: 'Revisión General',
            description: 'Etapa inicial de carga y validación de documentos',
            requirements: [],
          },
        ],
        originalDocumentContent: '',
      };
    } else {
      return c.json({ error: 'Plantilla de proceso no encontrada o documento no válido.' }, 404);
    }
  }

  if (!title?.trim() || !templateId || !template?.stages?.length) {
    return c.json({ error: 'Debe seleccionar un proceso configurado con al menos una etapa.' }, 400);
  }
  // Older digitized processes imported actor fields as tasks, not actor requirements.
  const importedRoles = new Set<string>();
  for (const req of template.stages.flatMap(stage => stage.requirements)) {
    if (req.type !== 'task' || !/CAMPO_\\d+/i.test(req.name)) continue;
    const prefix = String(req.name).split(' — ')[0].normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase();
    if (/^locador(?:es)?$/.test(prefix)) importedRoles.add('Locador');
    if (/^locatario(?:s)?$/.test(prefix)) importedRoles.add('Locatario');
    if (/^garante(?:s)?$/.test(prefix)) importedRoles.add('Garante');
    if (/^vendedor(?:es)?$/.test(prefix)) importedRoles.add('Vendedor');
    if (/^comprador(?:es)?$/.test(prefix)) importedRoles.add('Comprador');
  }
  for (const role of importedRoles) {
    if (!(Array.isArray(participants) ? participants : []).some((p:any) => p.role === role && p.name?.trim() && p.lastName?.trim() && p.dni?.trim()))
      return c.json({error:'Falta cargar el actor requerido: '+role},400);
  }
  const actorRequirements = template.stages.flatMap(stage => stage.requirements).filter(req => req.type === 'actor' && req.isRequired);
  for (const req of actorRequirements) {
    const count = (Array.isArray(participants) ? participants : []).filter((p: any) => p.role === req.actorRole && p.name?.trim() && p.lastName?.trim() && p.dni?.trim()).length;
    const min = Math.max(1, Number(req.minQuantity) || 1);
    if (count < min) return c.json({ error: `Faltan actores obligatorios: ${req.actorRole || req.name} (${count}/${min}).` }, 400);
  }

  const caseId = `case-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
  const code = `EXP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const finalManagerId = assignedManagerId || '';
  const requiredDocNames = template.stages.flatMap(stage => stage.requirements).filter(req => req.type === 'document' && req.isRequired).map(req => req.name);
  // Client-declared pending documents are advisory until uploads are verified in R2.
  const pendingNames = Array.isArray(pendingDocumentNames) ? pendingDocumentNames.filter((name: unknown) => typeof name === 'string' && requiredDocNames.some(reqName => (name as string).startsWith(reqName + ' — '))) : [];
  const status = pendingNames.length ? 'observed' : (finalManagerId ? 'active' : 'pending_assignment');
  const finalAdvisorId = assignedAdvisorId || auth.user.id;
  const now = new Date().toISOString();
  const finalDocContent = documentContent || template.originalDocumentContent || '';
  const showDoc = template.showDocumentToAll !== undefined ? (template.showDocumentToAll ? 1 : 0) : 1;
  const viewMode = template.sharedViewMode || 'both';

  await c.env.DB.prepare(
    `INSERT INTO cases (id, code, title, description, status, template_id, current_stage_index, assigned_advisor_id, assigned_manager_id, document_content, show_document_to_all, shared_view_mode, is_current_stage_approved, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0, ?, ?)`
  )
    .bind(
      caseId,
      code,
      title,
      description || '',
      status,
      templateId || '',
      finalAdvisorId,
      finalManagerId,
      finalDocContent,
      showDoc,
      viewMode,
      now,
      now
    )
    .run();

  if (Array.isArray(participants) && participants.length > 0) {
    const pStmts = participants.map((p: any) =>
      c.env.DB.prepare(
        `INSERT INTO case_participants (id, case_id, name, last_name, dni, cuit_cuil, email, phone, birth_date, role, comments)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        p.id || `prt-${crypto.randomUUID().slice(0, 8)}`,
        caseId,
        p.name || '',
        p.lastName || '',
        p.dni || '',
        p.cuitCuil || '',
        p.email || '',
        p.phone || '',
        p.birthDate || null,
        p.role || 'Vendedor',
        p.comments || ''
      )
    );
    await c.env.DB.batch(pStmts);
    const allowedFields = new Set(template.stages.flatMap(st => st.requirements).map(req => (String(req.name).match(/CAMPO_\\d+/i) || [])[0]).filter(Boolean));
    const values = participants.flatMap((p:any) => Object.entries(p.fieldValues || {}).filter(([fieldId,value]) => allowedFields.has(fieldId) && typeof value === 'string' && value.length <= 5000).map(([fieldId,value]) => ({participantId:p.id,fieldId,value})));
    if (values.length) await c.env.DB.batch(values.map((v:any) => c.env.DB.prepare('INSERT INTO case_field_values (case_id, participant_id, field_id, value) VALUES (?, ?, ?, ?)').bind(caseId,v.participantId,v.fieldId,v.value)));
  }

  if (generalFieldValues && typeof generalFieldValues === 'object' && !Array.isArray(generalFieldValues)) {
    const allowedFields = new Set(template.stages.flatMap(st => st.requirements).map(req => (String(req.name).match(/CAMPO_\d+/i) || [])[0]).filter(Boolean));
    const values = Object.entries(generalFieldValues).filter(([id,value]) => allowedFields.has(id) && typeof value === 'string' && value.length <= 5000);
    if (values.length) await c.env.DB.batch(values.map(([id,value]) => c.env.DB.prepare('INSERT INTO case_field_values (case_id, participant_id, field_id, value) VALUES (?, ?, ?, ?)').bind(caseId,'__operation__',id,value)));
  }

  const currentStage = template.stages[0];
  if (currentStage) {
    const tStmts = currentStage.requirements
      .filter((r) => r.type === 'task')
      .map((reqObj) =>
        c.env.DB.prepare(
          `INSERT INTO tasks (id, case_id, stage_id, requirement_id, name, description, status)
           VALUES (?, ?, ?, ?, ?, ?, 'pending')`
        ).bind(
          `tsk-${Date.now()}-${crypto.randomUUID().slice(0, 5)}`,
          caseId,
          currentStage.id,
          reqObj.id,
          reqObj.name,
          reqObj.description || ''
        )
      );
    if (tStmts.length > 0) {
      await c.env.DB.batch(tStmts);
    }
  }

  await createAudit(
    c.env.DB,
    auth.user.id,
    pendingNames.length ? `Legajo creado OBSERVADO: ${pendingNames.length} documentos pendientes (${pendingNames.join('; ')})` : status === 'pending_assignment' ? 'Solicitud de legajo creada' : 'Legajo creado',
    'Case',
    caseId,
    title
  );

  if (finalAdvisorId) {
    await createNotification(
      c.env.DB,
      finalAdvisorId,
      'Nuevo Legajo Creado',
      `Tu legajo ${code}: "${title}" fue registrado.`,
      'info',
      caseId
    );
  }

  if (status === 'pending_assignment') {
    const managers = await c.env.DB.prepare(
      "SELECT id FROM users WHERE role IN ('MANAGER', 'ADMIN', 'SUPERADMIN') AND active = 1"
    ).all<{ id: string }>();
    await dispatchQueueJob(c.env, {
      type: 'notification_fanout',
      payload: {
        userIds: (managers.results || []).map((m) => m.id),
        title: 'Nueva Solicitud de Legajo',
        message: `El asesor solicita iniciar el legajo ${code}: "${title}". Disponible para asignar.`,
        notifType: 'warning',
        caseId,
      },
    });
  } else if (finalManagerId) {
    await createNotification(
      c.env.DB,
      finalManagerId,
      'Legajo Asignado',
      `Se te asignó el legajo ${code}: "${title}".`,
      'info',
      caseId
    );
  }

  const created = await getCaseById(c.env.DB, caseId);
  return c.json(created, 201);
});

app.post('/api/cases/:id/assign-manager', async (c) => {
  const auth = c.get('auth')!;
  if (!['MANAGER', 'ADMIN', 'SUPERADMIN'].includes(auth.user.role)) {
    return c.json({ error: 'No autorizado para asignar Managers.' }, 403);
  }
  const { id } = c.req.param();
  const { managerId } = await c.req.json();
  const caseObj = await getCaseById(c.env.DB, id);
  if (!caseObj) return c.json({ error: 'Expediente no encontrado' }, 404);

  const manager = await c.env.DB.prepare(
    "SELECT * FROM users WHERE id = ? AND role IN ('MANAGER', 'ADMIN', 'SUPERADMIN')"
  )
    .bind(managerId)
    .first<any>();
  if (!manager) {
    return c.json({ error: 'Usuario especificado no es un Manager/Responsable válido.' }, 400);
  }

  await c.env.DB.prepare(
    "UPDATE cases SET assigned_manager_id = ?, status = 'active', updated_at = ? WHERE id = ?"
  )
    .bind(managerId, new Date().toISOString(), id)
    .run();

  await createAudit(c.env.DB, auth.user.id, 'Asignó manager a legajo', 'Case', id, caseObj.title);
  await createNotification(
    c.env.DB,
    caseObj.assignedAdvisorId,
    'Manager Asignado',
    `El manager ${manager.name} ${manager.last_name} ha sido asignado a tu legajo.`,
    'success',
    id
  );
  await createNotification(
    c.env.DB,
    managerId,
    'Nuevo Legajo Asignado',
    `Has sido asignado al legajo ${caseObj.code}: "${caseObj.title}".`,
    'info',
    id
  );

  return c.json(await getCaseById(c.env.DB, id));
});

app.post('/api/cases/:id/request-review', async (c) => {
  const auth = c.get('auth')!;
  const { id } = c.req.param();
  const { note } = await c.req.json();
  const caseObj = await getCaseById(c.env.DB, id);
  if (!caseObj) return c.json({ error: 'Legajo no encontrado.' }, 404);

  const templateForReview = await findTemplateOrVirtualById(c.env, caseObj.templateId);
  const stageForReview = templateForReview?.stages?.[caseObj.currentStageIndex];
  if (!stageForReview) return c.json({ error: 'El proceso no tiene una etapa válida.' }, 400);
  const validationForReview = await validateStageRequirements(c.env.DB, id, stageForReview.id, templateForReview!, 'submission');
  if (!validationForReview.isValid) return c.json({ error: 'Requisitos obligatorios pendientes', reasons: validationForReview.missing }, 400);

  await c.env.DB.prepare("UPDATE cases SET status = 'pending_review', updated_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), id)
    .run();

  if (caseObj.assignedManagerId) {
    const template = await findTemplateOrVirtualById(c.env, caseObj.templateId);
    const stageName = template?.stages?.[caseObj.currentStageIndex]?.name || 'Etapa actual';
    await createNotification(
      c.env.DB,
      caseObj.assignedManagerId,
      'Revisión de Etapa Solicitada',
      `El asesor ${auth.user.name} ${auth.user.lastName} ha completado el trabajo de la etapa "${stageName}" en el legajo "${caseObj.title}" y solicita su revisión.${note ? ` Nota: "${note}"` : ''}`,
      'info',
      caseObj.id
    );
  }

  await createAudit(c.env.DB, auth.user.id, 'Solicitó revisión de la etapa actual al Manager', 'Case', caseObj.id, caseObj.title);
  return c.json({ success: true, case: await getCaseById(c.env.DB, id) });
});

app.post('/api/cases/:id/request-reassignment', async (c) => {
  const auth = c.get('auth')!;
  const { id } = c.req.param();
  const { reason } = await c.req.json();
  const caseObj = await getCaseById(c.env.DB, id);
  if (!caseObj) return c.json({ error: 'Legajo no encontrado.' }, 404);

  const msgId = `msg-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  const now = new Date().toISOString();
  const subject = `Solicitud de Reasignación: Legajo "${caseObj.title}"`;
  const content = `El Manager ${auth.user.name} ${auth.user.lastName} solicita reasignar o liberar el legajo "${caseObj.title}" (ID: ${caseObj.id}).

Motivo:
"${reason}"`;

  await c.env.DB.prepare(
    `INSERT INTO system_messages (id, sender_id, sender_name, sender_role, receiver_id, receiver_name, receiver_role, subject, content, created_at, read, deleted_by_sender, deleted_by_receiver, permanent_deleted_by_sender, permanent_deleted_by_receiver)
     VALUES (?, ?, ?, ?, 'system', 'Sistema de Reasignaciones', 'SYSTEM', ?, ?, ?, 0, 0, 0, 0, 0)`
  )
    .bind(
      msgId,
      auth.user.id,
      `${auth.user.name} ${auth.user.lastName}`,
      auth.user.role,
      subject,
      content,
      now
    )
    .run();

  const admins = await c.env.DB.prepare(
    "SELECT id FROM users WHERE role IN ('SUPERADMIN', 'ADMIN') AND active = 1"
  ).all<{ id: string }>();

  await dispatchQueueJob(c.env, {
    type: 'notification_fanout',
    payload: {
      userIds: (admins.results || []).map((a) => a.id),
      title: 'Solicitud de Reasignación',
      message: `El manager ${auth.user.name} ha solicitado reasignar el legajo "${caseObj.title}".`,
      notifType: 'warning',
      caseId: caseObj.id,
    },
  });

  await createAudit(c.env.DB, auth.user.id, 'Solicitó reasignación / liberación del legajo', 'Case', caseObj.id, caseObj.title);
  return c.json({
    success: true,
    message: {
      id: msgId,
      senderId: auth.user.id,
      senderName: `${auth.user.name} ${auth.user.lastName}`,
      senderRole: auth.user.role,
      receiverId: 'system',
      receiverName: 'Sistema de Reasignaciones',
      receiverRole: 'SYSTEM',
      subject,
      content,
      createdAt: now,
      read: false,
      attachments: [],
    },
  });
});

app.put('/api/cases/:id', async (c) => {
  const auth = c.get('auth')!;
  const { id } = c.req.param();
  const body = await c.req.json();
  const oldCase = await getCaseById(c.env.DB, id);
  if (!oldCase) return c.json({ error: 'Legajo no encontrado' }, 404);

  const now = new Date().toISOString();
  const updatedTitle = body.title || oldCase.title;
  const updatedAdvisor = body.assignedAdvisorId || oldCase.assignedAdvisorId;

  await c.env.DB.prepare(
    `UPDATE cases SET title = ?, description = ?, assigned_advisor_id = ?, status = ?, document_content = ?,
     show_document_to_all = ?, shared_view_mode = ?, updated_at = ? WHERE id = ?`
  )
    .bind(
      updatedTitle,
      body.description || oldCase.description,
      updatedAdvisor,
      body.status || oldCase.status,
      body.documentContent !== undefined ? body.documentContent : oldCase.documentContent || '',
      body.showDocumentToAll !== undefined
        ? body.showDocumentToAll
          ? 1
          : 0
        : oldCase.showDocumentToAll !== false
          ? 1
          : 0,
      body.sharedViewMode !== undefined ? body.sharedViewMode : oldCase.sharedViewMode || 'both',
      now,
      id
    )
    .run();

  if (body.assignedAdvisorId && body.assignedAdvisorId !== oldCase.assignedAdvisorId) {
    await createNotification(
      c.env.DB,
      body.assignedAdvisorId,
      'Legajo Reasignado',
      `Se te reasignó el legajo ${oldCase.code}: "${updatedTitle}"`,
      'info',
      id
    );
  }

  await createAudit(c.env.DB, auth.user.id, body.auditAction || 'Legajo actualizado', 'Case', id, updatedTitle);
  return c.json(await getCaseById(c.env.DB, id));
});

app.delete('/api/cases/:id', async (c) => {
  const auth = c.get('auth')!;
  if (auth.user.role !== 'SUPERADMIN') {
    return c.json({ error: 'Solo el Superadmin puede eliminar legajos.' }, 403);
  }
  const { id } = c.req.param();
  const existing = await getCaseById(c.env.DB, id);
  if (!existing) return c.json({ error: 'Legajo no encontrado.' }, 404);

  // Clean up R2 objects belonging to case documents
  const vers = await c.env.DB.prepare(
    `SELECT dv.r2_key FROM document_versions dv
     JOIN documents d ON d.id = dv.document_id
     WHERE d.case_id = ? AND dv.r2_key IS NOT NULL`
  )
    .bind(id)
    .all<{ r2_key: string }>();

  for (const v of vers.results || []) {
    await c.env.R2_BUCKET.delete(v.r2_key);
  }

  await c.env.DB.prepare('DELETE FROM notifications WHERE case_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM case_field_values WHERE case_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM cases WHERE id = ?').bind(id).run();
  await createAudit(c.env.DB, auth.user.id, 'Legajo eliminado permanentemente', 'Case', id, existing.title);
  return c.json({ success: true, id });
});

app.post('/api/cases/:id/participants', async (c) => {
  const auth = c.get('auth')!;
  const { id } = c.req.param();
  const p = await c.req.json();
  const caseObj = await getCaseById(c.env.DB, id);
  if (!caseObj) return c.json({ error: 'Legajo no encontrado' }, 404);

  const partId = p.id || `prt-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
  await c.env.DB.prepare(
    `INSERT INTO case_participants (id, case_id, name, last_name, dni, cuit_cuil, email, phone, birth_date, role, comments)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      partId,
      id,
      p.name || '',
      p.lastName || '',
      p.dni || '',
      p.cuitCuil || '',
      p.email || '',
      p.phone || '',
      p.birthDate || null,
      p.role || 'Vendedor',
      p.comments || ''
    )
    .run();

  await c.env.DB.prepare('UPDATE cases SET updated_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), id)
    .run();

  await createAudit(
    c.env.DB,
    auth.user.id,
    `Añadió el actor ${p.name} ${p.lastName} (Rol: ${p.role || 'Vendedor'})`,
    'Case',
    id,
    caseObj.title
  );
  return c.json(await getCaseById(c.env.DB, id));
});

app.put('/api/cases/:id/participants/:participantId', async (c) => {
  const auth = c.get('auth')!;
  const { id, participantId } = c.req.param();
  const p = await c.req.json();
  const caseObj = await getCaseById(c.env.DB, id);
  if (!caseObj) return c.json({ error: 'Legajo no encontrado' }, 404);

  const oldPart = await c.env.DB.prepare(
    'SELECT * FROM case_participants WHERE id = ? AND case_id = ?'
  )
    .bind(participantId, id)
    .first<any>();
  if (!oldPart) return c.json({ error: 'Actor no encontrado en el legajo' }, 404);

  const nextName = p.name !== undefined ? p.name : oldPart.name;
  const nextLast = p.lastName !== undefined ? p.lastName : oldPart.last_name;
  const nextRole = p.role !== undefined ? p.role : oldPart.role;

  await c.env.DB.prepare(
    `UPDATE case_participants SET name = ?, last_name = ?, dni = ?, cuit_cuil = ?, email = ?, phone = ?, birth_date = ?, role = ?, comments = ?
     WHERE id = ? AND case_id = ?`
  )
    .bind(
      nextName,
      nextLast,
      p.dni !== undefined ? p.dni : oldPart.dni,
      p.cuitCuil !== undefined ? p.cuitCuil : oldPart.cuit_cuil,
      p.email !== undefined ? p.email : oldPart.email,
      p.phone !== undefined ? p.phone : oldPart.phone,
      p.birthDate !== undefined ? p.birthDate : oldPart.birth_date,
      nextRole,
      p.comments !== undefined ? p.comments : oldPart.comments,
      participantId,
      id
    )
    .run();

  await c.env.DB.prepare('UPDATE cases SET updated_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), id)
    .run();

  await createAudit(
    c.env.DB,
    auth.user.id,
    `Modificó datos del actor ${nextName} ${nextLast} (Rol: ${nextRole})`,
    'Case',
    id,
    caseObj.title
  );
  return c.json(await getCaseById(c.env.DB, id));
});

app.delete('/api/cases/:id/participants/:participantId', async (c) => {
  const auth = c.get('auth')!;
  const { id, participantId } = c.req.param();
  const caseObj = await getCaseById(c.env.DB, id);
  if (!caseObj) return c.json({ error: 'Legajo no encontrado' }, 404);

  const oldPart = await c.env.DB.prepare(
    'SELECT * FROM case_participants WHERE id = ? AND case_id = ?'
  )
    .bind(participantId, id)
    .first<any>();

  await c.env.DB.prepare('DELETE FROM case_field_values WHERE case_id = ? AND participant_id = ?').bind(id,participantId).run();
  await c.env.DB.prepare('DELETE FROM case_participants WHERE id = ? AND case_id = ?')
    .bind(participantId, id)
    .run();

  await c.env.DB.prepare('UPDATE cases SET updated_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), id)
    .run();

  await createAudit(
    c.env.DB,
    auth.user.id,
    oldPart
      ? `Eliminó el actor ${oldPart.name} ${oldPart.last_name} (Rol: ${oldPart.role || 'Actor'})`
      : 'Eliminó un actor del legajo',
    'Case',
    id,
    caseObj.title
  );
  return c.json(await getCaseById(c.env.DB, id));
});

app.post('/api/cases/:id/reopen', async (c) => {
  const auth = c.get('auth')!;
  if (!['MANAGER', 'ADMIN', 'SUPERADMIN'].includes(auth.user.role)) {
    return c.json({ error: 'No autorizado para reabrir legajos.' }, 403);
  }
  const { id } = c.req.param();
  const { password } = await c.req.json().catch(() => ({}));
  if (typeof password !== 'string' || !password) return c.json({ error: 'Ingrese su contraseña.' }, 400);
  const caseObj = await getCaseById(c.env.DB, id);
  if (!caseObj) return c.json({ error: 'Legajo no encontrado.' }, 404);
  if (caseObj.status !== 'completed') return c.json({ error: 'El legajo no está finalizado.' }, 409);
  if (auth.user.role === 'MANAGER' && caseObj.assignedManagerId !== auth.user.id) {
    return c.json({ error: 'Solo el manager responsable puede reabrir este legajo.' }, 403);
  }
  const userRow = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ? AND active = 1').bind(auth.user.id).first<{ password_hash: string }>();
  const rateKey = `reopen:${getClientIp(c.req.raw)}:${auth.user.id}`;
  const rateCheck = await checkLoginRateLimit(c.env, rateKey);
  if (!rateCheck.allowed) return c.json({ error: 'Demasiados intentos. Intente nuevamente más tarde.' }, 429);
  if (!userRow || !(await verifyPassword(password, userRow.password_hash))) {
    await recordFailedLoginAttempt(c.env, rateKey);
    return c.json({ error: 'Contraseña incorrecta.' }, 401);
  }
  await c.env.DB.prepare("UPDATE cases SET status = 'active', is_current_stage_approved = 1, updated_at = ? WHERE id = ? AND status = 'completed'")
    .bind(new Date().toISOString(), id).run();
  await createAudit(c.env.DB, auth.user.id, 'Reabrió legajo con validación de contraseña', 'Case', id, caseObj.title);
  return c.json({ success: true, case: await getCaseById(c.env.DB, id) });
});



}
