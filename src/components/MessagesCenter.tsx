import React, { useState, useEffect, useRef } from 'react';
import { 
  Mail, 
  Send, 
  Inbox, 
  Trash2, 
  Plus, 
  Search, 
  CornerUpLeft, 
  CornerUpRight,
  Clock, 
  User as UserIcon,
  MessageSquare,
  Paperclip,
  X,
  FileText,
  Download,
  AlertTriangle,
  CheckCircle,
  ArchiveRestore
} from 'lucide-react';
import { User, AppDataState, SystemMessage } from '../types';

interface MessagesCenterProps {
  currentUser: User;
  state: AppDataState;
  loadState: () => Promise<void>;
}

export default function MessagesCenter({
  currentUser,
  state,
  loadState
}: MessagesCenterProps) {
  const [activeSubTab, setActiveSubTab] = useState<'recibidos' | 'enviados' | 'papelera' | 'sistema'>('recibidos');
  const [selectedMessage, setSelectedMessage] = useState<SystemMessage | null>(null);
  
  // Compose message states
  const [showCompose, setShowCompose] = useState(false);
  const [recipientId, setRecipientId] = useState('');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; size: number; dataUrl?: string }[]>([]);
  
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Extract from state
  const messages = state.systemMessages || [];
  const usersList = state.users || [];

  // Filter messages based on active sub-tab and current user
  const inboxMessages = messages.filter(m => m.receiverId === currentUser.id && !m.deletedByReceiver && !(m as any).permanentDeletedByReceiver);
  const sentMessages = messages.filter(m => m.senderId === currentUser.id && !m.deletedBySender && !(m as any).permanentDeletedBySender);
  const systemMessagesList = ['SUPERADMIN', 'ADMIN'].includes(currentUser.role) ? messages.filter(m => m.receiverId === 'system') : [];
  const trashMessages = messages.filter(m => 
    (m.receiverId === currentUser.id && m.deletedByReceiver && !(m as any).permanentDeletedByReceiver) ||
    (m.senderId === currentUser.id && m.deletedBySender && !(m as any).permanentDeletedBySender)
  );

  const getFilteredMessages = () => {
    let list: SystemMessage[] = [];
    if (activeSubTab === 'recibidos') {
      list = inboxMessages;
    } else if (activeSubTab === 'enviados') {
      list = sentMessages;
    } else if (activeSubTab === 'papelera') {
      list = trashMessages;
    } else if (activeSubTab === 'sistema') {
      list = systemMessagesList;
    }

    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      list = list.filter(m => 
        m.subject.toLowerCase().includes(q) || 
        m.content.toLowerCase().includes(q) ||
        m.senderName.toLowerCase().includes(q) ||
        m.receiverName.toLowerCase().includes(q)
      );
    }
    return list;
  };

  // Check if current user is allowed to send messages based on their role
  const messagingConfigs = state.systemSettings?.roleMessagingConfigs || {
    SUPERADMIN: { allowed: true, rule: 'free' },
    ADMIN: { allowed: true, rule: 'free' },
    MANAGER: { allowed: true, rule: 'free' },
    ASESOR: { allowed: true, rule: 'free' }
  };
  const myConfig = (messagingConfigs as any)[currentUser.role] || { allowed: true, rule: 'free' };
  const canSend = myConfig.allowed;

  // Mark message as read
  const handleReadMessage = async (msg: SystemMessage) => {
    setSelectedMessage(msg);
    if ((msg.receiverId === currentUser.id || (msg.receiverId === 'system' && ['SUPERADMIN', 'ADMIN'].includes(currentUser.role))) && !msg.read) {
      try {
        const res = await fetch('/api/system-messages/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId: msg.id })
        });
        if (res.ok) {
          await loadState();
        }
      } catch (err) {
        console.error('Error marking message as read:', err);
      }
    }
  };

  // Handle local file uploads (converts to base64 for simulator durability)
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    (Array.from(files) as File[]).forEach((file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        setAttachedFiles(prev => [
          ...prev,
          {
            name: file.name,
            size: file.size,
            dataUrl: reader.result as string
          }
        ]);
      };
      reader.readAsDataURL(file);
    });

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveAttachedFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipientId || !content.trim()) {
      setErrorMsg('Debe seleccionar un destinatario y escribir un mensaje.');
      return;
    }

    setLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/system-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: currentUser.id,
          receiverId: recipientId,
          subject: subject.trim() || '(Sin Asunto)',
          content: content.trim(),
          attachments: attachedFiles
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'No se pudo enviar el mensaje.');
      }

      const resData = await res.json();
      setSuccessMsg('Mensaje enviado con éxito.');
      setRecipientId('');
      setSubject('');
      setContent('');
      setAttachedFiles([]);
      setShowCompose(false);
      await loadState();
      
      // Auto-select the sent message or switch to Sent tab
      setActiveSubTab('enviados');
      if (resData.message) {
        setSelectedMessage(resData.message);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Trash handling
  const handleMoveToTrash = async (msg: SystemMessage) => {
    setLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/system-messages/trash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: msg.id,
          userId: currentUser.id,
          action: 'trash'
        })
      });

      if (!res.ok) {
        throw new Error('No se pudo enviar el mensaje a la papelera.');
      }

      setSuccessMsg('Mensaje movido a la papelera.');
      setSelectedMessage(null);
      await loadState();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreFromTrash = async (msg: SystemMessage) => {
    setLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/system-messages/trash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: msg.id,
          userId: currentUser.id,
          action: 'restore'
        })
      });

      if (!res.ok) {
        throw new Error('No se pudo restaurar el mensaje.');
      }

      setSuccessMsg('Mensaje restaurado con éxito.');
      setSelectedMessage(null);
      await loadState();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePermanent = async (msg: SystemMessage) => {
    if (!window.confirm('¿Está seguro de que desea eliminar permanentemente este mensaje? Esta acción no se puede deshacer.')) {
      return;
    }
    setLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/system-messages/delete-permanent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: msg.id,
          userId: currentUser.id
        })
      });

      if (!res.ok) {
        throw new Error('No se pudo eliminar el mensaje permanentemente.');
      }

      setSuccessMsg('Mensaje eliminado permanentemente.');
      setSelectedMessage(null);
      await loadState();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Reply and Forward Helpers
  const handleReply = (msg: SystemMessage) => {
    setRecipientId(msg.senderId);
    setSubject(msg.subject.toLowerCase().startsWith('re:') ? msg.subject : `Re: ${msg.subject}`);
    setContent(`\n\n--- El ${formatDate(msg.createdAt)}, ${msg.senderName} escribió: ---\n> ${msg.content.split('\n').join('\n> ')}`);
    setAttachedFiles([]);
    setShowCompose(true);
    setSuccessMsg(null);
    setErrorMsg(null);
  };

  const handleForward = (msg: SystemMessage) => {
    setRecipientId('');
    setSubject(msg.subject.toLowerCase().startsWith('fwd:') ? msg.subject : `Fwd: ${msg.subject}`);
    setContent(`\n\n--- Mensaje reenviado ---\nDe: ${msg.senderName} (${msg.senderRole})\nPara: ${msg.receiverName}\nFecha: ${formatDate(msg.createdAt)}\nAsunto: ${msg.subject}\n\n${msg.content}`);
    // Copy original attachments to new draft
    if (msg.attachments && msg.attachments.length > 0) {
      setAttachedFiles([...msg.attachments]);
    } else {
      setAttachedFiles([]);
    }
    setShowCompose(true);
    setSuccessMsg(null);
    setErrorMsg(null);
  };

  // Helper file size formatter
  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
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

  // Get recipient list (exclude self)
  const recipients = usersList.filter(u => u.id !== currentUser.id && u.active !== false);

  // Auto-select first message on tab change
  const filteredMsgList = getFilteredMessages();
  useEffect(() => {
    if (filteredMsgList.length > 0) {
      // Find currently selected in new list or default to first
      const stillExists = filteredMsgList.find(m => m.id === selectedMessage?.id);
      if (!stillExists) {
        setSelectedMessage(filteredMsgList[0]);
      }
    } else {
      setSelectedMessage(null);
    }
  }, [activeSubTab, searchQuery, messages]);

  return (
    <div className="h-full flex flex-col space-y-5 animate-fade-in" id="messages-hub">
      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5 shrink-0">
        <div>
          <h1 className="font-display font-bold text-2xl text-slate-800 tracking-tight flex items-center gap-2.5">
            <Mail className="w-6 h-6 text-indigo-600" />
            Mensajes Internos
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Canal confidencial de comunicación interna entre asesores, gerentes y administradores.
          </p>
        </div>

        {canSend ? (
          <button
            onClick={() => {
              setRecipientId('');
              setSubject('');
              setContent('');
              setAttachedFiles([]);
              setShowCompose(true);
              setSuccessMsg(null);
              setErrorMsg(null);
            }}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-sm transition-all cursor-pointer self-start md:self-auto"
            id="btn-compose-message"
          >
            <Plus className="w-4 h-4" />
            Redactar Mensaje
          </button>
        ) : (
          <div className="text-xs bg-amber-50 text-amber-700 border border-amber-200 p-2.5 rounded-xl flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            El envío de mensajes está inhabilitado para tu perfil según la configuración actual del sistema.
          </div>
        )}
      </div>

      {/* Success and Error messages */}
      {successMsg && (
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl text-sm shrink-0" id="msg-hub-success">
          <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="font-medium">{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl text-sm shrink-0" id="msg-hub-error">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <span className="font-medium">{errorMsg}</span>
        </div>
      )}

      {/* Main split-pane container */}
      <div className="flex-1 min-h-[500px] bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col md:flex-row">
        
        {/* Left pane: Subtabs, list of messages */}
        <div className="w-full md:w-[360px] border-r border-slate-200 flex flex-col shrink-0 bg-slate-50/50">
          
          {/* Sub-navigation tabs */}
          <div className={`p-3 border-b border-slate-200 bg-white grid ${['SUPERADMIN', 'ADMIN'].includes(currentUser.role) ? 'grid-cols-4' : 'grid-cols-3'} gap-1 shrink-0`}>
            <button
              onClick={() => { setActiveSubTab('recibidos'); setSearchQuery(''); }}
              className={`py-2 px-1 rounded-lg text-xs font-bold transition-all flex flex-col items-center gap-1 cursor-pointer ${
                activeSubTab === 'recibidos'
                  ? 'bg-indigo-50 text-indigo-700 font-semibold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              id="subtab-inbox"
            >
              <Inbox className="w-4 h-4" />
              <span>Recibidos</span>
              {inboxMessages.filter(m => !m.read).length > 0 && (
                <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.2 rounded-full mt-0.5 animate-pulse">
                  {inboxMessages.filter(m => !m.read).length}
                </span>
              )}
            </button>

            <button
              onClick={() => { setActiveSubTab('enviados'); setSearchQuery(''); }}
              className={`py-2 px-1 rounded-lg text-xs font-bold transition-all flex flex-col items-center gap-1 cursor-pointer ${
                activeSubTab === 'enviados'
                  ? 'bg-indigo-50 text-indigo-700 font-semibold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              id="subtab-sent"
            >
              <Send className="w-4 h-4" />
              <span>Enviados</span>
            </button>

            <button
              onClick={() => { setActiveSubTab('papelera'); setSearchQuery(''); }}
              className={`py-2 px-1 rounded-lg text-xs font-bold transition-all flex flex-col items-center gap-1 cursor-pointer ${
                activeSubTab === 'papelera'
                  ? 'bg-indigo-50 text-indigo-700 font-semibold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              id="subtab-trash"
            >
              <Trash2 className="w-4 h-4" />
              <span>Papelera</span>
            </button>

            {['SUPERADMIN', 'ADMIN'].includes(currentUser.role) && (
              <button
                onClick={() => { setActiveSubTab('sistema'); setSearchQuery(''); }}
                className={`py-2 px-1 rounded-lg text-xs font-bold transition-all flex flex-col items-center gap-1 cursor-pointer ${
                  activeSubTab === 'sistema'
                    ? 'bg-red-50 text-red-700 font-semibold border border-red-100/50'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                id="subtab-sistema"
              >
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <span>Sistema</span>
                {systemMessagesList.filter(m => !m.read).length > 0 && (
                  <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.2 rounded-full mt-0.5 animate-pulse">
                    {systemMessagesList.filter(m => !m.read).length}
                  </span>
                )}
              </button>
            )}
          </div>

          {/* Search bar */}
          <div className="p-3 border-b border-slate-200 bg-white shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar mensajes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
              />
            </div>
          </div>

          {/* List display */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 max-h-[500px]">
            {filteredMsgList.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                {searchQuery ? 'No se encontraron mensajes.' : 'No hay mensajes en esta carpeta.'}
              </div>
            ) : (
              filteredMsgList.map((msg) => {
                const isInbox = msg.receiverId === currentUser.id;
                const otherPartyName = isInbox ? msg.senderName : msg.receiverName;
                const otherPartyRole = isInbox ? msg.senderRole : msg.receiverRole;
                const isSelected = selectedMessage?.id === msg.id;

                return (
                  <button
                    key={msg.id}
                    onClick={() => handleReadMessage(msg)}
                    className={`w-full text-left p-4 flex flex-col gap-1 transition-colors relative cursor-pointer ${
                      isSelected 
                        ? 'bg-indigo-50/75 hover:bg-indigo-50 border-l-4 border-indigo-600' 
                        : 'bg-white hover:bg-slate-50 border-l-4 border-transparent'
                    } ${!msg.read && isInbox ? 'font-semibold text-slate-900 bg-indigo-50/20' : 'text-slate-600'}`}
                  >
                    <div className="flex justify-between items-start gap-2 text-xs">
                      <span className="font-semibold truncate text-slate-800">{otherPartyName}</span>
                      <span className="text-[10px] text-slate-400 shrink-0 font-mono">{formatDate(msg.createdAt)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-mono text-slate-400 uppercase tracking-wider">{otherPartyRole}</span>
                      {!msg.read && isInbox && (
                        <span className="bg-indigo-600 w-2 h-2 rounded-full" />
                      )}
                    </div>
                    <div className="text-xs text-slate-700 font-semibold truncate mt-1">
                      {msg.subject}
                    </div>
                    <p className="text-xs text-slate-400 truncate leading-relaxed">
                      {msg.content}
                    </p>
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="flex items-center gap-1 text-[10px] text-slate-400 font-medium mt-1">
                        <Paperclip className="w-3 h-3 text-indigo-400 shrink-0" />
                        <span>{msg.attachments.length} {msg.attachments.length === 1 ? 'adjunto' : 'adjuntos'}</span>
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right pane: Selected Message content / details */}
        <div className="flex-1 flex flex-col bg-white overflow-hidden min-h-[300px]">
          {selectedMessage ? (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              {/* Message Header info */}
              <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start gap-4 shrink-0 bg-slate-50/20">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="bg-indigo-100 text-indigo-700 p-2 rounded-xl shrink-0">
                      <UserIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800 text-sm">
                          {selectedMessage.senderId === currentUser.id ? 'Para: ' : 'De: '} 
                          {selectedMessage.senderId === currentUser.id ? selectedMessage.receiverName : selectedMessage.senderName}
                        </span>
                        <span className="text-[9px] font-mono font-bold bg-indigo-50 text-indigo-600 px-1.5 py-0.2 rounded border border-indigo-100 uppercase">
                          {selectedMessage.senderId === currentUser.id ? selectedMessage.receiverRole : selectedMessage.senderRole}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 font-mono">
                        {selectedMessage.senderId === currentUser.id ? selectedMessage.receiverRole.toLowerCase() : selectedMessage.senderRole.toLowerCase()}@docflowpro.com
                      </p>
                    </div>
                  </div>
                </div>
                
                {/* Actions Row */}
                <div className="text-right flex flex-col sm:items-end gap-1 shrink-0 w-full sm:w-auto">
                  <span className="text-xs font-mono text-slate-500 flex items-center justify-end gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {formatDate(selectedMessage.createdAt)}
                  </span>
                  
                  <div className="flex items-center gap-2 mt-2 self-start sm:self-auto">
                    {/* Reply (Responder) */}
                    {selectedMessage.senderId !== currentUser.id && activeSubTab !== 'papelera' && (
                      <button
                        onClick={() => handleReply(selectedMessage)}
                        disabled={!canSend}
                        className="flex items-center gap-1 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        title="Responder este mensaje"
                      >
                        <CornerUpLeft className="w-3.5 h-3.5" />
                        Responder
                      </button>
                    )}

                    {/* Forward (Reenviar) */}
                    {activeSubTab !== 'papelera' && (
                      <button
                        onClick={() => handleForward(selectedMessage)}
                        disabled={!canSend}
                        className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        title="Reenviar este mensaje"
                      >
                        <CornerUpRight className="w-3.5 h-3.5" />
                        Reenviar
                      </button>
                    )}

                    {/* Trash & Restore */}
                    {activeSubTab !== 'papelera' ? (
                      <button
                        onClick={() => handleMoveToTrash(selectedMessage)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
                        title="Mover a papelera"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Borrar
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => handleRestoreFromTrash(selectedMessage)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
                          title="Restaurar de la papelera"
                        >
                          <ArchiveRestore className="w-3.5 h-3.5" />
                          Restaurar
                        </button>
                        <button
                          onClick={() => handleDeletePermanent(selectedMessage)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-sm"
                          title="Eliminar permanentemente"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Eliminar definitivo
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Subject Block */}
              <div className="px-6 py-4 border-b border-slate-100 shrink-0">
                <h2 className="font-bold text-slate-800 text-base flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-indigo-600" />
                  {selectedMessage.subject}
                </h2>
              </div>

              {/* Message Body Content */}
              <div className="flex-1 p-6 overflow-y-auto max-h-[350px]">
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap font-sans">
                  {selectedMessage.content}
                </p>

                {/* Attachments Display Section */}
                {selectedMessage.attachments && selectedMessage.attachments.length > 0 && (
                  <div className="mt-8 pt-6 border-t border-slate-150 space-y-3">
                    <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                      <Paperclip className="w-3.5 h-3.5 text-indigo-500" />
                      Archivos Adjuntos ({selectedMessage.attachments.length})
                    </h4>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {selectedMessage.attachments.map((file, i) => (
                        <div 
                          key={i} 
                          className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between hover:bg-slate-100 transition-colors"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="bg-indigo-100 text-indigo-700 p-2 rounded-lg shrink-0">
                              <FileText className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-slate-700 truncate" title={file.name}>
                                {file.name}
                              </p>
                              <p className="text-[10px] font-mono text-slate-400">
                                {formatSize(file.size)}
                              </p>
                            </div>
                          </div>
                          
                          {/* Real simulator download using dataUrl if present, otherwise fallback */}
                          <a 
                            href={file.dataUrl || '#'} 
                            download={file.name}
                            onClick={(e) => {
                              if (!file.dataUrl) {
                                e.preventDefault();
                                alert(`Simulación de descarga del archivo: ${file.name}`);
                              }
                            }}
                            className="p-1.5 text-slate-500 hover:text-indigo-600 rounded-lg hover:bg-slate-200 transition-colors flex items-center justify-center shrink-0"
                            title="Descargar adjunto"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400 flex flex-col items-center justify-center h-full space-y-3">
              <Mail className="w-12 h-12 text-slate-300" />
              <div>
                <h3 className="font-bold text-slate-700 text-sm">Bandeja de Mensajes</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Selecciona un mensaje de la lista lateral para visualizar su contenido completo, responder, reenviar o borrar.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Compose Message Modal overlay */}
      {showCompose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-fade-in" id="compose-modal">
          <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <Mail className="w-4 h-4 text-indigo-600" />
                Redactar Mensaje Interno
              </h3>
              <button
                onClick={() => { setShowCompose(false); }}
                className="text-slate-400 hover:text-slate-600 text-sm font-semibold p-1"
              >
                Cerrar
              </button>
            </div>

            {/* Compose Form */}
            <form onSubmit={handleSendMessage} className="p-5 space-y-4 overflow-y-auto flex-1">
              
              {/* Recipient select */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">Destinatario</label>
                <select
                  required
                  value={recipientId}
                  onChange={(e) => setRecipientId(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                >
                  <option value="">-- Seleccionar Destinatario --</option>
                  {recipients.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} {user.lastName} ({user.role})
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400">
                  Solo puedes enviar mensajes a usuarios activos en la plataforma.
                </p>
              </div>

              {/* Subject */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">Asunto</label>
                <input
                  type="text"
                  placeholder="Escribe el asunto del mensaje..."
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-semibold"
                />
              </div>

              {/* Content */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">Mensaje</label>
                <textarea
                  required
                  rows={6}
                  placeholder="Escribe el cuerpo de tu mensaje aquí..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium font-sans"
                />
              </div>

              {/* Attachments selection */}
              <div className="space-y-1.5 pt-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                    <Paperclip className="w-3.5 h-3.5 text-indigo-500" />
                    Archivos Adjuntos
                  </label>
                  
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
                  >
                    + Adjuntar archivos
                  </button>
                  <input 
                    type="file"
                    multiple
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </div>

                {attachedFiles.length > 0 ? (
                  <div className="space-y-1.5 mt-2 max-h-32 overflow-y-auto border border-slate-100 p-2 rounded-xl bg-slate-50">
                    {attachedFiles.map((file, i) => (
                      <div key={i} className="flex justify-between items-center text-xs p-1.5 rounded-lg bg-white border border-slate-150">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate font-medium text-slate-700 min-w-0 block" title={file.name}>
                            {file.name}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">({formatSize(file.size)})</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveAttachedFile(i)}
                          className="text-slate-400 hover:text-rose-600 p-0.5"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-400">
                    Ningún archivo seleccionado. Formatos soportados: PDF, imágenes, DOCX, etc.
                  </p>
                )}
              </div>

              {/* Info policies */}
              {myConfig.rule === 'wait_reply' && (
                <div className="bg-indigo-50 border border-indigo-150 p-3 rounded-xl text-[11px] text-indigo-700 flex items-start gap-1.5">
                  <Clock className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                  <span>
                    <strong>Política activa para tu rol:</strong> Debes esperar que te respondan antes de poder enviar un nuevo mensaje a este destinatario.
                  </span>
                </div>
              )}

              {/* Action buttons */}
              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCompose(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                >
                  {loading ? 'Enviando...' : 'Enviar Mensaje'}
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

    </div>
  );
}
