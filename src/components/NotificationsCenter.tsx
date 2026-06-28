import React, { useState } from 'react';
import { 
  Bell, 
  CheckCircle, 
  AlertTriangle, 
  Info, 
  Trash2, 
  Check, 
  FolderSearch,
  ExternalLink,
  Clock
} from 'lucide-react';
import { User, AppDataState, Notification } from '../types';

interface NotificationsCenterProps {
  currentUser: User;
  state: AppDataState;
  loadState: () => Promise<void>;
  onOpenCase?: (caseId: string) => void;
}

export default function NotificationsCenter({
  currentUser,
  state,
  loadState,
  onOpenCase
}: NotificationsCenterProps) {
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const notifications = state.notifications || [];
  // Filter for the current user only
  const userNotifications = notifications
    .filter(n => n.userId === currentUser.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const handleMarkAsRead = async (id: string) => {
    try {
      const res = await fetch(`/api/notifications/${id}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        await loadState();
      }
    } catch (err) {
      console.error('Error marking notification as read:', err);
    }
  };

  const handleMarkAllAsRead = async () => {
    setLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/notifications/read-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id })
      });
      if (!res.ok) {
        throw new Error('No se pudieron marcar todas las notificaciones como leídas.');
      }
      setSuccessMsg('Todas las notificaciones fueron marcadas como leídas.');
      await loadState();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteNotification = async (id: string) => {
    try {
      const res = await fetch(`/api/notifications/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        await loadState();
      }
    } catch (err) {
      console.error('Error deleting notification:', err);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('¿Está seguro de que desea eliminar todas sus notificaciones?')) {
      return;
    }
    setLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/notifications/clear-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id })
      });
      if (!res.ok) {
        throw new Error('No se pudieron eliminar las notificaciones.');
      }
      setSuccessMsg('Todas las notificaciones fueron eliminadas.');
      await loadState();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />;
      case 'error':
        return <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />;
      default:
        return <Info className="w-5 h-5 text-blue-500 shrink-0" />;
    }
  };

  const getBgClass = (type: string, read: boolean) => {
    if (read) return 'bg-white border-slate-200 hover:bg-slate-50/50';
    switch (type) {
      case 'success':
        return 'bg-emerald-50/20 border-emerald-150 hover:bg-emerald-50/30';
      case 'warning':
        return 'bg-amber-50/20 border-amber-150 hover:bg-amber-50/30';
      case 'error':
        return 'bg-rose-50/20 border-rose-150 hover:bg-rose-50/30';
      default:
        return 'bg-indigo-50/10 border-indigo-150 hover:bg-indigo-50/20';
    }
  };

  // Format date helper
  const formatDate = (isoStr: string) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleString('es-AR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-6 animate-fade-in" id="notifications-center-panel">
      {/* Header block */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5 shrink-0">
        <div>
          <h1 className="font-display font-bold text-2xl text-slate-800 tracking-tight flex items-center gap-2.5">
            <Bell className="w-6 h-6 text-indigo-600 animate-swing" />
            Notificaciones del Sistema
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Historial de alertas automatizadas, auditoría, tareas asignadas y actualizaciones de expedientes.
          </p>
        </div>

        {userNotifications.length > 0 && (
          <div className="flex items-center gap-2.5">
            <button
              onClick={handleMarkAllAsRead}
              disabled={loading || userNotifications.every(n => n.read)}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-xl shadow-xs transition-all disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              id="btn-read-all-notifications"
            >
              <Check className="w-4 h-4 text-emerald-600" />
              Marcar todo leído
            </button>
            <button
              onClick={handleClearAll}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold rounded-xl shadow-xs transition-all disabled:opacity-50 cursor-pointer"
              id="btn-clear-all-notifications"
            >
              <Trash2 className="w-4 h-4" />
              Eliminar todo
            </button>
          </div>
        )}
      </div>

      {/* Success and Error messages */}
      {successMsg && (
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl text-sm shrink-0" id="notif-success-alert">
          <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="font-medium">{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl text-sm shrink-0" id="notif-error-alert">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <span className="font-medium">{errorMsg}</span>
        </div>
      )}

      {/* List content */}
      <div className="max-w-4xl space-y-3.5">
        {userNotifications.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500 space-y-4" id="empty-notifications">
            <Bell className="w-12 h-12 text-slate-300 mx-auto" />
            <div>
              <h3 className="font-bold text-slate-700 text-base">Sin Novedades</h3>
              <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
                No tienes notificaciones pendientes de lectura en este momento. Las alertas automáticas aparecerán aquí.
              </p>
            </div>
          </div>
        ) : (
          userNotifications.map((n) => {
            const bgClass = getBgClass(n.type, n.read);
            
            return (
              <div
                key={n.id}
                className={`p-4 rounded-xl border ${bgClass} transition-all duration-150 flex items-start gap-4 shadow-xs`}
                id={`notif-card-${n.id}`}
              >
                {/* Icon based on status */}
                <div className="mt-0.5">
                  {getIcon(n.type)}
                </div>

                {/* Info block */}
                <div className="flex-1 space-y-1">
                  <div className="flex items-start justify-between gap-4">
                    <h3 className={`text-sm font-bold ${n.read ? 'text-slate-700' : 'text-slate-900'} flex items-center gap-2`}>
                      {n.title}
                      {!n.read && (
                        <span className="inline-block w-2 h-2 rounded-full bg-indigo-600 shrink-0 animate-pulse" />
                      )}
                    </h3>
                    <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1 shrink-0">
                      <Clock className="w-3 h-3" />
                      {formatDate(n.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed font-sans">
                    {n.message}
                  </p>

                  {/* Actions under card */}
                  <div className="flex items-center gap-3 pt-2">
                    {!n.read && (
                      <button
                        onClick={() => handleMarkAsRead(n.id)}
                        className="text-[10px] font-extrabold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Marcar como leído
                      </button>
                    )}

                    {n.caseId && onOpenCase && (
                      <button
                        onClick={() => onOpenCase(n.caseId!)}
                        className="text-[10px] font-extrabold text-slate-600 hover:text-indigo-600 flex items-center gap-1 cursor-pointer"
                      >
                        <FolderSearch className="w-3.5 h-3.5 text-indigo-400" />
                        Ver Expediente
                        <ExternalLink className="w-2.5 h-2.5" />
                      </button>
                    )}

                    <button
                      onClick={() => handleDeleteNotification(n.id)}
                      className="text-[10px] font-extrabold text-slate-400 hover:text-rose-600 flex items-center gap-1 ml-auto cursor-pointer"
                      title="Eliminar notificación"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Eliminar
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
