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
    <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-800">Agente IA</h2>
        <p className="text-sm text-slate-500">Modelos alojados en Cloudflare Workers AI. La autorización se comprueba también en el servidor.</p>
      </div>
      <label className="block text-sm font-semibold text-slate-700">
        Modelo activo
        <select className="block mt-2 w-full rounded-xl border border-slate-300 p-3 bg-slate-50"
          value={settings.model} disabled={!settings.canConfigure}
          onChange={e => setSettings({ ...settings, model: e.target.value })}>
          {settings.models.map(m => <option key={m.id} value={m.id}>{m.name} — {m.id}</option>)}
        </select>
      </label>
      {settings.canDelegate && (
        <div className="space-y-3">
          <h3 className="font-semibold text-slate-800">Permisos por rol</h3>
          <div className="grid gap-3">
            {roles.map(role => <div key={role} className="flex flex-wrap items-center justify-between gap-3 border border-slate-200 rounded-xl p-3">
              <span className="text-sm font-medium">{roleNames[role]}</span>
              <div className="flex flex-wrap gap-5">
                <label className="flex gap-2 items-center text-sm">
                  <input type="checkbox" checked={settings.allowedRoles.includes(role)} onChange={() => toggle('allowedRoles', role)} /> Usar IA
                </label>
                <label className="flex gap-2 items-center text-sm">
                  <input type="checkbox" checked={settings.settingsRoles.includes(role)} onChange={() => toggle('settingsRoles', role)} /> Configurar IA
                </label>
              </div>
            </div>)}
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
