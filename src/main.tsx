import React, { useEffect, useState } from 'react';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

function DatabaseStartupGate() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const response = await fetch('/api/health', { credentials: 'include', cache: 'no-store' });
        if (response.ok) {
          const status = await response.json();
          if (!cancelled && (status.status === 'ok' || status.ok === true)) {
            setReady(true);
            return;
          }
        }
      } catch (error) {
        console.warn('Waiting for backend database initialization', error);
      }
      if (!cancelled) timeout = setTimeout(check, 5000);
    };
    void check();
    return () => { cancelled = true; if (timeout) clearTimeout(timeout); };
  }, []);
  if (!ready) return (
    <div role="status" aria-live="polite" style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f7f8fb',color:'#18233d',fontFamily:'system-ui, sans-serif',padding:24,textAlign:'center'}}>
      <div><div style={{fontSize:28,marginBottom:16}}>⏳</div><p>Estamos trabajando en la base de datos. Aguarde a que termine.</p></div>
    </div>
  );
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DatabaseStartupGate />
  </StrictMode>,
);
