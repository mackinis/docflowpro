import React, { useState } from 'react';
import { 
  Briefcase, 
  Mail, 
  Lock, 
  User as UserIcon, 
  Phone, 
  MapPin, 
  CheckCircle, 
  AlertTriangle, 
  Loader2,
  KeyRound,
  RefreshCw,
  Compass,
  Eye,
  EyeOff
} from 'lucide-react';
import { User } from '../types';

interface AuthScreenProps {
  onLoginSuccess: (user: User) => void;
}

export default function AuthScreen({ onLoginSuccess }: AuthScreenProps) {
  // Modes: 'login', 'register', 'verify'
  const [mode, setMode] = useState<'login' | 'register' | 'verify'>('login');
  
  // Form fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  
  // Registration fields
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

  // Verification code field
  const [verifyEmail, setVerifyEmail] = useState('');
  const [token, setToken] = useState('');

  // Development helpers for simulator mode
  const [debugToken, setDebugToken] = useState<string | null>(null);
  const [appliedPolicy, setAppliedPolicy] = useState<'email' | 'sms' | 'both' | null>(null);

  // Statuses
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Login handler
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();
      if (!response.ok || data.error) {
        if (data.requiresVerification) {
          setVerifyEmail(data.email);
          setMode('verify');
          if (data.verificationToken) {
            setDebugToken(data.verificationToken);
          }
          if (data.verificationPolicy) {
            setAppliedPolicy(data.verificationPolicy);
          }
          setErrorMsg(data.error);
          return;
        }
        throw new Error(data.error || 'Credenciales inválidas.');
      }

      if (data.success && data.user) {
        onLoginSuccess(data.user);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Register handler
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    if (password !== confirmPassword) {
      setErrorMsg('Las contraseñas no coinciden. Por favor, verifícalas.');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
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
          role: 'ASESOR'
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Error durante el registro.');
      }

      setVerifyEmail(data.email);
      setMode('verify');
      if (data.verificationToken) {
        setDebugToken(data.verificationToken);
      }
      if (data.verificationPolicy) {
        setAppliedPolicy(data.verificationPolicy);
      }

      let methodMsg = 'su correo electrónico';
      if (data.verificationPolicy === 'sms') {
        methodMsg = 'su teléfono celular vía SMS';
      } else if (data.verificationPolicy === 'both') {
        methodMsg = 'su correo electrónico y celular vía SMS';
      }

      setSuccessMsg(`¡Registro exitoso! Se ha enviado un token de verificación de 6 dígitos a ${methodMsg}.`);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Verification handler
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: verifyEmail, token })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Token de verificación incorrecto.');
      }

      if (data.success && data.user) {
        setSuccessMsg('¡Cuenta verificada exitosamente! Iniciando sesión...');
        setTimeout(() => {
          onLoginSuccess(data.user);
        }, 1500);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Resend code handler
  const handleResendToken = async () => {
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const response = await fetch('/api/auth/resend-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: verifyEmail || email })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Error al reenviar el código.');
      }

      setSuccessMsg(data.message || 'Código de verificación reenviado.');
      if (data.verificationToken) {
        setDebugToken(data.verificationToken);
      }
      if (data.verificationPolicy) {
        setAppliedPolicy(data.verificationPolicy);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen flex items-center justify-center bg-slate-50 p-6 font-sans select-none" id="auth-screen-root">
      <div className="w-full max-w-lg bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden flex flex-col">
        {/* Upper Brand panel */}
        <div className="p-8 bg-slate-900 text-white text-center space-y-3 relative overflow-hidden">
          {/* Subtle decorations */}
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/10 rounded-full blur-xl"></div>
          <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-indigo-600/10 rounded-full blur-xl"></div>
          
          <div className="p-3.5 bg-indigo-600 rounded-2xl inline-block mx-auto text-white shadow-lg shadow-indigo-500/20">
            <Briefcase className="w-7 h-7" />
          </div>
          <div>
            <h1 className="font-display font-bold text-2xl tracking-tight bg-gradient-to-r from-white via-slate-100 to-indigo-200 bg-clip-text text-transparent">
              DocFlow Pro
            </h1>
            <p className="text-[10px] font-mono text-slate-400 tracking-widest uppercase mt-0.5">DocFlow Pro / Gestión Documental</p>
          </div>
        </div>

        {/* Dynamic content area */}
        <div className="p-8 flex-1 space-y-6">
          
          {/* Messages */}
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
                </div>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
                  <input
                    type={showLoginPassword ? "text" : "password"}
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
                    title={showLoginPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-slate-900 hover:bg-indigo-600 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md disabled:opacity-50"
                id="btn-login-submit"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Ingresar al Portal'}
              </button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => { setMode('register'); setErrorMsg(null); setSuccessMsg(null); }}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
                >
                  ¿No tienes cuenta? Regístrate aquí
                </button>
              </div>
            </form>
          )}

          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4" id="form-register">
              <div className="text-center space-y-1 pb-1">
                <h2 className="font-bold text-slate-800 text-lg">Crea tu cuenta de DocFlow</h2>
                <p className="text-xs text-slate-400">Completa todos tus datos de contacto y selecciona tu rol</p>
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
                    placeholder="Calle Falsa 123"
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
                  <label className="text-[11px] font-semibold text-slate-600">Contraseña</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      required
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
                      title={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Confirmar</label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      required
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
                      title={showConfirmPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    >
                      {showConfirmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

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
                  onClick={() => { setMode('login'); setErrorMsg(null); setSuccessMsg(null); }}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
                >
                  ¿Ya tienes cuenta? Inicia sesión aquí
                </button>
              </div>
            </form>
          )}

          {mode === 'verify' && (
            <form onSubmit={handleVerify} className="space-y-4" id="form-verify">
              <div className="text-center space-y-1.5 pb-2">
                <div className="p-3 bg-amber-50 text-amber-600 rounded-full inline-block mx-auto border border-amber-200">
                  <KeyRound className="w-6 h-6" />
                </div>
                <h2 className="font-bold text-slate-800 text-lg">
                  {appliedPolicy === 'sms' ? 'Verifica tu número de teléfono' :
                   appliedPolicy === 'both' ? 'Verificación de Seguridad Doble' :
                   'Verifica tu correo electrónico'}
                </h2>
                <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                  {appliedPolicy === 'sms' ? (
                    <>Hemos enviado un código SMS de verificación a su teléfono registrado. Completa el código para activar tu acceso.</>
                  ) : appliedPolicy === 'both' ? (
                    <>Hemos enviado un código de verificación a su correo electrónico y por SMS a su teléfono. Completa el código para activar tu acceso.</>
                  ) : (
                    <>Hemos enviado un código alfanumérico a <strong>{verifyEmail}</strong>. Completa el código para activar tu acceso.</>
                  )}
                </p>
              </div>

              {/* Dev Simulator Token Banner */}
              {debugToken && (
                <div className="bg-indigo-50 border border-indigo-100 p-3.5 rounded-2xl text-center space-y-1" id="dev-sim-banner">
                  <span className="text-[10px] font-mono font-bold text-indigo-500 uppercase tracking-widest block">Simulador de Entorno</span>
                  <p className="text-xs text-indigo-900 leading-normal">
                    Código de verificación en base de datos: <span className="font-mono font-bold text-sm bg-indigo-150 px-2 py-0.5 rounded text-indigo-700 select-all">{debugToken}</span>
                  </p>
                  <p className="text-[9px] text-indigo-400">
                    Método requerido por política Superadmin: <strong className="uppercase">{appliedPolicy || 'email'}</strong>
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">Código de Verificación</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: AB12CD"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="w-full px-4 py-2.5 text-center font-mono font-bold text-lg tracking-widest border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 uppercase"
                  maxLength={10}
                  id="verify-token"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-slate-900 hover:bg-indigo-600 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md disabled:opacity-50"
                id="btn-verify-submit"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verificar y Activar Cuenta'}
              </button>

              <div className="border-t border-slate-100 pt-3 flex flex-col md:flex-row justify-between items-center gap-2">
                <button
                  type="button"
                  onClick={handleResendToken}
                  disabled={loading}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Reenviar código de verificación
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('login'); setErrorMsg(null); setSuccessMsg(null); }}
                  className="text-xs text-slate-500 hover:text-slate-700 font-medium"
                >
                  Volver al inicio de sesión
                </button>
              </div>
            </form>
          )}

        </div>
      </div>
    </div>
  );
}
