import React from 'react';
import { invalidateCachedJson } from '../utils/requestCache';
import { AppLoadingScreen, AppConnectionError, WorkspaceHeader } from './AppShell';
import Sidebar from './Sidebar';
import DashboardManager from './DashboardManager';
import DashboardAdvisor from './DashboardAdvisor';
import CasesList from './CasesList';
import CaseDetail from './CaseDetail';
import TemplatesManager from './TemplatesManager';
import Confecciones from './Confecciones';
import AuditLogs from './AuditLogs';
import AdvisorStatistics from './AdvisorStatistics';
import AuthScreen from './AuthScreen';
import UserProfile from './UserProfile';
import SystemSettings from './SystemSettings';
import NotificationsCenter from './NotificationsCenter';
import MessagesCenter from './MessagesCenter';
import SharedDocumentsManager from './SharedDocumentsManager';

import type { useAppController } from '../hooks/useAppController';

type Controller = ReturnType<typeof useAppController>;

/** Pure screen composition: all actions and data come from the controller. */
export default function AppViews(props: { controller: Controller }) {
  const { loading, error, operationNotice, setOperationNotice, mobileSidebarOpen, setMobileSidebarOpen, darkMode, toggleTheme, state, needsSetup, turnstileSiteKey, turnstileEnabled, publicRegistrationEnabled, currentUser, realUser, activeTab, setActiveTab, activeCaseId, setActiveCaseId, loadState, handleUserChange, handleUpdateCurrentUser, handleCreateCase, handleUploadDoc, handleReplaceDoc, handleReviewDoc, handleToggleTask, handleUpdateCaseDocument, handleFormSubmit, handleAddObservation, handleResolveObservation, handleReopenObservation, handleAdvanceStage, handleApproveStage, handleReopenCase, handleAddParticipant, handleUpdateParticipant, handleRemoveParticipant, handleAddTemplate, handleQuickReviewDoc, handleMarkNotificationRead, handleDeleteNotification, handleMarkAllNotificationsRead, handleOpenCase, setLoading } = props.controller;
  // Render Loader
  if (loading) {
    return (
      <AppLoadingScreen />
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
          invalidateCachedJson();
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
      <AppConnectionError error={error} onRetry={() => { setLoading(true); void loadState(); }} />
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
        <WorkspaceHeader activeTab={activeTab} activeCaseId={activeCaseId} darkMode={darkMode} onOpenMenu={() => setMobileSidebarOpen(true)} onToggleTheme={toggleTheme} />

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

                {activeTab === 'profile' && (realUser?.role !== 'SUPERADMIN' || currentUser.role === 'SUPERADMIN') && (
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
