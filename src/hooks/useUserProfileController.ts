import React, { useState } from 'react';
import type { User, AppDataState } from '../types';
import { PRESET_AVATARS } from '../data';

export interface UserProfileProps {
  currentUser: User;
  state: AppDataState;
  onUpdateCurrentUser: (user: User) => void;
  loadState: () => Promise<void>;
}

/** Profile and account-management state, permissions and operations. */
export function useUserProfileController({ currentUser, state, onUpdateCurrentUser, loadState }: UserProfileProps) {
  // Active inner tab: 'my-profile' or 'user-management'
  const [innerTab, setInnerTab] = useState<'my-profile' | 'user-management' | 'audit'>('my-profile');
  
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

  // User Management States
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [canCreateAccounts, setCanCreateAccounts] = useState(currentUser.role === 'SUPERADMIN');
  const [newAccount, setNewAccount] = useState({ name: '', lastName: '', email: '', password: '', role: 'ASESOR', avatar: PRESET_AVATARS[0]?.url || '' });
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  React.useEffect(() => {
    if (currentUser.role === 'SUPERADMIN') return;
    if (currentUser.role !== 'ADMIN') { setCanCreateAccounts(false); return; }
    fetch('/api/users/creation-permission', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { allowed: false })
      .then(d => setCanCreateAccounts(Boolean(d.allowed)))
      .catch(() => setCanCreateAccounts(false));
  }, [currentUser.id, currentUser.role]);

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
  const [showMgmtPassword, setShowMgmtPassword] = useState(false);
  const [showNewAccountPassword, setShowNewAccountPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Check if current user is allowed to manage other users
  const canManageUsers = ['SUPERADMIN', 'ADMIN'].includes(currentUser.role);

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
      // Por defecto, los managers no pueden editar datos sensibles de nadie.
      return false;
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
        credentials: 'include',
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
        credentials: 'include',
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
    }

    try {
      const response = await fetch(`/api/users/${selectedUser.id}`, {
        method: 'PUT',
        credentials: 'include',
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

  // Approve & Verify pending account (Admin / Superadmin)
  const handleApproveUser = async () => {
    if (!selectedUser) return;
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const response = await fetch(`/api/users/${selectedUser.id}/approve`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'No se pudo aprobar la cuenta.');
      }
      setMgmtActive(true);
      setSuccessMsg(`Cuenta de ${selectedUser.name} ${selectedUser.lastName} aprobada y verificada con éxito.`);
      await loadState();
      if (data.user) {
        setSelectedUser(data.user);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Toggles active state (Suspended / Active) for a user
  const handleToggleSuspension = async () => {
    if (!selectedUser) return;
    const newActiveState = !mgmtActive;
    const confirmMsg = newActiveState 
      ? `¿Está seguro de que desea reactivar la cuenta de ${selectedUser.name} ${selectedUser.lastName}?`
      : `¿Está seguro de que desea suspender la cuenta de ${selectedUser.name} ${selectedUser.lastName}? El usuario no podrá iniciar sesión en la plataforma.`;
    
    if (!window.confirm(confirmMsg)) return;

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const response = await fetch(`/api/users/${selectedUser.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentUserId: currentUser.id,
          active: newActiveState
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'No se pudo cambiar el estado de suspensión.');
      }

      setMgmtActive(newActiveState);
      setSuccessMsg(`Cuenta de ${selectedUser.name} ${selectedUser.lastName} ${newActiveState ? 'reactivada' : 'suspendida'} con éxito.`);
      await loadState();
      setSelectedUser(data);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Deletes user completely (Only Superadmin)
  const handleDeleteUser = async () => {
    if (!selectedUser) return;
    const confirmMsg = `¿Está seguro de que desea ELIMINAR DEFINITIVAMENTE al usuario ${selectedUser.name} ${selectedUser.lastName}? Esta acción eliminará permanentemente la cuenta de la base de datos de forma irrecuperable.`;
    
    if (!window.confirm(confirmMsg)) return;

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const response = await fetch(`/api/users/${selectedUser.id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentUserId: currentUser.id })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'No se pudo eliminar el usuario.');
      }

      setSuccessMsg(`Usuario ${selectedUser.name} ${selectedUser.lastName} eliminado definitivamente de la base de datos.`);
      setSelectedUser(null);
      await loadState();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  return { innerTab, setInnerTab, profileName, setProfileName, profileLastName, setProfileLastName, profilePhone, setProfilePhone, profileAddress, setProfileAddress, profileCity, setProfileCity, profileProvince, setProfileProvince, profileCountry, setProfileCountry, profilePassword, setProfilePassword, profileAvatar, setProfileAvatar, activeIndustry, setActiveIndustry, selectedUser, setSelectedUser, canCreateAccounts, setCanCreateAccounts, newAccount, setNewAccount, avatarPickerOpen, setAvatarPickerOpen, mgmtName, setMgmtName, mgmtLastName, setMgmtLastName, mgmtEmail, setMgmtEmail, mgmtPhone, setMgmtPhone, mgmtAddress, setMgmtAddress, mgmtCity, setMgmtCity, mgmtProvince, setMgmtProvince, mgmtCountry, setMgmtCountry, mgmtRole, setMgmtRole, mgmtActive, setMgmtActive, mgmtPassword, setMgmtPassword, showMgmtPassword, setShowMgmtPassword, showNewAccountPassword, setShowNewAccountPassword, loading, setLoading, successMsg, setSuccessMsg, errorMsg, setErrorMsg, canEditSensitiveOf, handleSaveProfile, handleChangeIndustry, handleSelectUser, handleSaveUserMgmt, handleApproveUser, handleToggleSuspension, handleDeleteUser, canManageUsers };
}
