'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Download } from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import LandingWebGLLoader from '@/components/landing/LandingWebGLLoader';
import HowItWorksVoice from '@/components/landing/HowItWorksVoice';
import { desktopDownloadAnchorProps, useDesktopDownloadHref } from '@/lib/desktopDownload';

/**
 * Landing: night galaxy (dark) · sunny sky + sun WebGL (light).
 */
export default function LandingPage() {
  const desktopHref = useDesktopDownloadHref();
  const desktopAnchor = desktopDownloadAnchorProps(desktopHref);

  return (
    <div className="landing-root relative min-h-screen w-full overflow-hidden">
      <div className="landing-bg" aria-hidden />
      <div className="landing-orb landing-orb-a" aria-hidden />
      <div className="landing-orb landing-orb-b" aria-hidden />

      <LandingWebGLLoader />

      <div className="landing-vignette pointer-events-none" aria-hidden />

      <header className="relative z-20 flex items-center justify-between px-4 py-3 md:px-10 md:py-5 gap-2">
        <Link
          href="/"
          className="landing-brand pointer-events-auto h-10 w-[150px] md:h-14 md:w-[210px] flex items-center flex-shrink-0"
        >
          <Image
            src="/images/ultroniousLogo.png"
            alt="Ultronios logo"
            width={210}
            height={56}
            sizes="(max-width: 768px) 150px, 210px"
            priority
            className="h-10 md:h-14 w-auto drop-shadow-md"
          />
        </Link>
        <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
          <Link
            href="/dashboard"
            className="landing-nav-link hidden sm:inline-flex text-sm font-medium px-4 py-2 rounded-full pointer-events-auto border transition-colors"
          >
            Dashboard
          </Link>
          <a
            href={desktopHref}
            {...desktopAnchor}
            className="landing-nav-link inline-flex items-center gap-1.5 text-sm font-medium px-3 sm:px-4 py-2 rounded-full pointer-events-auto border transition-colors"
            title="Download desktop app"
          >
            <Download className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
            <span className="sm:hidden sr-only">Download</span>
            <span className="hidden sm:inline">Download</span>
          </a>
          <ThemeToggle />
          <Link
            href="/chat"
            className="landing-cta-primary text-xs sm:text-sm font-medium px-3 sm:px-5 py-2 sm:py-2.5 rounded-full pointer-events-auto"
          >
            Open chat
          </Link>
        </div>
      </header>

      <main className="relative z-20 flex flex-col items-center justify-center px-4 sm:px-6 pb-8 md:pb-10 pt-2 md:pt-6 min-h-[calc(100vh-72px)] md:min-h-[calc(100vh-88px)] text-center pointer-events-none -mt-3 md:-mt-10 overflow-y-auto md:overflow-hidden">
        <p className="landing-kicker text-[11px] md:text-xs tracking-[0.28em] uppercase mb-4 drop-shadow-md">
          React Native · AI agent
        </p>
        <h1 className="landing-headline max-w-5xl text-[1.9rem] sm:text-5xl md:text-6xl lg:text-[3.75rem] leading-[1.06]">
          <span className="landing-headline-line1 landing-headline-animate">
            Ship{' '}
            <span className="landing-headline-gradient">faster</span>
            <span className="landing-headline-plain">.</span>
          </span>
          <span className="landing-headline-line2 landing-headline-animate-delay text-[1.1rem] sm:text-3xl md:text-4xl lg:text-[2.65rem] leading-snug max-w-3xl mx-auto block mt-1">
            Think with your{' '}
            <span className="landing-headline-em">codebase</span>
            <span className="landing-subline"> — not around it.</span>
          </span>
        </h1>
        <p className="landing-text-body mt-3 max-w-lg text-xs sm:text-sm md:text-base leading-relaxed drop-shadow-[0_1px_12px_rgba(0,0,0,0.35)]">
          An autonomous engineer for your repo — read, edit, run, and debug in one flow.
          Open the workspace and start in plain language.
        </p>

        <div className="mt-5 flex flex-col sm:flex-row items-center gap-2.5 sm:gap-3 pointer-events-auto w-full sm:w-auto">
          <Link href="/chat" className="landing-cta-primary text-sm sm:text-base font-medium px-8 sm:px-10 py-3 sm:py-3.5 rounded-full min-w-[180px] sm:min-w-[200px]">
            Try Ultronios
          </Link>
          <a
            href={desktopHref}
            {...desktopAnchor}
            className="landing-cta-secondary text-sm sm:text-base font-medium px-8 sm:px-10 py-3 sm:py-3.5 rounded-full min-w-[180px] sm:min-w-[220px]"
          >
            <Download className="h-[1.1em] w-[1.1em] shrink-0" aria-hidden />
            Download desktop app
          </a>
          <Link
            href="/chat"
            className="landing-link-subtle text-sm font-medium transition-colors py-2"
          >
            Enter workspace →
          </Link>
        </div>

        <HowItWorksVoice />
      </main>

      <footer className="landing-text-footer absolute bottom-0 left-0 right-0 z-20 px-6 py-4 md:py-6 md:px-10 hidden sm:flex justify-center md:justify-between text-[11px] pointer-events-none">
        <span className="hidden md:inline drop-shadow">Local · cloud fallbacks · your keys</span>
        <span className="drop-shadow">Built for RN teams</span>
      </footer>
    </div>
  );
}
