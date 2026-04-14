import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// ─── Project context (injected once per cwd change) ───────────────────────────

export type ProjectContext = {
  name: string;
  version: string;
  description: string;
  scripts: string;        // key: command pairs
  deps: string;           // top-level runtime deps
  devDeps: string;        // key devDeps
  rnVersion: string;
  nodeVersion: string;
  fileTree: string;       // top-level + src/ shape
  gitLog: string;         // last 8 commits
  gitBranch: string;
};

function safe(fn: () => string, fallback = ''): string {
  try { return fn(); } catch { return fallback; }
}

export function readProjectContext(cwd: string): ProjectContext {
  // ── package.json ────────────────────────────────────────────────────────────
  let pkg: Record<string, unknown> = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8')) as Record<string, unknown>;
  } catch { /* not a node project */ }

  const deps    = pkg.dependencies    as Record<string, string> | undefined ?? {};
  const devDeps = pkg.devDependencies as Record<string, string> | undefined ?? {};
  const scripts = pkg.scripts         as Record<string, string> | undefined ?? {};

  const rnVersion = deps['react-native'] ?? devDeps['react-native'] ?? '';

  // Top 12 most relevant deps (exclude common noise)
  const NOISE = new Set(['react', 'react-native', 'typescript', 'metro-config']);
  const depStr = Object.entries(deps)
    .filter(([k]) => !NOISE.has(k))
    .slice(0, 12)
    .map(([k, v]) => `${k}@${v}`)
    .join(', ');

  const devStr = Object.entries(devDeps)
    .filter(([k]) => !NOISE.has(k))
    .slice(0, 8)
    .map(([k, v]) => `${k}@${v}`)
    .join(', ');

  const scriptStr = Object.entries(scripts)
    .slice(0, 10)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');

  // ── File tree (2 levels, filtered) ─────────────────────────────────────────
  const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'android', 'ios', '__pycache__']);
  function tree(dir: string, depth = 0, maxDepth = 2): string {
    if (depth > maxDepth) return '';
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return ''; }
    return entries
      .filter((e) => !SKIP.has(e.name) && !e.name.startsWith('.'))
      .slice(0, 20)
      .map((e) => {
        const indent = '  '.repeat(depth);
        if (e.isDirectory()) return `${indent}${e.name}/\n${tree(path.join(dir, e.name), depth + 1, maxDepth)}`;
        return `${indent}${e.name}`;
      })
      .join('\n');
  }
  const fileTree = safe(() => tree(cwd));

  // ── Git ─────────────────────────────────────────────────────────────────────
  const gitLog = safe(() =>
    execSync('git log --oneline -8 --no-color', { cwd, timeout: 3000 }).toString().trim(),
  );
  const gitBranch = safe(() =>
    execSync('git rev-parse --abbrev-ref HEAD', { cwd, timeout: 2000 }).toString().trim(),
  );
  const nodeVersion = safe(() =>
    execSync('node --version', { timeout: 2000 }).toString().trim(),
  );

  return {
    name:        String(pkg.name ?? path.basename(cwd)),
    version:     String(pkg.version ?? ''),
    description: String(pkg.description ?? ''),
    scripts:     scriptStr,
    deps:        depStr,
    devDeps:     devStr,
    rnVersion,
    nodeVersion,
    fileTree,
    gitLog,
    gitBranch,
  };
}

// ─── Conversation history serializer ─────────────────────────────────────────

export type HistoryTurn = { role: 'user' | 'agent'; content: string };

function serializeHistory(history: HistoryTurn[]): string {
  if (!history.length) return '';
  const turns = history
    .slice(-8)  // last 8 turns (4 user + 4 agent) to keep context tight
    .map((t) => `[${t.role === 'user' ? 'User' : 'Assistant'}]: ${t.content.slice(0, 500)}${t.content.length > 500 ? '…' : ''}`)
    .join('\n');
  return `\n\n## Conversation so far\n${turns}`;
}

// ─── Full system prompt builder ───────────────────────────────────────────────

export function buildSystemPrompt(
  cwd: string,
  history: HistoryTurn[] = [],
  ctx?: ProjectContext,
): string {
  const project = ctx ?? (() => { try { return readProjectContext(cwd); } catch { return null; } })();

  const projectBlock = project ? `
## Active project: ${project.name}${project.version ? ` v${project.version}` : ''}${project.rnVersion ? ` (RN ${project.rnVersion})` : ''}
${project.description ? `Description: ${project.description}` : ''}
Branch: ${project.gitBranch || 'unknown'} · Node: ${project.nodeVersion}

### Scripts
${project.scripts || '  (none)'}

### Key dependencies
${project.deps || '  (none)'}

### Dev dependencies
${project.devDeps || '  (none)'}

### File structure
\`\`\`
${project.fileTree || '  (empty)'}
\`\`\`

### Recent commits
${project.gitLog || '  (no git history)'}` : '';

  const historyBlock = serializeHistory(history);

  return `You are Ultronios — an expert AI agent acting as the user's personal senior React Native engineer.
You work autonomously — opening files, running the project, debugging issues, writing/refactoring code, managing dependencies.

## Stack
- React Native (0.79+), React 19, TypeScript
- Redux Toolkit / RTK Query, React Navigation
- react-native-reanimated, react-native-gesture-handler
- iOS (Xcode, CocoaPods) · Android (Gradle, SDK)
- Metro bundler · Jest / Detox · Fastlane / GitHub Actions

## Rules
- Minimal output · output diffs not full files
- Use Glob/Grep to navigate — don't guess file paths
- Warn before breaking changes · confirm ambiguous project
- Reference the conversation history when user says "fix it", "that", "the same file" etc.
- You already know the project structure above — don't re-scan unless context has changed

## Working directory
${cwd}
${projectBlock}${historyBlock}`;
}

/** CLI variant — reads project context synchronously, no HTTP */
export function buildSystemPromptCli(cwd: string, history: HistoryTurn[] = []): string {
  return buildSystemPrompt(cwd, history);
}
