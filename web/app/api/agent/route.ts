import { NextRequest } from 'next/server';
import path from 'path';
import { spawn } from 'child_process';
import dotenv from 'dotenv';

// Load API key from parent project's env files
dotenv.config({ path: path.join(process.cwd(), '..', '.env') });
dotenv.config({ path: path.join(process.cwd(), '..', '.env.example') });

import { query, type Options } from '@anthropic-ai/claude-agent-sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const API_TOKEN = process.env.ANTHROPIC_API_KEY;

// Default cwd: env override → home dir (works for any user on any machine)
const DEFAULT_CWD = process.env.AGENT_DEFAULT_CWD ?? require('os').homedir() as string;

function safeCwd(inputCwd: string | undefined): string {
  if (!inputCwd) return DEFAULT_CWD;
  const resolved = path.resolve(inputCwd);
  // Must be absolute and exist (basic sanity — no path traversal beyond what os allows)
  return path.isAbsolute(resolved) ? resolved : DEFAULT_CWD;
}

// ─── Zero-token direct execution ─────────────────────────────────────────────

const SHELL_RE = /^(npm|yarn|npx|node|pod|adb|git|ls|mkdir|rm|cp|mv|cat|which|brew|fastlane|xcodebuild|\.\/gradlew|gradlew|python3?|pip3?|ts-node|tsc|expo)\b/i;

const NL_CMDS: [RegExp, string][] = [
  [/^run\s+ios$/i,                               'npx react-native run-ios'],
  [/^run\s+android$/i,                           'npx react-native run-android'],
  [/^(start|launch)\s+(metro|server|bundler)$/i, 'npx react-native start'],
  [/^(install|update)\s+pods?$/i,                'cd ios && pod install'],
  [/^reset\s+(cache|metro)$/i,                   'npx react-native start --reset-cache'],
  [/^clean\s+android$/i,                         'cd android && ./gradlew clean'],
  [/^(build|compile)\s+android$/i,               'cd android && ./gradlew assembleDebug'],
  [/^install\s+dep(s|endencies)?$/i,             'npm install'],
  [/^(lint|eslint)$/i,                           'npx eslint . --ext .ts,.tsx'],
  [/^(typecheck|tsc)$/i,                         'npx tsc --noEmit'],
];

function resolveDirectCmd(input: string): string | null {
  if (SHELL_RE.test(input)) return input;
  for (const [re, cmd] of NL_CMDS) {
    if (re.test(input)) return cmd;
  }
  return null;
}

function runDirect(
  cmd: string,
  cwd: string,
  send: (e: Record<string, unknown>) => void,
): Promise<void> {
  const safeDir = cwd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const safeCmd = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const appleScript = `
    tell application "Terminal"
      activate
      do script "cd \\"${safeDir}\\" && ${safeCmd}"
    end tell
  `;

  return new Promise((resolve) => {
    const proc = spawn('osascript', ['-e', appleScript], { stdio: 'pipe' });

    proc.on('close', () => {
      send({ type: 'text', content: `↗ Terminal opened\n\`${cmd}\`\n📂 ${cwd}` });
      send({ type: 'usage', inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, model: 'direct', intent: 'run' });
      send({ type: 'done' });
      resolve();
    });

    proc.on('error', () => {
      // Fallback: stream output inline (Linux / non-macOS)
      send({ type: 'text', content: `$ ${cmd}\n` });
      const fb = spawn('sh', ['-c', cmd], { cwd, env: { ...process.env } });
      fb.stdout?.on('data', (d: Buffer) => send({ type: 'text', content: d.toString() }));
      fb.stderr?.on('data', (d: Buffer) => send({ type: 'text', content: d.toString() }));
      fb.on('close', (code) => {
        if (code !== 0) send({ type: 'text', content: `\n↳ exited ${code}\n` });
        send({ type: 'usage', inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, model: 'direct', intent: 'run' });
        send({ type: 'done' });
        resolve();
      });
      fb.on('error', (err) => { send({ type: 'error', message: err.message }); resolve(); });
    });
  });
}

import { buildSystemPrompt } from '@/lib/systemPrompt';
import {
  tryFallbackChat,
  fallbackBanner,
  shouldAttemptFallback,
  isClaudeBillingFailure,
} from '@/lib/fallbackLlm';
import { sanitizeAgentOutput } from '@/lib/sanitizeAgentOutput';
import { randomUUID } from 'crypto';

function mapOllamaToolForUi(name: string): string {
  const m: Record<string, string> = {
    read_file: 'Read',
    write_file: 'Write',
    edit_file: 'Edit',
    run_command: 'Bash',
    glob_files: 'Glob',
    grep_files: 'Grep',
    list_directory: 'Glob',
    think: 'Think',
  };
  return m[name] ?? name;
}

function mapOllamaToolInput(name: string, input: Record<string, unknown>): Record<string, unknown> {
  if (name === 'read_file' && typeof input.path === 'string') return { file_path: input.path };
  if (name === 'write_file' && typeof input.path === 'string') return { file_path: input.path, content: input.content };
  if (name === 'edit_file' && typeof input.path === 'string') {
    return { file_path: input.path, old_string: input.old_string, new_string: input.new_string };
  }
  if (name === 'run_command' && typeof input.command === 'string') return { command: input.command };
  if (name === 'glob_files' && typeof input.pattern === 'string') {
    return {
      pattern: input.pattern,
      ...(typeof input.directory === 'string' ? { directory: input.directory } : {}),
    };
  }
  if (name === 'grep_files' && typeof input.pattern === 'string') {
    return { pattern: input.pattern, ...(typeof input.glob === 'string' ? { glob: input.glob } : {}) };
  }
  if (name === 'list_directory') return { pattern: input.path != null ? String(input.path) : '.' };
  if (name === 'think') return { thought: input.thought != null ? String(input.thought).slice(0, 2000) : '' };
  return input;
}

// ─── Intent classifier (zero LLM cost) ───────────────────────────────────────
type Intent = 'read' | 'write' | 'run' | 'debug';

// Ordered highest-specificity first to prevent cross-classification
const PATTERNS: [RegExp, Intent][] = [
  // ── run: shell execution needed ─────────────────────────────────────────────
  [/\b(run|start|launch|install|build|deploy|pod|gradle|metro|android|ios|npm|yarn|exec|test|lint|typecheck|tsc|compile|bundle|eject)\b/i, 'run'],
  // ── debug: broken things + performance ──────────────────────────────────────
  [/\b(fix|debug|error|crash|issue|problem|fail|broken|exception|traceback|why\s+is|slow|lag|freeze|memory|leak|warning|warn|flicker|re.?render|optimize|performance)\b/i, 'debug'],
  // ── write: code changes ─────────────────────────────────────────────────────
  [/\b(create|make|write|add|generate|new|scaffold|implement|refactor|update|change|edit|modify|delete|remove|rename|migrate|convert|replace|extract|move)\b/i, 'write'],
  // ── read: information retrieval ─────────────────────────────────────────────
  [/\b(open|show|read|explain|find|search|look|check|list|what|where|display|view|how\s+does|how\s+do|describe|summarize|review|diff|compare|understand|tell\s+me)\b/i, 'read'],
];

function classify(s: string): Intent {
  for (const [re, intent] of PATTERNS) {
    if (re.test(s)) return intent;
  }
  // Smart default: if it contains a file path or code-like content → write; else read
  if (/[./\\]|\.(ts|tsx|js|json|swift|kt|gradle)\b/.test(s)) return 'write';
  return 'read'; // safer/cheaper default than 'write'
}

type Cfg = Pick<Options, 'model' | 'allowedTools' | 'maxTurns'>;
const CFG: Record<Intent, Cfg> = {
  //          model              tools                                       turns  cost/1M in
  read:  { model: 'claude-haiku-4-5',  allowedTools: ['Read','Glob','Grep'],                maxTurns: 5 }, // $1
  run:   { model: 'claude-haiku-4-5',  allowedTools: ['Bash','Read','Glob'],                maxTurns: 6 }, // $1
  write: { model: 'claude-sonnet-4-6', allowedTools: ['Read','Write','Edit','Glob','Grep'], maxTurns: 8 }, // $3
  debug: { model: 'claude-sonnet-4-6', allowedTools: ['Read','Glob','Grep','Bash'],         maxTurns: 7 }, // $3
};

export async function POST(req: NextRequest) {
  if (API_TOKEN) {
    const token = req.headers.get('x-agent-token');
    if (!token || token !== API_TOKEN) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const { prompt: userPrompt, cwd: rawCwd, history: rawHistory } = (await req.json()) as {
    prompt: string;
    cwd?: string;
    history?: Array<{ role: 'user' | 'agent'; content: string }>;
  };
  const cwd = safeCwd(rawCwd);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      // ── Zero-token path: run shell command directly ──────────────────────
      const direct = resolveDirectCmd(userPrompt);
      if (direct) {
        send({ type: 'meta', intent: 'run', model: 'direct' });
        await runDirect(direct, cwd, send);
        controller.close();
        return;
      }

      // ── LLM path ─────────────────────────────────────────────────────────
      const intent = classify(userPrompt);
      const cfg    = CFG[intent];
      const systemPrompt = buildSystemPrompt(cwd, rawHistory ?? []);
      send({ type: 'meta', intent, model: cfg.model });

      try {
        const options: Options = {
          permissionMode: 'acceptEdits',
          systemPrompt,
          ...cfg,
          ...(cwd ? { cwd } : {}),
        };

        let assistantAccum = '';
        let billingBlocked = false;

        for await (const message of query({ prompt: userPrompt, options })) {
          const msg = message as Record<string, unknown>;

          if (msg.type === 'assistant') {
            const inner = msg.message as Record<string, unknown> | undefined;
            const content = inner?.content;

            if (Array.isArray(content)) {
              for (const block of content as Array<Record<string, unknown>>) {
                if (block?.type === 'text' && typeof block.text === 'string' && block.text) {
                  assistantAccum += block.text;
                  if (
                    isClaudeBillingFailure(block.text) ||
                    isClaudeBillingFailure(assistantAccum.trim())
                  ) {
                    billingBlocked = true;
                    continue;
                  }
                  send({ type: 'text', content: block.text });
                } else if (block?.type === 'tool_use') {
                  send({
                    type: 'tool_use',
                    id: block.id ?? '',
                    name: block.name,
                    input: block.input ?? {},
                  });
                }
              }
            }
          } else if (msg.type === 'result') {
            const usage = msg.usage as Record<string, number> | undefined;
            const resultStr = msg.result != null ? String(msg.result) : '';
            const looksLikeBilling =
              billingBlocked ||
              isClaudeBillingFailure(assistantAccum.trim()) ||
              (resultStr.length > 0 && isClaudeBillingFailure(resultStr));

            if (looksLikeBilling) {
              const fb = await tryFallbackChat(userPrompt, systemPrompt, { cwd, intent });
              if (fb) {
                send({ type: 'meta', intent, model: `${fb.provider}:${fb.model}` });
                const fbBanner = fallbackBanner(fb);
                if (fbBanner.trim()) {
                  send({ type: 'text', content: fbBanner });
                }
                for (const t of fb.toolCalls ?? []) {
                  send({
                    type: 'tool_use',
                    id: t.id || randomUUID(),
                    name: mapOllamaToolForUi(t.name),
                    input: mapOllamaToolInput(t.name, t.input),
                  });
                }
                send({ type: 'text', content: sanitizeAgentOutput(fb.text) });
                send({
                  type: 'usage',
                  inputTokens:  0,
                  outputTokens: 0,
                  cacheRead:    0,
                  cacheWrite:   0,
                  costUsd:      0,
                  model:        `${fb.provider}:${fb.model}`,
                  intent:       `${intent}·fallback`,
                });
                send({ type: 'done' });
                break;
              }
              send({
                type: 'text',
                content:
                  (assistantAccum || resultStr || 'Claude unavailable.') +
                  '\n\nNo fallback (install Ollama or set GEMINI_API_KEY / GROQ_API_KEY). See README.',
              });
              send({
                type: 'usage',
                inputTokens:  usage?.input_tokens  ?? 0,
                outputTokens: usage?.output_tokens ?? 0,
                cacheRead:    usage?.cache_read_input_tokens    ?? 0,
                cacheWrite:   usage?.cache_creation_input_tokens ?? 0,
                costUsd:      (msg.total_cost_usd as number | undefined) ?? 0,
                model:        cfg.model,
                intent,
              });
              send({ type: 'done' });
              break;
            }

            send({
              type: 'usage',
              inputTokens:  usage?.input_tokens  ?? 0,
              outputTokens: usage?.output_tokens ?? 0,
              cacheRead:    usage?.cache_read_input_tokens    ?? 0,
              cacheWrite:   usage?.cache_creation_input_tokens ?? 0,
              costUsd:      (msg.total_cost_usd as number | undefined) ?? 0,
              model:        cfg.model,
              intent,
            });
            send({ type: 'done' });
            break;
          }
        }
      } catch (err) {
        if (shouldAttemptFallback(err)) {
          const fb = await tryFallbackChat(userPrompt, systemPrompt, { cwd, intent });
          if (fb) {
            send({ type: 'meta', intent, model: `${fb.provider}:${fb.model}` });
            const fbBanner = fallbackBanner(fb);
            if (fbBanner.trim()) {
              send({ type: 'text', content: fbBanner });
            }
            for (const t of fb.toolCalls ?? []) {
              send({
                type: 'tool_use',
                id: t.id || randomUUID(),
                name: mapOllamaToolForUi(t.name),
                input: mapOllamaToolInput(t.name, t.input),
              });
            }
            send({ type: 'text', content: sanitizeAgentOutput(fb.text) });
            send({
              type: 'usage',
              inputTokens:  0,
              outputTokens: 0,
              cacheRead:    0,
              cacheWrite:   0,
              costUsd:      0,
              model:        `${fb.provider}:${fb.model}`,
              intent:       `${intent}·fallback`,
            });
            send({ type: 'done' });
          } else {
            send({
              type: 'error',
              message:
                `${err instanceof Error ? err.message : String(err)}\n\n` +
                'No fallback available. Install Ollama locally (ollama.com), or set GEMINI_API_KEY / GROQ_API_KEY in .env — see README.',
            });
          }
        } else {
          send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
