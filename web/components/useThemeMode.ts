'use client';

import { useEffect, useState } from 'react';
import { applyTheme, getStoredTheme, setStoredTheme, type ThemeMode } from '@/lib/theme';

function readThemeFromDom(): ThemeMode {
  if (typeof document === 'undefined') return 'dark';
  const t = document.documentElement.getAttribute('data-theme');
  return t === 'light' ? 'light' : 'dark';
}

export function useThemeMode(): [ThemeMode, (m: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(() =>
    typeof window !== 'undefined' ? readThemeFromDom() : 'dark',
  );

  useEffect(() => {
    setMode(readThemeFromDom());
    const obs = new MutationObserver(() => {
      setMode(readThemeFromDom());
    });
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => obs.disconnect();
  }, []);

  const set = (m: ThemeMode) => {
    setMode(m);
    applyTheme(m);
    setStoredTheme(m);
  };

  return [mode, set];
}
