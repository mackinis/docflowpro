import React, { useState, useEffect } from 'react';
import { 
  Loader2, 
  Sparkles, 
  Layers, 
  AlertCircle,
  Menu
} from 'lucide-react';
import { AppDataState, User, Case, ProcessTemplate, Participant } from './types';
import Sidebar from './components/Sidebar';
import DashboardManager from './components/DashboardManager';
import DashboardAdvisor from './components/DashboardAdvisor';
import CasesList from './components/CasesList';
import CaseDetail from './components/CaseDetail';
import TemplatesManager from './components/TemplatesManager';
import Confecciones from './components/Confecciones';
import AuditLogs from './components/AuditLogs';
import AdvisorStatistics from './components/AdvisorStatistics';
import AuthScreen from './components/AuthScreen';
import UserProfile from './components/UserProfile';
import SystemSettings from './components/SystemSettings';
import NotificationsCenter from './components/NotificationsCenter';
import MessagesCenter from './components/MessagesCenter';
import SharedDocumentsManager from './components/SharedDocumentsManager';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [operationNotice, setOperationNotice] = useState<string | null>(null);
  
  // Mobile responsive sidebar state
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  
  // App data state
  const [state, setState] = useState<AppDataState | null>(null);
  
  // Bootstrap & Turnstile states
  const [needsSetup, setNeedsSetup] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('');
  const [turnstileEnabled, setTurnstileEnabled] = useState(false);
  const [publicRegistrationEnabled, setPublicRegistrationEnabled] = useState(true);

  // Authentication states
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [realUser, setRealUser] = useState<User | null>(null);
  
  // Navigation states
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);

  // Record navigation without collecting form values or sensitive URL parameters.
  useEffect(() => {
    if (!currentUser || !state) return;
    void fetch('/api/audit/navigation', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tab: activeTab, caseId: activeCaseId })
    }).catch(() => {});
  }, [activeTab, activeCaseId, currentUser?.id]);

  // Load backend state via Cloudflare Worker session cookie
  const loadState = async (refreshOnly = false) => {
    try {
      setError(null);
      let bootstrapData: { user?: User; realUser?: User; needsSetup?: boolean; turnstileSiteKey?: string; turnstileEnabled?: boolean; publicRegistrationEnabled?: boolean } | null = null;
      if (!refreshOnly) {
      const bootstrapRes = await fetch('/api/auth/bootstrap-status', {
        credentials: 'include',
        signal: AbortSignal.timeout(15000)
      });
      if (!bootstrapRes.ok) {
        throw new Error('No se pudo conectar con el servidor Cloudflare Worker.');
      }
      bootstrapData = await bootstrapRes.json();
      setNeedsSetup(Boolean(bootstrapData!.needsSetup));
      setTurnstileSiteKey(bootstrapData!.turnstileSiteKey || '');
      setTurnstileEnabled(Boolean(bootstrapData!.turnstileEnabled));
      setPublicRegistrationEnabled(bootstrapData!.publicRegistrationEnabled !== false);

      if (!bootstrapData!.user) {
        sessionStorage.removeItem('docflow_user');
        sessionStorage.removeItem('docflow_real_user');
        setCurrentUser(null);
        setRealUser(null);
        setState(null);
        return;
      }

      }
      // D1 initialization and transient Cloudflare errors can briefly return 503.
      // Retry the state request without showing a misleading connection-error page.
      let response: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          response = await fetch('/api/state', {
            credentials: 'include',
            signal: AbortSignal.timeout(25000)
          });
          if (response.status !== 503 && response.status !== 502 && response.status !== 504) break;
        } catch (requestError) {
          if (attempt === 2) throw requestError;
        }
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1200 * (attempt + 1)));
      }
      if (!response) throw new Error('No se recibió respuesta del servidor.');
      if (response.status === 401) {
        sessionStorage.removeItem('docflow_user');
        sessionStorage.removeItem('docflow_real_user');
        setCurrentUser(null);
        setRealUser(null);
        setState(null);
        return;
      }
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.error || detail.message || 'No se pudo recuperar el estado del servidor.');
      }
      const data: AppDataState = await response.json();
      setState(data);

      if (!refreshOnly) {
      const sessionUser: User = bootstrapData!.user!;
      const sessionRealUser: User = bootstrapData!.realUser || bootstrapData!.user!;
      setCurrentUser(sessionUser);
      setRealUser(sessionRealUser);
      sessionStorage.setItem('docflow_user', JSON.stringify(sessionUser));
      sessionStorage.setItem('docflow_real_user', JSON.stringify(sessionRealUser));
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.name === 'TimeoutError' ? 'El servidor tardó demasiado en responder. Intente nuevamente.' : (err.message || 'Error de conexión con el servidor Cloudflare Worker.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadState();
  }, []);

  // Sync state helper wrapper
  const syncOperation = async (url: string, options: RequestInit, successMsg?: string) => {
    try {
      const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
      const headers: Record<string, string> = {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...((options.headers as Record<string, string>) || {})
      };

      const response = await fetch(url, {
        ...options,
        credentials: 'include',
        headers
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Ocurrió un error en el servidor.');
      }
      
      // Reload state after success to capture audit logs & notifications
      await loadState(true);
      
      if (successMsg) {
        setOperationNotice(successMsg);
      }
    } catch (err: any) {
      console.error(err);
      setOperationNotice(`Error en la operación: ${err.message}`);
    }
  };

  // Switch active role/user (Superadmin server-verified impersonation)
  const handleUserChange = async (user: User) => {
    try {
      const response = await fetch('/api/auth/impersonate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: user.id })
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'No se pudo cambiar de usuario.');
      }
      setActiveTab('dashboard');
      setActiveCaseId(null);
      await loadState();
    } catch (err: any) {
      console.error(err);
      setOperationNotice(`Error al simular rol: ${err.message}`);
    }
  };

  // Handle current user updating (from UserProfile settings)
  const handleUpdateCurrentUser = (updatedUser: User) => {
    setCurrentUser(updatedUser);
    sessionStorage.setItem('docflow_user', JSON.stringify(updatedUser));
    if (realUser && updatedUser.id === realUser.id) {
      setRealUser(updatedUser);
      sessionStorage.setItem('docflow_real_user', JSON.stringify(updatedUser));
    }
  };

  // Create new Legajo (Case)
  const handleCreateCase = async (caseData: {
    title: string;
    description: string;
    templateId: string;
    assignedAdvisorId: string;
    assignedManagerId: string;
    participants: Participant[];
    documentContent?: string;
  }) => {
    await syncOperation('/api/cases', {
      method: 'POST',
      body: JSON.stringify(caseData)
    }, `Legajo "${caseData.title}" creado con éxito.`);
  };

  // Upload Document (real file to Cloudflare R2 or digital contract registration)
  const handleUploadDoc = async (stageId: string, reqId: string, reqName: string, fileName: string, fileSize: number, file?: File, onProgress?: (percent: number, loadedBytes?: number, totalBytes?: number) => void) => {
    if (!activeCaseId || !currentUser) throw new Error('No hay un legajo o usuario activo.');
    if (file) {
      const formData = new FormData();
      formData.append('caseId', activeCaseId);
      formData.append('stageId', stageId);
      formData.append('requirementId', reqId);
      formData.append('name', reqName);
      formData.append('file', file);
      // XMLHttpRequest permite medir bytes realmente enviados; fetch no expone progreso de subida.
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/documents/upload');
        xhr.withCredentials = true;
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) {
            onProgress?.(Math.min(100, Math.floor((event.loaded / event.total) * 100)), event.loaded, event.total);
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            let message = 'No se pudo guardar el archivo.';
            try { message = JSON.parse(xhr.responseText).error || message; } catch {}
            reject(new Error(message));
          }
        };
        xhr.onerror = () => reject(new Error('Falló la conexión durante la subida.'));
        xhr.onabort = () => reject(new Error('Se canceló la subida.'));
        xhr.send(formData);
      });
      await loadState();
    } else {
      await syncOperation('/api/documents/upload', {
        method: 'POST',
        body: JSON.stringify({
          caseId: activeCaseId,
          stageId,
          requirementId: reqId,
          name: reqName,
          fileName,
          fileSize,
          uploadedBy: currentUser.id
        })
      });
    }
  };

  // Advisor replace document with real file binary in Cloudflare R2
  const handleReplaceDoc = async (caseId: string, stageId: string, reqId: string, docName: string, file: File) => {
    if (!currentUser) return;
    const formData = new FormData();
    formData.append('caseId', caseId);
    formData.append('stageId', stageId);
    formData.append('requirementId', reqId);
    formData.append('name', docName);
    formData.append('file', file);
    await syncOperation('/api/documents/upload', {
      method: 'POST',
      body: formData
    });
  };

  // Review Document (Approve / Reject)
  const handleReviewDoc = async (docId: string, status: 'approved' | 'rejected' | 'uploaded', observationText?: string, allowedRoles?: string[]) => {
    if (!currentUser) throw new Error('Sesión no disponible.');
    const response = await fetch(`/api/documents/${docId}/review`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, observationText, allowedRoles })
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error || 'No se pudo guardar el estado del documento.');
    }
    await loadState();
    setOperationNotice(status === 'approved' ? 'Documento aprobado correctamente.' : status === 'uploaded' ? 'Aprobación revertida correctamente.' : 'Documento rechazado. Se notificó al asesor.');
  };

  // Complete/Toggle Task checklist
  const handleToggleTask = async (taskId: string, status: 'pending' | 'completed') => {
    if (!currentUser) return;
    await syncOperation(`/api/tasks/${taskId}/toggle`, {
      method: 'POST',
      body: JSON.stringify({
        status,
        completedBy: currentUser.id
      })
    });
  };

  // Update digital document content of a Case
  const handleUpdateCaseDocument = async (caseId: string, content: string, showDocumentToAll?: boolean, sharedViewMode?: 'both' | 'flow' | 'document') => {
    if (!currentUser) return;
    await syncOperation(`/api/cases/${caseId}`, {
      method: 'PUT',
      body: JSON.stringify({
        documentContent: content,
        showDocumentToAll: showDocumentToAll !== undefined ? showDocumentToAll : undefined,
        sharedViewMode: sharedViewMode !== undefined ? sharedViewMode : undefined,
        currentUserId: currentUser.id
      })
    });
  };

  // Submit form values
  const handleFormSubmit = async (reqId: string, values: Record<string, string | number | boolean>) => {
    if (!activeCaseId || !state || !currentUser) return;
    const caseObj = state.cases.find(c => c.id === activeCaseId);
    if (!caseObj) return;

    const template = state.templates.find(t => t.id === caseObj.templateId);
    const stageId = template?.stages[caseObj.currentStageIndex]?.id;

    if (!stageId) return;

    const response = await fetch('/api/forms/submit', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId: activeCaseId, stageId, requirementId: reqId, values })
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error || 'No se pudo guardar el formulario.');
    }
    await loadState(true);
  };

  // Create manual Observation
  const handleAddObservation = async (stageId: string, reqId: string | undefined, text: string) => {
    if (!activeCaseId || !currentUser) return;
    await syncOperation('/api/observations', {
      method: 'POST',
      body: JSON.stringify({
        caseId: activeCaseId,
        stageId,
        requirementId: reqId,
        text,
        createdBy: currentUser.id
      })
    }, 'Observación agregada y notificada al asesor.');
  };

  // Resolve Observation
  const handleResolveObservation = async (obsId: string, response: string) => {
    await syncOperation(`/api/observations/${obsId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ response })
    }, 'Respuesta guardada. La observación pasó a revisión.');
  };

  const handleReopenObservation = async (obsId: string) => {
    await syncOperation(`/api/observations/${obsId}/reopen`, {
      method: 'POST'
    }, 'Observación reabierta.');
  };

  // Advance Stage (Validated)
  const handleAdvanceStage = async () => {
    if (!activeCaseId) return;
    const response = await fetch(`/api/cases/${activeCaseId}/advance`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id })
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error || 'No se pudo completar la operación.');
    }
    await loadState(true);
    setOperationNotice('¡Etapa avanzada exitosamente! El legajo avanzó de nivel.');
  };

  // Approve Stage (Manager only)
  const handleApproveStage = async () => {
    if (!activeCaseId) return;
    const response = await fetch(`/api/cases/${activeCaseId}/approve-stage`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id })
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error || 'No se pudo completar la operación.');
    }
    await loadState(true);
    setOperationNotice('¡Etapa aprobada correctamente!');
  };

  const handleReopenCase = async (password: string): Promise<void> => {
    if (!activeCaseId) throw new Error('No hay un legajo activo.');
    const response = await fetch(`/api/cases/${activeCaseId}/reopen`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'No se pudo reabrir el legajo.');
    }
    await loadState();
  };

  // Add Participant dynamically to active case
  const handleAddParticipant = async (participant: Participant) => {
    if (!activeCaseId) return;
    await syncOperation(`/api/cases/${activeCaseId}/participants`, {
      method: 'POST',
      body: JSON.stringify({ ...participant, currentUserId: currentUser?.id })
    }, `Actor ${participant.name} ${participant.lastName} añadido correctamente.`);
  };

  // Update Participant dynamically inside active case
  const handleUpdateParticipant = async (participant: Participant) => {
    if (!activeCaseId) return;
    await syncOperation(`/api/cases/${activeCaseId}/participants/${participant.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...participant, currentUserId: currentUser?.id })
    }, `Actor ${participant.name} ${participant.lastName} actualizado correctamente.`);
  };

  // Remove Participant dynamically from active case
  const handleRemoveParticipant = async (participantId: string) => {
    if (!activeCaseId) return;
    const currentUserIdQuery = currentUser ? `?currentUserId=${currentUser.id}` : '';
    await syncOperation(`/api/cases/${activeCaseId}/participants/${participantId}${currentUserIdQuery}`, {
      method: 'DELETE'
    }, 'Actor eliminado correctamente del legajo.');
  };

  // Add Process template
  const handleAddTemplate = async (template: ProcessTemplate) => {
    await syncOperation('/api/templates', {
      method: 'POST',
      body: JSON.stringify(template)
    });
  };

  // Quick document review on dashboard
  const handleQuickReviewDoc = async (docId: string, status: 'approved' | 'rejected', observationText?: string) => {
    if (!currentUser) return;
    await syncOperation(`/api/documents/${docId}/review`, {
      method: 'POST',
      body: JSON.stringify({
        status,
        observationText,
        reviewedBy: currentUser.id
      })
    });
  };

  // Notification read
  const handleMarkNotificationRead = async (id: string) => {
    await syncOperation(`/api/notifications/${id}/read`, { method: 'POST' });
  };

  const handleDeleteNotification = async (id: string) => {
    await syncOperation(`/api/notifications/${id}`, { method: 'DELETE' });
  };

  const handleMarkAllNotificationsRead = async () => {
    if (!currentUser) return;
    await syncOperation('/api/notifications/read-all', {
      method: 'POST',
      body: JSON.stringify({ userId: currentUser.id })
    });
  };

  // Open case helper from dashboard / notification
  const handleOpenCase = (caseId: string) => {
    setActiveCaseId(caseId);
    setActiveTab('cases');
  };

  // Render Loader
  if (loading) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-slate-50" role="status" aria-live="polite" aria-label="Cargando DocFlow Pro">
        <div className="flex w-full max-w-xl flex-col items-center gap-4 px-6 text-center" style={{ minHeight: 124, justifyContent: 'center' }}>
          <div className="grid h-12 w-12 shrink-0 place-items-center">
            <Loader2 className="h-10 w-10 animate-spin text-indigo-600" aria-hidden="true" />
          </div>
          <div className="flex min-h-14 w-full flex-col items-center justify-center gap-1">
            <p className="font-display text-lg font-bold leading-7 text-slate-800">Cargando DocFlow Pro...</p>
            <p className="max-w-lg text-xs leading-5 text-slate-400">Estableciendo conexión segura con la base de datos de Gestión Documental...</p>
          </div>
        </div>
      </div>
    );
  }

  // Render AuthScreen if no user is signed in (check BEFORE state/error so setup/login renders cleanly)
  if (!currentUser && !error) {
    return (
      <AuthScreen
        needsSetup={needsSetup}
        turnstileSiteKey={turnstileSiteKey}
        turnstileEnabled={turnstileEnabled}
        publicRegistrationEnabled={publicRegistrationEnabled}
        onLoginSuccess={async (user) => {
          // Do not render the authenticated application before the full state is loaded.
          // A transient state-fetch failure must not display a misleading connection error
          // after a successful login; keep the login form available for retry.
          setActiveTab('dashboard');
          setActiveCaseId(null);
          setLoading(true);
          await loadState();
        }}
      />
    );
  }

  // Render Connection error
  if (error || !state || !currentUser) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 p-6">
        <div className="bg-white p-8 rounded-2xl border border-red-100 shadow-xl max-w-md text-center space-y-4">
          <AlertCircle className="w-14 h-14 text-red-500 mx-auto" />
          <h2 className="text-xl font-bold text-slate-800">Error de Conexión</h2>
          <p className="text-sm text-slate-500">
            {error || 'No se pudo recuperar la información inicial. Compruebe la conexión e intente nuevamente.'}
          </p>
          <button 
            onClick={() => { setLoading(true); void loadState(); }} 
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-xs"
          >
            Reintentar Conexión
          </button>
        </div>
      </div>
    );
  }

  const unreadMessagesCount = state?.systemMessages
    ? state.systemMessages.filter(m => m.receiverId === currentUser?.id && !m.read && !m.deletedByReceiver).length
    : 0;

  // Render Main Layout
  return (
    <div className="flex h-screen w-screen bg-slate-50 overflow-hidden font-sans">
      {operationNotice && <div role="status" className="fixed bottom-5 right-5 z-[100] max-w-sm rounded-xl border border-indigo-500/40 bg-slate-900 text-white shadow-2xl px-4 py-3 text-sm flex items-center gap-3"><span>{operationNotice}</span><button onClick={() => setOperationNotice(null)} className="text-indigo-300 font-bold">Cerrar</button></div>}
      {/* 1. Sidebar Nav */}
      <Sidebar
        currentUser={currentUser}
        users={state.users}
        onUserChange={handleUserChange}
        realUser={realUser}
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          setActiveCaseId(null); // Reset detail view when changing tabs
        }}
        notifications={state.notifications}
        unreadMessagesCount={unreadMessagesCount}
        onMarkNotificationRead={handleMarkNotificationRead}
        onDeleteNotification={handleDeleteNotification}
        onMarkAllNotificationsRead={handleMarkAllNotificationsRead}
        onOpenCase={handleOpenCase}
        tabOrder={state.systemSettings?.tabOrder}
        mobileSidebarOpen={mobileSidebarOpen}
        onCloseMobileSidebar={() => setMobileSidebarOpen(false)}
      />

      {/* 2. Main content view */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden w-full">
        {/* Workspace banner / navbar info */}
        <header className="h-14 bg-white border-b border-slate-200/80 px-4 sm:px-8 flex items-center justify-between shrink-0 select-none">
          <div className="flex items-center gap-3">
            {/* Hamburger Button for mobile/tablets (< lg) */}
            <button 
              onClick={() => setMobileSidebarOpen(true)}
              className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors cursor-pointer"
              aria-label="Abrir menú"
              title="Abrir menú"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Layers className="w-4 h-4 text-slate-400" />
              <span className="hidden sm:inline">Sistema</span>
              <span className="hidden sm:inline">/</span>
              <span className="font-semibold text-slate-600 uppercase font-mono tracking-wider">
                {activeCaseId ? `Detalle Legajo` : activeTab}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-[10px] text-slate-400 font-mono tracking-wider uppercase font-semibold">Online database</span>
          </div>
        </header>

        {/* Dynamic Inner views with responsive paddings */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 bg-slate-50/50">
          <div className="w-full min-w-0">
            {activeCaseId ? (
              <CaseDetail
                caseId={activeCaseId}
                cases={state.cases}
                templates={state.templates}
                users={state.users}
                currentUser={currentUser}
                documents={state.documents}
                tasks={state.tasks}
                observations={state.observations}
                formSubmissions={state.formSubmissions}
                uploadRequests={state.uploadRequests || []}
                loadState={loadState}
                onBack={() => setActiveCaseId(null)}
                onUploadDoc={handleUploadDoc}
                onReviewDoc={handleReviewDoc}
                onToggleTask={handleToggleTask}
                onSubmitForm={handleFormSubmit}
                onAddObservation={handleAddObservation}
                onResolveObservation={handleResolveObservation}
                onReopenObservation={handleReopenObservation}
                onAdvanceStage={handleAdvanceStage}
                onApproveStage={handleApproveStage}
                onReopenCase={handleReopenCase}
                onAddParticipant={handleAddParticipant}
                onRemoveParticipant={handleRemoveParticipant}
                onUpdateParticipant={handleUpdateParticipant}
                onUpdateCaseDocument={handleUpdateCaseDocument}
              />
            ) : (
              <>
                {activeTab === 'dashboard' && (
                  currentUser.role === 'ASESOR' ? (
                    <DashboardAdvisor
                      state={state}
                      currentUser={currentUser}
                      onOpenCase={handleOpenCase}
                      onToggleTask={handleToggleTask}
                      onReplaceDoc={handleReplaceDoc}
                      onResolveObs={handleResolveObservation}
                    />
                  ) : (
                    <DashboardManager
                      state={state}
                      onOpenCase={handleOpenCase}
                      onQuickReviewDoc={handleQuickReviewDoc}
                    />
                  )
                )}

                {activeTab === 'cases' && (
                  <CasesList
                    cases={state.cases}
                    templates={state.templates}
                    users={state.users}
                    currentUser={currentUser}
                    onOpenCase={handleOpenCase}
                    onCreateCase={handleCreateCase}
                    sharedDocuments={state.sharedDocuments || []}
                    systemSettings={state.systemSettings}
                    loadState={loadState}
                  />
                )}

                {activeTab === 'confecciones' && <Confecciones cases={state.cases} templates={state.templates} currentUser={currentUser} />}

                {activeTab === 'templates' && (
                  <TemplatesManager
                    templates={state.templates}
                    currentUser={currentUser}
                    onAddTemplate={handleAddTemplate}
                    loadState={loadState}
                  />
                )}

                {activeTab === 'profile' && ['SUPERADMIN', 'ADMIN'].includes(currentUser.role) && (
                  <UserProfile
                    currentUser={currentUser}
                    state={state}
                    onUpdateCurrentUser={handleUpdateCurrentUser}
                    loadState={loadState}
                  />
                )}

                {activeTab === 'settings' && (
                  <SystemSettings
                    currentUser={currentUser}
                    state={state}
                    loadState={loadState}
                  />
                )}

                {activeTab === 'messages' && (
                  <MessagesCenter
                    currentUser={currentUser}
                    state={state}
                    loadState={loadState}
                  />
                )}

                {activeTab === 'notifications' && (
                  <NotificationsCenter
                    currentUser={currentUser}
                    state={state}
                    loadState={loadState}
                    onOpenCase={handleOpenCase}
                  />
                )}

                {activeTab === 'statistics' && <AdvisorStatistics />}

                {activeTab === 'audit' && (
                  <AuditLogs
                    logs={state.auditLogs}
                    users={state.users}
                  />
                )}

                {activeTab === 'documents' && (
                  <SharedDocumentsManager
                    currentUser={currentUser}
                    users={state.users}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
