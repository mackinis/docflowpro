import React, { useState, useEffect } from 'react';
import { 
  FolderDown, 
  Upload, 
  Trash2, 
  FileText, 
  Users, 
  Lock, 
  Globe, 
  Download, 
  Plus, 
  AlertCircle, 
  Loader2,
  Check,
  FileCheck,
  Share2,
  Search,
  X,
  FileCheck2,
  Settings,
  Edit
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { User, SharedDocument } from '../types';

interface SharedDocumentsProps {
  currentUser: User;
  users: User[];
  onAddAudit?: (action: string, entityType: string, entityId: string, entityName: string) => void;
}

export default function SharedDocumentsManager({ currentUser, users, onAddAudit }: SharedDocumentsProps) {
  const [documents, setDocuments] = useState<SharedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Upload Form State
  const [docName, setDocName] = useState('');
  const [selectedFile, setSelectedFile] = useState<{ name: string; size: number; base64: string } | null>(null);
  const [audienceType, setAudienceType] = useState<'all' | 'roles' | 'users'>('all');
  const [allowedRoles, setAllowedRoles] = useState<string[]>(['ADMIN', 'MANAGER', 'ASESOR']);
  const [allowedUserIds, setAllowedUserIds] = useState<string[]>([]);
  
  // Drag and drop state
  const [dragActive, setDragActive] = useState(false);

  // Delete Confirmation modal
  const [deleteDoc, setDeleteDoc] = useState<SharedDocument | null>(null);

  // Categorization & Search State
  const [docFilterTab, setDocFilterTab] = useState<'all' | 'digital' | 'uploaded'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Editing Permissions State (SUPERADMIN in-place update)
  const [editingPermissionsDoc, setEditingPermissionsDoc] = useState<SharedDocument | null>(null);
  const [editDocName, setEditDocName] = useState('');
  const [editAudienceType, setEditAudienceType] = useState<'all' | 'roles' | 'users'>('all');
  const [editAllowedRoles, setEditAllowedRoles] = useState<string[]>(['ADMIN', 'MANAGER', 'ASESOR']);
  const [editAllowedUserIds, setEditAllowedUserIds] = useState<string[]>([]);
  const [updatingPermissions, setUpdatingPermissions] = useState(false);

  // Document Editing State (For name & digitized content)
  const [editingDoc, setEditingDoc] = useState<SharedDocument | null>(null);
  const [editNameField, setEditNameField] = useState('');
  const [editContentField, setEditContentField] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Unicode-safe Base64 helpers
  const base64ToUnicode = (str: string) => {
    try {
      const base64Part = str.includes(',') ? str.split(',')[1] : str;
      return decodeURIComponent(escape(atob(base64Part)));
    } catch (e) {
      try {
        const base64Part = str.includes(',') ? str.split(',')[1] : str;
        return atob(base64Part);
      } catch (err) {
        return '';
      }
    }
  };

  const unicodeToBase64 = (str: string) => {
    return btoa(unescape(encodeURIComponent(str)));
  };

  const handleOpenDocEditor = (doc: SharedDocument) => {
    setEditingDoc(doc);
    setEditNameField(doc.name);
    
    const isDigital = doc.name.toLowerCase().includes('digitalizado') || doc.fileName.endsWith('_digitalizado.txt') || doc.fileName.endsWith('.txt');
    if (isDigital && doc.dataUrl) {
      setEditContentField(base64ToUnicode(doc.dataUrl));
    } else {
      setEditContentField('');
    }
  };

  const handleEditDocSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDoc) return;

    try {
      setSavingEdit(true);
      setError(null);
      setSuccess(null);

      const isDigital = editingDoc.name.toLowerCase().includes('digitalizado') || editingDoc.fileName.endsWith('_digitalizado.txt') || editingDoc.fileName.endsWith('.txt');
      
      const payload: any = {
        name: editNameField.trim(),
        currentUserId: currentUser.id
      };

      if (isDigital) {
        const encodedContent = `data:text/plain;base64,${unicodeToBase64(editContentField)}`;
        payload.dataUrl = encodedContent;
        payload.fileSize = editContentField.length;
      }

      const res = await fetch(`/api/shared-documents/${editingDoc.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Error al guardar los cambios.');
      }

      setSuccess(`Documento "${editNameField}" actualizado con éxito.`);
      setEditingDoc(null);
      loadDocuments();
    } catch (err: any) {
      setError(err.message || 'Error al guardar los cambios.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleOpenPermissionsEditor = (doc: SharedDocument) => {
    setEditingPermissionsDoc(doc);
    setEditDocName(doc.name);
    if (!doc.allowedRoles || doc.allowedRoles.length === 4) {
      setEditAudienceType('all');
      setEditAllowedRoles(['ADMIN', 'MANAGER', 'ASESOR']);
      setEditAllowedUserIds([]);
    } else if (doc.allowedUserIds && doc.allowedUserIds.length > 0) {
      setEditAudienceType('users');
      setEditAllowedRoles([]);
      setEditAllowedUserIds(doc.allowedUserIds);
    } else {
      setEditAudienceType('roles');
      setEditAllowedRoles(doc.allowedRoles || []);
      setEditAllowedUserIds([]);
    }
  };

  const toggleEditRole = (role: string) => {
    if (editAllowedRoles.includes(role)) {
      setEditAllowedRoles(editAllowedRoles.filter(r => r !== role));
    } else {
      setEditAllowedRoles([...editAllowedRoles, role]);
    }
  };

  const toggleEditUser = (userId: string) => {
    if (editAllowedUserIds.includes(userId)) {
      setEditAllowedUserIds(editAllowedUserIds.filter(id => id !== userId));
    } else {
      setEditAllowedUserIds([...editAllowedUserIds, userId]);
    }
  };

  const handleUpdatePermissionsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPermissionsDoc) return;

    try {
      setUpdatingPermissions(true);
      setError(null);
      setSuccess(null);

      const payload = {
        name: editDocName.trim(),
        allowedRoles: editAudienceType === 'all' ? ['SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR'] : (editAudienceType === 'roles' ? editAllowedRoles : []),
        allowedUserIds: editAudienceType === 'users' ? editAllowedUserIds : [],
        currentUserId: currentUser.id
      };

      const res = await fetch(`/api/shared-documents/${editingPermissionsDoc.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Error al actualizar permisos.');
      }

      setSuccess(`Documento "${editDocName}" actualizado con éxito.`);
      setEditingPermissionsDoc(null);
      loadDocuments();
    } catch (err: any) {
      setError(err.message || 'Error al actualizar permisos.');
    } finally {
      setUpdatingPermissions(false);
    }
  };

  // Load documents
  const loadDocuments = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/shared-documents?userId=${currentUser.id}&role=${currentUser.role}`);
      if (!res.ok) throw new Error('Error al cargar la biblioteca de documentos.');
      const data = await res.json();
      setDocuments(data);
    } catch (err: any) {
      setError(err.message || 'Error al conectar con la biblioteca.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [currentUser]);

  // Format File Size
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Drag handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const processFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setSelectedFile({
        name: file.name,
        size: file.size,
        base64: reader.result as string
      });
      if (!docName) {
        // Auto-fill name without extension
        setDocName(file.name.replace(/\.[^/.]+$/, ""));
      }
    };
    reader.onerror = () => {
      setError('No se pudo leer el archivo seleccionado.');
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  // Submit shared document upload
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !docName.trim()) {
      setError('Por favor completa el nombre y selecciona un archivo.');
      return;
    }

    try {
      setUploading(true);
      setError(null);
      setSuccess(null);

      const payload = {
        name: docName.trim(),
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        fileBase64: selectedFile.base64,
        allowedRoles: audienceType === 'all' ? ['SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR'] : (audienceType === 'roles' ? allowedRoles : []),
        allowedUserIds: audienceType === 'users' ? allowedUserIds : [],
        currentUserId: currentUser.id
      };

      const res = await fetch('/api/shared-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Error al subir el documento.');
      }

      setSuccess(`Documento "${docName}" subido exitosamente.`);
      setDocName('');
      setSelectedFile(null);
      setAudienceType('all');
      setAllowedRoles(['ADMIN', 'MANAGER', 'ASESOR']);
      setAllowedUserIds([]);
      loadDocuments();
    } catch (err: any) {
      setError(err.message || 'Error al subir documento.');
    } finally {
      setUploading(false);
    }
  };

  // Handle Download File
  const handleDownload = (doc: SharedDocument) => {
    if (!doc.dataUrl) {
      setError('Este documento no posee contenido descargable.');
      return;
    }

    // Log client-side download action
    fetch('/api/audit-logs/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.id,
        action: `Visualizó / descargó documento compartido "${doc.name}"`,
        entityType: 'SharedDocument',
        entityId: doc.id,
        entityName: doc.name
      })
    }).catch(err => console.error('Failed to log audit:', err));

    const link = document.createElement('a');
    link.href = doc.dataUrl;
    link.download = doc.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Handle Delete Shared Document
  const handleDelete = async () => {
    if (!deleteDoc) return;
    try {
      setError(null);
      const res = await fetch(`/api/shared-documents/${deleteDoc.id}?currentUserId=${currentUser.id}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Error al eliminar el documento.');
      }
      setSuccess(`Documento "${deleteDoc.name}" eliminado correctamente.`);
      setDeleteDoc(null);
      loadDocuments();
    } catch (err: any) {
      setError(err.message || 'Error al eliminar documento.');
    }
  };

  // Toggle roles in multi-role selection
  const toggleRole = (role: string) => {
    if (allowedRoles.includes(role)) {
      setAllowedRoles(allowedRoles.filter(r => r !== role));
    } else {
      setAllowedRoles([...allowedRoles, role]);
    }
  };

  // Toggle users in multi-user selection
  const toggleUser = (userId: string) => {
    if (allowedUserIds.includes(userId)) {
      setAllowedUserIds(allowedUserIds.filter(id => id !== userId));
    } else {
      setAllowedUserIds([...allowedUserIds, userId]);
    }
  };

  return (
    <div id="shared-docs-view" className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <FolderDown className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Documentos</h1>
            <p className="text-slate-500 text-sm">Biblioteca de archivos cargados para consulta, instructivos y plantillas de descarga rápida.</p>
          </div>
        </div>
        <div className="text-xs bg-slate-100 px-3 py-1.5 rounded-full text-slate-600 font-mono self-start md:self-auto">
          Rol actual: <span className="font-bold text-indigo-600">{currentUser.role}</span>
        </div>
      </div>

      {/* Messages */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-3 text-sm"
          >
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p>{error}</p>
          </motion.div>
        )}
        {success && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl flex items-center gap-3 text-sm"
          >
            <Check className="w-5 h-5 shrink-0" />
            <p>{success}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upload Panel (SUPERADMIN ONLY) */}
        {currentUser.role === 'SUPERADMIN' && (
          <div className="lg:col-span-1 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                <Plus className="w-5 h-5 text-indigo-500" />
                Subir nuevo archivo
              </h2>
              <p className="text-xs text-slate-400 mt-1">Comparte PDFs, Word (.docx, .doc), contratos tipo, manuales o imágenes con tus colaboradores.</p>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              {/* File Selector */}
              <div 
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                className={`relative border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                  dragActive ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200 hover:border-indigo-400'
                }`}
              >
                <input 
                  type="file" 
                  id="shared-file-uploader" 
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={handleFileChange}
                  accept=".pdf,.docx,.doc,.xlsx,.xls,.png,.jpg,.jpeg,.txt"
                />
                
                {selectedFile ? (
                  <div className="space-y-2">
                    <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center mx-auto">
                      <FileCheck className="w-6 h-6" />
                    </div>
                    <div className="text-xs font-semibold text-slate-700 break-all max-w-[200px] mx-auto">
                      {selectedFile.name}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {formatBytes(selectedFile.size)}
                    </div>
                    <button 
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setSelectedFile(null);
                      }}
                      className="text-[10px] text-red-500 hover:underline block mx-auto"
                    >
                      Remover archivo
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="w-10 h-10 bg-slate-50 text-slate-400 rounded-lg flex items-center justify-center mx-auto">
                      <Upload className="w-6 h-6" />
                    </div>
                    <p className="text-xs font-medium text-slate-700">Arrastra un archivo aquí o haz clic</p>
                    <p className="text-[10px] text-slate-400">PDF, Word, Excel, Img hasta 5MB</p>
                  </div>
                )}
              </div>

              {/* Document Display Name */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nombre Descriptivo</label>
                <input 
                  type="text"
                  placeholder="Ej: Contrato de Reserva Inmobiliaria Standard"
                  value={docName}
                  onChange={(e) => setDocName(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  required
                />
              </div>

              {/* Target Audience Options */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2">¿Quién puede ver y descargar este documento?</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setAudienceType('all')}
                    className={`p-2.5 rounded-lg border text-center text-xs flex flex-col items-center justify-center gap-1 font-medium transition-all ${
                      audienceType === 'all' 
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700' 
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Globe className="w-4 h-4" />
                    <span>Todos</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAudienceType('roles')}
                    className={`p-2.5 rounded-lg border text-center text-xs flex flex-col items-center justify-center gap-1 font-medium transition-all ${
                      audienceType === 'roles' 
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700' 
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    <span>Por Rol</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAudienceType('users')}
                    className={`p-2.5 rounded-lg border text-center text-xs flex flex-col items-center justify-center gap-1 font-medium transition-all ${
                      audienceType === 'users' 
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700' 
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Lock className="w-4 h-4" />
                    <span>Específico</span>
                  </button>
                </div>
              </div>

              {/* Roles Selector */}
              {audienceType === 'roles' && (
                <div className="p-3 bg-slate-50 border border-slate-150 rounded-xl space-y-2">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Seleccionar roles habilitados:</span>
                  {['ADMIN', 'MANAGER', 'ASESOR'].map(role => (
                    <label key={role} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer py-0.5">
                      <input 
                        type="checkbox"
                        checked={allowedRoles.includes(role)}
                        onChange={() => toggleRole(role)}
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{role}</span>
                    </label>
                  ))}
                </div>
              )}

              {/* Users Selector */}
              {audienceType === 'users' && (
                <div className="p-3 bg-slate-50 border border-slate-150 rounded-xl space-y-2 max-h-[160px] overflow-y-auto">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Seleccionar usuarios habilitados:</span>
                  {users.filter(u => u.role !== 'SUPERADMIN').map(user => (
                    <label key={user.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer py-1 border-b border-slate-100 last:border-0">
                      <input 
                        type="checkbox"
                        checked={allowedUserIds.includes(user.id)}
                        onChange={() => toggleUser(user.id)}
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <div className="flex flex-col text-left">
                        <span className="font-medium">{user.name} {user.lastName}</span>
                        <span className="text-[9px] text-slate-400 font-mono">{user.role} - {user.email}</span>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              <button
                type="submit"
                disabled={uploading || !selectedFile}
                className="w-full text-xs py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Cargando archivo...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    <span>Subir a Documentos</span>
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* Documents List View */}
        <div className={`bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col space-y-4 ${
          currentUser.role === 'SUPERADMIN' ? 'lg:col-span-2' : 'lg:col-span-3'
        }`}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Archivos Compartidos</h2>
              <p className="text-xs text-slate-400 mt-0.5">Acceso inmediato a los documentos disponibles según tus permisos.</p>
            </div>
            
            {/* Search Input */}
            <div className="relative max-w-xs w-full">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
                placeholder="Buscar por nombre..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Categorized Filter Tabs */}
          <div className="flex gap-2 p-1 bg-slate-50 rounded-xl self-start">
            <button
              onClick={() => setDocFilterTab('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                docFilterTab === 'all'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Todos ({documents.length})
            </button>
            <button
              onClick={() => setDocFilterTab('digital')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                docFilterTab === 'digital'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <span>✍️ Digitalizados</span>
              <span className="px-1.5 py-0.5 text-[9px] bg-indigo-50 text-indigo-600 rounded-full font-bold">
                {documents.filter(d => d.name.toLowerCase().includes('digitalizado') || d.fileName.endsWith('_digitalizado.txt') || d.fileName.endsWith('.txt')).length}
              </span>
            </button>
            <button
              onClick={() => setDocFilterTab('uploaded')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                docFilterTab === 'uploaded'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <span>📥 Subidos</span>
              <span className="px-1.5 py-0.5 text-[9px] bg-slate-200/60 text-slate-700 rounded-full font-bold">
                {documents.filter(d => !(d.name.toLowerCase().includes('digitalizado') || d.fileName.endsWith('_digitalizado.txt') || d.fileName.endsWith('.txt'))).length}
              </span>
            </button>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-3">
              <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
              <p className="text-xs text-slate-400">Cargando biblioteca de documentos...</p>
            </div>
          ) : (() => {
            const digitalDocs = documents.filter(d => d.name.toLowerCase().includes('digitalizado') || d.fileName.endsWith('_digitalizado.txt') || d.fileName.endsWith('.txt'));
            const uploadedDocs = documents.filter(d => !(d.name.toLowerCase().includes('digitalizado') || d.fileName.endsWith('_digitalizado.txt') || d.fileName.endsWith('.txt')));
            
            const currentFiltered = docFilterTab === 'digital' 
              ? digitalDocs 
              : docFilterTab === 'uploaded' 
                ? uploadedDocs 
                : documents;

            const searched = currentFiltered.filter(d => 
              d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              d.fileName.toLowerCase().includes(searchQuery.toLowerCase())
            );

            if (searched.length === 0) {
              return (
                <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
                  <div className="w-14 h-14 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-slate-700">Sin archivos disponibles</h3>
                    <p className="text-[11px] text-slate-400 max-w-xs mt-1">
                      No hay documentos que coincidan con la búsqueda o tus permisos.
                    </p>
                  </div>
                </div>
              );
            }

            return (
              <div className="space-y-3 mt-2">
                {searched.map((doc) => {
                  const isDigital = doc.name.toLowerCase().includes('digitalizado') || doc.fileName.endsWith('_digitalizado.txt') || doc.fileName.endsWith('.txt');
                  return (
                    <div 
                      key={doc.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50 border border-slate-150/60 rounded-xl hover:border-indigo-200 transition-all gap-4 shadow-sm"
                    >
                      <div className="flex items-start gap-3">
                        <div className={`p-3 rounded-lg border shadow-sm shrink-0 ${
                          isDigital 
                            ? 'bg-amber-50/50 text-amber-600 border-amber-100' 
                            : 'bg-indigo-50/50 text-indigo-600 border-indigo-100'
                        }`}>
                          <FileText className="w-6 h-6" />
                        </div>
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-semibold text-slate-800 leading-tight">{doc.name}</h4>
                            <span className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                              isDigital 
                                ? 'bg-amber-100 text-amber-800' 
                                : 'bg-slate-200 text-slate-700'
                            }`}>
                              {isDigital ? '✍️ Digitalizado' : '📥 Subido'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 font-mono break-all">{doc.fileName} • {formatBytes(doc.fileSize)}</p>
                          
                          <div className="flex flex-wrap gap-2 pt-1 items-center">
                            <span className="text-[10px] text-slate-500">
                              Subido por: <span className="font-medium text-slate-600">{doc.uploadedBy}</span>
                            </span>
                            <span className="text-[10px] text-slate-300">•</span>
                            <span className="text-[10px] text-slate-500">
                              Fecha: <span className="font-medium text-slate-600">{new Date(doc.uploadedAt).toLocaleDateString()}</span>
                            </span>
                          </div>

                          {/* Visual Access/Permissions Status Indicator */}
                          <div className="flex flex-wrap gap-1.5 pt-1.5">
                            {(!doc.allowedRoles || doc.allowedRoles.length === 4) ? (
                              <span className="inline-flex items-center gap-1 text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full font-medium shadow-sm">
                                <Globe className="w-2.5 h-2.5 text-emerald-500" /> Público: Todos los Roles
                              </span>
                            ) : (doc.allowedUserIds && doc.allowedUserIds.length > 0) ? (
                              <span className="inline-flex items-center gap-1 text-[9px] bg-amber-50 text-amber-800 border border-amber-100 px-2 py-0.5 rounded-full font-medium shadow-sm">
                                <Lock className="w-2.5 h-2.5 text-amber-500" /> Específico: {doc.allowedUserIds.length} Usuario(s)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[9px] bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded-full font-medium shadow-sm">
                                <Users className="w-2.5 h-2.5 text-indigo-500" /> Roles: {doc.allowedRoles?.join(', ')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Document Quick Actions Bar */}
                      <div className="flex items-center gap-1.5 self-end sm:self-center">
                        <button
                          onClick={() => handleDownload(doc)}
                          className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg transition-all border border-indigo-100"
                          title="Descargar archivo"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Descargar</span>
                        </button>

                        <button
                          onClick={() => handleOpenDocEditor(doc)}
                          className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-all border border-slate-200"
                          title={isDigital ? "Editar contenido y nombre del documento" : "Editar nombre del documento"}
                        >
                          <Edit className="w-3.5 h-3.5" />
                          <span>Editar</span>
                        </button>

                        {currentUser.role === 'SUPERADMIN' && (
                          <>
                            <button
                              onClick={() => handleOpenPermissionsEditor(doc)}
                              className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg border border-transparent hover:border-indigo-100 transition-all"
                              title="Configurar quién puede ver este documento (Compartir / Permisos)"
                            >
                              <Share2 className="w-4 h-4" />
                            </button>

                            <button
                              onClick={() => setDeleteDoc(doc)}
                              className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg border border-transparent hover:border-red-100 transition-all"
                              title="Eliminar de biblioteca"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Dynamic Permissions / Sharing Modal */}
      {editingPermissionsDoc && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl border border-slate-100 shadow-xl max-w-md w-full overflow-hidden"
          >
            {/* Modal Header */}
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-500" />
                <h3 className="text-sm font-bold text-slate-800">Compartir y Permisos</h3>
              </div>
              <button
                onClick={() => setEditingPermissionsDoc(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdatePermissionsSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">Nombre del Documento</label>
                <input
                  type="text"
                  value={editDocName}
                  onChange={(e) => setEditDocName(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                  required
                />
              </div>

              {/* Audience selection */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Permisos de Acceso</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditAudienceType('all')}
                    className={`p-2 rounded-lg border text-center text-xs flex flex-col items-center justify-center gap-1 font-medium transition-all ${
                      editAudienceType === 'all' 
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm' 
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span className="text-[10px]">Público</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditAudienceType('roles')}
                    className={`p-2 rounded-lg border text-center text-xs flex flex-col items-center justify-center gap-1 font-medium transition-all ${
                      editAudienceType === 'roles' 
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm' 
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span className="text-[10px]">Por Rol</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditAudienceType('users')}
                    className={`p-2 rounded-lg border text-center text-xs flex flex-col items-center justify-center gap-1 font-medium transition-all ${
                      editAudienceType === 'users' 
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm' 
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span className="text-[10px]">Específico</span>
                  </button>
                </div>
              </div>

              {/* Roles Selector */}
              {editAudienceType === 'roles' && (
                <div className="p-3 bg-slate-50 border border-slate-150 rounded-xl space-y-2">
                  <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400">Seleccionar roles habilitados:</span>
                  {['ADMIN', 'MANAGER', 'ASESOR'].map(role => (
                    <label key={role} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer py-0.5">
                      <input 
                        type="checkbox"
                        checked={editAllowedRoles.includes(role)}
                        onChange={() => toggleEditRole(role)}
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{role}</span>
                    </label>
                  ))}
                </div>
              )}

              {/* Users Selector */}
              {editAudienceType === 'users' && (
                <div className="p-3 bg-slate-50 border border-slate-150 rounded-xl space-y-2 max-h-[160px] overflow-y-auto">
                  <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400">Seleccionar usuarios habilitados:</span>
                  {users.filter(u => u.role !== 'SUPERADMIN').map(user => (
                    <label key={user.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer py-1 border-b border-slate-100 last:border-0">
                      <input 
                        type="checkbox"
                        checked={editAllowedUserIds.includes(user.id)}
                        onChange={() => toggleEditUser(user.id)}
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <div className="flex flex-col text-left">
                        <span className="font-medium">{user.name} {user.lastName}</span>
                        <span className="text-[9px] text-slate-400 font-mono">{user.role} - {user.email}</span>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              <div className="flex gap-2 justify-end pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingPermissionsDoc(null)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={updatingPermissions}
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {updatingPermissions && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Guardar Cambios</span>
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Edit Document Modal */}
      {editingDoc && (() => {
        const isDigital = editingDoc.name.toLowerCase().includes('digitalizado') || editingDoc.fileName.endsWith('_digitalizado.txt') || editingDoc.fileName.endsWith('.txt');
        return (
          <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-2xl border border-slate-100 shadow-xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Modal Header */}
              <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <Edit className="w-5 h-5 text-indigo-500" />
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">
                      Editar Documento {isDigital ? 'Digitalizado' : ''}
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      {isDigital 
                        ? 'Puedes modificar el nombre descriptivo y el contenido de texto del documento.' 
                        : 'Para documentos subidos, sólo se permite editar el nombre descriptivo.'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setEditingDoc(null)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleEditDocSubmit} className="flex-1 flex flex-col overflow-hidden">
                <div className="p-6 space-y-4 overflow-y-auto flex-1">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Nombre Descriptivo
                    </label>
                    <input
                      type="text"
                      value={editNameField}
                      onChange={(e) => setEditNameField(e.target.value)}
                      className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                      required
                    />
                  </div>

                  {isDigital ? (
                    <div className="flex-1 flex flex-col min-h-[250px]">
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                        Contenido del Documento Digitalizado
                      </label>
                      <textarea
                        value={editContentField}
                        onChange={(e) => setEditContentField(e.target.value)}
                        className="w-full flex-1 min-h-[250px] text-xs p-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono resize-y"
                        placeholder="Escribe o pega el contenido de texto del documento aquí..."
                        required
                      />
                    </div>
                  ) : (
                    <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs space-y-1">
                      <p className="font-semibold">⚠️ Documento no digitalizado</p>
                      <p className="text-[11px] text-amber-700">
                        Este archivo (<span className="font-mono">{editingDoc.fileName}</span>) fue subido manualmente por un usuario. No se puede editar su contenido de texto binario o de imagen directamente, por lo que únicamente puedes cambiar su nombre descriptivo en el sistema.
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 justify-end p-6 border-t border-slate-100 bg-slate-50 shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditingDoc(null)}
                    className="px-4 py-2 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingEdit}
                    className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    {savingEdit && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Guardar Cambios</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        );
      })()}

      {/* Delete Confirmation Modal */}
      {deleteDoc && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl border border-slate-100 shadow-xl max-w-md w-full p-6 space-y-4"
          >
            <div>
              <h3 className="text-base font-bold text-slate-800">¿Eliminar documento de la biblioteca?</h3>
              <p className="text-xs text-slate-400 mt-1">
                Estás por remover permanentemente el archivo <span className="font-semibold text-slate-700 font-mono">"{deleteDoc.name}"</span>. 
                Los colaboradores ya no tendrán acceso a descargarlo ni visualizarlo.
              </p>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setDeleteDoc(null)}
                className="px-4 py-2 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-all"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-all"
              >
                Eliminar para todos
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
