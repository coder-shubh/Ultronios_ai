/**
 * Ollama local agent — a smarter, Claude-like tool loop for local LLMs.
 *
 * Key improvements over the naïve version:
 * - Auto-injects project context (directory tree + package.json) before asking
 * - Explicit `think` tool so the model can plan/reason before acting
 * - `edit_file` tool for surgical edits (search/replace) instead of full rewrites
 * - Detailed tool descriptions with usage examples
 * - Chain-of-thought system prompt with step-by-step workflow
 * - Retry logic for malformed tool calls
 * - Tuned temperature/top_p for tool-use accuracy
 * - Conversation summarisation when context gets long
 * - Auto-recovery: when read_file fails, nudge to glob_files immediately
 * - Per-intent context window: coding models get 16k, chat models get 8k
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { sanitizeAgentOutput } from './sanitizeAgentOutput';

const MAX_FILE_BYTES = 400_000;
const MAX_TOOL_OUTPUT = 80_000;
const MAX_GLOB_RESULTS = 80;
const CONTEXT_INJECT_MAX = 12_000;

function envInt(key: string, fallback: number): number {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function timeoutMs(): number {
  return envInt('FALLBACK_TIMEOUT_MS', 120_000);
}

function abort(): AbortSignal {
  const ms = timeoutMs();
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

// ─── Smart context window based on model name ────────────────────────────────

function defaultNumCtx(modelName: string): number {
  if (/qwen|deepseek|coder|codestral|starcoder|phi4|mistral|wizard|llama3\.1|llama3\.2:70|llama3\.3/i.test(modelName)) {
    return 16384;
  }
  return 8192;
}

// ─── Path safety ──────────────────────────────────────────────────────────────

function isInsideRoot(resolvedPath: string, root: string): boolean {
  const rel = path.relative(root, resolvedPath);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..');
}

function resolveUnderRoot(inputPath: string, workspaceRoot: string): string | null {
  const p = path.isAbsolute(inputPath)
    ? path.normalize(inputPath)
    : path.resolve(workspaceRoot, inputPath);
  const real = path.normalize(p);
  if (!isInsideRoot(real, workspaceRoot)) return null;
  return real;
}

// ─── Shell safety ─────────────────────────────────────────────────────────────

function assertSafeShellCommand(cmd: string): string | null {
  const t = cmd.trim();
  if (!t || t.length > 8_000) return null;
  if (/[;&|`$]|\$\(|\$\{|`/.test(t)) return null;
  if (/curl\s+.+\|\s*sh|wget\s+.+\|\s*sh|bash\s+-c/i.test(t)) return null;
  if (/rm\s+-rf\s*\/|>\s*\/dev\/|mkfs|dd\s+if=/i.test(t)) return null;
  return t;
}

function runShell(
  cmd: string,
  cwd: string,
  timeoutMsExec = 60_000,
): Promise<{ ok: boolean; out: string }> {
  const safe = assertSafeShellCommand(cmd);
  if (!safe) {
    return Promise.resolve({ ok: false, out: 'Error: command rejected (unsupported characters or unsafe pattern).' });
  }
  return new Promise((resolve) => {
    let out = '';
    const proc = spawn('sh', ['-c', safe], {
      cwd,
      env: { ...process.env, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => proc.kill('SIGTERM'), timeoutMsExec);
    proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      let text = out;
      if (text.length > MAX_TOOL_OUTPUT) text = text.slice(0, MAX_TOOL_OUTPUT) + '\n…(truncated)';
      if (code !== 0 && !text) text = `(exit ${code})`;
      resolve({ ok: code === 0, out: text || `(exit ${code})` });
    });
    proc.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, out: String(e.message) });
    });
  });
}

// ─── Glob ─────────────────────────────────────────────────────────────────────

function globMatch(rel: string, pattern: string): boolean {
  const r = rel.replace(/\\/g, '/');
  const p = pattern.replace(/\\/g, '/');
  const chunks = p.split('*').map((s) => s.trim()).filter(Boolean);
  if (chunks.length === 0) return true;
  let pos = 0;
  for (const part of chunks) {
    const i = r.indexOf(part, pos);
    if (i < 0) return false;
    pos = i + part.length;
  }
  return true;
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'Pods', '__pycache__', '.expo']);

async function walkGlob(
  workspaceRoot: string,
  pattern: string,
  subdir?: string,
): Promise<string[]> {
  const results: string[] = [];
  let startDir = workspaceRoot;
  if (subdir && subdir !== '.' && subdir.trim()) {
    const resolved = resolveUnderRoot(subdir.replace(/\\/g, '/'), workspaceRoot);
    if (resolved) {
      const st = await fs.promises.stat(resolved).catch(() => null);
      if (st?.isDirectory()) startDir = resolved;
    }
  }

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 14 || results.length >= MAX_GLOB_RESULTS) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (!isInsideRoot(full, workspaceRoot)) continue;
      if (e.isDirectory()) {
        await walk(full, depth + 1);
      } else if (e.isFile()) {
        const rel = path.relative(workspaceRoot, full).replace(/\\/g, '/');
        if (globMatch(rel, pattern) || globMatch(e.name, pattern)) {
          results.push(rel);
        }
      }
      if (results.length >= MAX_GLOB_RESULTS) return;
    }
  }

  await walk(startDir, 0);
  return results;
}

// ─── Grep ─────────────────────────────────────────────────────────────────────

async function runGrep(root: string, pattern: string, fileGlob?: string): Promise<string> {
  const safe = pattern.slice(0, 200);
  const args = ['-n', '--max-count', '40'];
  if (fileGlob) args.push('--glob', fileGlob);
  args.push(safe, '.');
  return new Promise((resolve) => {
    const proc = spawn('rg', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const t = setTimeout(() => proc.kill('SIGTERM'), 25_000);
    proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { err += d.toString(); });
    proc.on('close', async (code) => {
      clearTimeout(t);
      if (code === 127 || err.includes('No such file')) {
        resolve(await runGrepFallback(root, safe));
        return;
      }
      if (code === 1 && !out.trim() && !err.trim()) {
        resolve('(no matches)');
        return;
      }
      const text = out || err || '(no matches)';
      resolve(text.length > MAX_TOOL_OUTPUT ? text.slice(0, MAX_TOOL_OUTPUT) + '\n…' : text);
    });
    proc.on('error', async () => {
      clearTimeout(t);
      resolve(await runGrepFallback(root, safe));
    });
  });
}

async function runGrepFallback(root: string, needle: string): Promise<string> {
  const lines: string[] = [];
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 8 || lines.length > 60) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (e.isFile() && /\.(ts|tsx|js|jsx|json|md|mjs|cjs)$/.test(e.name)) {
        try {
          const c = await fs.promises.readFile(full, 'utf8');
          const rel = path.relative(root, full);
          c.split('\n').forEach((line, i) => {
            if (re.test(line)) lines.push(`${rel}:${i + 1}:${line.slice(0, 200)}`);
          });
        } catch { /* skip */ }
      }
      if (lines.length > 60) return;
    }
  }
  await walk(root, 0);
  return lines.length ? lines.join('\n') : '(no matches; install ripgrep `rg` for faster search)';
}

// ─── Directory tree (for context injection) ───────────────────────────────────

async function buildDirectoryTree(root: string, maxDepth = 3): Promise<string> {
  const lines: string[] = [];

  async function walk(dir: string, prefix: string, depth: number): Promise<void> {
    if (depth > maxDepth || lines.length > 200) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      const isLast = i === entries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';
      lines.push(`${prefix}${connector}${e.name}${e.isDirectory() ? '/' : ''}`);
      if (e.isDirectory()) {
        await walk(path.join(dir, e.name), prefix + childPrefix, depth + 1);
      }
    }
  }

  await walk(root, '', 0);
  return lines.join('\n');
}

// ─── Auto-context: gather project info before asking ──────────────────────────

async function gatherProjectContext(workspaceRoot: string): Promise<string> {
  const parts: string[] = [];

  const tree = await buildDirectoryTree(workspaceRoot, 3);
  if (tree) {
    parts.push(`## Project directory tree\n\`\`\`\n${tree}\n\`\`\``);
  }

  const pkgPath = path.join(workspaceRoot, 'package.json');
  try {
    const raw = await fs.promises.readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(raw);
    const summary: Record<string, unknown> = {};
    if (pkg.name) summary.name = pkg.name;
    if (pkg.version) summary.version = pkg.version;
    if (pkg.scripts) summary.scripts = pkg.scripts;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const keyDeps = Object.entries(deps)
      .filter(([k]) =>
        /react-native|react|typescript|expo|navigation|redux|reanimated|gesture|jest|detox|fastlane/i.test(k),
      )
      .reduce((o, [k, v]) => ({ ...o, [k]: v }), {} as Record<string, unknown>);
    if (Object.keys(keyDeps).length) summary.keyDependencies = keyDeps;
    parts.push(`## package.json (summary)\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\``);
  } catch { /* no package.json */ }

  const tsconfigPath = path.join(workspaceRoot, 'tsconfig.json');
  try {
    const raw = await fs.promises.readFile(tsconfigPath, 'utf8');
    if (raw.length < 2000) {
      parts.push(`## tsconfig.json\n\`\`\`json\n${raw.trim()}\n\`\`\``);
    }
  } catch { /* no tsconfig */ }

  let result = parts.join('\n\n');
  if (result.length > CONTEXT_INJECT_MAX) {
    result = result.slice(0, CONTEXT_INJECT_MAX) + '\n…(truncated)';
  }
  return result;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

type ToolName =
  | 'think'
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'list_directory'
  | 'glob_files'
  | 'grep_files'
  | 'run_command';

const OLLAMA_TOOLS_OPENAI = [
  {
    type: 'function' as const,
    function: {
      name: 'think',
      description: `Use this tool to plan your approach, reason about a problem, or organize your thoughts BEFORE taking action. This does NOT affect the project — it's for your internal reasoning only.

WHEN TO USE:
- Before starting any task: plan what files to read and what changes to make
- When debugging: reason about what could cause the issue
- When the task is complex: break it into numbered steps
- After reading files: decide what to do next

Example: think({ thought: "The user wants to add a loading spinner. I should: 1) Find the current component, 2) Read it, 3) Add a loading state, 4) Update the render." })`,
      parameters: {
        type: 'object',
        properties: {
          thought: { type: 'string', description: 'Your reasoning, plan, or analysis.' },
        },
        required: ['thought'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: `Read the full contents of a file. ALWAYS read a file before editing it.

Example: read_file({ path: "src/components/App.tsx" })
Example: read_file({ path: "package.json" })`,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root (e.g. "src/App.tsx") or absolute within workspace.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'edit_file',
      description: `Make a surgical edit to a file by replacing a specific string with new content. This is PREFERRED over write_file for modifying existing files.

RULES:
- old_string must EXACTLY match existing content (including whitespace/indentation)
- old_string must be unique in the file — include enough surrounding lines for uniqueness
- For multiple edits in one file, make separate edit_file calls

Example: edit_file({
  path: "src/App.tsx",
  old_string: "const [count, setCount] = useState(0);",
  new_string: "const [count, setCount] = useState(0);\\nconst [loading, setLoading] = useState(false);"
})`,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root.' },
          old_string: { type: 'string', description: 'Exact text to find and replace (must be unique in the file).' },
          new_string: { type: 'string', description: 'Replacement text.' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_file',
      description: `Create a new file or completely overwrite an existing file. Use edit_file instead if you only need to change part of a file.

Example: write_file({ path: "src/utils/helpers.ts", content: "export function add(a: number, b: number) { return a + b; }" })`,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root.' },
          content: { type: 'string', description: 'Complete file content to write.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_directory',
      description: `List files and folders in a directory. Use "." for the project root.

Example: list_directory({ path: "src/components" })
Example: list_directory({ path: "." })`,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path relative to project root, or "." for root. Default: "."' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'glob_files',
      description: `Find file paths matching a pattern under the project (or under an optional subfolder).

Example: glob_files({ pattern: "*login*.tsx" })
Example: glob_files({ pattern: "*.tsx", directory: "UserApp" }) — only inside UserApp/
Example: glob_files({ pattern: "**/package.json" })`,
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern like "*.tsx", "**/utils/*", "*.test.ts"' },
          directory: {
            type: 'string',
            description: 'Optional folder under the project root to search (e.g. "UserApp", "src/screens"). Omit to search the whole repo.',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'grep_files',
      description: `Search file contents for a text pattern. Returns matching lines with file paths and line numbers.

Example: grep_files({ pattern: "useState" }) — find all useState usage
Example: grep_files({ pattern: "export default", glob: "*.tsx" }) — find default exports in TSX files
Example: grep_files({ pattern: "TODO|FIXME" }) — find todos`,
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern (supports regex).' },
          glob: { type: 'string', description: 'Optional file glob filter, e.g. "*.ts" or "*.tsx"' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_command',
      description: `Run a shell command in the project directory. Only simple commands — NO pipes (|), semicolons (;), or subshells ($()).

ALLOWED: npm install, yarn add, git status, ls -la, npx tsc --noEmit, npx react-native run-ios
NOT ALLOWED: cat file | grep pattern, npm install && npm start, echo $(pwd)

Example: run_command({ command: "npm install" })
Example: run_command({ command: "git status" })
Example: run_command({ command: "npx tsc --noEmit" })`,
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run (no pipes/semicolons/subshells).' },
        },
        required: ['command'],
      },
    },
  },
];

// ─── Tool execution ───────────────────────────────────────────────────────────

export async function executeOllamaTool(
  name: ToolName,
  args: Record<string, unknown>,
  workspaceRoot: string,
): Promise<string> {
  try {
    switch (name) {
      case 'think': {
        return '(Planning noted — continue with tools and then answer in plain language.)';
      }
      case 'read_file': {
        const p = typeof args.path === 'string' ? args.path : '';
        const full = resolveUnderRoot(p, workspaceRoot);
        if (!full) return 'Error: path escapes workspace.';
        const st = await fs.promises.stat(full).catch(() => null);
        if (!st?.isFile()) return `Error: file not found — "${p}". Use list_directory or glob_files to find the correct path.`;
        const buf = await fs.promises.readFile(full);
        if (buf.length > MAX_FILE_BYTES) return `Error: file too large (${buf.length} bytes). Try grep_files to find specific content.`;
        const content = buf.toString('utf8');
        const lines = content.split('\n');
        const numbered = lines.map((line, i) => `${String(i + 1).padStart(4)}| ${line}`).join('\n');
        return numbered;
      }
      case 'edit_file': {
        const p = typeof args.path === 'string' ? args.path : '';
        const oldStr = typeof args.old_string === 'string' ? args.old_string : '';
        const newStr = typeof args.new_string === 'string' ? args.new_string : '';
        if (!oldStr) return 'Error: old_string is required.';
        const full = resolveUnderRoot(p, workspaceRoot);
        if (!full) return 'Error: path escapes workspace.';
        let content: string;
        try {
          content = await fs.promises.readFile(full, 'utf8');
        } catch {
          return `Error: cannot read file — "${p}". Does it exist?`;
        }
        const count = content.split(oldStr).length - 1;
        if (count === 0) {
          return `Error: old_string not found in ${p}. Make sure it matches EXACTLY (including whitespace). Read the file first to see the exact content.`;
        }
        if (count > 1) {
          return `Error: old_string found ${count} times in ${p}. Include more surrounding context to make it unique.`;
        }
        const updated = content.replace(oldStr, newStr);
        await fs.promises.writeFile(full, updated, 'utf8');
        const rel = path.relative(workspaceRoot, full);
        return `Successfully edited ${rel}. The old_string was replaced with new_string.`;
      }
      case 'write_file': {
        const p = typeof args.path === 'string' ? args.path : '';
        const content = typeof args.content === 'string' ? args.content : '';
        const full = resolveUnderRoot(p, workspaceRoot);
        if (!full) return 'Error: path escapes workspace.';
        await fs.promises.mkdir(path.dirname(full), { recursive: true });
        await fs.promises.writeFile(full, content, 'utf8');
        return `Wrote ${path.relative(workspaceRoot, full)} (${content.length} chars).`;
      }
      case 'list_directory': {
        const p = typeof args.path === 'string' && args.path ? args.path : '.';
        const full = resolveUnderRoot(p, workspaceRoot);
        if (!full) return 'Error: path escapes workspace.';
        const st = await fs.promises.stat(full).catch(() => null);
        if (!st?.isDirectory()) return `Error: "${p}" is not a directory. Use glob_files to find files.`;
        const entries = await fs.promises.readdir(full, { withFileTypes: true });
        const sorted = entries.sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });
        return sorted
          .map((e) => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`)
          .join('\n')
          .slice(0, MAX_TOOL_OUTPUT);
      }
      case 'glob_files': {
        const pattern = typeof args.pattern === 'string' ? args.pattern : '*';
        const sub =
          typeof args.directory === 'string'
            ? args.directory
            : typeof (args as { folder?: string }).folder === 'string'
              ? (args as { folder: string }).folder
              : undefined;
        const files = await walkGlob(workspaceRoot, pattern, sub);
        return files.length ? files.join('\n') : '(no files matched this pattern)';
      }
      case 'grep_files': {
        const pat = typeof args.pattern === 'string' ? args.pattern : '';
        const g = typeof args.glob === 'string' ? args.glob : undefined;
        if (!pat) return 'Error: pattern is required.';
        return runGrep(workspaceRoot, pat, g);
      }
      case 'run_command': {
        const cmd = typeof args.command === 'string' ? args.command : '';
        const r = await runShell(cmd, workspaceRoot);
        return `${r.ok ? '✅ Command succeeded' : '❌ Command failed'}:\n${r.out}`;
      }
      default:
        return `Unknown tool: ${name}. Available tools: think, read_file, edit_file, write_file, list_directory, glob_files, grep_files, run_command.`;
    }
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ─── System prompt builder ────────────────────────────────────────────────────

function buildAgentSystemPrompt(
  baseSystemPrompt: string,
  workspaceRoot: string,
  projectContext: string,
): string {
  return `${baseSystemPrompt}

---

## LOCAL AGENT — FULL TOOL ACCESS

You are Ultronios — a senior React Native / TypeScript engineer running as a LOCAL AI agent with direct filesystem and shell access.
Workspace: \`${workspaceRoot}\`

### MANDATORY WORKFLOW (follow for EVERY request):

**Step 1 — THINK** (always first):
Call \`think\` to plan before acting. Example:
\`\`\`
think({ thought: "User wants to add a loading spinner to LoginScreen. Plan: 1) glob_files to find LoginScreen, 2) read_file to see current code, 3) edit_file to add useState + ActivityIndicator." })
\`\`\`

**Step 2 — EXPLORE** (locate the code):
- \`glob_files({ pattern: "*LoginScreen*" })\` — find files by name
- \`grep_files({ pattern: "useSelector", glob: "*.ts" })\` — find usage
- \`read_file({ path: "src/screens/Login.tsx" })\` — read before editing
- \`list_directory({ path: "src/screens" })\` — see folder contents

**Step 3 — ACT**:
- \`edit_file\` — modify existing files (ALWAYS preferred over write_file)
- \`write_file\` — create NEW files only
- \`run_command({ command: "npx tsc --noEmit" })\` — typecheck, lint, git

**Step 4 — VERIFY**:
- Read the file back after editing to confirm correctness
- Run \`npx tsc --noEmit\` for TypeScript changes

### TOOL CALL FORMAT (CRITICAL — follow exactly):
Tool calls must be valid JSON in the function arguments field.
- Strings: use double quotes, escape backslashes as \\\\
- No trailing commas, no comments inside JSON
- old_string in edit_file MUST match the file exactly (including spaces/tabs)

### REACT NATIVE DEBUGGING PATTERNS:
- **Crash on start**: grep_files({ pattern: "import.*from" }) → check for circular deps; read_file({ path: "index.js" })
- **Red screen error**: grep_files({ pattern: "error message text" }) → find source; read_file the component
- **Navigation issue**: glob_files({ pattern: "*Navigator*" }) → read navigators; check screen registration
- **State not updating**: grep_files({ pattern: "dispatch|setState|useSelector" }) → trace the flow
- **Metro/bundle error**: run_command({ command: "npx react-native start --reset-cache" })
- **iOS build fail**: run_command({ command: "cd ios && pod install" }) → check Podfile.lock
- **Android build fail**: run_command({ command: "cd android && ./gradlew clean" })
- **TypeScript error**: run_command({ command: "npx tsc --noEmit 2>&1" }) → read the exact error

### CRITICAL RULES (NEVER break these):
- **NEVER ask the user which tool to use** — just call the tool yourself
- **NEVER stop with "here are your options"** — pick the best option and do it
- **When read_file returns "file not found"**: immediately call glob_files({ pattern: "*FILENAME*" }) to find it — do NOT ask the user
- **When glob_files returns paths**: immediately call read_file on the best matching path
- **Only give a text response when you have a final answer** — keep calling tools until done

### RESPONSE RULES:
- After all tool calls, respond in **plain English** — no JSON, no fake tool call syntax
- Show only the changed lines (diff-style), not entire files — unless user asked for the full file
- If user says "show me the code" → call read_file then paste contents in a \`\`\`tsx code fence
- Keep replies concise — lead with what changed, then explain why

### PROJECT CONTEXT (auto-gathered):

${projectContext}

---

Respond to the user's request using tools as needed, then give a clear, human-readable answer.`;
}

// ─── JSON recovery for malformed tool calls ───────────────────────────────────

function tryParseArgs(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw);
  } catch { /* continue */ }

  let cleaned = raw.trim();
  if (cleaned.endsWith(',}')) cleaned = cleaned.slice(0, -2) + '}';
  if (cleaned.endsWith(',')) cleaned = cleaned.slice(0, -1);
  if (!cleaned.endsWith('}')) cleaned += '}';
  if (!cleaned.startsWith('{')) cleaned = '{' + cleaned;
  try {
    return JSON.parse(cleaned);
  } catch { /* continue */ }

  const pairs: Record<string, string> = {};
  const kvRe = /"(\w+)"\s*:\s*("(?:[^"\\]|\\.)*"|true|false|null|\d+)/g;
  let m;
  while ((m = kvRe.exec(raw))) {
    try {
      pairs[m[1]] = JSON.parse(m[2]);
    } catch {
      pairs[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  }
  return Object.keys(pairs).length ? pairs : null;
}

// ─── "Show me the code" — auto-read when the model only glob'd ───────────────

function wantsToSeeCode(prompt: string): boolean {
  const p = prompt.toLowerCase();
  if (/\b(show|display|see|view|open|print|give)\s+(me\s+)?(the\s+)?(code|source|file)\b/.test(p)) return true;
  if (/\b(show|display|see|view)\b.*\b(code|screen|component|source|file)\b/.test(p)) return true;
  if (/\bcode\s+for\b/.test(p) || /\bwhere\s+is\s+(the\s+)?code\b/.test(p)) return true;
  if (/\bpaste\b.*\bcode\b/.test(p)) return true;
  return false;
}

function parseGlobResultPaths(globOutput: string): string[] {
  return globOutput
    .split('\n')
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !l.startsWith('(') &&
        !/no files matched/i.test(l),
    );
}

function pickBestPathForShowCode(prompt: string, paths: string[]): string | null {
  if (paths.length === 0) return null;
  if (paths.length === 1) return paths[0];
  const quoted = [...prompt.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1].toLowerCase());
  const lower = prompt.toLowerCase();
  const words = lower.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const keys = [...new Set([...quoted, ...words])];

  let best = paths[0];
  let bestScore = -1;
  for (const rel of paths) {
    const pl = rel.toLowerCase().replace(/\\/g, '/');
    let s = 0;
    for (const k of keys) {
      if (k && pl.includes(k)) s += k.length > 5 ? 4 : 2;
    }
    if (s > bestScore) {
      bestScore = s;
      best = rel;
    }
  }
  return best;
}

function fenceLang(filePath: string): string {
  if (/\.tsx$/i.test(filePath)) return 'tsx';
  if (/\.(ts|mts|cts)$/i.test(filePath)) return 'typescript';
  if (/\.(jsx|js|mjs|cjs)$/i.test(filePath)) return 'javascript';
  if (/\.json$/i.test(filePath)) return 'json';
  if (/\.(md|mdx)$/i.test(filePath)) return 'markdown';
  return 'text';
}

async function readProjectFilePlain(workspaceRoot: string, relPath: string): Promise<string | null> {
  const full = resolveUnderRoot(relPath.replace(/\\/g, '/'), workspaceRoot);
  if (!full) return null;
  const st = await fs.promises.stat(full).catch(() => null);
  if (!st?.isFile()) return null;
  const buf = await fs.promises.readFile(full);
  if (buf.length > MAX_FILE_BYTES) return null;
  return buf.toString('utf8');
}

const MAX_AUTO_APPEND = 60_000;

export type OllamaAgentResult = {
  text: string;
  model: string;
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
};

async function finalizeOllamaReply(
  userPrompt: string,
  text: string,
  model: string,
  toolCalls: OllamaAgentResult['toolCalls'],
  globPathsFound: string[],
  workspaceRoot: string,
): Promise<OllamaAgentResult> {
  let outText = text;
  const outCalls = [...toolCalls];
  const wantsCode = wantsToSeeCode(userPrompt);
  const hasFence = /```/.test(outText);

  async function appendPlainCode(relPath: string, pushTool: boolean): Promise<void> {
    const raw = await readProjectFilePlain(workspaceRoot, relPath);
    if (!raw) return;
    const lang = fenceLang(relPath);
    const body = raw.length > MAX_AUTO_APPEND ? `${raw.slice(0, MAX_AUTO_APPEND)}\n// …(truncated)` : raw;
    outText = `${outText}\n\n### \`${relPath}\`\n\n\`\`\`${lang}\n${body}\n\`\`\`\n`;
    if (pushTool) {
      outCalls.push({
        id: `auto-read-${randomUUID()}`,
        name: 'read_file',
        input: { path: relPath },
      });
    }
  }

  if (wantsCode && !hasFence) {
    // Prefer glob results (covers the case where read_file failed but glob succeeded)
    if (globPathsFound.length > 0) {
      const best = pickBestPathForShowCode(userPrompt, globPathsFound);
      if (best) await appendPlainCode(best, true);
    } else {
      // Fall back: try reading the last path the model attempted
      const lastRead = [...outCalls].reverse().find((t) => t.name === 'read_file');
      const p =
        lastRead && typeof (lastRead.input as { path?: string }).path === 'string'
          ? (lastRead.input as { path: string }).path
          : null;
      if (p) await appendPlainCode(p, false);
    }
  }

  return { text: sanitizeAgentOutput(outText), model, toolCalls: outCalls };
}

// ─── Main agent loop ──────────────────────────────────────────────────────────

export async function runOllamaAgentWithTools(
  userPrompt: string,
  systemPrompt: string,
  workspaceRoot: string,
  modelOverride?: string,
): Promise<OllamaAgentResult | null> {
  if (process.env.OLLAMA_DISABLED === '1') return null;
  const base = (process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
  const model = modelOverride ?? process.env.OLLAMA_MODEL ?? 'llama3.2';
  const maxTurns = Math.min(Math.max(envInt('OLLAMA_AGENT_MAX_TURNS', 16), 1), 40);
  const temperature = Number(process.env.OLLAMA_TEMPERATURE) || 0.1;
  const numCtx = envInt('OLLAMA_NUM_CTX', defaultNumCtx(model));

  const projectContext = await gatherProjectContext(workspaceRoot);
  const sys = buildAgentSystemPrompt(systemPrompt, workspaceRoot, projectContext);

  const messages: Record<string, unknown>[] = [
    { role: 'system', content: sys },
    { role: 'user', content: userPrompt },
  ];

  const toolCalls: OllamaAgentResult['toolCalls'] = [];
  const globPathsFound: string[] = [];
  let consecutiveFailures = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    const payload: Record<string, unknown> = {
      model,
      messages,
      tools: OLLAMA_TOOLS_OPENAI,
      tool_choice: 'auto',
      stream: false,
      temperature,
      top_p: 0.9,
      options: { num_ctx: numCtx },
    };

    let res: Response;
    try {
      res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abort(),
      });
    } catch (err) {
      if (turn === 0) return null;
      break;
    }

    if (!res.ok) {
      if (turn === 0) return null;
      break;
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            type?: string;
            function?: { name: string; arguments: string };
          }>;
        };
        finish_reason?: string;
      }>;
    };

    const msg = data.choices?.[0]?.message;
    if (!msg) break;

    const calls = msg.tool_calls;
    if (calls?.length) {
      const cleaned = msg.content != null ? sanitizeAgentOutput(String(msg.content)) : '';
      messages.push({
        role: 'assistant',
        content: cleaned.length > 0 ? cleaned : null,
        tool_calls: msg.tool_calls,
      });

      let hadValidCall = false;
      for (const tc of calls) {
        const id = tc.id ?? `call_${toolCalls.length}`;
        const fname = tc.function?.name as ToolName | undefined;
        let args: Record<string, unknown> | null = null;

        if (tc.function?.arguments) {
          args = tryParseArgs(tc.function.arguments);
        }
        if (!args) args = {};

        if (fname) {
          hadValidCall = true;
          toolCalls.push({ id, name: fname, input: args });
          const out = await executeOllamaTool(fname, args, workspaceRoot);
          if (fname === 'glob_files') {
            for (const p of parseGlobResultPaths(out)) {
              if (!globPathsFound.includes(p)) globPathsFound.push(p);
            }
          }
          messages.push({ role: 'tool', tool_call_id: id, content: out });

          // ── Auto-recover from file-not-found ────────────────────────────
          // When read_file fails, immediately nudge the model to search instead
          // of letting it ask the user. Critical for weak local models.
          if (fname === 'read_file' && /Error: file not found/i.test(out)) {
            const rawPath = String(args.path ?? '');
            const basename = path.basename(rawPath);
            const stem = basename.replace(/\.[^.]+$/, '');
            messages.push({
              role: 'user',
              content:
                `"${basename}" was not found at that path. ` +
                `Do NOT stop. Do NOT ask the user. ` +
                `Call glob_files({ pattern: "*${stem}*" }) RIGHT NOW to locate the file, ` +
                `then call read_file on the first matching result.`,
            });
          }
        }
      }

      if (!hadValidCall) {
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          messages.push({
            role: 'user',
            content: 'You seem to be having trouble with tool calls. Please respond with a text summary of what you know so far, and what you would do if the tools were working.',
          });
        }
      } else {
        consecutiveFailures = 0;
      }

      // Trim context if it's getting very long (keep system + last N messages)
      if (messages.length > 50) {
        const sysMsg = messages[0];
        const recent = messages.slice(-30);
        const summary = {
          role: 'user',
          content: `[Previous conversation trimmed for context. You made ${toolCalls.length} tool calls so far. Continue with the task.]`,
        };
        messages.length = 0;
        messages.push(sysMsg, summary, ...recent);
      }

      continue;
    }

    const text = sanitizeAgentOutput((msg.content ?? '').trim());
    if (text) {
      return finalizeOllamaReply(userPrompt, text, model, toolCalls, globPathsFound, workspaceRoot);
    }
    break;
  }

  if (toolCalls.length) {
    // The model stopped calling tools but didn't give a final answer — nudge it
    messages.push({
      role: 'user',
      content: wantsToSeeCode(userPrompt)
        ? 'The user asked to see source code. Call read_file on the best matching file from your search results and paste the full contents in a markdown code block (```). Do not stop after only finding paths.'
        : 'Please provide a clear summary of what you did and the results. If you made changes, list the files you modified.',
    });

    try {
      const finalRes = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          temperature,
          options: { num_ctx: numCtx },
        }),
        signal: abort(),
      });

      if (finalRes.ok) {
        const finalData = (await finalRes.json()) as {
          choices?: Array<{ message?: { content?: string | null } }>;
        };
        const finalText = sanitizeAgentOutput(finalData.choices?.[0]?.message?.content?.trim() ?? '');
        if (finalText) {
          return finalizeOllamaReply(userPrompt, finalText, model, toolCalls, globPathsFound, workspaceRoot);
        }
      }
    } catch { /* use fallback text */ }

    const touched = [
      ...new Set(
        toolCalls
          .filter((t) => ['write_file', 'edit_file'].includes(t.name))
          .map((t) => String((t.input as { path?: string }).path || '')),
      ),
    ].filter(Boolean);
    return finalizeOllamaReply(
      userPrompt,
      sanitizeAgentOutput(
        touched.length
          ? `Done. Modified: ${touched.join(', ')}`
          : `Completed ${toolCalls.length} tool operations.`,
      ),
      model,
      toolCalls,
      globPathsFound,
      workspaceRoot,
    );
  }

  return null;
}
