'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Loader2, Command, Square } from 'lucide-react';

type Props = {
  onSend: (prompt: string) => void;
  isProcessing: boolean;
  /** Abort in-flight agent request */
  onStop?: () => void;
};

const QUICK_ACTIONS = [
  { label: 'run ios',          icon: '📱' },
  { label: 'run android',      icon: '🤖' },
  { label: 'npm install',      icon: '📦' },
  { label: 'install pods',     icon: '🔧' },
  { label: 'start metro',      icon: '⚡' },
  { label: 'typecheck',        icon: '✅' },
];

export default function ChatInput({ onSend, isProcessing, onStop }: Props) {
  const [text, setText]         = useState('');
  const [showQuick, setShowQuick] = useState(false);
  const textareaRef             = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  // focus on mount
  useEffect(() => { textareaRef.current?.focus(); }, []);

  const submit = useCallback((value?: string) => {
    const trimmed = (value ?? text).trim();
    if (!trimmed || isProcessing) return;
    onSend(trimmed);
    setText('');
    setShowQuick(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [text, isProcessing, onSend]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') setShowQuick(false);
  };

  const hasText = text.trim().length > 0;

  return (
    <div
      className="px-4 py-3"
      style={{ background: 'var(--bg-surface)', borderTop: '1px solid var(--border)' }}
    >
      {/* ── Quick-action chips ─────────────────────────────────────────────── */}
      {showQuick && !isProcessing && (
        <div className="max-w-3xl mx-auto mb-2 flex flex-wrap gap-1.5">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.label}
              onClick={() => submit(a.label)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all hover:scale-105 active:scale-95"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
              }}
            >
              <span>{a.icon}</span>
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Input box ─────────────────────────────────────────────────────── */}
      <div
        className="max-w-3xl mx-auto flex items-end gap-2 rounded-2xl px-3 py-2.5 transition-all input-wrap"
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
        }}
      >
        {/* Quick-actions toggle */}
        <button
          onClick={() => setShowQuick((v) => !v)}
          title="Quick actions"
          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all mb-0.5"
          style={{
            background: showQuick ? 'var(--accent-subtle)' : 'transparent',
            color: showQuick ? 'var(--accent-light)' : 'var(--text-muted)',
          }}
        >
          <Command size={13} />
        </button>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={isProcessing ? 'Agent is working…' : 'Ask anything or type a command…'}
          disabled={isProcessing}
          rows={1}
          className="flex-1 resize-none bg-transparent outline-none text-sm leading-relaxed py-0.5 disabled:opacity-50"
          style={{
            color: 'var(--text-primary)',
            maxHeight: '180px',
            caretColor: 'var(--accent-light)',
          }}
        />

        {/* Send / stop */}
        {isProcessing && onStop ? (
          <button
            type="button"
            onClick={onStop}
            className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all mb-0.5"
            style={{
              background: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid rgba(239, 68, 68, 0.45)',
            }}
            title="Stop generation"
            aria-label="Stop generation"
          >
            <Square size={12} className="text-red-400 fill-red-400" />
          </button>
        ) : (
          <button
            onClick={() => submit()}
            disabled={!hasText || isProcessing}
            className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all mb-0.5 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: hasText && !isProcessing ? 'var(--accent)' : 'var(--bg-hover)',
              boxShadow: hasText && !isProcessing ? '0 0 12px rgba(99,102,241,0.5)' : 'none',
              transform: hasText && !isProcessing ? 'scale(1.05)' : 'scale(1)',
            }}
            title="Send (Enter)"
          >
            {isProcessing ? (
              <Loader2 size={14} className="text-indigo-400 animate-spin" />
            ) : (
              <Send size={13} className="text-white" style={{ marginLeft: 1 }} />
            )}
          </button>
        )}
      </div>

      {/* ── Status bar ────────────────────────────────────────────────────── */}
      <div className="max-w-3xl mx-auto mt-1.5 flex items-center justify-between px-1">
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {isProcessing ? (
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              Agent working…
            </span>
          ) : (
            <>
              ↵ send · ⇧↵ newline · <kbd className="px-1 rounded" style={{ background: 'var(--bg-hover)' }}>⌘N</kbd> new chat
            </>
          )}
        </span>
        {text.length > 0 && (
          <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
            {text.length}
          </span>
        )}
      </div>
    </div>
  );
}
