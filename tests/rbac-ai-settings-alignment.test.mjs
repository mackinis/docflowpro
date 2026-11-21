import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const access = readFileSync(new URL('../worker/access-ai-settings.ts',import.meta.url),'utf8');
const ai = readFileSync(new URL('../worker/ai-document-routes.ts',import.meta.url),'utf8');

test('AI configuration requires both role allowlist and RBAC edit grant',()=>{
  assert.ok(access.includes("hasRbacPermission(matrix, auth.user.role, auth.user.id, 'ai.edit')"));
  assert.ok(access.includes("(settings.aiSettingsRoles || []).includes(auth.user.role as any) && await canEditAiSettings(c)"));
  assert.ok(access.includes("(current.aiSettingsRoles || []).includes(auth.user.role as any) && await canEditAiSettings(c)"));
});
test('AI template digitization requires template creation RBAC and handler authorization',()=>{
  assert.ok(ai.includes("hasRbacPermission(matrix, auth.user.role, auth.user.id, 'templates.create')"));
  assert.ok(ai.includes('await canUserManageTemplates(c.env.DB, auth.user.id)'));
  assert.ok(ai.indexOf("'templates.create'") < ai.indexOf('digitizeTemplateWithAI(c.env'));
});
test('legacy gemini aliases share the protected handlers',()=>{
  assert.ok(ai.includes("app.post('/api/gemini/digitize-template', handleDigitizeTemplate)"));
  assert.ok(ai.includes("app.post('/api/gemini/analyze-document', handleAnalyzeDocument)"));
  assert.ok(access.includes("app.use('/api/gemini/*', enforceAiRbac)"));
});
