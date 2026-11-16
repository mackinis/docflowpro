import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// App owns the complete startup lifecycle (session, backend and initial state).
// Do not introduce a second loading gate here: it causes consecutive splash screens.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
