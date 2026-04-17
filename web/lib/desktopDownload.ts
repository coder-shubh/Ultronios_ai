'use client';

import { useEffect, useState } from 'react';

const API_MAC = '/api/desktop-download?os=mac';
const API_WIN = '/api/desktop-download?os=win';

export function desktopDownloadAnchorProps(
  href: string,
): { target?: string; rel?: string; download?: boolean } {
  if (/^https?:\/\//i.test(href)) {
    return { target: '_blank', rel: 'noopener noreferrer' };
  }
  return {};
}

/** Call in the browser to pick Mac vs Windows installer (served by /api/desktop-download). */
export function getDesktopDownloadHrefForCurrentOs(): string {
  if (typeof window === 'undefined') return API_MAC;

  const ua = navigator.userAgent;
  const platform = (navigator.platform ?? '').toLowerCase();

  const isWindows =
    /Win/i.test(platform) ||
    /Windows/i.test(ua) ||
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ===
      'Windows';

  if (isWindows) return API_WIN;

  const isMacDesktop =
    /Mac/i.test(platform) ||
    /Mac OS X|Macintosh/i.test(ua) ||
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ===
      'macOS';

  if (isMacDesktop) return API_MAC;

  return API_MAC;
}

/** SSR uses Mac route; after mount picks Mac vs Windows from the user agent. */
export function useDesktopDownloadHref(): string {
  const [href, setHref] = useState(API_MAC);

  useEffect(() => {
    setHref(getDesktopDownloadHrefForCurrentOs());
  }, []);

  return href;
}
