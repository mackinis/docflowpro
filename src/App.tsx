import React, { useState, useEffect } from 'react';
import { 
  Loader2, 
  Sparkles, 
  Layers, 
  HelpCircle,
  FileCheck2,
  AlertCircle
} from 'lucide-react';
import { AppDataState, User, Case, ProcessTemplate, Participant } from './types';
import Sidebar from './components/Sidebar';
import DashboardManager from './components/DashboardManager';
import DashboardAdvisor from './components/DashboardAdvisor';
import CasesList from './components/CasesList';
import CaseDetail from './components/CaseDetail';
import TemplatesManager from './components/TemplatesManager';
import AuditLogs from './components/AuditLogs';
import AuthScreen from './components/AuthScreen';
import UserProfile from './components/UserProfile';
import SystemSettings from './components/SystemSettings';
import NotificationsCenter from './components/NotificationsCenter';
import MessagesCenter from './components/MessagesCenter';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // App data state
  const [state, setState] = useState<AppDataState | null>(null);
  
  // Simulated authentication states
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [realUser, setRealUser] = useState<User | null>(null);
  
  // Navigation states
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);

  // Load backend state on initialization
  const loadState = async () => {
    try {
      const response = await fetch('/api/state');
      if (!response.ok) {
        throw new Error('No se pudo recuperar el estado del servidor.');
      }
      const data: AppDataState = await response.json();
      setState(data);

      // Restore user from localStorage if exists
      const savedUserStr = localStorage.getItem('docflow_user');
      const savedRealUserStr = localStorage.getItem('docflow_real_user');
      if (savedUserStr) {
        try {
          const savedUser = JSON.parse(savedUserStr);
          const matchedUser = data.users.find(u => u.id === savedUser.id);
          if (matchedUser && matchedUser.active !== false) {
            setCurrentUser(matchedUser);
            
            if (savedRealUserStr) {
              const savedReal = JSON.parse(savedRealUserStr);
              const matchedReal = data.users.find(u => u.id === savedReal.id);
              setRealUser(matchedReal || matchedUser);
            } else {
              setRealUser(matchedUser);
              localStorage.setItem('docflow_real_user', JSON.stringify(matchedUser));
            }
          } else {
            localStorage.removeItem('docflow_user');
            localStorage.removeItem('docflow_real_user');
            setCurrentUser(null);
            setRealUser(null);
          }
        } catch (e) {
          localStorage.removeItem('docflow_user');
          localStorage.removeItem('docflow_real_user');
          setCurrentUser(null);
          setRealUser(null);
        }
      } else {
        setCurrentUser(null);
        setRealUser(null);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error de conexión con el servidor backend.');
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
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Ocurrió un error en el servidor.');
      }
      
      // Reload state after success to capture audit logs & notifications
      await loadState();
      
      if (successMsg) {
        // Simple elegant browser alert for feedback
        alert(successMsg);
      }
    } catch (err: any) {
      console.error(err);
      alert(`Error en la operación: ${err.message}`);
    }
  };

  // Switch simulated user
  const handleUserChange = (user: User) => {
    setCurrentUser(user);
    // If switching roles, make sure we go back to dashboard to avoid rendering blocked tabs
    setActiveTab('dashboard');
    setActiveCaseId(null);
  };

  // Create new Expediente (Case)
  const handleCreateCase = async (caseData: {
    title: string;
    description: string;
    templateId: string;
    assignedAdvisorId: string;
    assignedManagerId: string;
    participants: Participant[];
  }) => {
    await syncOperation('/api/cases', {
      method: 'POST',
      body: JSON.stringify(caseData)
    }, `Expediente "${caseData.title}" creado con éxito.`);
  };

  // Upload/Mock Document
  const handleUploadDoc = async (stageId: string, reqId: string, reqName: string, fileName: string, fileSize: number) => {
    if (!activeCaseId || !currentUser) return;
    await syncOperation('/api/documents/upload', {
      method: 'POST',
      body: JSON.stringify({
        caseId: activeCaseId,
        stageId,
        requirementId: reqId,
        fileName,
        fileSize,
        uploadedBy: currentUser.id
      })
    });
  };

  // Advisor replace document
  const handleReplaceDoc = async (caseId: string, stageId: string, reqId: string, docName: string, file: File) => {
    if (!currentUser) return;
    await syncOperation('/api/documents/upload', {
      method: 'POST',
      body: JSON.stringify({
        caseId,
        stageId,
        requirementId: reqId,
        fileName: file.name,
        fileSize: file.size,
        uploadedBy: currentUser.id
      })
    });
  };

  // Review Document (Approve / Reject)
  const handleReviewDoc = async (docId: string, status: 'approved' | 'rejected', observationText?: string) => {
    if (!currentUser) return;
    await syncOperation(`/api/documents/${docId}/review`, {
      method: 'POST',
      body: JSON.stringify({
        status,
        observationText,
        reviewedBy: currentUser.id
      })
    }, status === 'approved' ? 'Documento aprobado correctamente.' : 'Documento rechazado. Se notificó al asesor.');
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

  // Submit form values
  const handleFormSubmit = async (reqId: string, values: Record<string, string | number | boolean>) => {
    if (!activeCaseId || !state || !currentUser) return;
    const caseObj = state.cases.find(c => c.id === activeCaseId);
    if (!caseObj) return;

    const template = state.templates.find(t => t.id === caseObj.templateId);
    const stageId = template?.stages[caseObj.currentStageIndex]?.id;

    if (!stageId) return;

    await syncOperation('/api/forms/submit', {
      method: 'POST',
      body: JSON.stringify({
        caseId: activeCaseId,
        stageId,
        requirementId: reqId,
        values
      })
    });
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

  // Advance Stage (Validated)
  const handleAdvanceStage = async () => {
    if (!activeCaseId) return;
    await syncOperation(`/api/cases/${activeCaseId}/advance`, {
      method: 'POST'
    }, '¡Etapa avanzada exitosamente! El expediente avanzó de nivel.');
  };

  // Add Participant dynamically to active case
  const handleAddParticipant = async (participant: Participant) => {
    if (!activeCaseId) return;
    await syncOperation(`/api/cases/${activeCaseId}/participants`, {
      method: 'POST',
      body: JSON.stringify(participant)
    }, `Participante ${participant.name} ${participant.lastName} añadido correctamente.`);
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
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 space-y-4">
        <Loader2 className="w-10 h-10 animate-spin text-indigo-600" />
        <div className="text-center">
          <p className="font-display font-bold text-slate-800 text-lg">Cargando DocFlow Pro...</p>
          <p className="text-xs text-slate-400">Estableciendo conexión segura con la base de datos de Gestión Documental...</p>
        </div>
      </div>
    );
  }

  // Render Connection error
  if (error || !state) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 p-6">
        <div className="bg-white p-8 rounded-2xl border border-red-100 shadow-xl max-w-md text-center space-y-4">
          <AlertCircle className="w-14 h-14 text-red-500 mx-auto" />
          <h2 className="text-xl font-bold text-slate-800">Error de Conexión</h2>
          <p className="text-sm text-slate-500">
            No se pudo conectar con el servidor backend Express de la plataforma. Asegúrese de que el servidor esté activo.
          </p>
          <button 
            onClick={loadState} 
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-xs"
          >
            Reintentar Conexión
          </button>
        </div>
      </div>
    );
  }

  // Render AuthScreen if no user is signed in
  if (!currentUser) {
    return (
      <AuthScreen 
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          setRealUser(user);
          localStorage.setItem('docflow_user', JSON.stringify(user));
          localStorage.setItem('docflow_real_user', JSON.stringify(user));
          setActiveTab('dashboard');
          setActiveCaseId(null);
        }}
      />
    );
  }

  const unreadMessagesCount = state?.systemMessages
    ? state.systemMessages.filter(m => m.receiverId === currentUser?.id && !m.read && !m.deletedByReceiver).length
    : 0;

  // Render Main Layout
  return (
    <div className="flex h-screen w-screen bg-slate-50 overflow-hidden font-sans">
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
      />

      {/* 2. Main content view */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Workspace banner / navbar info */}
        <header className="h-14 bg-white border-b border-slate-200/80 px-8 flex items-center justify-between shrink-0 select-none">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Layers className="w-4 h-4 text-slate-400" />
            <span>Sistema</span>
            <span>/</span>
            <span className="font-semibold text-slate-600 uppercase font-mono tracking-wider">
              {activeCaseId ? `Detalle Expediente` : activeTab}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-[10px] text-slate-400 font-mono tracking-wider uppercase font-semibold">Online database</span>
          </div>
        </header>

        {/* Dynamic Inner views */}
        <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50">
          <div className="max-w-7xl mx-auto">
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
                onBack={() => setActiveCaseId(null)}
                onUploadDoc={handleUploadDoc}
                onReviewDoc={handleReviewDoc}
                onToggleTask={handleToggleTask}
                onSubmitForm={handleFormSubmit}
                onAddObservation={handleAddObservation}
                onResolveObservation={handleResolveObservation}
                onAdvanceStage={handleAdvanceStage}
                onAddParticipant={handleAddParticipant}
              />
            ) : (
              <>
                {activeTab === 'dashboard' && (
                  currentUser.role === 'ASESOR' ? (
                    <DashboardAdvisor
                      state={state}
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
                  />
                )}

                {activeTab === 'templates' && (
                  <TemplatesManager
                    templates={state.templates}
                    currentUser={currentUser}
                    onAddTemplate={handleAddTemplate}
                    loadState={loadState}
                  />
                )}

                {activeTab === 'profile' && (
                  <UserProfile
                    currentUser={currentUser}
                    state={state}
                    onUpdateCurrentUser={setCurrentUser}
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

                {activeTab === 'audit' && (
                  <AuditLogs
                    logs={state.auditLogs}
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
