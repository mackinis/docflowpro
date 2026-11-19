import { useEffect, useState } from 'react';

/** Persist the visual theme independently from the app's business state. */
export function useAppTheme() {
  const [darkMode, setDarkMode] = useState(() => sessionStorage.getItem('docflow_theme') === 'dark');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    sessionStorage.setItem('docflow_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);
  return { darkMode, toggleTheme: () => setDarkMode(value => !value) };
}
