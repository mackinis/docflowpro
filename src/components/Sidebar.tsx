import React, { useState, useEffect } from 'react';
import { 
  Briefcase, 
  LayoutDashboard, 
  FileText, 
  FolderKanban, 
  ShieldAlert, 
  Bell, 
  User as UserIcon, 
  Check, 
  ChevronDown, 
  LogOut,
  Sun,
  Moon,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Settings as SettingsIcon,
  Mail
} from 'lucide-react';
import { User, Notification } from '../types';

interface SidebarProps {
  currentUser: User;
  users: User[];
  onUserChange: (user: User) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  notifications: Notification[];
  unreadMessagesCount: number;
  onMarkNotificationRead: (id: string) => void;
  onDeleteNotification: (id: string) => void;
  onMarkAllNotificationsRead: () => void;
  onOpenCase: (caseId: string) => void;
  tabOrder?: string[];
  realUser?: User | null;
}

export default function Sidebar({
  currentUser,
  users,
  onUserChange,
  activeTab,
  setActiveTab,
  notifications,
  unreadMessagesCount,
  onMarkNotificationRead,
  onDeleteNotification,
  onMarkAllNotificationsRead,
  onOpenCase,
  tabOrder,
  realUser
}: SidebarProps) {
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  
  // Theme state initialized from localStorage
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('docflow_theme');
    return saved === 'dark';
  });

  // Sidebar collapse state initialized from localStorage
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem('docflow_sidebar_collapsed');
    return saved === 'true';
  });

  // Persist sidebar collapsed state
  useEffect(() => {
    localStorage.setItem('docflow_sidebar_collapsed', String(isCollapsed));
  }, [isCollapsed]);

  // Sync dark mode preference with HTML element class & localStorage
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('docflow_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('docflow_theme', 'light');
    }
  }, [darkMode]);

  // Toggle theme
  const toggleTheme = () => {
    setDarkMode(!darkMode);
  };

  const userNotifications = notifications.filter(n => n.userId === currentUser.id);
  const unreadCount = userNotifications.filter(n => !n.read).length;

  const menuItems = [
    { id: 'dashboard', label: 'Tablero Principal', icon: LayoutDashboard, roles: ['SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR'] },
    { id: 'cases', label: 'Expedientes', icon: FileText, roles: ['SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR'] },
    { id: 'templates', label: 'Plantillas de Procesos', icon: FolderKanban, roles: ['SUPERADMIN', 'ADMIN', 'MANAGER'] },
    { id: 'profile', label: 'Perfiles de usuarios', icon: UserIcon, roles: ['SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR'] },
    { id: 'messages', label: 'Mensajes', icon: Mail, roles: ['SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR'] },
    { id: 'notifications', label: 'Notificaciones', icon: Bell, roles: ['SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR'] },
    { id: 'settings', label: 'Configuración', icon: SettingsIcon, roles: ['SUPERADMIN', 'ADMIN'] },
    { id: 'audit', label: 'Auditoría', icon: ShieldAlert, roles: ['SUPERADMIN', 'ADMIN'] },
  ];

  const sortedMenuItems = [...menuItems];
  if (tabOrder && Array.isArray(tabOrder) && tabOrder.length > 0) {
    sortedMenuItems.sort((a, b) => {
      const idxA = tabOrder.indexOf(a.id);
      const idxB = tabOrder.indexOf(b.id);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return 0;
    });
  }

  const allowedMenuItems = sortedMenuItems.filter(item => item.roles.includes(currentUser.role));

  const handleNotificationClick = (n: Notification) => {
    onMarkNotificationRead(n.id);
    if (n.caseId) {
      onOpenCase(n.caseId);
    }
    setShowNotifications(false);
  };

  return (
    <aside className={`relative ${isCollapsed ? 'w-20' : 'w-64'} bg-slate-900 text-slate-100 flex flex-col h-screen border-r border-slate-800 shrink-0 select-none transition-all duration-300 z-40`}>
      {/* Brand Header */}
      <div className={`p-4 ${isCollapsed ? 'justify-center' : 'p-6 justify-between'} border-b border-slate-800 flex items-center relative min-h-[77px]`}>
        <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-2.5'}`}>
          <div className="p-2 bg-indigo-600 rounded-lg text-white shadow-md shadow-indigo-500/20 shrink-0">
            <Briefcase className="w-5.5 h-5.5" />
          </div>
          {!isCollapsed && (
            <div>
              <h1 className="font-display font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-indigo-300 bg-clip-text text-transparent">
                DocFlow Pro
              </h1>
              <p className="text-[10px] font-mono text-slate-400 tracking-wider uppercase">Gestión Documental</p>
            </div>
          )}
        </div>
        
        {/* Toggle Collapse Button on Sidebar Edge */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="absolute top-1/2 -translate-y-1/2 -right-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 p-1 rounded-full shadow-lg z-50 transition-all hover:scale-110 active:scale-95 cursor-pointer flex items-center justify-center"
          title={isCollapsed ? "Expandir menú" : "Colapsar menú"}
        >
          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Active User Switcher / Simulator Panel */}
      <div className={`p-2 ${isCollapsed ? 'py-4' : 'p-4'} border-b border-slate-800 relative flex flex-col items-center`}>
        {!isCollapsed && (
          <p className="text-[10px] font-mono text-indigo-400 uppercase tracking-widest mb-1.5 px-2 self-start">
            {(realUser?.role === 'SUPERADMIN' || currentUser.role === 'SUPERADMIN') ? 'Simulador de Rol' : 'Nombre y Rol'}
          </p>
        )}

        {(realUser?.role === 'SUPERADMIN' || currentUser.role === 'SUPERADMIN') ? (
          <button
            onClick={() => setShowUserDropdown(!showUserDropdown)}
            className={`flex items-center ${isCollapsed ? 'justify-center p-1 bg-transparent border-0' : 'w-full justify-between p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700/80 border border-slate-700/40'} transition-all text-left group cursor-pointer`}
            title={isCollapsed ? `Simulador de Rol: ${currentUser.name} (${currentUser.role})` : undefined}
          >
            <div className="flex items-center gap-3">
              <img 
                src={currentUser.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100"} 
                alt={currentUser.name} 
                className="w-9 h-9 rounded-full object-cover border border-indigo-500/30 shrink-0"
                referrerPolicy="no-referrer"
              />
              {!isCollapsed && (
                <div className="overflow-hidden">
                  <h2 className="text-sm font-medium leading-none truncate group-hover:text-indigo-300 transition-colors">
                    {currentUser.name} {currentUser.lastName}
                  </h2>
                  <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold tracking-wider uppercase ${
                    currentUser.role === 'SUPERADMIN' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                    currentUser.role === 'ADMIN' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                    currentUser.role === 'MANAGER' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                    'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  }`}>
                    {currentUser.role}
                  </span>
                </div>
              )}
            </div>
            {!isCollapsed && <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showUserDropdown ? 'rotate-180' : ''}`} />}
          </button>
        ) : (
          <div
            className={`flex items-center ${isCollapsed ? 'justify-center p-1 bg-transparent border-0' : 'w-full p-2.5 rounded-lg bg-slate-800/40 border border-slate-700/20'} transition-all text-left`}
            title={isCollapsed ? `${currentUser.name} (${currentUser.role})` : undefined}
          >
            <div className="flex items-center gap-3">
              <img 
                src={currentUser.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100"} 
                alt={currentUser.name} 
                className="w-9 h-9 rounded-full object-cover border border-indigo-500/30 shrink-0"
                referrerPolicy="no-referrer"
              />
              {!isCollapsed && (
                <div className="overflow-hidden">
                  <h2 className="text-sm font-medium leading-none text-slate-200 truncate">
                    {currentUser.name} {currentUser.lastName}
                  </h2>
                  <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold tracking-wider uppercase ${
                    currentUser.role === 'ADMIN' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                    currentUser.role === 'MANAGER' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                    'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  }`}>
                    {currentUser.role}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {(realUser?.role === 'SUPERADMIN' || currentUser.role === 'SUPERADMIN') && showUserDropdown && (
          <div className={`absolute ${isCollapsed ? 'left-16 w-52 top-2' : 'left-4 right-4 mt-2'} bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden divide-y divide-slate-700/50`}>
            {users.map((u) => (
              <button
                key={u.id}
                onClick={() => {
                  onUserChange(u);
                  setShowUserDropdown(false);
                }}
                className={`w-full flex items-center justify-between p-2.5 text-left hover:bg-slate-700 transition-colors cursor-pointer ${
                  u.id === currentUser.id ? 'bg-slate-700/40 text-indigo-300' : 'text-slate-300'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <img src={u.avatar} alt={u.name} className="w-8 h-8 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
                  <div>
                    <p className="text-xs font-semibold leading-tight">{u.name} {u.lastName}</p>
                    <p className="text-[10px] text-slate-400 font-mono">{u.role}</p>
                  </div>
                </div>
                {u.id === currentUser.id && <Check className="w-4 h-4 text-indigo-400" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main Navigation links - scrolling with hidden scrollbar */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-none">
        {allowedMenuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center ${isCollapsed ? 'justify-center px-2' : 'gap-3.5 px-4'} py-3 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer ${
                isActive 
                  ? 'bg-indigo-600/10 text-indigo-400 border-l-4 border-indigo-500 font-semibold' 
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
              }`}
              title={isCollapsed ? item.label : undefined}
            >
              <div className="relative shrink-0 flex items-center justify-center">
                <Icon className={`w-5 h-5 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                {item.id === 'notifications' && unreadCount > 0 && isCollapsed && (
                  <span className="absolute -top-1 -right-1 flex h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                )}
                {item.id === 'messages' && unreadMessagesCount > 0 && isCollapsed && (
                  <span className="absolute -top-1 -right-1 flex h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
                )}
              </div>
              {!isCollapsed && (
                <div className="flex-1 flex items-center justify-between ml-3.5 text-left">
                  <span>{item.label}</span>
                  {item.id === 'notifications' && unreadCount > 0 && (
                    <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full animate-pulse">
                      {unreadCount}
                    </span>
                  )}
                  {item.id === 'messages' && unreadMessagesCount > 0 && (
                    <span className="bg-indigo-600 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full animate-pulse">
                      {unreadMessagesCount}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </nav>

      {/* Sidebar Footer with actions */}
      <div className={`p-4 border-t border-slate-800 ${isCollapsed ? 'space-y-4' : 'space-y-3.5'} bg-slate-950/40`}>
        {/* System Settings/Display controls */}
        <div className="space-y-2">
          <button
            onClick={() => {
              localStorage.removeItem('docflow_user');
              window.location.reload();
            }}
            className={`w-full flex items-center justify-center ${isCollapsed ? 'p-2.5' : 'gap-2 py-2 px-3'} rounded-lg text-xs font-semibold bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white transition-all border border-red-500/10 cursor-pointer`}
            title={isCollapsed ? "Cerrar Sesión" : undefined}
            id="btn-logout"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            {!isCollapsed && "Cerrar Sesión"}
          </button>
          
          <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} pt-1`}>
            {!isCollapsed && <span className="text-[11px] text-slate-500 font-mono">v1.2.0 (PWA)</span>}
            <button 
              onClick={toggleTheme} 
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors shrink-0 cursor-pointer"
              title={darkMode ? "Modo Claro" : "Modo Oscuro"}
              id="btn-theme-toggle"
            >
              {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
