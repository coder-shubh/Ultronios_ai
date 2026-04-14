import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

export type ProjectEntry = {
  name: string;
  path: string;
  hasPackageJson: boolean;
  isRN: boolean;
};

function scanDir(root: string): ProjectEntry[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .map((e) => {
      const dirPath = path.join(root, e.name);
      const pkgPath = path.join(dirPath, 'package.json');
      let hasPackageJson = false;
      let isRN = false;

      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
        hasPackageJson = true;
        const deps = { ...((pkg.dependencies ?? {}) as Record<string, unknown>), ...((pkg.devDependencies ?? {}) as Record<string, unknown>) };
        isRN = 'react-native' in deps;
      } catch { /* not a node project */ }

      return { name: e.name, path: dirPath, hasPackageJson, isRN };
    })
    .sort((a, b) => {
      // RN projects first, then node projects, then plain dirs
      if (a.isRN !== b.isRN) return a.isRN ? -1 : 1;
      if (a.hasPackageJson !== b.hasPackageJson) return a.hasPackageJson ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dir = searchParams.get('dir');

  if (!dir) {
    return NextResponse.json({ error: 'dir param required' }, { status: 400 });
  }

  // Basic safety: must be an absolute path
  if (!path.isAbsolute(dir)) {
    return NextResponse.json({ error: 'dir must be absolute' }, { status: 400 });
  }

  if (!fs.existsSync(dir)) {
    return NextResponse.json({ error: 'directory not found' }, { status: 404 });
  }

  const projects = scanDir(dir);
  return NextResponse.json({ dir, projects });
}
