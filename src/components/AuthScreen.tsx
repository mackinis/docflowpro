import React, { useState, useEffect, useRef } from 'react';
import {
  Briefcase,
  Mail,
  Lock,
  MapPin,
  CheckCircle,
  AlertTriangle,
  Loader2,
  KeyRound,
  ShieldCheck,
  Clock,
  Eye,
  EyeOff
} from 'lucide-react';
import { User } from '../types';

declare global {
  interface Window {
    turnstile?: {
      render: (container: string | HTMLElement, options: Record<string, any>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

interface AuthScreenProps {
  onLoginSuccess: (user: User) => void | Promise<void>;
  needsSetup?: boolean;
  turnstileSiteKey?: string;
  turnstileEnabled?: boolean;
  publicRegistrationEnabled?: boolean;
}

type AuthMode = 'setup' | 'login' | 'register' | 'pending_approval' | 'recover' | 'reset';

export default function AuthScreen({
  onLoginSuccess,
  needsSetup = false,
  turnstileSiteKey = '',
  turnstileEnabled = false,
  publicRegistrationEnabled = true
}: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>(needsSetup ? 'setup' : 'login');

  useEffect(() => {
    if (needsSetup) {
      setMode('setup');
    }
  }, [needsSetup]);

  // Common login / recovery fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Registration & setup fields
  const [name, setName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('+54');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('');
  const [country, setCountry] = useState('Argentina');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Password reset fields
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  // Pending approval info
  const [pendingEmail, setPendingEmail] = useState('');

  // Cloudflare Turnstile state
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);

  // Statuses
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const modeNeedsTurnstile =
    Boolean(turnstileEnabled && turnstileSiteKey) &&
    ['setup', 'login', 'register', 'recover'].includes(mode);

  const resetTurnstile = () => {
    setTurnstileToken('');
    if (window.turnstile && turnstileWidgetIdRef.current) {
      try {
        window.turnstile.reset(turnstileWidgetIdRef.current);
      } catch {
        // ignore reset race
      }
    }
  };

  useEffect(() => {
    if (!modeNeedsTurnstile) {
      if (window.turnstile && turnstileWidgetIdRef.current) {
        try {
          window.turnstile.remove(turnstileWidgetIdRef.current);
        } catch {
          // ignore cleanup
        }
        turnstileWidgetIdRef.current = null;
      }
      return;
    }

    let cancelled = false;
    const mountWidget = () => {
      if (cancelled || !turnstileContainerRef.current || !window.turnstile) return;
      if (turnstileWidgetIdRef.current) {
        try {
          window.turnstile.remove(turnstileWidgetIdRef.current);
        } catch {
          // ignore cleanup
        }
        turnstileWidgetIdRef.current = null;
      }
      turnstileContainerRef.current.innerHTML = '';
      turnstileWidgetIdRef.current = window.turnstile.render(turnstileContainerRef.current, {
        sitekey: turnstileSiteKey,
        theme: 'light',
        callback: (token: string) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(''),
        'error-callback': () => setTurnstileToken('')
      });
    };

    if (window.turnstile) {
      mountWidget();
    } else {
      const existingScript = document.querySelector<HTMLScriptElement>(
        'script[src*="challenges.cloudflare.com/turnstile/v0/api.js"]'
      );
      if (existingScript) {
        existingScript.addEventListener('load', mountWidget, { once: true });
      } else {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.onload = mountWidget;
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      if (window.turnstile && turnstileWidgetIdRef.current) {
        try {
          window.turnstile.remove(turnstileWidgetIdRef.current);
        } catch {
          // ignore cleanup
        }
        turnstileWidgetIdRef.current = null;
      }
    };
  }, [mode, modeNeedsTurnstile, turnstileSiteKey]);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setErrorMsg(null);
    setSuccessMsg(null);
    setTurnstileToken('');
  };

  // Setup Initial Superadmin
  const handleSetupAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (password.length < 8) {
      setErrorMsg('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Las contraseñas no coinciden. Por favor, verifícalas.');
      return;
    }
    if (modeNeedsTurnstile && !turnstileToken) {
      setErrorMsg('Por favor completa la verificación de seguridad de Cloudflare Turnstile.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/setup-admin', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          lastName,
          email,
          phone,
          password,
          turnstileToken
        })
      });

      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || 'No se pudo configurar el Superadministrador inicial.');
      }

      if (data.success && data.user) {
        await onLoginSuccess(data.user);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
      resetTurnstile();
    } finally {
      setLoading(false);
    }
  };

  // Login handler
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (modeNeedsTurnstile && !turnstileToken) {
      setErrorMsg('Por favor completa la verificación de seguridad de Cloudflare Turnstile.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, turnstileToken })
      });

      const data = await response.json();
      if (!response.ok || data.error) {
        if (data.requiresAdminApproval) {
          setPendingEmail(data.email || email);
          setMode('pending_approval');
          setErrorMsg(data.error);
          return;
        }
        throw new Error(data.error || 'Credenciales inválidas.');
      }

      if (data.success && data.user) {
        await onLoginSuccess(data.user);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
      resetTurnstile();
    } finally {
      setLoading(false);
    }
  };

  // Register handler
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (password.length < 8) {
      setErrorMsg('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Las contraseñas no coinciden. Por favor, verifícalas.');
      return;
    }
    if (modeNeedsTurnstile && !turnstileToken) {
      setErrorMsg('Por favor completa la verificación de seguridad de Cloudflare Turnstile.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          lastName,
          email,
          phone,
          address,
          city,
          province,
          country,
          password,
          turnstileToken
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Error durante el registro.');
      }

      if (data.requiresAdminApproval) {
        setPendingEmail(data.email || email);
        setMode('pending_approval');
        setSuccessMsg(
          data.message ||
            'Registro completado. Un Administrador o Superadministrador debe aprobar tu cuenta en Perfiles de Usuarios.'
        );
      } else {
        setMode('login');
        setSuccessMsg(data.message || 'Registro completado. Ya puedes iniciar sesión con tus credenciales.');
        setPassword('');
        setConfirmPassword('');
      }
    } catch (err: any) {
      setErrorMsg(err.message);
      resetTurnstile();
    } finally {
      setLoading(false);
    }
  };

  // Password recovery request
  const handleRecoverPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (modeNeedsTurnstile && !turnstileToken) {
      setErrorMsg('Por favor completa la verificación de seguridad de Cloudflare Turnstile.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/recover-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, turnstileToken })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'No se pudo procesar la solicitud de recuperación.');
      }
      setSuccessMsg(
        data.message ||
          'Si el correo existe en la plataforma, un Administrador puede restablecer o verificar tu acceso desde Perfiles de Usuarios.'
      );
      resetTurnstile();
    } catch (err: any) {
      setErrorMsg(err.message);
      resetTurnstile();
    } finally {
      setLoading(false);
    }
  };

  // Password reset with token
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (newPassword.length < 8) {
      setErrorMsg('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setErrorMsg('Las contraseñas no coinciden.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, newPassword })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Token inválido o expirado.');
      }
      setMode('login');
      setSuccessMsg('Contraseña restablecida con éxito. Ya puedes iniciar sesión.');
      setResetToken('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-12 bg-slate-50 font-sans text-slate-800" id="auth-screen-root">
      {/* Gestor de Documentos-inspired brand panel; DocFlow auth behavior remains unchanged. */}
      <aside className="lg:col-span-5 bg-slate-950 text-white p-8 sm:p-12 flex flex-col items-center justify-center text-center relative overflow-hidden min-h-[300px] lg:min-h-screen">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black opacity-80" />
        <div className="relative z-10 space-y-4 max-w-sm sm:max-w-md mx-auto flex flex-col items-center justify-center">
          <div className="flex items-center gap-2.5 justify-center text-teal-400">
            <Briefcase className="h-6 w-6" />
            <span className="text-xs font-mono font-bold tracking-widest uppercase">DocFlow Pro</span>
          </div>
          <p className="text-xs font-mono uppercase tracking-[0.22em] text-teal-400">Gestión Documental</p>
          <h1 className="text-3xl sm:text-4xl font-display font-light tracking-tight mt-6 text-white leading-tight">
            Plataforma de Expedientes, Documentos y Procesos
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-sm mt-3">
            Inicie sesión o regístrese como Asesor de legajos para coordinar y verificar requisitos de forma fluida.
          </p>
        </div>
      </aside>
      <main className="lg:col-span-7 flex items-center justify-center p-6 md:p-12 min-w-0">
        <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden flex flex-col">
        {/* Dynamic content area */}
        <div className="p-8 flex-1 space-y-6">
          {successMsg && (
            <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-100 text-emerald-800 p-4 rounded-2xl text-xs" id="auth-success-alert">
              <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <p className="font-medium leading-relaxed">{successMsg}</p>
            </div>
          )}

          {errorMsg && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-100 text-red-800 p-4 rounded-2xl text-xs" id="auth-error-alert">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <p className="font-medium leading-relaxed">{errorMsg}</p>
            </div>
          )}

          {mode === 'setup' && (
            <form onSubmit={handleSetupAdmin} className="space-y-4" id="form-setup-admin">
              <div className="text-center space-y-1.5 pb-2">
                <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-full inline-block mx-auto border border-indigo-100">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h2 className="font-bold text-slate-800 text-lg">Configuración Inicial de Superadministrador</h2>
                <p className="text-xs text-slate-500">
                  Crea la primera cuenta maestra del sistema en Cloudflare D1. Este paso solo se ejecuta una vez.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Nombre</label>
                  <input
                    type="text"
                    required
                    placeholder="Nombre"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl"
                    id="setup-name"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Apellido</label>
                  <input
                    type="text"
                    required
                    placeholder="Apellido"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl"
                    id="setup-lastname"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Correo electrónico</label>
                  <input
                    type="email"
                    required
                    placeholder="superadmin@empresa.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl"
                    id="setup-email"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Teléfono</label>
                  <input
                    type="text"
                    placeholder="+54 11 5555-0000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl"
                    id="setup-phone"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Contraseña (mín. 8 caracteres)</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-3 pr-9 py-2 text-xs border border-slate-200 rounded-xl"
                      id="setup-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Confirmar contraseña</label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full pl-3 pr-9 py-2 text-xs border border-slate-200 rounded-xl"
                      id="setup-confirm-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showConfirmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              {modeNeedsTurnstile && (
                <div className="flex justify-center pt-1">
                  <div ref={turnstileContainerRef} />
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md disabled:opacity-50"
                id="btn-setup-submit"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Crear Superadministrador y Comenzar'}
              </button>
            </form>
          )}

          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4" id="form-login">
              <div className="text-center space-y-1 pb-2">
                <h2 className="font-bold text-slate-800 text-lg">Inicia sesión en tu cuenta</h2>
                <p className="text-xs text-slate-400">Ingresa tus credenciales registradas para continuar</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">Correo electrónico</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    required
                    placeholder="correo@ejemplo.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    id="login-email"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-semibold text-slate-600">Contraseña</label>
                  <button
                    type="button"
                    onClick={() => switchMode('recover')}
                    className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
                  <input
                    type={showLoginPassword ? 'text' : 'password'}
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-10 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    id="login-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword(!showLoginPassword)}
                    className="absolute right-3.5 top-3 text-slate-400 hover:text-slate-600 cursor-pointer"
                    title={showLoginPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {modeNeedsTurnstile && (
                <div className="flex justify-center pt-1">
                  <div ref={turnstileContainerRef} />
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-slate-900 hover:bg-indigo-600 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md disabled:opacity-50"
                id="btn-login-submit"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Ingresar al Portal'}
              </button>

              {publicRegistrationEnabled && (
              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => switchMode('register')}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
                >
                  ¿No tienes cuenta? Regístrate aquí
                </button>
              </div>
              )}
            </form>
          )}

          {mode === 'register' && publicRegistrationEnabled && (
            <form onSubmit={handleRegister} className="space-y-4" id="form-register">
              <div className="text-center space-y-1 pb-1">
                <h2 className="font-bold text-slate-800 text-lg">Crea tu cuenta de DocFlow</h2>
                <p className="text-xs text-slate-400">Completa tus datos para solicitar acceso como Asesor</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Nombre</label>
                  <input
                    type="text"
                    required
                    placeholder="Juan"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl"
                    id="register-name"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Apellido</label>
                  <input
                    type="text"
                    required
                    placeholder="Pérez"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl"
                    id="register-lastname"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Email corporativo</label>
                  <input
                    type="email"
                    required
                    placeholder="juan.perez@docflow.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl"
                    id="register-email"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Teléfono</label>
                  <input
                    type="text"
                    required
                    placeholder="+5491112345678"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl"
                    id="register-phone"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-600">Dirección Completa</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="text"
                    required
                    placeholder="Av. Corrientes 1234"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl"
                    id="register-address"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Ciudad</label>
                  <input
                    type="text"
                    required
                    placeholder="Rosario"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl"
                    id="register-city"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Provincia</label>
                  <input
                    type="text"
                    required
                    placeholder="Santa Fe"
                    value={province}
                    onChange={(e) => setProvince(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl"
                    id="register-province"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">País</label>
                  <input
                    type="text"
                    required
                    placeholder="Argentina"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl"
                    id="register-country"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Contraseña (mín. 8)</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-3 pr-9 py-2 text-xs border border-slate-200 rounded-xl"
                      id="register-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                      title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Confirmar</label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full pl-3 pr-9 py-2 text-xs border border-slate-200 rounded-xl"
                      id="register-confirm-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                      title={showConfirmPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    >
                      {showConfirmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              {modeNeedsTurnstile && (
                <div className="flex justify-center pt-1">
                  <div ref={turnstileContainerRef} />
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-slate-900 hover:bg-indigo-600 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md disabled:opacity-50"
                id="btn-register-submit"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Registrar'}
              </button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
                >
                  ¿Ya tienes cuenta? Inicia sesión aquí
                </button>
              </div>
            </form>
          )}

          {mode === 'pending_approval' && (
            <div className="space-y-5 text-center py-2" id="panel-pending-approval">
              <div className="p-3.5 bg-amber-50 text-amber-600 rounded-full inline-block mx-auto border border-amber-200">
                <Clock className="w-7 h-7" />
              </div>
              <div className="space-y-2">
                <h2 className="font-bold text-slate-800 text-lg">Cuenta Pendiente de Aprobación</h2>
                <p className="text-xs text-slate-600 max-w-sm mx-auto leading-relaxed">
                  Tu cuenta{pendingEmail ? ` (${pendingEmail})` : ''} fue registrada correctamente y está pendiente de activación por un Administrador o Superadministrador en <strong>Perfiles de Usuarios</strong>.
                </p>
                <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                  Una vez aprobada por el administrador de tu organización, podrás ingresar con tu correo y contraseña.
                </p>
              </div>
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="w-full py-3 bg-slate-900 hover:bg-indigo-600 text-white font-semibold rounded-xl text-xs transition-all cursor-pointer shadow-md"
                id="btn-pending-back-login"
              >
                Volver al Inicio de Sesión
              </button>
            </div>
          )}

          {mode === 'recover' && (
            <form onSubmit={handleRecoverPassword} className="space-y-4" id="form-recover">
              <div className="text-center space-y-1.5 pb-2">
                <div className="p-3 bg-indigo-50 text-indigo-600 rounded-full inline-block mx-auto border border-indigo-100">
                  <KeyRound className="w-6 h-6" />
                </div>
                <h2 className="font-bold text-slate-800 text-lg">Recuperar Acceso</h2>
                <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                  Registra una solicitud de recuperación para tu cuenta o solicita a un Administrador el restablecimiento desde Perfiles de Usuarios.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">Correo electrónico</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    required
                    placeholder="correo@ejemplo.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    id="recover-email"
                  />
                </div>
              </div>

              {modeNeedsTurnstile && (
                <div className="flex justify-center pt-1">
                  <div ref={turnstileContainerRef} />
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-slate-900 hover:bg-indigo-600 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md disabled:opacity-50"
                id="btn-recover-submit"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Registrar Solicitud de Recuperación'}
              </button>

              <div className="border-t border-slate-100 pt-3 flex justify-between items-center text-xs">
                <button
                  type="button"
                  onClick={() => switchMode('reset')}
                  className="text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer"
                >
                  ¿Ya tienes un token? Restablecer clave
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="text-slate-500 hover:text-slate-700 font-medium cursor-pointer"
                >
                  Volver
                </button>
              </div>
            </form>
          )}

          {mode === 'reset' && (
            <form onSubmit={handleResetPassword} className="space-y-4" id="form-reset-password">
              <div className="text-center space-y-1.5 pb-2">
                <h2 className="font-bold text-slate-800 text-lg">Restablecer Contraseña</h2>
                <p className="text-xs text-slate-500">Ingresa tu token de recuperación y una nueva contraseña segura.</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">Token de recuperación</label>
                <input
                  type="text"
                  required
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  placeholder="Pega tu token aquí"
                  className="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-200 rounded-xl"
                  id="reset-token"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Nueva contraseña</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl"
                    id="reset-new-password"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Confirmar contraseña</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl"
                    id="reset-confirm-password"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md disabled:opacity-50"
                id="btn-reset-submit"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Guardar Nueva Contraseña'}
              </button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="text-xs text-slate-500 hover:text-slate-700 font-medium cursor-pointer"
                >
                  Volver al inicio de sesión
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
