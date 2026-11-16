import React from 'react';
import { RBAC_MODULES, RBAC_ACTIONS, RBAC_LABELS, RBAC_ACTION_LABELS, type RbacMatrix, type PermissionKey, type RbacRole } from '../rbac';
import type { User } from '../types';

const ROLES: Array<Exclude<RbacRole,'SUPERADMIN'>> = ['ADMIN','MANAGER','ASESOR'];
export default function RbacPanel({ users }: { users: User[] }) {
  const [matrix,setMatrix] = React.useState<RbacMatrix>({roles:{},users:{}});
  const [scope,setScope] = React.useState<'role'|'user'>('role');
  const [target,setTarget] = React.useState<string>('ADMIN');
  const [status,setStatus] = React.useState('');
  const [busy,setBusy] = React.useState(false);
  React.useEffect(() => { fetch('/api/admin/rbac',{credentials:'include'}).then(async r=>{if(!r.ok)throw Error('No se pudo cargar RBAC');return r.json()}).then(d=>setMatrix(d.matrix)).catch(e=>setStatus(e.message)); },[]);
  const values = scope === 'role' ? matrix.roles[target as Exclude<RbacRole,'SUPERADMIN'>] || {} : matrix.users[target] || {};
  const setPermission = (key:PermissionKey, value:boolean|undefined) => {
    setMatrix(previous => {
      const group = scope === 'role' ? previous.roles : previous.users;
      const next = {...(group as any)[target]};
      if(value === undefined) delete next[key]; else next[key] = value;
      return {...previous, [scope === 'role' ? 'roles' : 'users']:{...group,[target]:next}};
    });
  };
  const save=async()=>{setBusy(true);setStatus('');try{const r=await fetch('/api/admin/rbac',{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({matrix})});if(!r.ok)throw Error((await r.json()).error||'Error al guardar');setStatus('Permisos guardados correctamente.');}catch(e){setStatus(e instanceof Error?e.message:'Error inesperado');}finally{setBusy(false);}};
  return <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 space-y-5">
    <div><h2 className="text-lg font-bold text-slate-900 dark:text-white">Matriz granular RBAC</h2><p className="text-sm text-slate-500 dark:text-slate-300">Solo el Superadmin administra permisos por rol y excepciones individuales. El Superadmin conserva acceso completo.</p></div>
    <div className="flex flex-wrap gap-3 items-end">
      <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">Aplicar a
        <select className="block mt-1 rounded-lg border p-2 bg-white text-slate-900" value={scope} onChange={e=>{const next=e.target.value as 'role'|'user';setScope(next);setTarget(next==='role'?'ADMIN':users.find(u=>u.role!=='SUPERADMIN')?.id||'');}}><option value="role">Rol</option><option value="user">Usuario</option></select>
      </label>
      <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">Seleccionar
        <select className="block mt-1 rounded-lg border p-2 bg-white text-slate-900" value={target} onChange={e=>setTarget(e.target.value)}>
          {scope==='role'?ROLES.map(r=><option key={r} value={r}>{r}</option>):users.filter(u=>u.role!=='SUPERADMIN').map(u=><option key={u.id} value={u.id}>{u.name} {u.lastName} ({u.role})</option>)}
        </select>
      </label>
    </div>
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-600">
      <table className="w-full text-sm text-slate-900 dark:text-slate-100"><thead><tr className="bg-slate-100 dark:bg-slate-900"><th className="p-3 text-left">Módulo</th>{RBAC_ACTIONS.map(a=><th key={a} className="p-3 text-center">{RBAC_ACTION_LABELS[a]}</th>)}</tr></thead>
      <tbody>{RBAC_MODULES.map(module=><tr key={module} className="border-t border-slate-200 dark:border-slate-600"><th className="p-3 text-left whitespace-nowrap">{RBAC_LABELS[module]}</th>{RBAC_ACTIONS.map(action=>{const key=`${module}.${action}` as PermissionKey;const current=values[key];return <td key={key} className="p-2 text-center"><button type="button" role="switch" aria-checked={current===true} aria-label={`${RBAC_LABELS[module]}: ${RBAC_ACTION_LABELS[action]}; ${current===undefined?'Heredado':current?'Permitido':'Denegado'}`} title={current===undefined?'Heredado (clic: permitir)':current?'Permitido (clic: denegar)':'Denegado (clic: heredar)'} onClick={()=>setPermission(key,current===undefined?true:current===true?false:undefined)} className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${current===true?'bg-indigo-600':current===false?'bg-rose-500':'bg-slate-400'}`}><span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${current===true?'translate-x-6':'translate-x-1'}`}/></button></td>})}</tr>)}</tbody></table>
    </div>
    <p className="text-xs text-slate-500 dark:text-slate-300">Gris: hereda los permisos del rol o la política predeterminada. Violeta: permite. Rojo: deniega. Cada switch alterna entre los tres estados.</p>
    <button type="button" disabled={busy} onClick={save} className="rounded-xl bg-indigo-600 px-5 py-2.5 font-semibold text-white disabled:opacity-50">{busy?'Guardando…':'Guardar permisos'}</button>{status&&<p role="status" className="text-sm text-slate-700 dark:text-slate-200">{status}</p>}
  </section>;
}
