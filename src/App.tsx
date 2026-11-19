import React from 'react';
import { useAppController } from './hooks/useAppController';
import AppViews from './components/AppViews';

/** Root composition; UI and business orchestration live in independent modules. */
export default function App() {
  const controller = useAppController();
  return <AppViews controller={controller} />;
}
