import { Hono, type Context } from 'hono';
import type { Env, AppVariables } from './types';
import { createAudit, createNotification, fieldIdForTask, getCaseById, isFieldTaskComplete } from './db';

type WorkerApp = Hono<{ Bindings: Env; Variables: AppVariables }>;
type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

/** Case tasks, observations, forms, immutable audit and case history routes. */
export function registerCaseWorkflowRoutes(app: WorkerApp, registerNotificationRoutes: (app: WorkerApp) => void) {
// ============================================================================
// 10. Tasks, Observations, Forms, Notifications, Audit Logs
// ============================================================================
app.get('/api/cases/:caseId/tasks', async (c) => {
  const { caseId } = c.req.param();
  const [res, valuesRes] = await Promise.all([\n    c.env.DB.prepare('SELECT * FROM tasks WHERE case_id = ?').bind(caseId).all<any>(),\n    c.env.DB.prepare('SELECT field_id, value FROM case_field_values WHERE case_id = ?').bind(caseId).all<any>(),\n  ]);\n  const fieldValues = valuesRes.results || [];
  return c.json(
    (res.results || []).map((t) => ({
      id: t.id,
      caseId: t.case_id,
      stageId: t.stage_id,
      requirementId: t.requirement_id,
      name: t.name,
      description: t.description || '',
      status: fieldIdForTask(t.name) ? (isFieldTaskComplete(t.name, fieldValues) ? 'completed' : 'pending') : t.status,
      completedBy: t.completed_by || undefined,
      completedAt: t.completed_at || undefined,
    }))
  );
});

async function handleTaskToggle(c: AppContext) {
  const auth = c.get('auth')!;
  const { id } = c.req.param();
  const { status } = await c.req.json();
  const task = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<any>();
  if (!task) return c.json({ error: 'Tarea no encontrada' }, 404);\n  if (fieldIdForTask(task.name)) return c.json({ error: 'Esta tarea se completa automáticamente al guardar el campo correspondiente.' }, 409);

  const now = status === 'completed' ? new Date().toISOString() : null;
  const completedBy = status === 'completed' ? auth.user.id : null;

  await c.env.DB.prepare('UPDATE tasks SET status = ?, completed_by = ?, completed_at = ? WHERE id = ?')
    .bind(status, completedBy, now, id)
    .run();

  await createAudit(
    c.env.DB,
    auth.user.id,
    `Tarea marcada como ${status === 'completed' ? 'completa' : 'pendiente'}: "${task.name}"`,
    'Task',
    id,
    task.name
  );

  return c.json({
    id: task.id,
    caseId: task.case_id,
    stageId: task.stage_id,
    requirementId: task.requirement_id,
    name: task.name,
    description: task.description || '',
    status,
    completedBy: completedBy || undefined,
    completedAt: now || undefined,
  });
}

app.post('/api/tasks/:id', handleTaskToggle);
app.put('/api/tasks/:id', handleTaskToggle);
app.post('/api/tasks/:id/toggle', handleTaskToggle);
app.put('/api/tasks/:id/toggle', handleTaskToggle);

app.get('/api/cases/:caseId/observations', async (c) => {
  const { caseId } = c.req.param();
  const res = await c.env.DB.prepare('SELECT * FROM observations WHERE case_id = ? ORDER BY created_at DESC')
    .bind(caseId)
    .all<any>();
  return c.json(
    (res.results || []).map((o) => ({
      id: o.id,
      caseId: o.case_id,
      stageId: o.stage_id,
      requirementId: o.requirement_id || undefined,
      documentId: o.document_id || undefined,
      text: o.text,
      createdBy: o.created_by,
      createdAt: o.created_at,
      status: o.status,
      resolvedBy: o.resolved_by || undefined,
      resolvedAt: o.resolved_at || undefined,
      response: o.response || undefined,
    }))
  );
});

app.post('/api/observations', async (c) => {
  const auth = c.get('auth')!;
  const { caseId, stageId, text, requirementId } = await c.req.json();
  const obsId = `obs-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO observations (id, case_id, stage_id, requirement_id, text, created_by, created_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`
  )
    .bind(obsId, caseId, stageId, requirementId || null, text, auth.user.id, now)
    .run();

  const caseObj = await getCaseById(c.env.DB, caseId);
  if (caseObj) {
    await c.env.DB.prepare("UPDATE cases SET status = 'observed', updated_at = ? WHERE id = ?")
      .bind(now, caseId)
      .run();
    await createNotification(
      c.env.DB,
      caseObj.assignedAdvisorId,
      'Nueva Observación',
      `Se agregó una observación en el legajo ${caseObj.code}: "${text}"`,
      'warning',
      caseId
    );
  }

  await createAudit(c.env.DB, auth.user.id, 'Observación agregada', 'Observation', obsId, `${text.substring(0, 30)}...`);
  return c.json(
    {
      id: obsId,
      caseId,
      stageId,
      requirementId,
      text,
      createdBy: auth.user.id,
      createdAt: now,
      status: 'open',
    },
    201
  );
});

async function handleResolveObservation(c: AppContext) {
  const auth = c.get('auth')!;
  const { id } = c.req.param();
  const { response } = await c.req.json();
  const obs = await c.env.DB.prepare('SELECT * FROM observations WHERE id = ?').bind(id).first<any>();
  if (!obs) return c.json({ error: 'Observación no encontrada' }, 404);

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "UPDATE observations SET status = 'resolved', response = ?, resolved_by = ?, resolved_at = ? WHERE id = ?"
  )
    .bind(response || '', auth.user.id, now, id)
    .run();

  if (obs.document_id) {
    await c.env.DB.prepare(
      "UPDATE documents SET status = 'uploaded' WHERE id = ? AND status = 'rejected'"
    )
      .bind(obs.document_id)
      .run();
  }

  const caseObj = await getCaseById(c.env.DB, obs.case_id);
  if (caseObj) {
    const [openObs, rejDocs, upDocs] = await Promise.all([
      c.env.DB.prepare(
        "SELECT id FROM observations WHERE case_id = ? AND stage_id = ? AND status = 'open' LIMIT 1"
      )
        .bind(caseObj.id, obs.stage_id)
        .first(),
      c.env.DB.prepare(
        "SELECT id FROM documents WHERE case_id = ? AND stage_id = ? AND status = 'rejected' LIMIT 1"
      )
        .bind(caseObj.id, obs.stage_id)
        .first(),
      c.env.DB.prepare(
        "SELECT id FROM documents WHERE case_id = ? AND stage_id = ? AND status = 'uploaded' LIMIT 1"
      )
        .bind(caseObj.id, obs.stage_id)
        .first(),
    ]);

    const nextStatus =
      openObs || rejDocs ? 'observed' : upDocs ? 'pending_review' : 'active';
    await c.env.DB.prepare('UPDATE cases SET status = ?, updated_at = ? WHERE id = ?')
      .bind(nextStatus, now, caseObj.id)
      .run();

    if (caseObj.assignedManagerId) {
      await createNotification(
        c.env.DB,
        caseObj.assignedManagerId,
        'Observación Respondida',
        `El asesor respondió a la observación en ${caseObj.code}`,
        'success',
        obs.case_id
      );
    }
  }

  await createAudit(c.env.DB, auth.user.id, 'Observación resuelta', 'Observation', id, `${obs.text.substring(0, 30)}...`);
  return c.json({
    obs: {
      id: obs.id,
      caseId: obs.case_id,
      stageId: obs.stage_id,
      requirementId: obs.requirement_id || undefined,
      documentId: obs.document_id || undefined,
      text: obs.text,
      createdBy: obs.created_by,
      createdAt: obs.created_at,
      status: 'resolved',
      resolvedBy: auth.user.id,
      resolvedAt: now,
      response,
    },
    case: await getCaseById(c.env.DB, obs.case_id),
  });
}

app.post('/api/observations/:id/reopen', async (c) => {
  const auth = c.get('auth')!;
  if (!['MANAGER', 'ADMIN', 'SUPERADMIN'].includes(auth.user.role)) return c.json({ error: 'Sin autorización' }, 403);
  const { id } = c.req.param();
  const obs = await c.env.DB.prepare('SELECT * FROM observations WHERE id = ?').bind(id).first<any>();
  if (!obs) return c.json({ error: 'Observación no encontrada' }, 404);
  if (obs.status !== 'resolved') return c.json({ error: 'La observación no está cumplida' }, 409);
  const now = new Date().toISOString();
  await c.env.DB.prepare("UPDATE observations SET status = 'open', response = NULL, resolved_by = NULL, resolved_at = NULL WHERE id = ? AND status = 'resolved'").bind(id).run();
  await c.env.DB.prepare("UPDATE cases SET status = 'observed', updated_at = ? WHERE id = ?").bind(now, obs.case_id).run();
  await createAudit(c.env.DB, auth.user.id, 'Cumplimiento de observación revertido', 'Observation', id, obs.text.substring(0, 80));
  return c.json({ success: true });
});

app.post('/api/observations/:id/resolve', handleResolveObservation);
app.put('/api/observations/:id/resolve', handleResolveObservation);

app.post('/api/forms/submit', async (c) => {
  const auth = c.get('auth')!;
  const { caseId, stageId, requirementId, values } = await c.req.json();
  const now = new Date().toISOString();
  const id = `frm-${crypto.randomUUID().slice(0, 8)}`;

  await c.env.DB.prepare(
    `INSERT INTO form_submissions (id, case_id, stage_id, requirement_id, values_json, submitted_by, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(requirement_id) DO UPDATE SET
       values_json = excluded.values_json,
       submitted_by = excluded.submitted_by,
       submitted_at = excluded.submitted_at`
  )
    .bind(id, caseId || null, stageId || null, requirementId, JSON.stringify(values), auth.user.id, now)
    .run();

  await createAudit(c.env.DB, auth.user.id, 'Formulario guardado', 'Form', requirementId, 'Valores guardados');
  return c.json({ requirementId, values, submittedBy: auth.user.id, submittedAt: now });
});

app.get('/api/forms/:requirementId', async (c) => {
  const { requirementId } = c.req.param();
  const sub = await c.env.DB.prepare('SELECT * FROM form_submissions WHERE requirement_id = ?')
    .bind(requirementId)
    .first<any>();
  if (!sub) return c.json(null);
  return c.json({
    requirementId: sub.requirement_id,
    values: JSON.parse(sub.values_json),
    submittedBy: sub.submitted_by,
    submittedAt: sub.submitted_at,
  });
});



registerNotificationRoutes(app);

// Per-legajo chronology: read-only and scoped to the assigned advisor or supervising roles.
app.get('/api/cases/:id/history', async (c) => {
  const auth = c.get('auth')!;
  const id = c.req.param('id');
  const item = await getCaseById(c.env.DB, id);
  if (!item) return c.json({ error: 'Legajo no encontrado.' }, 404);
  if (auth.user.role === 'ASESOR' && item.assignedAdvisorId !== auth.user.id) {
    return c.json({ error: 'No tiene acceso al historial de este legajo.' }, 403);
  }
  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.user_id, a.user_name, a.user_role, a.action,
            a.entity_type, a.entity_id, a.entity_name, a.created_at
     FROM audit_logs a
     WHERE (a.entity_type = 'Case' AND a.entity_id = ?)
        OR (a.entity_type = 'Document' AND a.entity_id IN (SELECT id FROM documents WHERE case_id = ?))
        OR (a.entity_type = 'Observation' AND a.entity_id IN (SELECT id FROM observations WHERE case_id = ?))
        OR (a.entity_type = 'Participant' AND a.entity_id IN (SELECT id FROM case_participants WHERE case_id = ?))
     ORDER BY a.created_at ASC, a.id ASC LIMIT 1000`
  ).bind(id, id, id, id).all<any>();
  const events = (rows.results || []).map((row: any) => ({
    id: row.id, userId: row.user_id, userName: row.user_name,
    userRole: row.user_role, action: row.action, entityType: row.entity_type,
    entityId: row.entity_id, entityName: row.entity_name, createdAt: row.created_at
  }));
  const completion = await c.env.DB.prepare(
    "SELECT MIN(created_at) AS completedAt FROM audit_logs WHERE entity_type = 'Case' AND entity_id = ? AND action = 'Finalizó legajo'"
  ).bind(id).first<{ completedAt: string | null }>();
  const completedAt = completion?.completedAt || null;
  const endTime = completedAt ? Date.parse(completedAt) : Date.now();
  const contributors = new Map<string, { userId: string; userName: string; userRole: string; interventions: number; firstAt: string; lastAt: string; actions: Record<string, number> }>();
  for (const event of events) {
    const key = event.userId || event.userName || 'unknown';
    const entry = contributors.get(key) || { userId: event.userId, userName: event.userName, userRole: event.userRole, interventions: 0, firstAt: event.createdAt, lastAt: event.createdAt, actions: {} };
    entry.interventions++;
    entry.lastAt = event.createdAt;
    entry.actions[event.action] = (entry.actions[event.action] || 0) + 1;
    contributors.set(key, entry);
  }
  // Derive elapsed time per stage from immutable-in-UI server events.
  // Open stages use the current time; completed stages use their next transition.
  const transitions = events.filter((event: any) => event.entityType === 'Case' && (event.action.startsWith('Avanzó etapa a "') || event.action === 'Finalizó legajo'));
  const stageDurations: { stage: string; startedAt: string; endedAt: string; durationMs: number; ongoing: boolean }[] = [];
  let stageStart = item.createdAt;
  let stageName = 'Etapa inicial';
  for (const event of transitions) {
    const end = Date.parse(event.createdAt);
    stageDurations.push({ stage: stageName, startedAt: stageStart, endedAt: event.createdAt, durationMs: Math.max(0, end - Date.parse(stageStart)), ongoing: false });
    if (event.action === 'Finalizó legajo') { stageStart = ''; break; }
    stageName = event.action.replace(/^Avanzó etapa a "/, '').replace(/"$/, '');
    stageStart = event.createdAt;
  }
  if (stageStart) stageDurations.push({ stage: stageName, startedAt: stageStart, endedAt: new Date().toISOString(), durationMs: Math.max(0, Date.now() - Date.parse(stageStart)), ongoing: true });
  return c.json({
    caseId: id, createdAt: item.createdAt, status: item.status,
    stageDurations,
    completedAt, durationMs: Math.max(0, endTime - Date.parse(item.createdAt)),
    durationIsFinal: Boolean(completedAt), eventCount: events.length,
    truncated: events.length >= 1000,
    contributors: [...contributors.values()].sort((a, b) => b.interventions - a.interventions),
    events
  });
});

app.get('/api/audit-logs', async (c) => {
  const auth = c.get('auth')!;
  const isSuper = auth.realUser.role === 'SUPERADMIN';
  if (!isSuper && auth.realUser.role !== 'ADMIN') return c.json({ error: 'Acceso a auditoría no autorizado.' }, 403);
  const requestedLimit = Number(c.req.query('limit'));
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 1000) : 500;
  const offset = Math.max(0, Math.min(Number(c.req.query('offset')) || 0, 100000));
  const rows = await c.env.DB.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?').bind(limit, offset).all<any>();
  const logs = (rows.results || [])
    .map((l) => ({
      id: l.id,
      userId: l.user_id,
      userName: l.user_name,
      userRole: l.user_role,
      action: l.action,
      entityType: l.entity_type,
      entityId: l.entity_id,
      entityName: l.entity_name,
      createdAt: l.created_at,
    }))
    .filter((l) => isSuper || l.userRole !== 'SUPERADMIN');
  return c.json(logs);
});

// Audit entries are server-generated. Clients cannot fabricate audit actions.
app.post('/api/audit-logs/log', (c) => c.json({ error: 'Los registros de auditoría se generan exclusivamente en el servidor.' }, 403));


}
