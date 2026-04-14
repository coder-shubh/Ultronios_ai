'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import {
  Bot, User, Terminal, FileText, FilePlus, FileEdit,
  Search, Globe, ChevronDown, ChevronRight, Copy, Check,
  Zap, TerminalSquare, Code2, Cpu, ArrowDown,
} from 'lucide-react';
import type { ChatMessage, ToolCall, TokenUsage } from '@/lib/types';

// ─── Tool config ──────────────────────────────────────────────────────────────

type ToolCfg = { icon: React.ElementType; color: string; bg: string; label: string; primaryKey: string };

const TOOL_MAP: Record<string, ToolCfg> = {
  Bash:      { icon: Terminal,       color: '#4ade80', bg: 'rgba(74,222,128,0.07)',   label: 'Run Command', primaryKey: 'command'   },
  Read:      { icon: FileText,       color: '#38bdf8', bg: 'rgba(56,189,248,0.07)',   label: 'Read File',   primaryKey: 'file_path' },
  Write:     { icon: FilePlus,       color: '#fb923c', bg: 'rgba(251,146,60,0.07)',   label: 'Write File',  primaryKey: 'file_path' },
  Edit:      { icon: FileEdit,       color: '#fb923c', bg: 'rgba(251,146,60,0.07)',   label: 'Edit File',   primaryKey: 'file_path' },
  Glob:      { icon: Search,         color: '#38bdf8', bg: 'rgba(56,189,248,0.07)',   label: 'Find Files',  primaryKey: 'pattern'   },
  Grep:      { icon: Search,         color: '#38bdf8', bg: 'rgba(56,189,248,0.07)',   label: 'Search Code', primaryKey: 'pattern'   },
  WebSearch: { icon: Globe,          color: '#a78bfa', bg: 'rgba(167,139,250,0.07)', label: 'Web Search',  primaryKey: 'query'     },
  WebFetch:  { icon: Globe,          color: '#a78bfa', bg: 'rgba(167,139,250,0.07)', label: 'Web Fetch',   primaryKey: 'url'       },
};

function primaryValue(name: string, input: Record<string, unknown>): string {
  const key = TOOL_MAP[name]?.primaryKey ?? Object.keys(input)[0] ?? '';
  const val = input[key];
  if (typeof val === 'string') return val.length > 90 ? val.slice(0, 90) + '…' : val;
  return '';
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyBtn({ text, size = 12 }: { text: string; size?: number }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <button
      onClick={copy}
      className="opacity-0 group-hover:opacity-100 transition-all p-1 rounded-md hover:bg-white/5"
      style={{ color: 'var(--text-muted)' }}
      title="Copy"
    >
      {copied
        ? <Check size={size} className="text-green-400" />
        : <Copy size={size} />
      }
    </button>
  );
}

// ─── Tool call card ───────────────────────────────────────────────────────────

function ToolCard({ tool }: { tool: ToolCall }) {
  const [open, setOpen] = useState(false);
  const cfg = TOOL_MAP[tool.name] ?? {
    icon: TerminalSquare, color: '#94a3b8', bg: 'rgba(148,163,184,0.07)',
    label: tool.name, primaryKey: '',
  };
  const Icon = cfg.icon;
  const pv = primaryValue(tool.name, tool.input);

  return (
    <div
      className="rounded-xl overflow-hidden text-xs transition-all"
      style={{ border: `1px solid ${cfg.color}22`, background: cfg.bg }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left"
      >
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ background: `${cfg.color}18` }}
        >
          <Icon size={11} style={{ color: cfg.color }} />
        </div>
        <span className="font-semibold" style={{ color: cfg.color }}>{cfg.label}</span>
        {pv && (
          <span className="truncate font-mono text-[11px]" style={{ color: 'var(--text-secondary)', minWidth: 0 }}>
            {pv}
          </span>
        )}
        <span className="ml-auto flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3" style={{ borderTop: `1px solid ${cfg.color}18` }}>
          <pre
            className="mt-2 text-[11px] overflow-x-auto p-2.5 rounded-lg font-mono leading-relaxed"
            style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)' }}
          >
            {JSON.stringify(tool.input, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Usage badge ──────────────────────────────────────────────────────────────

const MODEL_LABEL: Record<string, string> = {
  'claude-haiku-4-5':  'haiku',
  'claude-sonnet-4-6': 'sonnet',
  'claude-opus-4-6':   'opus',
  'direct':            'direct',
};

const INTENT_COLOR: Record<string, string> = {
  read:  'var(--c-read)',
  write: 'var(--c-write)',
  run:   'var(--c-run)',
  debug: 'var(--c-debug)',
};

function UsageBadge({ usage }: { usage: TokenUsage }) {
  const label = MODEL_LABEL[usage.model] ?? usage.model;
  const color = INTENT_COLOR[usage.intent] ?? '#94a3b8';
  const total = usage.inputTokens + usage.outputTokens;
  const isDirect = usage.model === 'direct';

  return (
    <div
      className="flex items-center gap-2 mt-3 flex-wrap px-3 py-2 rounded-xl"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
    >
      {/* intent · model pill */}
      <span
        className="text-[11px] px-2 py-0.5 rounded-full font-mono font-medium"
        style={{ background: `${color}18`, color, border: `1px solid ${color}35` }}
      >
        {label} · {usage.intent}
      </span>

      {isDirect ? (
        <span className="text-[11px] font-mono flex items-center gap-1" style={{ color: 'var(--c-run)' }}>
          <Zap size={10} />
          zero tokens
        </span>
      ) : (
        <>
          <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
            ↑{usage.inputTokens.toLocaleString()}
          </span>
          <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
            ↓{usage.outputTokens.toLocaleString()}
          </span>
          <span className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
            ∑{total.toLocaleString()}
          </span>
          {usage.cacheRead > 0 && (
            <span className="text-[11px] font-mono flex items-center gap-1 text-indigo-400">
              <Zap size={10} />
              {usage.cacheRead.toLocaleString()} cached
            </span>
          )}
          {usage.costUsd > 0 && (
            <span className="text-[11px] font-mono ml-auto" style={{ color: 'var(--text-muted)' }}>
              ${usage.costUsd.toFixed(5)}
            </span>
          )}
          {usage.costUsd === 0 && (
            <span className="text-[11px] font-mono ml-auto text-green-400">$0.00000</span>
          )}
        </>
      )}
    </div>
  );
}

// ─── Code block with header ───────────────────────────────────────────────────

function CodeBlock({ lang, children }: { lang: string; children: string }) {
  return (
    <div className="code-block-wrap my-3 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      <div className="code-block-header">
        <span className="code-lang-tag">{lang || 'code'}</span>
        <CopyBtn text={children} size={11} />
      </div>
      <SyntaxHighlighter
        style={vscDarkPlus as Record<string, React.CSSProperties>}
        language={lang || 'text'}
        PreTag="div"
        customStyle={{ margin: 0, borderRadius: 0, fontSize: '0.8rem', background: '#0d0d14', padding: '1rem' }}
        showLineNumbers={children.split('\n').length > 4}
        lineNumberStyle={{ color: '#3a3a5a', fontSize: '0.7rem', minWidth: '2rem' }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
}

// ─── Thinking dots ────────────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex items-center gap-1">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="w-1.5 h-1.5 rounded-full bg-indigo-400 dot-bounce"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Working…</span>
    </div>
  );
}

// ─── Agent message ────────────────────────────────────────────────────────────

function AgentMessage({ msg }: { msg: ChatMessage }) {
  return (
    <div className="flex items-start gap-3 group msg-enter">
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 shadow-lg"
        style={{ background: 'var(--accent-subtle)', border: '1px solid rgba(99,102,241,0.25)' }}
      >
        <Bot size={15} className="text-indigo-400" />
      </div>

      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-semibold" style={{ color: 'var(--accent-light)' }}>
            Ultronios
          </span>
          {msg.usage && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-md font-mono"
              style={{
                background: 'var(--bg-elevated)',
                color: 'var(--text-muted)',
                border: '1px solid var(--border)',
              }}
            >
              {MODEL_LABEL[msg.usage.model] ?? msg.usage.model}
            </span>
          )}
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <CopyBtn text={msg.content} />
        </div>

        {/* Tool calls */}
        {msg.toolCalls.length > 0 && (
          <div className="mb-3 space-y-1.5">
            {msg.toolCalls.map((t) => <ToolCard key={t.id} tool={t} />)}
          </div>
        )}

        {/* Content */}
        {msg.isError ? (
          <div
            className="text-sm px-4 py-3 rounded-xl"
            style={{
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.25)',
              color: '#fca5a5',
            }}
          >
            {msg.content}
          </div>
        ) : msg.content ? (
          <div className={`prose-agent ${msg.isStreaming ? 'streaming-cursor' : ''}`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                code({ inline, className, children, ...props }: any) {
                  const lang = /language-(\w+)/.exec(className ?? '')?.[1] ?? '';
                  if (!inline && lang) {
                    return <CodeBlock lang={lang}>{String(children).replace(/\n$/, '')}</CodeBlock>;
                  }
                  return <code className={className} {...props}>{children}</code>;
                },
              }}
            >
              {msg.content}
            </ReactMarkdown>
          </div>
        ) : msg.isStreaming ? (
          <ThinkingDots />
        ) : null}

        {/* Usage badge */}
        {!msg.isStreaming && msg.usage && <UsageBadge usage={msg.usage} />}
      </div>
    </div>
  );
}

// ─── User message ─────────────────────────────────────────────────────────────

function UserMessage({ msg }: { msg: ChatMessage }) {
  return (
    <div className="flex items-start gap-3 justify-end group msg-enter">
      <div className="max-w-[78%]">
        <div className="flex items-center justify-end gap-2 mb-2">
          <CopyBtn text={msg.content} />
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>You</span>
        </div>
        <div
          className="px-4 py-3 rounded-2xl rounded-tr-md text-sm leading-relaxed whitespace-pre-wrap"
          style={{
            background: 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.15))',
            border: '1px solid rgba(99,102,241,0.3)',
            color: 'var(--text-primary)',
          }}
        >
          {msg.content}
        </div>
      </div>
      <div
        className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
      >
        <User size={14} style={{ color: 'var(--text-secondary)' }} />
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  { text: 'run ios',                          tag: 'run',   icon: '📱' },
  { text: 'run android',                      tag: 'run',   icon: '🤖' },
  { text: 'explain the project structure',    tag: 'read',  icon: '🗂️'  },
  { text: 'fix TypeScript errors',            tag: 'debug', icon: '🐛' },
  { text: 'create a new screen component',    tag: 'write', icon: '✏️'  },
  { text: 'install pods',                     tag: 'run',   icon: '🔧' },
];

const TAG_COLORS: Record<string, string> = {
  read:  'var(--c-read)',
  write: 'var(--c-write)',
  run:   'var(--c-run)',
  debug: 'var(--c-debug)',
};

function EmptyState({ onSuggest }: { onSuggest: (s: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center">
      {/* Hero icon */}
      <div className="relative mb-5">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-2xl"
          style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
        >
          <Cpu size={30} className="text-white" />
        </div>
        <div
          className="absolute -bottom-1 -right-1 w-6 h-6 rounded-lg flex items-center justify-center"
          style={{ background: '#4ade80' }}
        >
          <Code2 size={12} className="text-black" />
        </div>
      </div>

      <h2 className="text-xl font-bold mb-1 tracking-tight" style={{ color: 'var(--text-primary)' }}>
        Ultronios
      </h2>
      <p className="text-sm max-w-xs mb-8" style={{ color: 'var(--text-secondary)' }}>
        Your autonomous senior RN engineer. Opens files, runs projects, writes &amp; debugs code — all from one prompt.
      </p>

      {/* Capability pills */}
      <div className="flex flex-wrap gap-2 justify-center mb-8">
        {(['read', 'write', 'run', 'debug'] as const).map((intent) => (
          <span
            key={intent}
            className="text-xs px-2.5 py-1 rounded-full font-medium capitalize"
            style={{
              background: `${TAG_COLORS[intent]}15`,
              border: `1px solid ${TAG_COLORS[intent]}35`,
              color: TAG_COLORS[intent],
            }}
          >
            {intent}
          </span>
        ))}
      </div>

      {/* Suggestions grid */}
      <div className="grid grid-cols-2 gap-2 w-full max-w-md">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.text}
            onClick={() => onSuggest(s.text)}
            className="flex items-center gap-2.5 px-3 py-3 rounded-xl text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
            }}
          >
            <span className="text-base">{s.icon}</span>
            <div className="min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                {s.text}
              </p>
              <p
                className="text-[10px] font-medium capitalize mt-0.5"
                style={{ color: TAG_COLORS[s.tag] }}
              >
                {s.tag}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── MessageList ──────────────────────────────────────────────────────────────

type Props = { messages: ChatMessage[]; isProcessing: boolean; onSend?: (s: string) => void };

export default function MessageList({ messages, onSend }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showJumpBottom, setShowJumpBottom] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setShowJumpBottom(!nearBottom && el.scrollHeight > el.clientHeight + 40);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener('scroll', checkScroll, { passive: true });
    return () => el.removeEventListener('scroll', checkScroll);
  }, [checkScroll, messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const jumpBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  if (messages.length === 0) {
    return (
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        <EmptyState onSuggest={onSend ?? (() => {})} />
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 relative">
      <div className="max-w-3xl mx-auto px-5 py-6 space-y-7">
        {messages.map((msg) =>
          msg.role === 'user'
            ? <UserMessage key={msg.id} msg={msg} />
            : <AgentMessage key={msg.id} msg={msg} />,
        )}
        <div ref={bottomRef} />
      </div>
      {showJumpBottom && (
        <button
          type="button"
          onClick={jumpBottom}
          className="absolute bottom-4 right-4 md:right-8 z-10 flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium shadow-lg transition-transform hover:scale-105"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          }}
        >
          <ArrowDown size={14} />
          Latest
        </button>
      )}
    </div>
  );
}
