import React, { useEffect, useState } from 'react';
import type { User } from '../types';

type Role = 'ADMIN' | 'MANAGER' | 'ASESOR';
type AiSettings = {
  models: { id: string; name: string }[];
  model: string;
  allowedRoles: Role[];
  settingsRoles: Role[];
  canConfigure: boolean;
  canDelegate: boolean;
};
function PermissionSwitch({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: () => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange}
    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 ${checked ? 'bg-indigo-600' : 'bg-slate-500/50'}`}>
    <span aria-hidden="true" className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
  </button>;
}
const roles: Role[] = ['ADMIN', 'MANAGER', 'ASESOR'];
const roleNames: Record<Role, string> = { ADMIN: 'Administradores', MANAGER: 'Operadores / Managers', ASESOR: 'Asesores' };

export default function AiAgentSettings({ currentUser }: { currentUser: User }) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    fetch('/api/ai/settings', { credentials: 'include' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo cargar el agente IA.');
        setSettings(data);
      }).catch(e => setError(e.message));
  }, []);
  const toggle = (field: 'allowedRoles' | 'settingsRoles', role: Role) => {
    if (!settings?.canDelegate) return;
    setSettings(prev => prev && ({ ...prev, [field]: prev[field].includes(role)
      ? prev[field].filter(item => item !== role) : [...prev[field], role] }));
  };
  const save = async () => {
    if (!settings?.canConfigure) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/ai/settings', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudieron guardar los cambios.');
      setNotice('Configuración del Agente IA guardada.');
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };
  if (error && !settings) return <div role="alert" className="p-4 rounded-xl border border-red-200 text-red-700">{error}</div>;
  if (!settings) return <p className="text-sm text-slate-500">Cargando modelos de Cloudflare Workers AI…</p>;
  return (
    <section className="w-full bg-white border border-slate-200 rounded-2xl p-5 sm:p-7 space-y-7">
      <div>
        <h2 className="text-lg font-bold text-slate-800">Agente IA</h2>
        <p className="text-sm text-slate-500">Modelos alojados en Cloudflare Workers AI. La autorización se comprueba también en el servidor.</p>
      </div>
      <label className="block text-sm font-semibold text-slate-700">
        Modelo activo
        <select className="block mt-2 w-full rounded-xl border border-slate-300 p-3.5 bg-slate-50 text-slate-900"
          value={settings.model} disabled={!settings.canConfigure}
          onChange={e => setSettings({ ...settings, model: e.target.value })}>
          {settings.models.map(m => <option key={m.id} value={m.id}>{m.name} — {m.id}</option>)}
        </select>
      </label>
      {settings.canDelegate && (
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-bold text-slate-800">Acceso por rol</h3>
            <p className="text-sm text-slate-500">Activá el uso de IA y la administración del agente de forma independiente para cada perfil.</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {roles.map(role => (
              <div key={role} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 space-y-5">
                <h4 className="font-semibold text-slate-800">{roleNames[role]}</h4>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700">Usar IA</span>
                  <PermissionSwitch label={`Permitir usar IA a ${roleNames[role]}`}
                    checked={settings.allowedRoles.includes(role)} onChange={() => toggle('allowedRoles', role)} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700">Configurar IA</span>
                  <PermissionSwitch label={`Permitir configurar IA a ${roleNames[role]}`}
                    checked={settings.settingsRoles.includes(role)} onChange={() => toggle('settingsRoles', role)} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
      {settings.canConfigure && <button disabled={saving} onClick={save}
        className="bg-indigo-600 text-white rounded-xl px-5 py-2.5 font-semibold disabled:opacity-50">
        {saving ? 'Guardando…' : 'Guardar Agente IA'}
      </button>}
    </section>
  );
}
