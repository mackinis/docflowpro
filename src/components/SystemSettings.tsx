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
  List,
  FolderKanban
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
      global: 'email',
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

  // Templates permission state
  const [allowAdminManagerTemplates, setAllowAdminManagerTemplates] = useState(() => {
    return state.systemSettings?.allowAdminManagerTemplates !== false;
  });

  const defaultTabs = [
    { id: 'dashboard', label: 'Tablero Principal' },
    { id: 'audit', label: 'Auditoría' },
    { id: 'cases', label: 'Legajos' },
    { id: 'documents', label: 'Documentos' },
    { id: 'messages', label: 'Mensajes' },
    { id: 'notifications', label: 'Notificaciones' },
    { id: 'templates', label: 'Plantillas y Procesos' },
    { id: 'profile', label: 'Perfiles de Usuarios' },
    { id: 'settings', label: 'Configuración' },
  ];

  const getCompletedTabOrder = (savedOrder?: string[]) => {
    const list = savedOrder && Array.isArray(savedOrder) ? [...savedOrder] : defaultTabs.map(t => t.id);
    // filter out any stale IDs that are no longer in defaultTabs
    const validIds = defaultTabs.map(t => t.id);
    const filteredList = list.filter(id => validIds.includes(id));
    
    defaultTabs.forEach(t => {
      if (!filteredList.includes(t.id)) {
        const defaultIdx = defaultTabs.findIndex(dt => dt.id === t.id);
        filteredList.splice(defaultIdx, 0, t.id);
      }
    });
    return filteredList;
  };

  const [tabOrderState, setTabOrderState] = useState<string[]>(() => {
    return getCompletedTabOrder(state.systemSettings?.tabOrder);
  });

  // Sync tabOrderState if state updates from server
  React.useEffect(() => {
    if (state.systemSettings?.tabOrder) {
      setTabOrderState(getCompletedTabOrder(state.systemSettings.tabOrder));
    }
  }, [state.systemSettings?.tabOrder]);

  // Sync allowAdminManagerTemplates if state updates from server
  React.useEffect(() => {
    if (state.systemSettings?.allowAdminManagerTemplates !== undefined) {
      setAllowAdminManagerTemplates(state.systemSettings.allowAdminManagerTemplates);
    }
  }, [state.systemSettings?.allowAdminManagerTemplates]);

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

  const handleUpdateGlobalPolicy = async (value: 'email' | 'sms' | 'both') => {
    setLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      const updatedPolicies = {
        ...policies,
        global: value
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

      setPolicies(updatedPolicies as any);
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

  const handleToggleTemplatePermission = async () => {
    setLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      const newValue = !allowAdminManagerTemplates;
      const res = await fetch('/api/system-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            allowAdminManagerTemplates: newValue
          },
          currentUserId: currentUser.id
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Error al actualizar permisos de plantillas.');
      }

      setAllowAdminManagerTemplates(newValue);
      setSuccessMsg(`Permiso de gestión de plantillas para Administradores y Managers actualizado con éxito.`);
      await loadState();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const isSuperAdmin = currentUser.role === 'SUPERADMIN';
  const isAdminOrSuper = isSuperAdmin || currentUser.role === 'ADMIN';

  if (!isSuperAdmin && currentUser.role !== 'ADMIN' && currentUser.role !== 'MANAGER') {
    return (
      <div className="bg-red-50 border border-red-200 text-red-800 p-6 rounded-2xl flex items-center gap-4 shadow-sm" id="unauthorized-settings">
        <Lock className="w-8 h-8 text-red-600 shrink-0" />
        <div>
          <h3 className="font-bold text-lg">Acceso Denegado</h3>
          <p className="text-sm text-red-700/90">Solo los Superadministradores, Administradores y Managers tienen acceso a la configuración del sistema.</p>
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
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between" id="card-mfa-policies">
          <div>
            <div className="flex items-center gap-2 text-indigo-600 mb-3">
              <ShieldCheck className="w-5 h-5" />
              <h2 className="font-bold text-slate-800 text-base">Políticas de Verificación (MFA)</h2>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed mb-4">
              Configura el método de verificación obligatorio para todos los usuarios que se registren en la plataforma. El Superadmin está exento de esta validación.
            </p>
            
            <div className="space-y-4">
              {(() => {
                const currentPolicy = policies?.global || 'email';
                const options = [
                  { value: 'email', label: 'Email', description: 'Verificación exclusiva por correo electrónico' },
                  { value: 'sms', label: 'SMS', description: 'Verificación exclusiva por mensaje de texto (SMS)' },
                  { value: 'both', label: 'Ambos Requeridos', description: 'Debe validar tanto su correo electrónico como su celular vía SMS' }
                ];

                return (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 rounded-xl bg-indigo-50/50 border border-indigo-100/50">
                      <span className="text-[11px] font-mono font-bold text-slate-700 uppercase tracking-wider">
                        Política Activa Global
                      </span>
                      <span className="text-[10px] font-mono bg-indigo-600 text-white px-2.5 py-0.5 rounded-full uppercase font-bold">
                        {currentPolicy === 'both' ? 'Email + SMS' : currentPolicy}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {options.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={loading || !isSuperAdmin}
                          onClick={() => handleUpdateGlobalPolicy(opt.value as any)}
                          className={`w-full text-left p-3 rounded-xl transition-all border flex flex-col gap-1 cursor-pointer ${
                            currentPolicy === opt.value
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-md scale-[1.01]'
                              : 'bg-slate-50 text-slate-700 border-slate-200/60 hover:bg-slate-100 disabled:cursor-not-allowed'
                          }`}
                        >
                          <div className="flex justify-between items-center w-full">
                            <span className="text-xs font-bold">{opt.label}</span>
                            {currentPolicy === opt.value && (
                              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                            )}
                          </div>
                          <span className={`text-[10px] leading-relaxed ${
                            currentPolicy === opt.value ? 'text-indigo-100' : 'text-slate-500'
                          }`}>
                            {opt.description}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
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
              Establece el rubro industrial rector de la organización. Esto ajusta dinámicamente las sugerencias con Inteligencia Artificial, campos de plantillas y de legajos.
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

        {/* Card 5: Templates and Digitalization Permission */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-indigo-600 mb-3">
              <FolderKanban className="w-5 h-5" />
              <h2 className="font-bold text-slate-800 text-base">Permisos de Plantillas de Procesos</h2>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed mb-4">
              Determina si los Administradores y Managers tienen permitido crear, editar, duplicar, digitalizar y eliminar plantillas de procesos. El Superadmin siempre tendrá acceso sin restricciones. Los Asesores nunca podrán gestionar plantillas.
            </p>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/60 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider font-mono">
                  Admins & Managers
                </span>
                <button
                  type="button"
                  disabled={loading || !isSuperAdmin}
                  onClick={handleToggleTemplatePermission}
                  className={`px-3 py-1 text-xs font-extrabold uppercase rounded-full border transition-all cursor-pointer ${
                    allowAdminManagerTemplates
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                      : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                  } disabled:cursor-not-allowed`}
                >
                  {allowAdminManagerTemplates ? 'Habilitado' : 'Deshabilitado'}
                </button>
              </div>
            </div>
          </div>
          {!isSuperAdmin && (
            <div className="text-[10px] text-amber-600 bg-amber-50 p-2 rounded-lg border border-amber-100 mt-2">
              * Solo modificable por el Superadmin.
            </div>
          )}
        </div>

        {/* Card 6: Obligatoriedad de Plantilla de Proceso */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-indigo-600 mb-3">
              <FolderKanban className="w-5 h-5" />
              <h2 className="font-bold text-slate-800 text-base">Obligatoriedad de Plantilla de Proceso</h2>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed mb-4">
              Configura si el campo "Plantilla de Proceso" es obligatorio o de carácter opcional al momento de crear nuevos legajos en la plataforma.
            </p>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/60 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider font-mono">
                  Campo Obligatorio
                </span>
                <button
                  type="button"
                  disabled={loading}
                  onClick={async () => {
                    setLoading(true);
                    setSuccessMsg(null);
                    setErrorMsg(null);
                    try {
                      const currentValue = state.systemSettings?.processTemplateRequired !== false;
                      const res = await fetch('/api/system-settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          settings: {
                            processTemplateRequired: !currentValue
                          },
                          currentUserId: currentUser.id
                        })
                      });
                      if (!res.ok) throw new Error('Error al actualizar obligatoriedad.');
                      setSuccessMsg('Configuración de obligatoriedad de plantilla de proceso actualizada con éxito.');
                      await loadState();
                    } catch (err: any) {
                      setErrorMsg(err.message);
                    } finally {
                      setLoading(false);
                    }
                  }}
                  className={`px-3 py-1 text-xs font-extrabold uppercase rounded-full border transition-all cursor-pointer ${
                    state.systemSettings?.processTemplateRequired !== false
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                      : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                  }`}
                >
                  {state.systemSettings?.processTemplateRequired !== false ? 'Obligatorio' : 'Opcional'}
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
