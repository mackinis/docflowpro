import React, { StrictMode, useEffect, useState } from 'react';
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
    <div role="status" aria-live="polite" style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'linear-gradient(145deg,#f5f7fc,#edf3fa)',color:'#14233d',fontFamily:'system-ui, sans-serif',padding:24,textAlign:'center'}}>
      <style>{`@keyframes database-pulse {0%,100%{opacity:.55;transform:scale(.92)}50%{opacity:1;transform:scale(1.08)}} @keyframes database-spin {to{transform:rotate(360deg)}}`}</style>
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:18,maxWidth:440}}>
        <div style={{width:74,height:74,borderRadius:24,background:'#e3eafa',display:'grid',placeItems:'center',position:'relative',boxShadow:'0 12px 35px rgba(32,65,120,.09)'}}>
          <svg width="40" height="40" viewBox="0 0 48 48" fill="none" aria-hidden="true" style={{animation:'database-pulse 2.2s ease-in-out infinite'}}>
            <ellipse cx="24" cy="10" rx="15" ry="6" fill="#4865df"/>
            <path d="M9 10v10c0 3.3 6.7 6 15 6s15-2.7 15-6V10" fill="#6982ef"/>
            <path d="M9 20v10c0 3.3 6.7 6 15 6s15-2.7 15-6V20" fill="#4865df"/>
            <path d="M9 30v8c0 3.3 6.7 6 15 6s15-2.7 15-6v-8" fill="#314ec8"/>
            <ellipse cx="24" cy="30" rx="15" ry="6" fill="#6982ef"/>
            <path d="M9 30v8c0 3.3 6.7 6 15 6s15-2.7 15-6v-8" fill="#314ec8"/>
          </svg>
          <div style={{position:'absolute',right:-5,bottom:-5,width:23,height:23,border:'3px solid #dbe4fa',borderTopColor:'#4865df',borderRadius:'50%',animation:'database-spin 1.1s linear infinite'}} />
        </div>
        <div style={{fontSize:19,fontWeight:650,letterSpacing:'-.02em'}}>Preparando la base de datos</div>
        <p style={{fontSize:14,lineHeight:1.65,margin:0,color:'#52627d'}}>Estamos trabajando en la base de datos. Aguarde a que termine.</p>
      </div>
    </div>
  );
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DatabaseStartupGate />
  </StrictMode>,
);
