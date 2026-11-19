import React from 'react';
import { AlertCircle, Layers, Loader2, Menu, Moon, Sun } from 'lucide-react';

/** Presentation only: the parent owns navigation, theme and retry behavior. */
export function WorkspaceHeader({ activeTab, activeCaseId, darkMode, onOpenMenu, onToggleTheme }: {
  activeTab: string;
  activeCaseId: string | null;
  darkMode: boolean;
  onOpenMenu: () => void;
  onToggleTheme: () => void;
}) {
  return (
        <header className="h-14 bg-white border-b border-slate-200/80 px-4 sm:px-8 flex items-center justify-between shrink-0 select-none">
          <div className="flex items-center gap-3">
            {/* Hamburger Button for mobile/tablets (< lg) */}
            <button 
              onClick={onOpenMenu}
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
            <button
              onClick={onToggleTheme}
              className="ml-1 p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors cursor-pointer"
              title={darkMode ? "Modo Claro" : "Modo Oscuro"}
              aria-label={darkMode ? "Modo Claro" : "Modo Oscuro"}
              id="btn-theme-toggle"
            >
              {darkMode ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>
  );
}

export function AppLoadingScreen() {
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

export function AppConnectionError({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 p-6">
        <div className="bg-white p-8 rounded-2xl border border-red-100 shadow-xl max-w-md text-center space-y-4">
          <AlertCircle className="w-14 h-14 text-red-500 mx-auto" />
          <h2 className="text-xl font-bold text-slate-800">Error de Conexión</h2>
          <p className="text-sm text-slate-500">
            {error || 'No se pudo recuperar la información inicial. Compruebe la conexión e intente nuevamente.'}
          </p>
          <button 
            onClick={onRetry} 
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-xs"
          >
            Reintentar Conexión
          </button>
        </div>
      </div>
  );
}
