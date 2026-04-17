import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';

function env(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v && v.length > 0 ? v : undefined;
}

const DEFAULT_MAC = 'Ultronios-desktop.dmg';
const DEFAULT_WIN = 'Ultronios-desktop.exe';

function publicDir(): string {
  return path.join(process.cwd(), 'public');
}

function safePathUnderPublic(relativeFromPublic: string): string | null {
  const base = path.resolve(publicDir());
  const resolved = path.resolve(base, relativeFromPublic);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    return null;
  }
  return resolved;
}

function remoteUrlForOs(isWin: boolean): string | undefined {
  const legacy = env('NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL');
  const mac = env('NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL_MAC') ?? legacy;
  const win = env('NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL_WIN') ?? legacy;
  const u = isWin ? win : mac;
  return u && /^https?:\/\//i.test(u) ? u : undefined;
}

function configuredRelativePath(isWin: boolean): string | undefined {
  const legacy = env('NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL');
  const mac = env('NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL_MAC') ?? legacy;
  const win = env('NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL_WIN') ?? legacy;
  const u = isWin ? win : mac;
  if (u && u.startsWith('/') && !u.startsWith('//')) {
    return u.replace(/^\//, '');
  }
  return undefined;
}

export async function GET(req: NextRequest) {
  const os = req.nextUrl.searchParams.get('os')?.toLowerCase() ?? 'mac';
  const isWin = os === 'win' || os === 'windows';

  const remote = remoteUrlForOs(isWin);
  if (remote) {
    return NextResponse.redirect(remote, 302);
  }

  const relFromConfigured = configuredRelativePath(isWin);
  const relDefault = `downloads/${isWin ? DEFAULT_WIN : DEFAULT_MAC}`;
  const relative = relFromConfigured ?? relDefault;

  const abs = safePathUnderPublic(relative);
  if (!abs) {
    return new NextResponse('Invalid path', { status: 400 });
  }

  try {
    const buf = await readFile(abs);
    const filename = path.basename(abs);
    const mime = filename.endsWith('.exe')
      ? 'application/octet-stream'
      : filename.endsWith('.dmg')
        ? 'application/x-apple-diskimage'
        : 'application/octet-stream';

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return new NextResponse(
      'Desktop installer is not available. Add the file under web/public/downloads/ or set NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL_MAC / NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL_WIN to an https URL.',
      { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }
}
