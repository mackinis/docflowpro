#!/usr/bin/env node
/**
 * DocFlow Pro — Script de Migración Única de Datos Legacy (Firestore / JSON) a Cloudflare D1 + R2
 *
 * Uso con archivo JSON exportado:
 *   node scripts/migrate-firebase-to-cloudflare.mjs --input ./firestore-export.json
 *
 * Uso opcional vía Firestore REST API (sin dependencias npm de Firebase):
 *   node scripts/migrate-firebase-to-cloudflare.mjs --project MI_PROJECT_ID --token OAUTH_BEARER_TOKEN
 *
 * Salidas generadas:
 *   - migrations/data-import.sql        (Sentencias SQL listas para `wrangler d1 execute`)
 *   - migration-output/r2/...           (Archivos binarios extraídos de DataURLs)
 *   - migration-output/upload-r2.sh     (Script de carga masiva a Cloudflare R2)
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
}

const inputPath = getArg('--input') || process.env.FIREBASE_EXPORT_JSON;
const projectId = getArg('--project') || process.env.FIREBASE_PROJECT_ID;
const bearerToken = getArg('--token') || process.env.FIREBASE_ACCESS_TOKEN;
const r2BucketName = getArg('--bucket') || 'docflow-pro-files';
const d1DbName = getArg('--db') || 'docflow-pro-db';

function decodeFirestoreValue(val) {
  if (!val || typeof val !== 'object') return val;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) return (val.arrayValue.values || []).map(decodeFirestoreValue);
  if ('mapValue' in val) {
    const out = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  }
  return val;
}

async function loadLegacyState() {
  if (inputPath) {
    const abs = path.resolve(inputPath);
    if (!fs.existsSync(abs)) {
      throw new Error(`No existe el archivo de entrada: ${abs}`);
    }
    const raw = JSON.parse(fs.readFileSync(abs, 'utf-8'));
    if (raw && raw.fields) {
      return decodeFirestoreValue({ mapValue: { fields: raw.fields } });
    }
    return raw;
  }

  if (projectId && bearerToken) {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/appState/current`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Error consultando Firestore REST API (${res.status}): ${txt}`);
    }
    const doc = await res.json();
    return decodeFirestoreValue({ mapValue: { fields: doc.fields || {} } });
  }

  console.error(
    'Uso:\n' +
      '  node scripts/migrate-firebase-to-cloudflare.mjs --input ./export.json\n' +
      '  node scripts/migrate-firebase-to-cloudflare.mjs --project <id> --token <oauth_token>'
  );
  process.exit(1);
}

function sqlStr(val) {
  if (val === undefined || val === null) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

function sqlInt(val, fallback = 0) {
  if (val === undefined || val === null || val === '') return fallback;
  return Number(val) ? Number(val) : 0;
}

function sqlBool(val, fallback = 0) {
  if (val === undefined || val === null) return fallback;
  return val ? 1 : 0;
}

function sanitizeFileName(name) {
  return String(name || 'archivo.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function extractDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    return null;
  }
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return null;
  const header = dataUrl.slice(5, commaIdx);
  const body = dataUrl.slice(commaIdx + 1);
  const mimeType = header.split(';')[0] || 'application/octet-stream';
  const isBase64 = header.includes(';base64');
  const buffer = isBase64
    ? Buffer.from(body, 'base64')
    : Buffer.from(decodeURIComponent(body), 'utf-8');
  return { mimeType, buffer };
}

async function main() {
  const state = await loadLegacyState();
  const now = new Date().toISOString();

  const outR2Dir = path.resolve('migration-output/r2');
  fs.mkdirSync(outR2Dir, { recursive: true });
  fs.mkdirSync(path.resolve('migrations'), { recursive: true });

  const sqlLines = [
    '-- DocFlow Pro — Importación de Datos Legacy a Cloudflare D1',
    `-- Generado el: ${now}`,
    'PRAGMA foreign_keys = ON;',
    '',
  ];

  const r2Commands = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `# Carga de binarios extraídos al bucket Cloudflare R2 "${r2BucketName}"`,
    '',
  ];

  const counts = {
    users: 0,
    usersRequiringReset: 0,
    templates: 0,
    cases: 0,
    documents: 0,
    sharedDocuments: 0,
    messages: 0,
    r2Files: 0,
  };

  const writeR2File = (r2Key, buffer, mimeType) => {
    const dest = path.join(outR2Dir, r2Key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buffer);
    const contentTypeFlag = mimeType ? ` --content-type "${mimeType}"` : '';
    r2Commands.push(
      `npx wrangler r2 object put "${r2BucketName}/${r2Key}" --file "${dest}"${contentTypeFlag} --remote`
    );
    counts.r2Files++;
  };

  // 1. System Config
  const activeIndustry = state.activeIndustry || state.industry;
  if (activeIndustry) {
    sqlLines.push(
      `INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('activeIndustry', ${sqlStr(JSON.stringify(activeIndustry))}, ${sqlStr(now)});`
    );
  }
  if (state.verificationPolicies) {
    const vp = state.verificationPolicies;
    const policies = {
      global: vp.global === 'direct' || vp.ASESOR === 'direct' ? 'direct' : 'admin_approval',
      ASESOR: vp.ASESOR === 'direct' ? 'direct' : 'admin_approval',
      MANAGER: vp.MANAGER === 'direct' ? 'direct' : 'admin_approval',
      ADMIN: vp.ADMIN === 'direct' ? 'direct' : 'admin_approval',
    };
    sqlLines.push(
      `INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('verificationPolicies', ${sqlStr(JSON.stringify(policies))}, ${sqlStr(now)});`
    );
  }
  if (state.systemSettings) {
    sqlLines.push(
      `INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('systemSettings', ${sqlStr(JSON.stringify(state.systemSettings))}, ${sqlStr(now)});`
    );
  }

  // 2. Users
  for (const u of state.users || []) {
    const rawHash = u.passwordHash || '';
    const isPbkdf2 = rawHash.startsWith('pbkdf2_sha256$');
    const passwordHash = isPbkdf2 ? rawHash : 'REQUIRES_ADMIN_RESET';
    if (!isPbkdf2) counts.usersRequiringReset++;
    counts.users++;

    sqlLines.push(
      `INSERT OR REPLACE INTO users (id, name, last_name, email, role, avatar, phone, active, address, city, province, country, password_hash, is_verified, verification_token_hash, token_created_at, has_sensitive_edit_override, created_at, updated_at) VALUES (` +
        [
          sqlStr(u.id),
          sqlStr(u.name || ''),
          sqlStr(u.lastName || ''),
          sqlStr(String(u.email || '').toLowerCase()),
          sqlStr(u.role || 'ASESOR'),
          sqlStr(u.avatar || null),
          sqlStr(u.phone || ''),
          sqlBool(u.active, 1),
          sqlStr(u.address || ''),
          sqlStr(u.city || ''),
          sqlStr(u.province || ''),
          sqlStr(u.country || ''),
          sqlStr(passwordHash),
          sqlBool(u.isVerified, 1),
          'NULL',
          'NULL',
          u.hasSensitiveEditOverride === undefined ? 'NULL' : sqlBool(u.hasSensitiveEditOverride, 0),
          sqlStr(now),
          sqlStr(now),
        ].join(', ') +
        ');'
    );
  }

  // 3. Process Templates + Stages + Requirements
  for (const tpl of state.templates || []) {
    counts.templates++;
    sqlLines.push(
      `INSERT OR REPLACE INTO process_templates (id, name, description, industry, original_document_content, show_document_to_all, shared_view_mode, created_at, updated_at) VALUES (` +
        [
          sqlStr(tpl.id),
          sqlStr(tpl.name || ''),
          sqlStr(tpl.description || ''),
          sqlStr(tpl.industry || 'Inmobiliaria'),
          sqlStr(tpl.originalDocumentContent || ''),
          sqlBool(tpl.showDocumentToAll !== false, 1),
          sqlStr(tpl.sharedViewMode || 'both'),
          sqlStr(now),
          sqlStr(now),
        ].join(', ') +
        ');'
    );
    (tpl.stages || []).forEach((stg, sIdx) => {
      sqlLines.push(
        `INSERT OR REPLACE INTO template_stages (id, template_id, stage_order, name, description) VALUES (` +
          [sqlStr(stg.id), sqlStr(tpl.id), sIdx, sqlStr(stg.name || ''), sqlStr(stg.description || '')].join(', ') +
          ');'
      );
      (stg.requirements || []).forEach((req, rIdx) => {
        sqlLines.push(
          `INSERT OR REPLACE INTO stage_requirements (id, stage_id, template_id, req_order, name, type, description, is_required, form_fields_json, document_source_type, linked_template_id, linked_shared_document_id) VALUES (` +
            [
              sqlStr(req.id),
              sqlStr(stg.id),
              sqlStr(tpl.id),
              rIdx,
              sqlStr(req.name || ''),
              sqlStr(req.type || 'document'),
              sqlStr(req.description || ''),
              sqlBool(req.isRequired !== false, 1),
              req.formFields ? sqlStr(JSON.stringify(req.formFields)) : 'NULL',
              sqlStr(req.documentSourceType || null),
              sqlStr(req.linkedTemplateId || null),
              sqlStr(req.linkedSharedDocumentId || null),
            ].join(', ') +
            ');'
        );
      });
    });
  }

  // 4. Cases + Participants
  for (const c of state.cases || []) {
    counts.cases++;
    sqlLines.push(
      `INSERT OR REPLACE INTO cases (id, code, title, description, status, template_id, current_stage_index, assigned_advisor_id, assigned_manager_id, document_content, show_document_to_all, shared_view_mode, is_current_stage_approved, created_at, updated_at) VALUES (` +
        [
          sqlStr(c.id),
          sqlStr(c.code),
          sqlStr(c.title || ''),
          sqlStr(c.description || ''),
          sqlStr(c.status || 'active'),
          sqlStr(c.templateId || ''),
          sqlInt(c.currentStageIndex, 0),
          sqlStr(c.assignedAdvisorId || ''),
          sqlStr(c.assignedManagerId || ''),
          sqlStr(c.documentContent || ''),
          sqlBool(c.showDocumentToAll !== false, 1),
          sqlStr(c.sharedViewMode || 'both'),
          sqlBool(c.isCurrentStageApproved, 0),
          sqlStr(c.createdAt || now),
          sqlStr(c.updatedAt || now),
        ].join(', ') +
        ');'
    );
    for (const p of c.participants || []) {
      sqlLines.push(
        `INSERT OR REPLACE INTO case_participants (id, case_id, name, last_name, dni, cuit_cuil, email, phone, birth_date, role, comments) VALUES (` +
          [
            sqlStr(p.id),
            sqlStr(c.id),
            sqlStr(p.name || ''),
            sqlStr(p.lastName || ''),
            sqlStr(p.dni || ''),
            sqlStr(p.cuitCuil || ''),
            sqlStr(p.email || ''),
            sqlStr(p.phone || ''),
            sqlStr(p.birthDate || null),
            sqlStr(p.role || 'Vendedor'),
            sqlStr(p.comments || ''),
          ].join(', ') +
          ');'
      );
    }
  }

  // 5. Documents & Versions
  for (const d of state.documents || []) {
    counts.documents++;
    let r2Key = d.r2Key || null;
    let mimeType = d.mimeType || null;
    const extracted = extractDataUrl(d.dataUrl);
    if (extracted) {
      mimeType = extracted.mimeType;
      r2Key = r2Key || `cases/${d.caseId}/${d.id}/${sanitizeFileName(d.fileName)}`;
      writeR2File(r2Key, extracted.buffer, mimeType);
    }
    sqlLines.push(
      `INSERT OR REPLACE INTO documents (id, case_id, stage_id, requirement_id, name, status, file_name, mime_type, file_size, r2_key, uploaded_by, uploaded_at, allowed_roles_json) VALUES (` +
        [
          sqlStr(d.id),
          sqlStr(d.caseId),
          sqlStr(d.stageId),
          sqlStr(d.requirementId),
          sqlStr(d.name || ''),
          sqlStr(d.status || 'pending'),
          sqlStr(d.fileName || null),
          sqlStr(mimeType),
          sqlInt(d.fileSize, 0),
          sqlStr(r2Key),
          sqlStr(d.uploadedBy || null),
          sqlStr(d.uploadedAt || null),
          d.allowedRoles ? sqlStr(JSON.stringify(d.allowedRoles)) : 'NULL',
        ].join(', ') +
        ');'
    );
    (d.versions || []).forEach((v, idx) => {
      const vId = v.id || `ver-${d.id}-${idx}`;
      sqlLines.push(
        `INSERT OR REPLACE INTO document_versions (id, document_id, file_name, mime_type, file_size, r2_key, uploaded_by, uploaded_at) VALUES (` +
          [
            sqlStr(vId),
            sqlStr(d.id),
            sqlStr(v.fileName || ''),
            sqlStr(v.mimeType || mimeType),
            sqlInt(v.fileSize, 0),
            sqlStr(v.r2Key || r2Key),
            sqlStr(v.uploadedBy || d.uploadedBy || ''),
            sqlStr(v.uploadedAt || d.uploadedAt || now),
          ].join(', ') +
          ');'
      );
    });
  }

  // 6. Tasks, Observations, Form Submissions, Upload Requests
  for (const t of state.tasks || []) {
    sqlLines.push(
      `INSERT OR REPLACE INTO tasks (id, case_id, stage_id, requirement_id, name, description, status, completed_by, completed_at) VALUES (` +
        [
          sqlStr(t.id),
          sqlStr(t.caseId),
          sqlStr(t.stageId),
          sqlStr(t.requirementId),
          sqlStr(t.name || ''),
          sqlStr(t.description || ''),
          sqlStr(t.status || 'pending'),
          sqlStr(t.completedBy || null),
          sqlStr(t.completedAt || null),
        ].join(', ') +
        ');'
    );
  }
  for (const o of state.observations || []) {
    sqlLines.push(
      `INSERT OR REPLACE INTO observations (id, case_id, stage_id, requirement_id, document_id, text, created_by, created_at, status, resolved_by, resolved_at, response) VALUES (` +
        [
          sqlStr(o.id),
          sqlStr(o.caseId),
          sqlStr(o.stageId),
          sqlStr(o.requirementId || null),
          sqlStr(o.documentId || null),
          sqlStr(o.text || ''),
          sqlStr(o.createdBy || ''),
          sqlStr(o.createdAt || now),
          sqlStr(o.status || 'open'),
          sqlStr(o.resolvedBy || null),
          sqlStr(o.resolvedAt || null),
          sqlStr(o.response || null),
        ].join(', ') +
        ');'
    );
  }
  for (const f of state.formSubmissions || []) {
    sqlLines.push(
      `INSERT OR REPLACE INTO form_submissions (id, case_id, stage_id, requirement_id, values_json, submitted_by, submitted_at) VALUES (` +
        [
          sqlStr(f.id || `sub-${f.requirementId}`),
          sqlStr(f.caseId || null),
          sqlStr(f.stageId || null),
          sqlStr(f.requirementId),
          sqlStr(JSON.stringify(f.values || {})),
          sqlStr(f.submittedBy || ''),
          sqlStr(f.submittedAt || now),
        ].join(', ') +
        ');'
    );
  }
  for (const r of state.uploadRequests || []) {
    sqlLines.push(
      `INSERT OR REPLACE INTO upload_requests (id, case_id, stage_id, requirement_id, requirement_name, requested_by, requested_at, status, requested_extension, allowed_extension, allowed_max_weight, response_comment, reviewed_by, reviewed_at) VALUES (` +
        [
          sqlStr(r.id),
          sqlStr(r.caseId),
          sqlStr(r.stageId),
          sqlStr(r.requirementId),
          sqlStr(r.requirementName || ''),
          sqlStr(r.requestedBy || ''),
          sqlStr(r.requestedAt || now),
          sqlStr(r.status || 'pending'),
          sqlStr(r.requestedExtension || '.pdf'),
          sqlStr(r.allowedExtension || null),
          r.allowedMaxWeight !== undefined && r.allowedMaxWeight !== null ? sqlInt(r.allowedMaxWeight, 5) : 'NULL',
          sqlStr(r.responseComment || null),
          sqlStr(r.reviewedBy || null),
          sqlStr(r.reviewedAt || null),
        ].join(', ') +
        ');'
    );
  }

  // 7. Shared Documents
  for (const sd of state.sharedDocuments || []) {
    counts.sharedDocuments++;
    let r2Key = sd.r2Key || `shared/${sd.id}/${sanitizeFileName(sd.fileName)}`;
    let mimeType = sd.mimeType || 'application/octet-stream';
    let fileSize = sqlInt(sd.fileSize, 0);
    const extracted = extractDataUrl(sd.dataUrl);
    if (extracted) {
      mimeType = extracted.mimeType;
      fileSize = extracted.buffer.length;
      writeR2File(r2Key, extracted.buffer, mimeType);
    }
    sqlLines.push(
      `INSERT OR REPLACE INTO shared_documents (id, name, file_name, mime_type, file_size, r2_key, uploaded_by, uploaded_at, allowed_roles_json, allowed_user_ids_json) VALUES (` +
        [
          sqlStr(sd.id),
          sqlStr(sd.name || ''),
          sqlStr(sd.fileName || ''),
          sqlStr(mimeType),
          fileSize,
          sqlStr(r2Key),
          sqlStr(sd.uploadedBy || ''),
          sqlStr(sd.uploadedAt || now),
          sd.allowedRoles ? sqlStr(JSON.stringify(sd.allowedRoles)) : 'NULL',
          sd.allowedUserIds ? sqlStr(JSON.stringify(sd.allowedUserIds)) : 'NULL',
        ].join(', ') +
        ');'
    );
  }

  // 8. System Messages & Attachments
  for (const m of state.systemMessages || []) {
    counts.messages++;
    sqlLines.push(
      `INSERT OR REPLACE INTO system_messages (id, sender_id, sender_name, sender_role, receiver_id, receiver_name, receiver_role, subject, content, created_at, read, deleted_by_sender, deleted_by_receiver, permanent_deleted_by_sender, permanent_deleted_by_receiver) VALUES (` +
        [
          sqlStr(m.id),
          sqlStr(m.senderId),
          sqlStr(m.senderName || ''),
          sqlStr(m.senderRole || ''),
          sqlStr(m.receiverId),
          sqlStr(m.receiverName || ''),
          sqlStr(m.receiverRole || ''),
          sqlStr(m.subject || ''),
          sqlStr(m.content || ''),
          sqlStr(m.createdAt || now),
          sqlBool(m.read, 0),
          sqlBool(m.deletedBySender, 0),
          sqlBool(m.deletedByReceiver, 0),
          sqlBool(m.permanentDeletedBySender, 0),
          sqlBool(m.permanentDeletedByReceiver, 0),
        ].join(', ') +
        ');'
    );
    (m.attachments || []).forEach((att, idx) => {
      const attId = att.id || `att-${m.id}-${idx}`;
      const r2Key = att.r2Key || `messages/${m.id}/${attId}/${sanitizeFileName(att.name)}`;
      let mimeType = att.mimeType || 'application/octet-stream';
      let size = sqlInt(att.size, 0);
      const extracted = extractDataUrl(att.dataUrl);
      if (extracted) {
        mimeType = extracted.mimeType;
        size = extracted.buffer.length;
        writeR2File(r2Key, extracted.buffer, mimeType);
      }
      sqlLines.push(
        `INSERT OR REPLACE INTO message_attachments (id, message_id, name, mime_type, size, r2_key) VALUES (` +
          [sqlStr(attId), sqlStr(m.id), sqlStr(att.name || ''), sqlStr(mimeType), size, sqlStr(r2Key)].join(', ') +
          ');'
      );
    });
  }

  // 9. Notifications & Audit Logs
  for (const n of state.notifications || []) {
    sqlLines.push(
      `INSERT OR REPLACE INTO notifications (id, user_id, title, message, type, read, created_at, case_id) VALUES (` +
        [
          sqlStr(n.id),
          sqlStr(n.userId),
          sqlStr(n.title || ''),
          sqlStr(n.message || ''),
          sqlStr(n.type || 'info'),
          sqlBool(n.read, 0),
          sqlStr(n.createdAt || now),
          sqlStr(n.caseId || null),
        ].join(', ') +
        ');'
    );
  }
  for (const a of state.auditLogs || []) {
    sqlLines.push(
      `INSERT OR REPLACE INTO audit_logs (id, user_id, user_name, user_role, action, entity_type, entity_id, entity_name, created_at) VALUES (` +
        [
          sqlStr(a.id),
          sqlStr(a.userId),
          sqlStr(a.userName || ''),
          sqlStr(a.userRole || ''),
          sqlStr(a.action || ''),
          sqlStr(a.entityType || ''),
          sqlStr(a.entityId || ''),
          sqlStr(a.entityName || ''),
          sqlStr(a.createdAt || now),
        ].join(', ') +
        ');'
    );
  }

  const sqlOutPath = path.resolve('migrations/data-import.sql');
  fs.writeFileSync(sqlOutPath, sqlLines.join('\n') + '\n', 'utf-8');

  const uploadScriptPath = path.resolve('migration-output/upload-r2.sh');
  fs.writeFileSync(uploadScriptPath, r2Commands.join('\n') + '\n', { mode: 0o755 });

  console.log('Migración generada correctamente:');
  console.log(`  SQL generado       : ${sqlOutPath}`);
  console.log(`  Script R2          : ${uploadScriptPath}`);
  console.log(`  Usuarios           : ${counts.users} (${counts.usersRequiringReset} marcados con REQUIRES_ADMIN_RESET)`);
  console.log(`  Plantillas         : ${counts.templates}`);
  console.log(`  Legajos            : ${counts.cases}`);
  console.log(`  Documentos         : ${counts.documents}`);
  console.log(`  Docs Compartidos   : ${counts.sharedDocuments}`);
  console.log(`  Mensajes Sistema   : ${counts.messages}`);
  console.log(`  Binarios para R2   : ${counts.r2Files}`);
  console.log('\nSiguientes pasos:');
  console.log(`  1. npx wrangler d1 execute ${d1DbName} --file=migrations/data-import.sql --remote`);
  console.log('  2. bash migration-output/upload-r2.sh');
}

main().catch((err) => {
  console.error('Error en migración:', err);
  process.exit(1);
});
