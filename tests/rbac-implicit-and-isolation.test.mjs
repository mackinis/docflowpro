import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const rbac = readFileSync(new URL('../src/rbac.ts',import.meta.url),'utf8');
const js=ts.transpileModule(rbac,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {RBAC_MODULES,RBAC_ACTIONS,RBAC_DEFAULTS,hasRbacPermission,isApplicableRbacPermission}=
 await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(js));

test('all applicable role defaults are explicitly resolved',()=>{
 for(const role of ['ADMIN','MANAGER','ASESOR'])
  for(const module of RBAC_MODULES) for(const action of RBAC_ACTIONS){
   const key=`${module}.${action}`;
   assert.equal(typeof RBAC_DEFAULTS[role][key],'boolean',`${role}: ${key}`);
   if(!isApplicableRbacPermission(key)) assert.equal(hasRbacPermission(null,role,'u',key),false);
  }
});
test('user denial overrides role grant and no undefined grants are allowed',()=>{
 const matrix={roles:{MANAGER:{'cases.view':true}},users:{u:{'cases.view':false}}};
 assert.equal(hasRbacPermission(matrix,'MANAGER','u','cases.view'),false);
 assert.equal(hasRbacPermission(null,'MANAGER','u','not-a-module.view'),false);
});
test('AI document audit verifies assigned manager before R2 and mutation',()=>{
 const code=readFileSync(new URL('../worker/ai-document-routes.ts',import.meta.url),'utf8');
 const check=code.indexOf("assignedCase.assignedManagerId !== auth.user.id");
 assert.ok(check>0);
 assert.ok(check<code.indexOf('analyzeDocumentWithAI(c.env, {'));
});
test('advisor state isolates case data and messages',()=>{
 const code=readFileSync(new URL('../worker/db.ts',import.meta.url),'utf8');
 for(const token of ['assignedAdvisorId === requestingUser.id','cases: visibleCases','documents: advisorScope ? documents.filter','notifications: advisorScope ? notifications.filter','systemMessages: advisorScope ? filteredMessages.filter'])
 assert.ok(code.includes(token),token);
});
