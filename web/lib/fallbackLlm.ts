/**
 * Free / cheap fallbacks when Anthropic is unavailable (low credits, rate limits, outage).
 * Chat-only — no Read/Write/Bash tools (unlike the Claude agent SDK).
 *
 * Priority (first that succeeds):
 * 1. Ollama — local, no API key (OLLAMA_BASE_URL, default http://127.0.0.1:11434)
 * 2. Google Gemini — free tier with GEMINI_API_KEY from AI Studio
 * 3. Groq — free tier with GROQ_API_KEY
 */

export type FallbackChatResult = {
  text: string;
  provider: 'ollama' | 'gemini' | 'groq';
  model: string;
  /** Ollama local agent tool trace (read/write/run) */
  toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
};

function timeoutMs(): number {
  const n = Number(process.env.FALLBACK_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 120_000;
}

function abort(): AbortSignal {
  const ms = timeoutMs();
  if (typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

/** When true, try Ollama/Gemini/Groq after Claude fails (currently: always, for resilience). */
export function shouldAttemptFallback(err: unknown): boolean {
  void err;
  return true;
}

/**
 * Claude Agent SDK often returns billing / quota errors as normal assistant text (no throw).
 * Detect that so we can switch to free fallbacks instead of showing the raw error.
 */
export function isClaudeBillingFailure(text: string): boolean {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (t.length < 6) return false;
  if (t.includes('credit balance') && (t.includes('low') || t.includes('insufficient'))) return true;
  if (t.includes('balance is too low')) return true;
  if (t.includes('insufficient') && t.includes('credit')) return true;
  if (t.includes('billing') && (t.includes('failed') || t.includes('error') || t.includes('issue'))) return true;
  if (t.includes('payment') && t.includes('required')) return true;
  if (t.includes('exceeded') && (t.includes('quota') || t.includes('limit'))) return true;
  if (t.includes('rate limit') || t.includes('too many requests')) return true;
  if (t.includes('api key') && (t.includes('invalid') || t.includes('expired'))) return true;
  return false;
}

/**
 * Pick the right Ollama model based on the intent.
 * - write/debug → OLLAMA_CODER_MODEL (default: qwen2.5-coder:7b) — bigger, smarter for code tasks
 * - read/run    → OLLAMA_CHAT_MODEL  (default: llama3.2)          — faster, cheaper for Q&A
 * - OLLAMA_MODEL overrides both if set
 */
function pickOllamaModel(intent?: string): string {
  if (process.env.OLLAMA_MODEL) return process.env.OLLAMA_MODEL;
  const isCode = intent === 'write' || intent === 'debug';
  if (isCode) return process.env.OLLAMA_CODER_MODEL ?? 'qwen2.5-coder:7b';
  return process.env.OLLAMA_CHAT_MODEL ?? 'llama3.2';
}

async function ollamaChat(
  userPrompt: string,
  systemPrompt: string,
  cwd?: string,
  intent?: string,
): Promise<FallbackChatResult | null> {
  if (process.env.OLLAMA_DISABLED === '1') return null;

  const model = pickOllamaModel(intent);

  if (cwd && process.env.OLLAMA_TOOLS !== '0') {
    const { runOllamaAgentWithTools } = await import('./ollamaAgent');
    const agent = await runOllamaAgentWithTools(userPrompt, systemPrompt, cwd, model);
    if (agent) {
      return {
        text: agent.text,
        provider: 'ollama',
        model: agent.model,
        toolCalls: agent.toolCalls.length ? agent.toolCalls : undefined,
      };
    }
  }

  const base = (process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
    }),
    signal: abort(),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) return null;
  return { text, provider: 'ollama', model };
}

async function geminiChat(
  userPrompt: string,
  systemPrompt: string,
): Promise<FallbackChatResult | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const combined = `${systemPrompt}\n\n---\n\nUser:\n${userPrompt}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: combined }] }],
    }),
    signal: abort(),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')?.trim();
  if (!text) return null;
  return { text, provider: 'gemini', model };
}

async function groqChat(
  userPrompt: string,
  systemPrompt: string,
): Promise<FallbackChatResult | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  const model = process.env.GROQ_MODEL ?? 'llama-3.1-8b-instant';
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
    }),
    signal: abort(),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) return null;
  return { text, provider: 'groq', model };
}

const ORDER = ['ollama', 'gemini', 'groq'] as const;

/** Env FALLBACK_ORDER=ollama,gemini,groq (subset/reorder). */
function orderedProviders(): (typeof ORDER)[number][] {
  const raw = process.env.FALLBACK_ORDER?.trim();
  if (!raw) return [...ORDER];
  const set = new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  const list = ORDER.filter((p) => set.has(p));
  return list.length > 0 ? list : [...ORDER];
}

export type FallbackOptions = {
  /** Required for Ollama tool agent (read/write/run jailed to this folder). */
  cwd?: string;
  /** Intent from classifier — used to pick the right Ollama model (write/debug → coder model). */
  intent?: string;
};

/**
 * Returns a reply from the first working fallback provider, or null.
 */
export async function tryFallbackChat(
  userPrompt: string,
  systemPrompt: string,
  options?: FallbackOptions,
): Promise<FallbackChatResult | null> {
  const cwd = options?.cwd;
  const runners: Record<
    (typeof ORDER)[number],
    () => Promise<FallbackChatResult | null>
  > = {
    ollama: () => ollamaChat(userPrompt, systemPrompt, cwd, options?.intent),
    gemini: () => geminiChat(userPrompt, systemPrompt),
    groq:   () => groqChat(userPrompt, systemPrompt),
  };

  for (const p of orderedProviders()) {
    try {
      const out = await runners[p]();
      if (out) return out;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Set FALLBACK_VERBOSE_BANNER=1 for long "Claude unavailable …" notices. Default is quiet (footer shows model). */
export function fallbackBanner(result: FallbackChatResult): string {
  const label =
    result.provider === 'ollama'
      ? `Ollama (${result.model})`
      : result.provider === 'gemini'
        ? `Gemini (${result.model})`
        : `Groq (${result.model})`;

  if (process.env.FALLBACK_VERBOSE_BANNER === '1') {
    if (result.provider === 'ollama' && result.toolCalls?.length) {
      return `*Using local **${result.model}** with project tools (read, edit, search, run).*\n\n`;
    }
    return `*Using **${label}** — chat-only (no project file access).*\n\n`;
  }

  if (result.provider === 'ollama') return '';
  return `*Assistant: **${label}** (chat-only).*\n\n`;
}

/** Plain text for terminal (CLI). */
export function fallbackBannerPlain(result: FallbackChatResult): string {
  const label =
    result.provider === 'ollama'
      ? `Ollama (${result.model})`
      : result.provider === 'gemini'
        ? `Gemini (${result.model})`
        : `Groq (${result.model})`;

  if (process.env.FALLBACK_VERBOSE_BANNER === '1') {
    if (result.provider === 'ollama' && result.toolCalls?.length) {
      return `Using local ${result.model} with project tools.\n\n`;
    }
    return `Using ${label} (chat-only).\n\n`;
  }

  if (result.provider === 'ollama') return '';
  return `Using ${label} (chat-only).\n\n`;
}
