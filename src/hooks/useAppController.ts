import { impersonateUser, reviewDocument, submitCaseForm, advanceCaseStage, approveCaseStage, reopenCase } from '../services/controllerOperations';
import { useState, useEffect } from 'react';
import { useNavigationAudit } from './useNavigationAudit';
import { invalidateCachedJson } from '../utils/requestCache';
import { fetchStartupEndpoint, startupHttpError } from '../services/startupRequests';
import { performSyncOperation } from '../services/syncOperation';
import { uploadDocumentWithProgress } from '../services/documentUpload';
import { useAppTheme } from './useAppTheme';
import type { AppDataState, User, ProcessTemplate, Participant } from '../types';

/** Application orchestration: sessions, navigation, mutations and state refreshes. */
export function useAppController() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [operationNotice, setOperationNotice] = useState<string | null>(null);
  
  // Mobile responsive sidebar state
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { darkMode, toggleTheme } = useAppTheme();
  
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

  useNavigationAudit(Boolean(currentUser && state), activeTab, activeCaseId, currentUser?.id);

  // Load backend state via Cloudflare Worker session cookie
  const loadState = async (refreshOnly = false) => {
    try {
      setError(null);
      let bootstrapData: { user?: User; realUser?: User; needsSetup?: boolean; turnstileSiteKey?: string; turnstileEnabled?: boolean; publicRegistrationEnabled?: boolean } | null = null;
      if (!refreshOnly) {
      const bootstrapRes = await fetchStartupEndpoint('/api/auth/bootstrap-status');
      if (!bootstrapRes.ok) {
        throw await startupHttpError(bootstrapRes, '/api/auth/bootstrap-status');
      }
      bootstrapData = await bootstrapRes.json();
      setNeedsSetup(Boolean(bootstrapData!.needsSetup));
      setTurnstileSiteKey(bootstrapData!.turnstileSiteKey || '');
      setTurnstileEnabled(Boolean(bootstrapData!.turnstileEnabled));
      setPublicRegistrationEnabled(bootstrapData!.publicRegistrationEnabled !== false);

      if (!bootstrapData!.user) {
        invalidateCachedJson();
        sessionStorage.removeItem('docflow_user');
        sessionStorage.removeItem('docflow_real_user');
        setCurrentUser(null);
        setRealUser(null);
        setState(null);
        return;
      }

      }
      const response = await fetchStartupEndpoint('/api/state');
      if (response.status === 401) {
        invalidateCachedJson();
        sessionStorage.removeItem('docflow_user');
        sessionStorage.removeItem('docflow_real_user');
        setCurrentUser(null);
        setRealUser(null);
        setState(null);
        return;
      }
      if (!response.ok) {
        throw await startupHttpError(response, '/api/state');
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
      await performSyncOperation(url, options, () => loadState(true));
      if (successMsg) setOperationNotice(successMsg);
    } catch (err: any) {
      console.error(err);
      setOperationNotice(`Error en la operación: ${err.message}`);
    }
  };

  // Switch active role/user (Superadmin server-verified impersonation)
  const handleUserChange = async (user: User) => {
    try {
      const response = await impersonateUser(user.id);
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'No se pudo cambiar de usuario.');
      }
      invalidateCachedJson();
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
      await uploadDocumentWithProgress(formData, onProgress);
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
    const response = await reviewDocument(docId, status, observationText, allowedRoles);
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

    const response = await submitCaseForm(activeCaseId, stageId, reqId, values);
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
    const response = await advanceCaseStage(activeCaseId, currentUser.id);
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
    const response = await approveCaseStage(activeCaseId, currentUser.id);
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error || 'No se pudo completar la operación.');
    }
    await loadState(true);
    setOperationNotice('¡Etapa aprobada correctamente!');
  };

  const handleReopenCase = async (password: string): Promise<void> => {
    if (!activeCaseId) throw new Error('No hay un legajo activo.');
    const response = await reopenCase(activeCaseId, password);
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


  return { loading, error, operationNotice, setOperationNotice, mobileSidebarOpen, setMobileSidebarOpen, darkMode, toggleTheme, state, needsSetup, turnstileSiteKey, turnstileEnabled, publicRegistrationEnabled, currentUser, realUser, activeTab, setActiveTab, activeCaseId, setActiveCaseId, loadState, handleUserChange, handleUpdateCurrentUser, handleCreateCase, handleUploadDoc, handleReplaceDoc, handleReviewDoc, handleToggleTask, handleUpdateCaseDocument, handleFormSubmit, handleAddObservation, handleResolveObservation, handleReopenObservation, handleAdvanceStage, handleApproveStage, handleReopenCase, handleAddParticipant, handleUpdateParticipant, handleRemoveParticipant, handleAddTemplate, handleQuickReviewDoc, handleMarkNotificationRead, handleDeleteNotification, handleMarkAllNotificationsRead, handleOpenCase, setLoading };
}
