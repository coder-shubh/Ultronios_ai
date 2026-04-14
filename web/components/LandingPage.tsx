'use client';

import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import LandingWebGLLoader from '@/components/landing/LandingWebGLLoader';

/**
 * Landing: night galaxy (dark) · sunny sky + sun WebGL (light).
 */
export default function LandingPage() {
  return (
    <div className="landing-root relative min-h-screen w-full overflow-hidden">
      <div className="landing-bg" aria-hidden />
      <div className="landing-orb landing-orb-a" aria-hidden />
      <div className="landing-orb landing-orb-b" aria-hidden />

      <LandingWebGLLoader />

      <div className="landing-vignette pointer-events-none" aria-hidden />

      <header className="relative z-20 flex items-center justify-between px-6 py-5 md:px-10">
        <span className="landing-brand text-sm font-semibold tracking-tight drop-shadow-md">
          Ultronios
        </span>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/dashboard"
            className="landing-nav-link text-sm font-medium px-4 py-2 rounded-full pointer-events-auto border transition-colors"
          >
            Dashboard
          </Link>
          <ThemeToggle />
          <Link
            href="/chat"
            className="landing-cta-primary text-sm font-medium px-5 py-2.5 rounded-full pointer-events-auto"
          >
            Open chat
          </Link>
        </div>
      </header>

      <main className="relative z-20 flex flex-col items-center justify-center px-6 pb-24 pt-8 md:pt-12 min-h-[calc(100vh-88px)] text-center pointer-events-none">
        <p className="landing-kicker text-[11px] md:text-xs tracking-[0.28em] uppercase mb-6 drop-shadow-md">
          React Native · AI agent
        </p>
        <h1 className="landing-headline max-w-5xl text-[2.35rem] sm:text-5xl md:text-6xl lg:text-[3.75rem] leading-[1.06]">
          <span className="landing-headline-line1 landing-headline-animate">
            Ship{' '}
            <span className="landing-headline-gradient">faster</span>
            <span className="landing-headline-plain">.</span>
          </span>
          <span className="landing-headline-line2 landing-headline-animate-delay text-[1.35rem] sm:text-3xl md:text-4xl lg:text-[2.65rem] leading-snug max-w-3xl mx-auto block mt-1">
            Think with your{' '}
            <span className="landing-headline-em">codebase</span>
            <span className="landing-subline"> — not around it.</span>
          </span>
        </h1>
        <p className="landing-text-body mt-8 max-w-lg text-base md:text-lg leading-relaxed drop-shadow-[0_1px_12px_rgba(0,0,0,0.35)]">
          An autonomous engineer for your repo — read, edit, run, and debug in one flow.
          Open the workspace and start in plain language.
        </p>

        <div className="mt-12 flex flex-col sm:flex-row items-center gap-4 pointer-events-auto">
          <Link href="/chat" className="landing-cta-primary text-base font-medium px-10 py-3.5 rounded-full min-w-[200px]">
            Try Ultronios
          </Link>
          <Link
            href="/chat"
            className="landing-link-subtle text-sm font-medium transition-colors py-2"
          >
            Enter workspace →
          </Link>
        </div>
      </main>

      <footer className="landing-text-footer absolute bottom-0 left-0 right-0 z-20 px-6 py-6 md:px-10 flex justify-center md:justify-between text-[11px] pointer-events-none">
        <span className="hidden md:inline drop-shadow">Local · cloud fallbacks · your keys</span>
        <span className="drop-shadow">Built for RN teams</span>
      </footer>
    </div>
  );
}
