'use client';

import Link from 'next/link';
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Menu,
  Download,
  Sparkles,
  MessageSquare,
  Hash,
} from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import Sidebar from '@/components/Sidebar';
import MessageList from '@/components/MessageList';
import ChatInput from '@/components/ChatInput';
import type { ChatMessage, Session, SSEEvent } from '@/lib/types';
import {
  getSessions,
  createSession,
  updateSession,
  updateSessionCwd,
  deleteSession,
} from '@/lib/history';
import { DEFAULT_WORKSPACE_CWD } from '@/lib/workspacePath';
import { messagesToMarkdown, downloadMarkdown } from '@/lib/exportChat';

export default function ChatApp() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [cwd, setCwd] = useState(DEFAULT_WORKSPACE_CWD);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const messagesRef = useRef<ChatMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  messagesRef.current = messages;

  const closeSidebarMobile = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    const all = getSessions();
    setSessions(all);
    if (all.length > 0) {
      const latest = all[0];
      setActiveId(latest.id);
      setMessages(latest.messages);
      setCwd(latest.cwd);
    }
  }, []);

  useEffect(() => {
    if (!activeId) return;
    updateSession(activeId, messages);
    setSessions(getSessions());
  }, [messages, activeId]);

  const newChat = useCallback(() => {
    const session = createSession(cwd);
    setSessions(getSessions());
    setActiveId(session.id);
    setMessages([]);
    closeSidebarMobile();
  }, [cwd, closeSidebarMobile]);

  const loadSession = useCallback(
    (id: string) => {
      const session = getSessions().find((s) => s.id === id);
      if (!session) return;
      setActiveId(session.id);
      setMessages(session.messages);
      setCwd(session.cwd);
      closeSidebarMobile();
    },
    [closeSidebarMobile],
  );

  const removeSession = useCallback(
    (id: string) => {
      deleteSession(id);
      const remaining = getSessions();
      setSessions(remaining);
      if (id === activeId) {
        if (remaining.length > 0) {
          loadSession(remaining[0].id);
        } else {
          setActiveId(null);
          setMessages([]);
        }
      }
    },
    [activeId, loadSession],
  );

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const sendMessage = useCallback(
    async (prompt: string) => {
      if (isProcessing || !prompt.trim()) return;

      let sessionId = activeId;
      if (!sessionId) {
        const session = createSession(cwd);
        setSessions(getSessions());
        setActiveId(session.id);
        sessionId = session.id;
      }

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: prompt,
        toolCalls: [],
        isStreaming: false,
        timestamp: new Date(),
      };

      const agentId = crypto.randomUUID();
      const agentMsg: ChatMessage = {
        id: agentId,
        role: 'agent',
        content: '',
        toolCalls: [],
        isStreaming: true,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg, agentMsg]);
      setIsProcessing(true);

      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const res = await fetch('/api/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, cwd }),
          signal: ac.signal,
        });

        if (!res.ok || !res.body) throw new Error(`Server error ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            let event: SSEEvent;
            try {
              event = JSON.parse(line.slice(6)) as SSEEvent;
            } catch {
              continue;
            }

            if (event.type === 'text') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === agentId ? { ...m, content: m.content + event.content } : m,
                ),
              );
            } else if (event.type === 'tool_use') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === agentId
                    ? {
                        ...m,
                        toolCalls: [
                          ...m.toolCalls,
                          { id: event.id, name: event.name, input: event.input },
                        ],
                      }
                    : m,
                ),
              );
            } else if (event.type === 'usage') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === agentId
                    ? {
                        ...m,
                        usage: {
                          inputTokens: event.inputTokens,
                          outputTokens: event.outputTokens,
                          cacheRead: event.cacheRead,
                          cacheWrite: event.cacheWrite,
                          costUsd: event.costUsd,
                          model: event.model,
                          intent: event.intent,
                        },
                      }
                    : m,
                ),
              );
            } else if (event.type === 'done') {
              setMessages((prev) =>
                prev.map((m) => (m.id === agentId ? { ...m, isStreaming: false } : m)),
              );
            } else if (event.type === 'error') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === agentId
                    ? {
                        ...m,
                        content: `Error: ${event.message}`,
                        isStreaming: false,
                        isError: true,
                      }
                    : m,
                ),
              );
            }
          }
        }
      } catch (err) {
        const aborted = err instanceof Error && err.name === 'AbortError';
        if (aborted) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === agentId
                ? {
                    ...m,
                    content: m.content
                      ? `${m.content}\n\n_— Stopped._`
                      : '_Stopped._',
                    isStreaming: false,
                  }
                : m,
            ),
          );
        } else {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === agentId
                ? {
                    ...m,
                    content: `Failed to reach agent: ${err instanceof Error ? err.message : String(err)}`,
                    isStreaming: false,
                    isError: true,
                  }
                : m,
            ),
          );
        }
      } finally {
        abortRef.current = null;
        setIsProcessing(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentId && m.isStreaming ? { ...m, isStreaming: false } : m,
          ),
        );
      }
    },
    [isProcessing, cwd, activeId],
  );

  const handleCwdChange = useCallback(
    (path: string) => {
      setCwd(path);
      if (activeId) {
        updateSessionCwd(activeId, path);
        setSessions(getSessions());
      }
      closeSidebarMobile();
    },
    [activeId, closeSidebarMobile],
  );

  const handleResetCwd = useCallback(() => {
    setCwd(DEFAULT_WORKSPACE_CWD);
    if (activeId) {
      updateSessionCwd(activeId, DEFAULT_WORKSPACE_CWD);
      setSessions(getSessions());
    }
  }, [activeId]);

  const exportChat = useCallback(() => {
    if (messages.length === 0) return;
    const title = sessions.find((s) => s.id === activeId)?.title ?? 'chat';
    const safe = title.replace(/[^\w\s-]/g, '').slice(0, 40) || 'chat';
    const md = messagesToMarkdown(messages, title);
    const name = `forge-${safe}-${new Date().toISOString().slice(0, 10)}.md`;
    downloadMarkdown(name, md);
  }, [messages, sessions, activeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        newChat();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newChat]);

  const userTurns = messages.filter((m) => m.role === 'user').length;
  const sessionTokens = messages.reduce(
    (acc, m) =>
      acc +
      (m.usage ? (m.usage.inputTokens ?? 0) + (m.usage.outputTokens ?? 0) : 0),
    0,
  );

  const title =
    messages.length > 0
      ? messages.find((m) => m.role === 'user')?.content.slice(0, 56) ?? 'Conversation'
      : 'New conversation';

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/45 md:hidden"
          aria-label="Close menu"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div
        className={[
          'fixed inset-y-0 left-0 z-50 w-64 max-w-[85vw] transition-transform duration-200 ease-out md:static md:z-0 md:max-w-none md:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <Sidebar
          sessions={sessions}
          activeId={activeId}
          cwd={cwd}
          defaultCwd={DEFAULT_WORKSPACE_CWD}
          onNewChat={newChat}
          onLoadSession={loadSession}
          onDeleteSession={removeSession}
          onCwdChange={handleCwdChange}
          onResetCwd={handleResetCwd}
          onCloseMobile={() => setSidebarOpen(false)}
        />
      </div>

      <div className="flex flex-col flex-1 min-w-0">
        <div
          className="flex items-center justify-between px-3 sm:px-5 py-2.5 flex-shrink-0 gap-2 sm:gap-3"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              type="button"
              className="md:hidden flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
              aria-label="Open sidebar"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={18} style={{ color: 'var(--text-secondary)' }} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <MessageSquare size={14} className="flex-shrink-0 hidden sm:block" style={{ color: 'var(--text-muted)' }} />
                <span
                  className="text-sm font-semibold truncate"
                  style={{ color: 'var(--text-primary)' }}
                  title={title}
                >
                  {title}
                </span>
              </div>
              <div
                className="flex items-center gap-2 mt-0.5 text-[10px] sm:text-[11px] font-mono"
                style={{ color: 'var(--text-muted)' }}
              >
                <span className="flex items-center gap-0.5">
                  <Hash size={10} />
                  {userTurns} prompt{userTurns === 1 ? '' : 's'}
                </span>
                {sessionTokens > 0 && (
                  <span className="flex items-center gap-0.5">
                    <Sparkles size={10} />
                    {sessionTokens.toLocaleString()} tok
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={exportChat}
              disabled={messages.length === 0}
              className="flex items-center gap-1.5 text-xs font-medium px-2 py-1.5 sm:px-2.5 rounded-lg transition-colors disabled:opacity-35"
              style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
              title="Download chat as Markdown"
            >
              <Download size={14} />
              <span className="hidden sm:inline">Export</span>
            </button>
            <Link
              href="/"
              className="text-xs font-medium px-2 py-1.5 sm:px-2.5 rounded-lg transition-colors"
              style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
            >
              Intro
            </Link>
            <Link
              href="/dashboard"
              className="text-xs font-medium px-2 py-1.5 sm:px-2.5 rounded-lg transition-colors hidden sm:inline-flex"
              style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
            >
              Dashboard
            </Link>
            <ThemeToggle />
          </div>

          <div className="hidden lg:flex items-center gap-2 flex-shrink-0 max-w-[200px] xl:max-w-[260px]">
            <span
              className="text-xs font-mono px-2.5 py-1 rounded-lg truncate"
              style={{
                background: 'var(--bg-elevated)',
                color: 'var(--text-muted)',
                border: '1px solid var(--border)',
              }}
              title={cwd}
            >
              {cwd.split('/').pop()}
            </span>
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${isProcessing ? 'bg-amber-400 animate-pulse' : 'bg-green-400'}`}
              />
              <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                {isProcessing ? 'working' : 'ready'}
              </span>
            </div>
          </div>
        </div>

        <div className="lg:hidden flex items-center justify-between px-3 py-1.5 border-b text-[11px] font-mono" style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
          <span className="truncate flex-1 mr-2" title={cwd}>
            {cwd}
          </span>
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isProcessing ? 'bg-amber-400 animate-pulse' : 'bg-green-400'}`} />
        </div>

        <MessageList messages={messages} isProcessing={isProcessing} onSend={sendMessage} />
        <ChatInput onSend={sendMessage} isProcessing={isProcessing} onStop={stopGeneration} />
      </div>
    </div>
  );
}
