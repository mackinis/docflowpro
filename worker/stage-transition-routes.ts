import type { Hono } from 'hono';
import type { Env, AppVariables } from './types';
import { createAudit, createNotification, findTemplateOrVirtualById, getCaseById, validateStageRequirements } from './db';

export function registerStageTransitionRoutes(app: Hono<{ Bindings: Env; Variables: AppVariables }>) {
  app.post('/api/cases/:id/advance', async (c) => {
    const auth = c.get('auth')!;
    const { id } = c.req.param();
    const caseObj = await getCaseById(c.env.DB, id);
    if (!caseObj) return c.json({ error: 'Legajo no encontrado' }, 404);
  
    const template = await findTemplateOrVirtualById(c.env, caseObj.templateId);
    if (!template) return c.json({ error: 'Plantilla de proceso no encontrada' }, 404);
  
    const currentStage = template.stages[caseObj.currentStageIndex];
    if (!currentStage) return c.json({ error: 'Etapa actual no válida' }, 400);
  
    const validation = await validateStageRequirements(c.env.DB, caseObj.id, currentStage.id, template);
    if (!validation.isValid) {
      return c.json(
        { error: 'Avance denegado automáticamente', reasons: validation.missing },
        400
      );
    }
  
    const nextStageIndex = caseObj.currentStageIndex + 1;
    const isCompleted = nextStageIndex >= template.stages.length;
    const nextIndexToSave = isCompleted ? caseObj.currentStageIndex : nextStageIndex;
    const nextStatus = isCompleted ? 'completed' : 'active';
    const now = new Date().toISOString();
  
    await c.env.DB.prepare(
      'UPDATE cases SET current_stage_index = ?, status = ?, is_current_stage_approved = 0, updated_at = ? WHERE id = ?'
    )
      .bind(nextIndexToSave, nextStatus, now, id)
      .run();
  
    if (!isCompleted) {
      const nextStage = template.stages[nextStageIndex];
      for (const reqObj of nextStage.requirements) {
        if (reqObj.type === 'task') {
          const exists = await c.env.DB.prepare(
            'SELECT id FROM tasks WHERE case_id = ? AND requirement_id = ?'
          )
            .bind(id, reqObj.id)
            .first();
          if (!exists) {
            await c.env.DB.prepare(
              `INSERT INTO tasks (id, case_id, stage_id, requirement_id, name, description, status)
               VALUES (?, ?, ?, ?, ?, ?, 'pending')`
            )
              .bind(
                `tsk-${Date.now()}-${crypto.randomUUID().slice(0, 5)}`,
                id,
                nextStage.id,
                reqObj.id,
                reqObj.name,
                reqObj.description || ''
              )
              .run();
          }
        }
      }
  
      await createNotification(
        c.env.DB,
        caseObj.assignedAdvisorId,
        'Cambio de Etapa',
        `El legajo ${caseObj.code} avanzó a la etapa: "${nextStage.name}"`,
        'success',
        id
      );
      await createAudit(c.env.DB, auth.user.id, `Avanzó etapa a "${nextStage.name}"`, 'Case', id, caseObj.title);
    } else {
      await createNotification(
        c.env.DB,
        caseObj.assignedAdvisorId,
        'Legajo Finalizado',
        `¡Felicidades! El legajo ${caseObj.code} ha sido finalizado exitosamente.`,
        'success',
        id
      );
      await createAudit(c.env.DB, auth.user.id, 'Finalizó legajo', 'Case', id, caseObj.title);
    }
  
    return c.json({ success: true, case: await getCaseById(c.env.DB, id) });
  });
  
  app.post('/api/cases/:id/approve-stage', async (c) => {
    const auth = c.get('auth')!;
    if (!['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(auth.user.role)) {
      return c.json({ error: 'No autorizado para aprobar etapas.' }, 403);
    }
    const { id } = c.req.param();
    const caseObj = await getCaseById(c.env.DB, id);
    if (!caseObj) return c.json({ error: 'Legajo no encontrado' }, 404);
  
    const template = await findTemplateOrVirtualById(c.env, caseObj.templateId);
    if (!template) return c.json({ error: 'Plantilla de proceso no encontrada' }, 404);
  
    const currentStage = template.stages[caseObj.currentStageIndex];
    if (!currentStage) return c.json({ error: 'Etapa actual no válida' }, 400);
  
    await c.env.DB.prepare(
      'UPDATE cases SET is_current_stage_approved = 1, updated_at = ? WHERE id = ?'
    )
      .bind(new Date().toISOString(), id)
      .run();
  
    await createNotification(
      c.env.DB,
      caseObj.assignedAdvisorId,
      'Etapa Aprobada',
      `¡Tu etapa actual "${currentStage.name}" ha sido aprobada por el Manager!`,
      'success',
      id
    );
    await createAudit(c.env.DB, auth.user.id, `Aprobó etapa "${currentStage.name}"`, 'Case', id, caseObj.title);
    return c.json({ success: true, case: await getCaseById(c.env.DB, id) });
  });
  
  app.get('/api/cases/:id/validate', async (c) => {
    const { id } = c.req.param();
    const caseObj = await getCaseById(c.env.DB, id);
    if (!caseObj) return c.json({ error: 'Legajo no encontrado' }, 404);
    const template = await findTemplateOrVirtualById(c.env, caseObj.templateId);
    if (!template) return c.json({ error: 'Plantilla de proceso no encontrada' }, 404);
    const currentStage = template.stages[caseObj.currentStageIndex];
    if (!currentStage) return c.json({ error: 'Etapa actual no válida' }, 400);
  
    const validation = await validateStageRequirements(c.env.DB, caseObj.id, currentStage.id, template);
    return c.json(validation);
  });
  
  
}
