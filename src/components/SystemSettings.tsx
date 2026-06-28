import React, { useState } from 'react';
import { 
  Settings, 
  ShieldCheck, 
  Compass, 
  MessageSquare, 
  CheckCircle, 
  AlertTriangle, 
  Lock,
  Mail,
  Clock,
  ArrowUp,
  ArrowDown,
  List
} from 'lucide-react';
import { User, AppDataState } from '../types';

interface SystemSettingsProps {
  currentUser: User;
  state: AppDataState;
  loadState: () => Promise<void>;
}

export default function SystemSettings({
  currentUser,
  state,
  loadState
}: SystemSettingsProps) {
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Policies state
  const [policies, setPolicies] = useState(() => {
    return state.verificationPolicies || {
      ASESOR: 'email',
      MANAGER: 'email',
      ADMIN: 'email'
    };
  });

  // Industry state
  const [activeIndustry, setActiveIndustry] = useState(state.activeIndustry || 'Inmobiliaria');

  // Individual role messaging configurations
  const [roleConfigs, setRoleConfigs] = useState(() => {
    return state.systemSettings?.roleMessagingConfigs || {
      SUPERADMIN: { allowed: true, rule: 'free' },
      ADMIN: { allowed: true, rule: 'free' },
      MANAGER: { allowed: true, rule: 'free' },
      ASESOR: { allowed: true, rule: 'free' }
    };
  });

  const defaultTabs = [
    { id: 'dashboard', label: 'Tablero Principal' },
    { id: 'cases', label: 'Expedientes' },
    { id: 'templates', label: 'Plantillas de Procesos' },
    { id: 'profile', label: 'Perfiles de usuarios' },
    { id: 'messages', label: 'Mensajes' },
    { id: 'notifications', label: 'Notificaciones' },
    { id: 'settings', label: 'Configuración' },
    { id: 'audit', label: 'Auditoría' },
  ];

  const [tabOrderState, setTabOrderState] = useState<string[]>(() => {
    return state.systemSettings?.tabOrder || defaultTabs.map(t => t.id);
  });

  // Sync tabOrderState if state updates from server
  React.useEffect(() => {
    if (state.systemSettings?.tabOrder) {
      setTabOrderState(state.systemSettings.tabOrder);
    }
  }, [state.systemSettings?.tabOrder]);

  const moveTab = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === tabOrderState.length - 1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const newOrder = [...tabOrderState];
    const temp = newOrder[index];
    newOrder[index] = newOrder[targetIndex];
    newOrder[targetIndex] = temp;
    setTabOrderState(newOrder);
  };

  const handleSaveTabOrder = async () => {
    setLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/system-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            tabOrder: tabOrderState
          },
          currentUserId: currentUser.id
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Error al guardar el orden de las solapas.');
      }

      setSuccessMsg('Orden de solapas lateral actualizado para todos los usuarios con éxito.');
      await loadState();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePolicy = async (role: string, value: string) => {
    setLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      const updatedPolicies = {
        ...policies,
        [role]: value
      };

      const res = await fetch('/api/verification-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policies: updatedPolicies,
          currentUserId: currentUser.id
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Error al guardar la política de verificación.');
      }

      setPolicies(updatedPolicies);
      setSuccessMsg('Política de Verificación (MFA) actualizada con éxito.');
      await loadState();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChangeIndustry = async (industry: string) => {
    setLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/industry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          industry,
          currentUserId: currentUser.id
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Error al cambiar el rubro de la plataforma.');
      }

      setActiveIndustry(industry);
      setSuccessMsg(`El rubro activo de la plataforma se cambió a: ${industry}`);
      await loadState();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateRoleConfig = async (role: string, field: 'allowed' | 'rule', value: any) => {
    setLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      const currentRoleConfig = (roleConfigs as any)[role] || { allowed: true, rule: 'free' };
      const updatedRoleConfig = {
        ...currentRoleConfig,
        [field]: value
      };
      const updatedConfigs = {
        ...roleConfigs,
        [role]: updatedRoleConfig
      };

      const res = await fetch('/api/system-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            roleMessagingConfigs: updatedConfigs
          },
          currentUserId: currentUser.id
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Error al actualizar las políticas de mensajería.');
      }

      setRoleConfigs(updatedConfigs as any);
      setSuccessMsg(`Configuración de mensajería para ${role === 'ASESOR' ? 'Asesores' : role === 'MANAGER' ? 'Managers' : role} actualizada con éxito.`);
      await loadState();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const isSuperAdmin = currentUser.role === 'SUPERADMIN';

  if (!isSuperAdmin && currentUser.role !== 'ADMIN') {
    return (
      <div className="bg-red-50 border border-red-200 text-red-800 p-6 rounded-2xl flex items-center gap-4 shadow-sm" id="unauthorized-settings">
        <Lock className="w-8 h-8 text-red-600 shrink-0" />
        <div>
          <h3 className="font-bold text-lg">Acceso Denegado</h3>
          <p className="text-sm text-red-700/90">Solo los Superadministradores y Administradores tienen acceso a la configuración del sistema.</p>
        </div>
      </div>
    );
  }

  const roleLabels: Record<string, string> = {
    SUPERADMIN: 'Superadmin',
    ADMIN: 'Administradores',
    MANAGER: 'Managers',
    ASESOR: 'Asesores'
  };

  return (
    <div className="space-y-6 animate-fade-in" id="system-settings-panel">
      {/* Title block */}
      <div className="border-b border-slate-200 pb-5">
        <h1 className="font-display font-bold text-2xl text-slate-800 tracking-tight flex items-center gap-2.5">
          <Settings className="w-6 h-6 text-indigo-600" />
          Configuración del Sistema
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Panel de administración global para definir políticas de seguridad, flujo de comunicación y rubro activo.
        </p>
      </div>

      {/* Message blocks */}
      {successMsg && (
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl text-sm" id="msg-settings-success">
          <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="font-medium">{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl text-sm" id="msg-settings-error">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <span className="font-medium">{errorMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        
        {/* Card 1: Verification Policies (MFA) */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-indigo-600 mb-3">
              <ShieldCheck className="w-5 h-5" />
              <h2 className="font-bold text-slate-800 text-base">Políticas de Verificación (MFA)</h2>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed mb-4">
              Determina cómo deben validar sus cuentas los usuarios según su rol asignado. Puede configurarse por correo, mensaje de texto (SMS) o ambos requisitos combinados.
            </p>
            
            <div className="space-y-4">
              {['ASESOR', 'MANAGER', 'ADMIN'].map((roleKey) => {
                const currentPolicy = (policies as any)[roleKey] || 'email';
                return (
                  <div key={roleKey} className="space-y-2 p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] font-mono font-bold text-slate-700 uppercase tracking-wider">
                        Rol: {roleKey === 'ADMIN' ? 'ADMIN / SUPERADMIN' : `${roleKey}S`}
                      </span>
                      <span className="text-[9px] font-mono bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full uppercase font-bold border border-indigo-100">
                        {currentPolicy === 'both' ? 'Email + SMS' : currentPolicy}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {[
                        { value: 'email', label: 'Email' },
                        { value: 'sms', label: 'SMS' },
                        { value: 'both', label: 'Ambos' }
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={loading || !isSuperAdmin}
                          onClick={() => handleUpdatePolicy(roleKey, opt.value)}
                          className={`px-2.5 py-1 text-[10px] font-bold rounded-full transition-all cursor-pointer border ${
                            currentPolicy === opt.value
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {!isSuperAdmin && (
            <div className="text-[10px] text-amber-600 bg-amber-50 p-2 rounded-lg border border-amber-100 mt-2">
              * Solo modificable por el Superadmin.
            </div>
          )}
        </div>

        {/* Card 2: Platform Industry */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-indigo-600 mb-3">
              <Compass className="w-5 h-5" />
              <h2 className="font-bold text-slate-800 text-base">Rubro Activo de la Plataforma</h2>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed mb-4">
              Establece el rubro industrial rector de la organización. Esto ajusta dinámicamente las sugerencias con Inteligencia Artificial, campos de plantillas y de expedientes.
            </p>

            <div className="flex flex-wrap gap-2">
              {['Inmobiliaria', 'Legal', 'Contable', 'Recursos Humanos', 'Comercial'].map((rubro) => (
                <button
                  key={rubro}
                  onClick={() => handleChangeIndustry(rubro)}
                  disabled={loading || !isSuperAdmin}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition-colors cursor-pointer ${
                    activeIndustry === rubro
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs font-bold'
                      : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-200/80 disabled:cursor-not-allowed'
                  }`}
                  type="button"
                >
                  <span>{rubro}</span>
                  {activeIndustry === rubro && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                </button>
              ))}
            </div>
          </div>
          {!isSuperAdmin && (
            <div className="text-[10px] text-amber-600 bg-amber-50 p-2 rounded-lg border border-amber-100 mt-2">
              * Solo modificable por el Superadmin.
            </div>
          )}
        </div>

        {/* Card 3: Internal Messaging & Communication Rules per Role */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-indigo-600 mb-3">
              <MessageSquare className="w-5 h-5" />
              <h2 className="font-bold text-slate-800 text-base">Políticas de Mensajería Interna</h2>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed mb-4">
              Configura permisos de comunicación de forma <strong className="text-indigo-600 font-semibold">individual por perfil</strong>. Decide quiénes pueden iniciar chats y si deben esperar respuestas antes de seguir enviando.
            </p>

            <div className="space-y-4">
              {['SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR'].map((role) => {
                const config = (roleConfigs as any)[role] || { allowed: true, rule: 'free' };
                
                return (
                  <div key={role} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/60 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-slate-700 uppercase tracking-wider font-mono">
                        {roleLabels[role] || role}
                      </span>
                      <button
                        type="button"
                        disabled={loading || !isSuperAdmin}
                        onClick={() => handleUpdateRoleConfig(role, 'allowed', !config.allowed)}
                        className={`px-2 py-0.5 text-[9px] font-extrabold uppercase rounded-full border transition-all cursor-pointer ${
                          config.allowed
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                        } disabled:cursor-not-allowed`}
                      >
                        {config.allowed ? 'Habilitado' : 'Deshabilitado'}
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-[10px] font-semibold text-slate-500 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Frecuencia de envío:
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          disabled={loading || !isSuperAdmin || !config.allowed}
                          onClick={() => handleUpdateRoleConfig(role, 'rule', 'free')}
                          className={`px-2.5 py-1 text-[10px] font-bold rounded-full transition-all cursor-pointer border ${
                            config.rule === 'free'
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55'
                          }`}
                        >
                          Envío Libre
                        </button>
                        <button
                          type="button"
                          disabled={loading || !isSuperAdmin || !config.allowed}
                          onClick={() => handleUpdateRoleConfig(role, 'rule', 'wait_reply')}
                          className={`px-2.5 py-1 text-[10px] font-bold rounded-full transition-all cursor-pointer border ${
                            config.rule === 'wait_reply'
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55'
                          }`}
                          title="Impide enviar nuevos mensajes al mismo destinatario hasta que éste le haya respondido."
                        >
                          Esperar Rta.
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {!isSuperAdmin && (
            <div className="text-[10px] text-amber-600 bg-amber-50 p-2 rounded-lg border border-amber-100 mt-2">
              * Solo modificable por el Superadmin.
            </div>
          )}
        </div>

        {/* Card 4: Sidebar Menu Tab Ordering */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-indigo-600 mb-3">
              <List className="w-5 h-5" />
              <h2 className="font-bold text-slate-800 text-base">Orden de Solapas del Menú</h2>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed mb-4">
              Establece el orden de prioridad de las solapas del menú lateral lateral para todos los usuarios. El orden definido aquí se aplicará de manera unificada independientemente del rol o permisos de cada perfil.
            </p>

            <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
              {tabOrderState.map((tabId, index) => {
                const matchedTab = defaultTabs.find(t => t.id === tabId);
                if (!matchedTab) return null;
                return (
                  <div 
                    key={tabId} 
                    className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl transition-all"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-xs font-mono font-bold text-slate-400">
                        #{index + 1}
                      </span>
                      <span className="text-xs font-semibold text-slate-700">
                        {matchedTab.label}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={loading || !isSuperAdmin || index === 0}
                        onClick={() => moveTab(index, 'up')}
                        className="p-1 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-indigo-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Subir"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={loading || !isSuperAdmin || index === tabOrderState.length - 1}
                        onClick={() => moveTab(index, 'down')}
                        className="p-1 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-indigo-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Bajar"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-2 mt-4 pt-4 border-t border-slate-100">
            {isSuperAdmin ? (
              <button
                type="button"
                disabled={loading}
                onClick={handleSaveTabOrder}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {loading ? 'Guardando...' : 'Guardar Orden de Solapas'}
              </button>
            ) : (
              <div className="text-[10px] text-amber-600 bg-amber-50 p-2 rounded-lg border border-amber-100">
                * El orden de las solapas solo puede ser modificado por el Superadmin.
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
