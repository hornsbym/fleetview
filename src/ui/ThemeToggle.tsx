import { useCallback, useEffect, useState } from 'react';

type Theme = 'auto' | 'light' | 'dark';
const STORAGE_KEY = 'fleetview-theme';

function applyTheme(theme: Theme) {
  if (theme === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

function getStored(): Theme {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' ? v : 'auto';
}

export function initTheme() {
  applyTheme(getStored());
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getStored);

  useEffect(() => {
    applyTheme(theme);
    if (theme === 'auto') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => applyTheme('auto');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const cycle = useCallback(() => {
    setTheme(t => t === 'auto' ? 'light' : t === 'light' ? 'dark' : 'auto');
  }, []);

  const label = theme === 'auto' ? '◐ Auto' : theme === 'light' ? '☀ Light' : '☾ Dark';

  return (
    <button type="button" className="theme-toggle" onClick={cycle} title={`Theme: ${theme}`}>
      {label}
    </button>
  );
}
