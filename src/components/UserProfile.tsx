import React, { useState } from 'react';
import { 
  User as UserIcon, 
  Mail, 
  Phone, 
  MapPin, 
  Lock, 
  ShieldCheck, 
  Users, 
  UserCog, 
  Briefcase, 
  Save, 
  CheckCircle,
  AlertTriangle,
  Compass,
  FileCheck2,
  Camera,
  Upload
} from 'lucide-react';
import { User, AppDataState } from '../types';

const PRESET_AVATARS = [
  {
    name: 'Fantasmita',
    url: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#6366f1" rx="50"/><path d="M30,70 C30,40 35,30 50,30 C65,30 70,40 70,70 C70,72 65,75 60,70 C55,65 50,75 45,70 C40,65 35,75 30,70 Z" fill="#ffffff" /><circle cx="43" cy="48" r="4" fill="#1e1b4b" /><circle cx="57" cy="48" r="4" fill="#1e1b4b" /><circle cx="39" cy="53" r="2" fill="#f43f5e" opacity="0.6" /><circle cx="61" cy="53" r="2" fill="#f43f5e" opacity="0.6" /></svg>')
  },
  {
    name: 'Cactus',
    url: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#10b981" rx="50"/><path d="M35,75 L65,75 L60,85 L40,85 Z" fill="#f97316" /><rect x="32" y="70" width="36" height="6" rx="2" fill="#ea580c" /><rect x="44" y="30" width="12" height="42" rx="6" fill="#047857" /><path d="M44,45 L36,45 C34,45 34,55 36,55 L44,55" fill="none" stroke="#047857" stroke-width="8" stroke-linecap="round" /><path d="M56,38 L64,38 C66,38 66,48 64,48 L56,48" fill="none" stroke="#047857" stroke-width="8" stroke-linecap="round" /><circle cx="47" cy="42" r="2" fill="#ffffff" /><circle cx="53" cy="42" r="2" fill="#ffffff" /><path d="M48,46 Q50,48 52,46" stroke="#ffffff" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>')
  },
  {
    name: 'Pinguinito',
    url: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#3b82f6" rx="50"/><ellipse cx="50" cy="55" rx="22" ry="25" fill="#1e293b" /><ellipse cx="50" cy="58" rx="15" ry="18" fill="#ffffff" /><ellipse cx="26" cy="55" rx="5" ry="12" fill="#1e293b" transform="rotate(-15 26 55)" /><ellipse cx="74" cy="55" rx="5" ry="12" fill="#1e293b" transform="rotate(15 74 55)" /><circle cx="44" cy="44" r="2.5" fill="#1e293b" /><circle cx="56" cy="44" r="2.5" fill="#1e293b" /><polygon points="46,47 54,47 50,53" fill="#f59e0b" /><ellipse cx="42" cy="80" rx="6" ry="3" fill="#f59e0b" /><ellipse cx="58" cy="80" rx="6" ry="3" fill="#f59e0b" /></svg>')
  },
  {
    name: 'Osito',
    url: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#f59e0b" rx="50"/><circle cx="32" cy="32" r="10" fill="#78350f" /><circle cx="32" cy="32" r="5" fill="#f43f5e" opacity="0.5" /><circle cx="68" cy="32" r="10" fill="#78350f" /><circle cx="68" cy="32" r="5" fill="#f43f5e" opacity="0.5" /><circle cx="50" cy="55" r="25" fill="#78350f" /><ellipse cx="50" cy="62" rx="10" ry="8" fill="#fef3c7" /><polygon points="47,58 53,58 50,62" fill="#1e293b" /><circle cx="42" cy="50" r="3" fill="#ffffff" /><circle cx="58" cy="50" r="3" fill="#ffffff" /></svg>')
  },
  {
    name: 'Gatito',
    url: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#ec4899" rx="50"/><polygon points="25,25 45,45 25,50" fill="#f1f5f9" /><polygon points="75,25 55,45 75,50" fill="#f1f5f9" /><polygon points="28,29 40,41 28,45" fill="#fda4af" /><polygon points="72,29 60,41 72,45" fill="#fda4af" /><ellipse cx="50" cy="55" rx="26" ry="22" fill="#f1f5f9" /><circle cx="40" cy="52" r="3" fill="#0f172a" /><circle cx="60" cy="52" r="3" fill="#0f172a" /><polygon points="48,58 52,58 50,60" fill="#fda4af" /><path d="M47,62 Q50,64 50,62 Q50,64 53,62" stroke="#0f172a" stroke-width="1.5" fill="none" /><line x1="20" y1="54" x2="30" y2="56" stroke="#cbd5e1" stroke-width="2" /><line x1="20" y1="60" x2="29" y2="60" stroke="#cbd5e1" stroke-width="2" /><line x1="80" y1="54" x2="70" y2="56" stroke="#cbd5e1" stroke-width="2" /><line x1="80" y1="60" x2="71" y2="60" stroke="#cbd5e1" stroke-width="2" /></svg>')
  },
  {
    name: 'Robot',
    url: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#06b6d4" rx="50"/><line x1="50" y1="30" x2="50" y2="18" stroke="#f1f5f9" stroke-width="4" /><circle cx="50" cy="16" r="5" fill="#f43f5e" /><rect x="28" y="28" width="44" height="38" rx="8" fill="#cbd5e1" /><rect x="34" y="34" width="32" height="20" rx="4" fill="#1e293b" /><circle cx="44" cy="44" r="3" fill="#22c55e" /><circle cx="56" cy="44" r="3" fill="#22c55e" /><rect x="42" y="60" width="16" height="2" rx="1" fill="#475569" /><rect x="24" y="40" width="4" height="14" rx="2" fill="#475569" /><rect x="72" y="40" width="4" height="14" rx="2" fill="#475569" /></svg>')
  },
  {
    name: 'Zorrito',
    url: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#f97316" rx="50"/><polygon points="20,25 42,42 18,50" fill="#ea580c" /><polygon points="80,25 58,42 82,50" fill="#ea580c" /><polygon points="23,28 36,39 22,44" fill="#1e293b" /><polygon points="77,28 64,39 78,44" fill="#1e293b" /><ellipse cx="36" cy="60" rx="16" ry="12" fill="#ffffff" /><ellipse cx="64" cy="60" rx="16" ry="12" fill="#ffffff" /><path d="M50,34 L28,52 C32,68 68,68 72,52 Z" fill="#ea580c" /><circle cx="38" cy="50" r="3" fill="#1e293b" /><circle cx="62" cy="50" r="3" fill="#1e293b" /><ellipse cx="50" cy="64" rx="5" ry="3.5" fill="#1e293b" /></svg>')
  },
  {
    name: 'Estrellita',
    url: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#8b5cf6" rx="50"/><path d="M50,18 L59,38 L81,41 L65,56 L69,78 L50,67 L31,78 L35,56 L19,41 L41,38 Z" fill="#fbbf24" /><circle cx="44" cy="48" r="2" fill="#1e293b" /><circle cx="56" cy="48" r="2" fill="#1e293b" /><path d="M47,53 Q50,56 53,53" stroke="#1e293b" stroke-width="1.5" fill="none" stroke-linecap="round" /><circle cx="41" cy="51" r="2" fill="#f43f5e" opacity="0.6" /><circle cx="59" cy="51" r="2" fill="#f43f5e" opacity="0.6" /></svg>')
  }
];

interface UserProfileProps {
  currentUser: User;
  state: AppDataState;
  onUpdateCurrentUser: (user: User) => void;
  loadState: () => Promise<void>;
}

export default function UserProfile({
  currentUser,
  state,
  onUpdateCurrentUser,
  loadState
}: UserProfileProps) {
  // Active inner tab: 'my-profile' or 'user-management'
  const [innerTab, setInnerTab] = useState<'my-profile' | 'user-management'>('my-profile');
  
  // My Profile Form States
  const [profileName, setProfileName] = useState(currentUser.name);
  const [profileLastName, setProfileLastName] = useState(currentUser.lastName);
  const [profilePhone, setProfilePhone] = useState(currentUser.phone || '');
  const [profileAddress, setProfileAddress] = useState(currentUser.address || '');
  const [profileCity, setProfileCity] = useState(currentUser.city || '');
  const [profileProvince, setProfileProvince] = useState(currentUser.province || '');
  const [profileCountry, setProfileCountry] = useState(currentUser.country || '');
  const [profilePassword, setProfilePassword] = useState('');
  const [profileAvatar, setProfileAvatar] = useState(currentUser.avatar || '');

  React.useEffect(() => {
    setProfileAvatar(currentUser.avatar || '');
    setProfileName(currentUser.name);
    setProfileLastName(currentUser.lastName);
    setProfilePhone(currentUser.phone || '');
    setProfileAddress(currentUser.address || '');
    setProfileCity(currentUser.city || '');
    setProfileProvince(currentUser.province || '');
    setProfileCountry(currentUser.country || '');
  }, [currentUser]);
  
  // Superadmin Active Industry Config
  const [activeIndustry, setActiveIndustry] = useState(state.activeIndustry || 'Inmobiliaria');

  // Superadmin Verification Policies Config
  const [policiesState, setPoliciesState] = useState(() => {
    return state.verificationPolicies || {
      ASESOR: 'email',
      MANAGER: 'email',
      ADMIN: 'email'
    };
  });

  React.useEffect(() => {
    if (state.verificationPolicies) {
      setPoliciesState(state.verificationPolicies);
    }
  }, [state.verificationPolicies]);

  // User Management States
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [mgmtName, setMgmtName] = useState('');
  const [mgmtLastName, setMgmtLastName] = useState('');
  const [mgmtEmail, setMgmtEmail] = useState('');
  const [mgmtPhone, setMgmtPhone] = useState('');
  const [mgmtAddress, setMgmtAddress] = useState('');
  const [mgmtCity, setMgmtCity] = useState('');
  const [mgmtProvince, setMgmtProvince] = useState('');
  const [mgmtCountry, setMgmtCountry] = useState('');
  const [mgmtRole, setMgmtRole] = useState<'SUPERADMIN' | 'ADMIN' | 'MANAGER' | 'ASESOR'>('ASESOR');
  const [mgmtActive, setMgmtActive] = useState(true);
  const [mgmtPassword, setMgmtPassword] = useState('');
  const [mgmtSensitiveOverride, setMgmtSensitiveOverride] = useState<boolean | undefined>(undefined);

  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Check if current user is allowed to manage other users
  const canManageUsers = ['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(currentUser.role);

  // Check if current user is allowed to edit sensitive data of a target user based on hierarchy:
  // "solo el superadmin modifica datos sensibles de los admins, speradmins"
  // "los admins modifican datos sensibles de los managers"
  // "superadmins, admins, y los managers modifican los datos sensibles de los asesores"
  const canEditSensitiveOf = (targetRole: string) => {
    // Override rules
    if (currentUser.hasSensitiveEditPermissionOverride === false) {
      return false; // Forcefully blocked
    }
    if (currentUser.hasSensitiveEditPermissionOverride === true) {
      if (currentUser.role === 'SUPERADMIN') return true;
      if (targetRole === 'SUPERADMIN') return false; // Non-superadmins can never edit superadmin
      return true; // Allowed
    }

    if (currentUser.role === 'SUPERADMIN') {
      // Superadmin can edit ADMIN, SUPERADMIN, MANAGER, ASESOR
      return true;
    }
    if (currentUser.role === 'ADMIN') {
      // Admins can edit MANAGER, ASESOR (but NOT admin or superadmin)
      return ['MANAGER', 'ASESOR'].includes(targetRole);
    }
    if (currentUser.role === 'MANAGER') {
      // Managers can only edit ASESOR
      return targetRole === 'ASESOR';
    }
    return false;
  };

  // Save My Profile
  const handleSaveProfile = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e) e.preventDefault();
    setLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    try {
      const response = await fetch('/api/auth/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          name: profileName,
          lastName: profileLastName,
          phone: profilePhone,
          address: profileAddress,
          city: profileCity,
          province: profileProvince,
          country: profileCountry,
          password: profilePassword || undefined,
          avatar: profileAvatar
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Error al guardar los cambios.');
      }

      onUpdateCurrentUser(data.user);
      sessionStorage.setItem('docflow_user', JSON.stringify(data.user));
      setSuccessMsg('Perfil actualizado con éxito.');
      setProfilePassword('');
      await loadState();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Change active industry (Only Superadmin)
  const handleChangeIndustry = async (industry: string) => {
    setLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      const response = await fetch('/api/industry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          industry,
          currentUserId: currentUser.id
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'No se pudo cambiar el rubro.');
      }
      setActiveIndustry(industry);
      setSuccessMsg(`Rubro configurado a "${industry}" con éxito.`);
      await loadState();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Update Verification Policy by Role (Superadmin only)
  const handleUpdatePolicy = async (roleKey: string, value: string) => {
    const updatedPolicies = {
      ...policiesState,
      [roleKey]: value
    };
    
    setLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    
    try {
      const response = await fetch('/api/verification-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policies: updatedPolicies,
          currentUserId: currentUser.id
        })
      });
      
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'No se pudo actualizar la política de verificación.');
      }
      
      setPoliciesState(updatedPolicies);
      setSuccessMsg(`Política de verificación para ${roleKey === 'ADMIN' ? 'ADMINS' : roleKey + 'S'} actualizada a "${value.toUpperCase()}" con éxito.`);
      await loadState();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Select a user to edit in User Management panel
  const handleSelectUser = (user: User) => {
    setSelectedUser(user);
    setMgmtName(user.name);
    setMgmtLastName(user.lastName);
    setMgmtEmail(user.email);
    setMgmtPhone(user.phone || '');
    setMgmtAddress(user.address || '');
    setMgmtCity(user.city || '');
    setMgmtProvince(user.province || '');
    setMgmtCountry(user.country || '');
    setMgmtRole(user.role);
    setMgmtActive(user.active !== false);
    setMgmtPassword('');
    setMgmtSensitiveOverride(user.hasSensitiveEditPermissionOverride);
    setSuccessMsg(null);
    setErrorMsg(null);
  };

  // Save selected user details
  const handleSaveUserMgmt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    setLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    // Build pay-load containing changes
    const payload: any = {
      currentUserId: currentUser.id,
      name: mgmtName,
      lastName: mgmtLastName,
      phone: mgmtPhone,
      address: mgmtAddress,
      city: mgmtCity,
      province: mgmtProvince,
      country: mgmtCountry,
      avatar: selectedUser.avatar,
    };

    // If allowed to edit sensitive data, add them
    if (canEditSensitiveOf(selectedUser.role)) {
      payload.email = mgmtEmail;
      payload.role = mgmtRole;
      payload.active = mgmtActive;
      if (mgmtPassword) {
        payload.password = mgmtPassword;
      }
      if (currentUser.role === 'SUPERADMIN') {
        payload.hasSensitiveEditPermissionOverride = mgmtSensitiveOverride;
      }
    }

    try {
      const response = await fetch(`/api/users/${selectedUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'No se pudo actualizar el usuario.');
      }

      setSuccessMsg(`Usuario ${data.name} ${data.lastName} actualizado con éxito.`);
      setMgmtPassword('');
      await loadState();
      
      // Update our selected user instance
      setSelectedUser(data);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6" id="view-user-profile">
      {/* Title block */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="font-display font-bold text-2xl text-slate-800 tracking-tight">
            Perfiles de usuarios
          </h1>
          <p className="text-sm text-slate-500">
            Administra tus credenciales personales, datos de contacto y cuentas de usuarios en la plataforma.
          </p>
        </div>
        
        {/* Navigation tabs inside Settings */}
        {canManageUsers && (
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => { setInnerTab('my-profile'); setSuccessMsg(null); setErrorMsg(null); }}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                innerTab === 'my-profile'
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              id="tab-my-profile"
            >
              <UserIcon className="w-3.5 h-3.5" />
              Mi Perfil
            </button>
            <button
              onClick={() => { setInnerTab('user-management'); setSuccessMsg(null); setErrorMsg(null); }}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                innerTab === 'user-management'
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              id="tab-user-management"
            >
              <Users className="w-3.5 h-3.5" />
              Gestión de Usuarios
            </button>
          </div>
        )}
      </div>

      {/* Success / Error Messages */}
      {successMsg && (
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl text-sm" id="msg-profile-success">
          <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="font-medium">{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl text-sm" id="msg-profile-error">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <span className="font-medium">{errorMsg}</span>
        </div>
      )}

      {innerTab === 'my-profile' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Avatar and Info Card */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6 lg:col-span-1">
            <div className="text-center space-y-3">
              <div className="relative inline-block">
                <img 
                  src={profileAvatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=120"} 
                  alt={currentUser.name} 
                  className="w-24 h-24 rounded-full mx-auto object-cover border-4 border-indigo-50 shadow-md"
                  referrerPolicy="no-referrer"
                />
                <span className="absolute bottom-1 right-1 bg-indigo-600 text-white p-1.5 rounded-full border-2 border-white shadow">
                  <Camera className="w-3.5 h-3.5" />
                </span>
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-lg leading-snug">
                  {currentUser.name} {currentUser.lastName}
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{currentUser.email}</p>
                
                <span className={`inline-block mt-2 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase tracking-wider ${
                  currentUser.role === 'SUPERADMIN' ? 'bg-red-50 text-red-600 border border-red-200' :
                  currentUser.role === 'ADMIN' ? 'bg-amber-50 text-amber-600 border border-amber-200' :
                  currentUser.role === 'MANAGER' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' :
                  'bg-blue-50 text-blue-600 border border-blue-200'
                }`}>
                  {currentUser.role}
                </span>
              </div>

              {/* Avatar Preset and Uploader Selection */}
              <div className="space-y-3 pt-4 border-t border-slate-100 text-left">
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Personalizar Foto de Perfil
                </label>
                
                {/* Grid of Preset Avatars */}
                <div className="grid grid-cols-4 gap-2">
                  {PRESET_AVATARS.map((avatarItem) => {
                    const isSelected = profileAvatar === avatarItem.url;
                    return (
                      <button
                        type="button"
                        key={avatarItem.url}
                        onClick={() => setProfileAvatar(avatarItem.url)}
                        className={`relative rounded-full aspect-square overflow-hidden border-2 transition-all hover:scale-105 active:scale-95 cursor-pointer ${
                          isSelected 
                            ? 'border-indigo-600 ring-2 ring-indigo-100 ring-offset-1' 
                            : 'border-slate-200 hover:border-slate-400'
                        }`}
                        title={avatarItem.name}
                      >
                        <img 
                          src={avatarItem.url} 
                          alt={avatarItem.name} 
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </button>
                    );
                  })}
                </div>

                {/* File Uploader */}
                <div className="pt-1">
                  <input
                    type="file"
                    id="avatar-file-upload"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          if (event.target?.result && typeof event.target.result === 'string') {
                            setProfileAvatar(event.target.result);
                          }
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                    className="hidden"
                  />
                  <label
                    htmlFor="avatar-file-upload"
                    className="flex items-center justify-center gap-2 w-full py-2 px-3 border border-dashed border-slate-300 hover:border-indigo-500 rounded-xl text-xs font-semibold text-slate-600 hover:text-indigo-600 bg-slate-50/50 hover:bg-indigo-50/20 transition-all cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Subir de dispositivo</span>
                  </label>
                </div>

                {/* Direct quick-save for Avatar changes */}
                {profileAvatar !== (currentUser.avatar || '') && (
                  <div className="pt-2">
                    <p className="text-[10px] text-amber-600 font-medium mb-1.5 text-center">
                      Tienes cambios sin guardar en tu imagen.
                    </p>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={handleSaveProfile}
                      className="w-full py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>Guardar Nueva Imagen</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-slate-100 pt-5 space-y-3">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Info del Sistema</h4>
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500">ID Usuario:</span>
                <span className="font-mono text-slate-700 font-medium">{currentUser.id}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500">Rubro Activo:</span>
                <span className="font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{state.activeIndustry || 'Inmobiliaria'}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500">Estado Cuenta:</span>
                <span className="font-semibold text-emerald-600">ACTIVO</span>
              </div>
            </div>
          </div>

          {/* Form Block */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm lg:col-span-2">
            <h3 className="font-bold text-slate-800 text-lg mb-4 flex items-center gap-2">
              <UserCog className="w-5 h-5 text-indigo-600" />
              Editar Detalles de Perfil
            </h3>
            
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">Nombre</label>
                  <input
                    type="text"
                    required
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    id="input-profile-name"
                  />
                </div>
                
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">Apellido</label>
                  <input
                    type="text"
                    required
                    value={profileLastName}
                    onChange={(e) => setProfileLastName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    id="input-profile-lastname"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">Email (No modificable)</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input
                      type="email"
                      disabled
                      value={currentUser.email}
                      className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 bg-slate-50 text-slate-400 rounded-xl cursor-not-allowed"
                    />
                  </div>
                </div>
                
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">Teléfono</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={profilePhone}
                      onChange={(e) => setProfilePhone(e.target.value)}
                      placeholder="+54 9 11 1234-5678"
                      className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                      id="input-profile-phone"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">Dirección</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={profileAddress}
                    onChange={(e) => setProfileAddress(e.target.value)}
                    placeholder="Av. del Libertador 1500"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    id="input-profile-address"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">Ciudad</label>
                  <input
                    type="text"
                    value={profileCity}
                    onChange={(e) => setProfileCity(e.target.value)}
                    placeholder="CABA"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    id="input-profile-city"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">Provincia / Estado</label>
                  <input
                    type="text"
                    value={profileProvince}
                    onChange={(e) => setProfileProvince(e.target.value)}
                    placeholder="Buenos Aires"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    id="input-profile-province"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">País</label>
                  <input
                    type="text"
                    value={profileCountry}
                    onChange={(e) => setProfileCountry(e.target.value)}
                    placeholder="Argentina"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    id="input-profile-country"
                  />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Cambiar Contraseña (Opcional)</label>
                <p className="text-[11px] text-slate-500 leading-normal mb-2">
                  Deje este campo vacío si desea conservar su contraseña actual. Las contraseñas se almacenan mediante un hashing criptográfico robusto en el backend.
                </p>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    type="password"
                    placeholder="Nueva contraseña de seguridad"
                    value={profilePassword}
                    onChange={(e) => setProfilePassword(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    id="input-profile-password"
                  />
                </div>
              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full md:w-auto px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  id="btn-save-profile"
                >
                  <Save className="w-4 h-4" />
                  {loading ? 'Guardando...' : 'Guardar Cambios de Perfil'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : (
        /* USER MANAGEMENT SUB-TAB (Hierarchical Access Control) */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Users List Block */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm lg:col-span-1 flex flex-col max-h-[600px]">
            <h3 className="font-bold text-slate-800 text-base mb-3 flex items-center gap-2">
              <Users className="w-4.5 h-4.5 text-slate-500" />
              Directorio de Usuarios ({state.users.length})
            </h3>
            
            <div className="overflow-y-auto space-y-2 flex-1 pr-1">
              {state.users.map((u) => {
                const isSelected = selectedUser?.id === u.id;
                return (
                  <button
                    key={u.id}
                    onClick={() => handleSelectUser(u)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'bg-indigo-50/50 border-indigo-200 ring-1 ring-indigo-200'
                        : 'bg-white hover:bg-slate-50 border-slate-100'
                    }`}
                  >
                    <img 
                      src={u.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100"} 
                      alt={u.name} 
                      className="w-10 h-10 rounded-full object-cover border border-slate-100"
                      referrerPolicy="no-referrer"
                    />
                    <div className="overflow-hidden flex-1">
                      <p className="text-xs font-bold text-slate-800 leading-tight truncate">
                        {u.name} {u.lastName}
                      </p>
                      <p className="text-[10px] text-slate-400 font-mono truncate">{u.email}</p>
                      
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase ${
                          u.role === 'SUPERADMIN' ? 'bg-red-50 text-red-600 border border-red-200/50' :
                          u.role === 'ADMIN' ? 'bg-amber-50 text-amber-600 border border-amber-200/50' :
                          u.role === 'MANAGER' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200/50' :
                          'bg-blue-50 text-blue-600 border border-blue-200/50'
                        }`}>
                          {u.role}
                        </span>
                        {u.active === false && (
                          <span className="bg-red-100 text-red-700 text-[8px] px-1.5 py-0.5 rounded font-bold font-mono">
                            INACTIVO
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* User Editor block */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm lg:col-span-2">
            {selectedUser ? (
              <div className="space-y-6">
                <div className="flex items-center gap-4 border-b border-slate-100 pb-4 justify-between">
                  <div className="flex items-center gap-3">
                    <img 
                      src={selectedUser.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100"} 
                      alt={selectedUser.name} 
                      className="w-12 h-12 rounded-full object-cover border-2 border-slate-150 shadow-xs"
                      referrerPolicy="no-referrer"
                    />
                    <div>
                      <h3 className="font-bold text-slate-800 text-lg leading-snug">
                        Administrar a: {selectedUser.name} {selectedUser.lastName}
                      </h3>
                      <p className="text-xs text-slate-400 font-mono">Modo de edición jerárquica activa</p>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold uppercase bg-slate-100 text-slate-700 border`}>
                    {selectedUser.role}
                  </span>
                </div>

                {/* Hierarchy Information Banner */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
                  <p className="font-bold text-slate-700 flex items-center gap-1">
                    <ShieldCheck className="w-4 h-4 text-indigo-600" />
                    Permisos de Edición de Datos Sensibles
                  </p>
                  <p className="text-slate-500 leading-relaxed">
                    De acuerdo a las reglas de la plataforma: 
                    <strong> Superadmin</strong> edita Admins y Superadmins; 
                    <strong> Admins</strong> editan Managers; 
                    <strong> Managers, Admins y Superadmins</strong> editan Asesores.
                  </p>
                  <div className="pt-1 flex items-center gap-1.5 justify-between flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400">¿Tienes permiso sensible para este usuario?:</span>
                      <span className={`font-bold font-mono uppercase ${
                        canEditSensitiveOf(selectedUser.role) ? 'text-emerald-600' : 'text-amber-600'
                      }`}>
                        {canEditSensitiveOf(selectedUser.role) ? 'SÍ (Acceso total)' : 'SÓLO DATOS DE CONTACTO (Lectura en sensibles)'}
                      </span>
                    </div>

                    {currentUser.role === 'SUPERADMIN' && (
                      <div className="flex items-center gap-2 mt-1.5 sm:mt-0 bg-white border border-slate-200 rounded-lg px-2 py-1">
                        <span className="font-semibold text-slate-600 text-[11px]">Asignar permiso sensible:</span>
                        <select
                          value={mgmtSensitiveOverride === undefined ? 'default' : mgmtSensitiveOverride ? 'allow' : 'deny'}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === 'default') {
                              setMgmtSensitiveOverride(undefined);
                            } else {
                              setMgmtSensitiveOverride(val === 'allow');
                            }
                          }}
                          className="text-[11px] font-medium bg-transparent border-none text-slate-800 focus:outline-none focus:ring-0 p-0 pr-6 cursor-pointer"
                          id="select-mgmt-sensitive-override"
                        >
                          <option value="default">Por defecto (Rol)</option>
                          <option value="allow">SÍ (Permitir)</option>
                          <option value="deny">NO (Bloquear)</option>
                        </select>
                      </div>
                    )}
                  </div>
                </div>

                <form onSubmit={handleSaveUserMgmt} className="space-y-4">
                  {/* Non-sensitive (Always Editable) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-600">Nombre</label>
                      <input
                        type="text"
                        required
                        value={mgmtName}
                        onChange={(e) => setMgmtName(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                        id="input-mgmt-name"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-600">Apellido</label>
                      <input
                        type="text"
                        required
                        value={mgmtLastName}
                        onChange={(e) => setMgmtLastName(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                        id="input-mgmt-lastname"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">Teléfono de Contacto</label>
                    <input
                      type="text"
                      value={mgmtPhone}
                      onChange={(e) => setMgmtPhone(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                      id="input-mgmt-phone"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="md:col-span-2 space-y-1.5">
                      <label className="text-xs font-semibold text-slate-600">Dirección</label>
                      <input
                        type="text"
                        value={mgmtAddress}
                        onChange={(e) => setMgmtAddress(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl"
                        id="input-mgmt-address"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-600">Ciudad</label>
                      <input
                        type="text"
                        value={mgmtCity}
                        onChange={(e) => setMgmtCity(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl"
                        id="input-mgmt-city"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-600">Provincia</label>
                      <input
                        type="text"
                        value={mgmtProvince}
                        onChange={(e) => setMgmtProvince(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl"
                        id="input-mgmt-province"
                      />
                    </div>
                  </div>

                  {/* SENSITIVE FIELDS PANEL (Enforces permissions) */}
                  <div className={`p-4 rounded-xl border space-y-4 ${
                    canEditSensitiveOf(selectedUser.role) 
                      ? 'bg-indigo-50/10 border-indigo-100' 
                      : 'bg-slate-50 border-slate-100 text-slate-400 opacity-70'
                  }`}>
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider font-mono">
                        Sección de Datos Sensibles (Email, Rol, Clave, Activo)
                      </h4>
                      {!canEditSensitiveOf(selectedUser.role) && (
                        <span className="text-[10px] bg-amber-100 text-amber-700 font-bold px-2 py-0.5 rounded font-mono">
                          BLOQUEADO POR JERARQUÍA
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold">Email de Acceso</label>
                        <input
                          type="email"
                          disabled={!canEditSensitiveOf(selectedUser.role)}
                          value={mgmtEmail}
                          onChange={(e) => setMgmtEmail(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-200 bg-white rounded-xl disabled:bg-slate-100 disabled:cursor-not-allowed"
                          id="input-mgmt-email"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold">Rol del Sistema</label>
                        <select
                          disabled={!canEditSensitiveOf(selectedUser.role) || selectedUser.role === 'SUPERADMIN'}
                          value={mgmtRole}
                          onChange={(e) => setMgmtRole(e.target.value as any)}
                          className="w-full px-3 py-2 text-sm border border-slate-200 bg-white rounded-xl disabled:bg-slate-100 disabled:cursor-not-allowed"
                          id="select-mgmt-role"
                        >
                          {selectedUser.role === 'SUPERADMIN' && <option value="SUPERADMIN">SUPERADMIN</option>}
                          <option value="ADMIN">ADMIN</option>
                          <option value="MANAGER">MANAGER</option>
                          <option value="ASESOR">ASESOR</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold">Forzar Nueva Contraseña</label>
                        <input
                          type="password"
                          disabled={!canEditSensitiveOf(selectedUser.role)}
                          placeholder="Reescribir contraseña"
                          value={mgmtPassword}
                          onChange={(e) => setMgmtPassword(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-200 bg-white rounded-xl disabled:bg-slate-100 disabled:cursor-not-allowed"
                          id="input-mgmt-password"
                        />
                      </div>

                      <div className="flex items-center gap-2 pt-5">
                        <input
                          type="checkbox"
                          disabled={!canEditSensitiveOf(selectedUser.role)}
                          checked={mgmtActive}
                          onChange={(e) => setMgmtActive(e.target.checked)}
                          className="w-4 h-4 text-indigo-600 border-slate-200 rounded focus:ring-indigo-500 disabled:cursor-not-allowed"
                          id="checkbox-mgmt-active"
                        />
                        <label className="text-xs font-semibold">Usuario Activo (Permitir iniciar sesión)</label>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-colors"
                      id="btn-mgmt-save"
                    >
                      <Save className="w-4 h-4" />
                      {loading ? 'Guardando...' : 'Aplicar Cambios en Usuario'}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400 space-y-3 min-h-[350px]">
                <UserCog className="w-12 h-12 text-slate-300 stroke-[1.5]" />
                <div>
                  <p className="font-semibold text-slate-700">Ningún usuario seleccionado</p>
                  <p className="text-xs max-w-sm mt-1">
                    Seleccione un usuario de la lista de la izquierda para ver su perfil completo y modificar sus datos de contacto o permisos jerárquicos.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
