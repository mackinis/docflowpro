import type { Hono, Context } from 'hono';
import type { Env, AppVariables } from './types';
import type { ProcessTemplate } from '../src/types';
import { analyzeDocumentWithAI, digitizeTemplateWithAI } from './ai';
import { canUserManageTemplates, createAudit, createNotification, getCaseById } from './db';
import { saveTemplateInDb } from './template-routes';

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;
type WorkerApp = Hono<{ Bindings: Env; Variables: AppVariables }>;
export function registerAiDocumentRoutes(app: WorkerApp, identifyDigitizedFields: (content: string) => ProcessTemplate['fieldMap']): void {
// ============================================================================
// 11. Cloudflare Workers AI Endpoints (Replaces Gemini 100%)
// ============================================================================
async function handleAnalyzeDocument(c: AppContext) {
  const auth = c.get('auth')!;
  if (!['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(auth.user.role)) {
    return c.json({ error: 'No autorizado para ejecutar auditorías IA.' }, 403);
  }
  const { documentId, requirementName, requirementDescription, fileName } = await c.req.json();
  const docRow = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(documentId).first<any>();
  if (!docRow) return c.json({ error: 'Documento no encontrado' }, 404);
  // A manager may audit only documents in cases assigned to them.
  // This must be checked before loading R2 content or mutating document status.
  if (auth.user.role === 'MANAGER') {
    const assignedCase = await getCaseById(c.env.DB, docRow.case_id);
    if (!assignedCase || assignedCase.assignedManagerId !== auth.user.id) {
      return c.json({ error: 'Documento no encontrado' }, 404);
    }
  }

  try {
    const result = await analyzeDocumentWithAI(c.env, {
      requirementName: requirementName || docRow.name,
      requirementDescription: requirementDescription || '',
      fileName: fileName || docRow.file_name || 'documento',
      r2Key: docRow.r2_key,
    });

    const now = new Date().toISOString();
    if (result.approved) {
      await c.env.DB.prepare("UPDATE documents SET status = 'approved' WHERE id = ?")
        .bind(docRow.id)
        .run();
      await createAudit(c.env.DB, auth.user.id, 'Auditoría Workers AI: Documento aprobado', 'Document', docRow.id, docRow.name);
    } else {
      await c.env.DB.prepare("UPDATE documents SET status = 'rejected' WHERE id = ?")
        .bind(docRow.id)
        .run();
      const obsText = result.suggestedObservation || `Observación de Workers AI para ${requirementName}`;
      await c.env.DB.prepare(
        `INSERT INTO observations (id, case_id, stage_id, requirement_id, document_id, text, created_by, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`
      )
        .bind(
          `obs-ai-${Date.now()}`,
          docRow.case_id,
          docRow.stage_id,
          docRow.requirement_id,
          docRow.id,
          obsText,
          auth.user.id,
          now
        )
        .run();
      await createAudit(c.env.DB, auth.user.id, 'Auditoría Workers AI: Documento rechazado', 'Document', docRow.id, docRow.name);
    }

    const caseObj = await getCaseById(c.env.DB, docRow.case_id);
    if (caseObj) {
      await c.env.DB.prepare('UPDATE cases SET status = ?, updated_at = ? WHERE id = ?')
        .bind(result.approved ? 'active' : 'observed', now, caseObj.id)
        .run();
      await createNotification(
        c.env.DB,
        docRow.uploaded_by || caseObj.assignedAdvisorId,
        result.approved ? 'Workers AI Auditoría: Aprobado' : 'Workers AI Auditoría: Observado',
        result.approved
          ? `Cloudflare Workers AI auditó y aprobó tu documento "${docRow.name}" en el legajo ${caseObj.code}.`
          : `Cloudflare Workers AI auditó y observó tu documento "${docRow.name}" en ${caseObj.code}.`,
        result.approved ? 'success' : 'error',
        docRow.case_id
      );
    }

    return c.json({ success: true, ...result });
  } catch (err: any) {
    console.error('Workers AI document audit error:', err);
    return c.json(
      {
        error: err?.message || 'Error ejecutando auditoría en Cloudflare Workers AI.',
      },
      503
    );
  }
}

async function handleDigitizeTemplate(c: AppContext) {
  const auth = c.get('auth')!;
  if (!(await canUserManageTemplates(c.env.DB, auth.user.id))) {
    return c.json({ error: 'No tienes permisos suficientes para digitalizar plantillas.' }, 403);
  }
  const { fileBase64, mimeType, fileName, textProposal, industry } = await c.req.json();

  try {
    const digitized = await digitizeTemplateWithAI(c.env, {
      fileBase64,
      mimeType,
      fileName,
      textProposal,
      industry: industry || 'Administrativo',
    });

    const finalTemplate: ProcessTemplate = {
      id: `tmpl-dig-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`,
      ...digitized,
    };
    // Digitization is the only semantic interpretation stage.
    // Keep machine-readable markers unchanged for downstream filling.
    finalTemplate.fieldMap=identifyDigitizedFields(finalTemplate.originalDocumentContent||'');
    finalTemplate.digitizationReviewNotes=finalTemplate.fieldMap.filter(f=>f.review)
      .map(f=>f.id+': significado o actor pendiente de confirmar');
    await saveTemplateInDb(c.env.DB, finalTemplate, false);
    await createAudit(
      c.env.DB,
      auth.user.id,
      'Plantilla digitalizada con Cloudflare Workers AI',
      'ProcessTemplate',
      finalTemplate.id,
      finalTemplate.name
    );
    return c.json({ success: true, template: finalTemplate });
  } catch (err: any) {
    console.error('Workers AI digitization error:', err);
    return c.json(
      { error: err?.message || 'Error digitalizando documento con Cloudflare Workers AI.' },
      503
    );
  }
}

app.post('/api/ai/analyze-document', handleAnalyzeDocument);
app.post('/api/ai/digitize-template', handleDigitizeTemplate);
// Backward-compatible route aliases
app.post('/api/gemini/analyze-document', handleAnalyzeDocument);
app.post('/api/gemini/digitize-template', handleDigitizeTemplate);


}
