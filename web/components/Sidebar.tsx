'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, FolderOpen, ChevronRight,
  Code2, Smartphone, Clock, DollarSign, MessageSquare,
  Search, Zap, X, RotateCcw, RefreshCw, Folder,
} from 'lucide-react';
import type { Session } from '@/lib/types';
import type { ProjectEntry } from '@/app/api/projects/route';

const STORAGE_KEY = 'invia_workspace_root';

// Deterministic color from project name
function projectColor(name: string): string {
  const palette = ['#f97316','#38bdf8','#4ade80','#a78bfa','#fb7185','#fbbf24','#34d399','#60a5fa'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

type Props = {
  sessions: Session[];
  activeId: string | null;
  cwd: string;
  /** Shown for “Reset path” — matches `DEFAULT_WORKSPACE_CWD` / env */
  defaultCwd: string;
  onNewChat: () => void;
  onLoadSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onCwdChange: (path: string) => void;
  onResetCwd: () => void;
  /** Mobile drawer: close when navigating */
  onCloseMobile?: () => void;
};

function relativeTime(date: Date): string {
  const diff = Date.now() - +date;
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatHistoryDate(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'Unknown date';

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today, ${time}`;
  if (isYesterday) return `Yesterday, ${time}`;

  return date.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Sidebar({
  sessions, activeId, cwd, defaultCwd,
  onNewChat, onLoadSession, onDeleteSession, onCwdChange, onResetCwd,
  onCloseMobile,
}: Props) {
  const [tab, setTab]                   = useState<'history' | 'projects'>('history');
  const [search, setSearch]             = useState('');
  const [customPath, setCustomPath]     = useState('');
  const [showCustom, setShowCustom]     = useState(false);
  const [hoveredId, setHoveredId]       = useState<string | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState<string>(() =>
    (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY)) || '',
  );
  const [workspaceInput, setWorkspaceInput] = useState('');
  const [showRootInput, setShowRootInput]   = useState(false);
  const [projects, setProjects]             = useState<ProjectEntry[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  const fetchProjects = useCallback(async (root: string) => {
    if (!root) return;
    setLoadingProjects(true);
    try {
      const res = await fetch(`/api/projects?dir=${encodeURIComponent(root)}`);
      if (res.ok) {
        const data = (await res.json()) as { projects: ProjectEntry[] };
        setProjects(data.projects);
      } else {
        setProjects([]);
      }
    } catch {
      setProjects([]);
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  useEffect(() => {
    if (workspaceRoot) fetchProjects(workspaceRoot);
  }, [workspaceRoot, fetchProjects]);

  const applyWorkspaceRoot = (root: string) => {
    const trimmed = root.trim();
    if (!trimmed) return;
    setWorkspaceRoot(trimmed);
    localStorage.setItem(STORAGE_KEY, trimmed);
    setWorkspaceInput('');
    setShowRootInput(false);
  };

  const activeSession = sessions.find((s) => s.id === activeId);
  const activeProject = projects.find((p) => p.path === cwd);

  const filtered = sessions.filter((s) =>
    !search || s.title.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <aside
      className="w-64 flex-shrink-0 flex flex-col h-full"
      style={{ background: 'var(--bg-surface)', borderRight: '1px solid var(--border)' }}
    >
      {/* ── Logo ───────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 py-4 gap-2"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="md:hidden flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}
              aria-label="Close sidebar"
            >
              <X size={16} style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
          <div className="w-8 h-8 rounded-xl logo-gradient flex items-center justify-center flex-shrink-0 shadow-lg">
            <Zap size={15} className="text-white" strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Ultronios
            </p>
            <p className="text-[10px] font-medium tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
              RN Agent
            </p>
          </div>
        </div>
        <button
          onClick={onNewChat}
          title="New chat"
          className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-105"
          style={{ background: 'var(--accent-subtle)', border: '1px solid rgba(99,102,241,0.25)' }}
        >
          <Plus size={13} style={{ color: 'var(--accent-light)' }} />
        </button>
      </div>

      {/* ── Active project pill ─────────────────────────────────────────────── */}
      {activeProject && (
        <div
          className="mx-3 mt-2.5 mb-1 flex items-center gap-2 px-3 py-1.5 rounded-lg"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: projectColor(activeProject.name), boxShadow: `0 0 6px ${projectColor(activeProject.name)}` }}
          />
          <span className="text-xs font-medium truncate" style={{ color: projectColor(activeProject.name) }}>
            {activeProject.name}
          </span>
        </div>
      )}

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div className="flex mx-3 mt-2 rounded-lg p-0.5" style={{ background: 'var(--bg-elevated)' }}>
        {(['history', 'projects'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 py-1.5 text-xs font-medium capitalize rounded-md transition-all"
            style={{
              background: tab === t ? 'var(--bg-hover)' : 'transparent',
              color: tab === t ? 'var(--accent-light)' : 'var(--text-muted)',
              boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.4)' : 'none',
            }}
          >
            {t === 'history' ? 'History' : 'Projects'}
          </button>
        ))}
      </div>

      {/* ── History tab ─────────────────────────────────────────────────────── */}
      {tab === 'history' && (
        <>
          {/* Search */}
          <div className="px-3 mt-2">
            <div
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
            >
              <Search size={11} style={{ color: 'var(--text-muted)' }} className="flex-shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search history…"
                className="flex-1 bg-transparent text-xs outline-none"
                style={{ color: 'var(--text-primary)' }}
              />
              {search && (
                <button onClick={() => setSearch('')}>
                  <X size={10} style={{ color: 'var(--text-muted)' }} />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto mt-2 px-2 pb-2">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2">
                <MessageSquare size={20} style={{ color: 'var(--text-muted)' }} />
                <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
                  {search ? 'No results' : 'No history yet'}
                </p>
              </div>
            ) : (
              <ul className="space-y-0.5">
                {filtered.map((s) => (
                  <li key={s.id}>
                    <div
                      role="button"
                      onClick={() => onLoadSession(s.id)}
                      onMouseEnter={() => setHoveredId(s.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      className={`w-full flex items-start gap-2.5 px-2.5 py-2.5 rounded-xl cursor-pointer transition-all ${
                        s.id === activeId ? 'session-active' : ''
                      }`}
                      style={{
                        background: s.id === activeId
                          ? 'var(--bg-active)'
                          : hoveredId === s.id
                          ? 'var(--bg-elevated)'
                          : 'transparent',
                        paddingLeft: s.id === activeId ? '10px' : '10px',
                      }}
                    >
                      <div
                        className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{
                          background: s.id === activeId ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        <MessageSquare
                          size={10}
                          style={{ color: s.id === activeId ? 'var(--accent-light)' : 'var(--text-muted)' }}
                        />
                      </div>

                      <div className="flex-1 min-w-0">
                        <p
                          className="text-xs font-medium truncate leading-snug"
                          style={{ color: s.id === activeId ? '#c4b5fd' : 'var(--text-primary)' }}
                        >
                          {s.title}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span
                            className="text-[10px]"
                            style={{ color: 'var(--text-muted)' }}
                            title={s.updatedAt.toLocaleString()}
                          >
                            {formatHistoryDate(s.updatedAt)} ({relativeTime(s.updatedAt)})
                          </span>
                          {s.totalCostUsd > 0 && (
                            <span
                              className="text-[10px] font-mono"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              ${s.totalCostUsd.toFixed(4)}
                            </span>
                          )}
                        </div>
                      </div>

                      {hoveredId === s.id && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onDeleteSession(s.id); }}
                          className="flex-shrink-0 p-1 rounded-md hover:bg-red-500/10 transition-colors"
                          style={{ color: 'var(--text-muted)' }}
                          title="Delete"
                        >
                          <Trash2 size={10} />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {/* ── Projects tab ────────────────────────────────────────────────────── */}
      {tab === 'projects' && (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5">

          {/* Workspace root input */}
          <div className="mb-2">
            <button
              onClick={() => setShowRootInput((v) => !v)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all"
              style={{ background: 'var(--bg-elevated)', border: `1px solid ${showRootInput ? 'rgba(99,102,241,0.4)' : 'var(--border)'}` }}
            >
              <FolderOpen size={11} style={{ color: 'var(--accent-light)', flexShrink: 0 }} />
              <span className="text-[11px] truncate flex-1 font-mono" style={{ color: workspaceRoot ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                {workspaceRoot || 'Set workspace folder…'}
              </span>
              {loadingProjects && <RefreshCw size={10} className="animate-spin" style={{ color: 'var(--text-muted)' }} />}
            </button>
            {showRootInput && (
              <form
                className="mt-1.5"
                onSubmit={(e) => { e.preventDefault(); applyWorkspaceRoot(workspaceInput); }}
              >
                <input
                  value={workspaceInput}
                  onChange={(e) => setWorkspaceInput(e.target.value)}
                  placeholder="/path/to/your/projects"
                  autoFocus
                  className="w-full px-3 py-2 rounded-lg text-xs outline-none font-mono"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-focus)', color: 'var(--text-primary)' }}
                />
                <p className="text-[10px] mt-1 px-1" style={{ color: 'var(--text-muted)' }}>
                  Paste any folder — subdirectories are scanned automatically
                </p>
              </form>
            )}
          </div>

          {/* Discovered projects */}
          {!workspaceRoot && (
            <div className="flex flex-col items-center justify-center h-24 gap-2">
              <Folder size={18} style={{ color: 'var(--text-muted)' }} />
              <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>Set a workspace folder above</p>
            </div>
          )}

          {workspaceRoot && !loadingProjects && projects.length === 0 && (
            <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>No projects found</p>
          )}

          {projects.map((p) => {
            const color = projectColor(p.name);
            return (
            <button
              key={p.path}
              onClick={() => onCwdChange(p.path)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all"
              style={{
                background: cwd === p.path ? `${color}14` : 'var(--bg-elevated)',
                border: `1px solid ${cwd === p.path ? `${color}40` : 'var(--border)'}`,
              }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: color, boxShadow: cwd === p.path ? `0 0 8px ${color}80` : 'none' }}
              />
              {p.isRN
                ? <Smartphone size={12} style={{ color, flexShrink: 0 }} />
                : <Code2 size={12} style={{ color, flexShrink: 0 }} />
              }
              <span className="text-xs font-medium truncate flex-1" style={{ color: cwd === p.path ? color : 'var(--text-secondary)' }}>
                {p.name}
              </span>
              {p.isRN && (
                <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0"
                  style={{ background: `${color}22`, color }}>RN</span>
              )}
              {cwd === p.path && <ChevronRight size={11} style={{ color }} className="flex-shrink-0" />}
            </button>
            );
          })}

          {/* Custom path */}
          <button
            onClick={() => setShowCustom((v) => !v)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all"
            style={{
              background: 'var(--bg-elevated)',
              border: `1px solid ${showCustom ? 'rgba(99,102,241,0.4)' : 'var(--border)'}`,
            }}
          >
            <FolderOpen size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Custom path…</span>
          </button>

          {showCustom && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (customPath.trim()) {
                  onCwdChange(customPath.trim());
                  setShowCustom(false);
                  setCustomPath('');
                }
              }}
            >
              <input
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                placeholder="/path/to/project"
                autoFocus
                className="w-full px-3 py-2 rounded-xl text-xs outline-none"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-focus)',
                  color: 'var(--text-primary)',
                }}
              />
            </form>
          )}

          {/* Active path display */}
          <div className="mt-3 px-3 py-2.5 rounded-xl space-y-2" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <p className="text-[10px] font-semibold tracking-widest uppercase mb-1" style={{ color: 'var(--text-muted)' }}>
              Active Path
            </p>
            <p className="text-[11px] break-all leading-relaxed font-mono" style={{ color: 'var(--text-secondary)' }}>
              {cwd}
            </p>
            <button
              type="button"
              onClick={onResetCwd}
              disabled={cwd === defaultCwd}
              title={cwd === defaultCwd ? 'Already using default workspace' : `Reset to: ${defaultCwd}`}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: 'var(--bg-hover)',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
              }}
            >
              <RotateCcw size={13} />
              Reset to default path
            </button>
          </div>
        </div>
      )}

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <div
        className="px-3 py-3 space-y-2"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <div
          className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
          <FolderOpen size={12} className="flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Workspace
            </p>
            <p className="text-[10px] font-mono truncate" title={cwd}>
              {cwd}
            </p>
          </div>
          <button
            type="button"
            onClick={onResetCwd}
            disabled={cwd === defaultCwd}
            title={cwd === defaultCwd ? 'Already default' : `Reset to ${defaultCwd}`}
            className="flex-shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-md text-[10px] font-medium transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
            style={{
              background: 'var(--bg-hover)',
              color: 'var(--accent-light)',
              border: '1px solid var(--border)',
            }}
          >
            <RotateCcw size={11} />
            <span className="hidden sm:inline">Reset</span>
          </button>
        </div>

        {activeSession && (
          <div
            className="flex items-center gap-3 px-2.5 py-2 rounded-lg"
            style={{ background: 'var(--bg-elevated)' }}
          >
            <div className="flex items-center gap-1.5">
              <Clock size={9} style={{ color: 'var(--text-muted)' }} />
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {activeSession.messages.filter((m) => m.role === 'user').length} turns
              </span>
            </div>
            {activeSession.totalTokens > 0 && (
              <div className="flex items-center gap-1.5">
                <Code2 size={9} style={{ color: 'var(--text-muted)' }} />
                <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                  {activeSession.totalTokens.toLocaleString()} tok
                </span>
              </div>
            )}
            {activeSession.totalCostUsd > 0 && (
              <div className="flex items-center gap-1.5">
                <DollarSign size={9} style={{ color: 'var(--text-muted)' }} />
                <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                  ${activeSession.totalCostUsd.toFixed(4)}
                </span>
              </div>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 px-1">
          <div className="flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#38bdf8' }} />
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#4ade80' }} />
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#6366f1' }} />
          </div>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            read/run → haiku · write/debug → sonnet
          </span>
        </div>
      </div>
    </aside>
  );
}
