'use client';

import { Moon, Sun } from 'lucide-react';
import { useThemeMode } from '@/components/useThemeMode';

export default function ThemeToggle() {
  const [mode, setMode] = useThemeMode();
  const next = mode === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={() => setMode(next)}
      className="inline-flex items-center justify-center w-9 h-9 rounded-full border transition-colors pointer-events-auto"
      style={{
        borderColor: 'var(--border)',
        color: 'var(--text-secondary)',
        background: 'var(--bg-hover)',
      }}
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
    >
      {mode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
