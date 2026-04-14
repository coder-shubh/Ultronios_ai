'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useThemeMode } from '@/components/useThemeMode';

const LandingWebGL = dynamic(() => import('./LandingWebGL'), {
  ssr: false,
  loading: () => <CssStarFallback />,
});

const LandingWebGLSunny = dynamic(() => import('./LandingWebGLSunny'), {
  ssr: false,
  loading: () => <CssSunnyFallback />,
});

function CssStarFallback() {
  return (
    <div
      className="landing-stars pointer-events-none absolute inset-0 z-[5] h-full min-h-[100dvh] overflow-hidden"
      aria-hidden
    >
      <div className="landing-starfield" />
      <div className="landing-sparkles" />
    </div>
  );
}

function CssSunnyFallback() {
  return (
    <div
      className="landing-sunny-canvas-fallback pointer-events-none absolute inset-0 z-[5] h-full min-h-[100dvh] overflow-hidden"
      aria-hidden
    >
      <div className="landing-sunny-glow" />
      <div className="landing-sunny-rays" />
    </div>
  );
}

/**
 * Dark: galaxy stars · Light: sunny Three.js scene. Respects `prefers-reduced-motion`.
 */
export default function LandingWebGLLoader() {
  const [mode] = useThemeMode();
  const [preferReduced, setPreferReduced] = useState<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setPreferReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  if (preferReduced === null) {
    return mode === 'light' ? <CssSunnyFallback /> : <CssStarFallback />;
  }

  if (preferReduced) {
    return mode === 'light' ? <CssSunnyFallback /> : <CssStarFallback />;
  }

  if (mode === 'light') {
    return <LandingWebGLSunny />;
  }

  return <LandingWebGL />;
}
