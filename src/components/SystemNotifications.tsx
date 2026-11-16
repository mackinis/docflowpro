import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

// Single branded notification surface for legacy window.alert calls.
export default function SystemNotifications() {
  const [queue, setQueue] = useState<string[]>([]);
  useEffect(() => {
    const original = window.alert;
    window.alert = (message?: any) => {
      window.dispatchEvent(new CustomEvent('docflow:notice', { detail: String(message ?? '') }));
    };
    const onNotice = (event: Event) => setQueue(items => [...items, (event as CustomEvent<string>).detail]);
    window.addEventListener('docflow:notice', onNotice);
    return () => { window.alert = original; window.removeEventListener('docflow:notice', onNotice); };
  }, []);
  const message = queue[0];
  if (!message) return null;
  const isError = /error|fall[oóa]|no se pudo|inv[aá]lid|denegad|faltan|falta |obligatori/i.test(message);
  const Icon = isError ? AlertCircle : CheckCircle2;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/65 backdrop-blur-sm px-4" role="presentation">
      <section role="alertdialog" aria-modal="true" aria-labelledby="system-notice-title" aria-describedby="system-notice-description"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-600 bg-slate-900 text-slate-100 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
          <Icon className={`h-5 w-5 shrink-0 ${isError ? 'text-rose-400' : 'text-emerald-400'}`} />
          <h2 id="system-notice-title" className="flex-1 text-sm font-bold">{isError ? 'No se pudo completar la operación' : 'Notificación del sistema'}</h2>
          <button type="button" aria-label="Cerrar notificación" onClick={() => setQueue(items => items.slice(1))} className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-700"><X size={18} /></button>
        </div>
        <p id="system-notice-description" className="whitespace-pre-wrap break-words px-5 py-5 text-sm leading-6 text-slate-200">{message}</p>
        <div className="flex justify-end border-t border-slate-700 px-5 py-3">
          <button autoFocus type="button" onClick={() => setQueue(items => items.slice(1))}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300">Entendido</button>
        </div>
      </section>
    </div>
  );
}
