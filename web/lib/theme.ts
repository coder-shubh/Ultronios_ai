export type ThemeMode = 'dark' | 'light';

const KEY = 'invia_forge_theme';

export function getStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  const v = localStorage.getItem(KEY);
  return v === 'light' ? 'light' : 'dark';
}

export function setStoredTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* ignore */
  }
}

export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', mode);
}
