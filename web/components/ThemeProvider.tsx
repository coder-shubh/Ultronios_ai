'use client';

import { useEffect, useState } from 'react';
import { applyTheme, getStoredTheme } from '@/lib/theme';

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    applyTheme(getStoredTheme());
    setReady(true);
  }, []);

  if (!ready) {
    return <>{children}</>;
  }
  return <>{children}</>;
}
