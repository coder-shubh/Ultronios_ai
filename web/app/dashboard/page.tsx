'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  MessageSquare,
  Cpu,
  Coins,
  Clock,
  Wrench,
  Database,
  Download,
  Trash2,
  Sparkles,
  BookOpen,
  Zap,
  BarChart3,
  Activity,
} from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import { getSessions, clearAllSessions } from '@/lib/history';
import { computeDashboardStats, exportStatsCsv, type DashboardStats } from '@/lib/analytics';

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toLocaleString();
}

function fmtMoney(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(5)}`;
  return `$${n.toFixed(4)}`;
}

function fmtDuration(min: number): string {
  if (min < 1) return '< 1 min';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h ${m}m`;
}

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  accent: string;
}) {
  return (
    <div
      className="rounded-xl p-5 border transition-shadow hover:shadow-md"
      style={{
        background: 'var(--bg-elevated)',
        borderColor: 'var(--border)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            {label}
          </p>
          <p className="text-2xl font-semibold mt-1.5 tabular-nums" style={{ color: 'var(--text-primary)' }}>
            {value}
          </p>
          {sub && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              {sub}
            </p>
          )}
        </div>
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${accent}18`, color: accent }}
        >
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    setStats(computeDashboardStats(getSessions()));
  }, []);

  useEffect(() => {
    load();
  }, [load, tick]);

  const refresh = () => setTick((t) => t + 1);

  const onExport = () => {
    if (!stats) return;
    const csv = exportStatsCsv(stats);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `forge-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onClearAll = () => {
    if (!confirm('Delete all chat history and dashboard stats from this browser? This cannot be undone.')) return;
    clearAllSessions();
    refresh();
  };

  if (!stats) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)', color: 'var(--text-muted)' }}>
        Loading…
      </div>
    );
  }

  const maxDayTok = Math.max(...stats.last7Days.map((d) => d.tokens), 1);

  return (
    <div
      className="h-screen overflow-y-auto"
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      {/* Top bar — AWS console–style */}
      <header
        className="sticky top-0 z-30 flex items-center justify-between gap-4 px-4 py-3 md:px-8 border-b"
        style={{
          background: 'var(--bg-elevated)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/chat"
            className="flex items-center gap-2 text-sm font-medium px-2 py-1.5 rounded-lg hover:opacity-90"
            style={{ color: 'var(--text-secondary)' }}
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">Chat</span>
          </Link>
          <div className="h-4 w-px hidden sm:block" style={{ background: 'var(--border)' }} />
          <div className="flex items-center gap-2">
            <BarChart3 size={18} style={{ color: 'var(--accent)' }} />
            <span className="font-semibold text-sm md:text-base truncate">Analytics</span>
          </div>
          <span
            className="hidden md:inline text-xs px-2 py-0.5 rounded"
            style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}
          >
            Ultronios
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/"
            className="text-xs font-medium px-3 py-2 rounded-lg hidden sm:inline-block"
            style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
          >
            Intro
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 md:px-8 pb-16">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Overview</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Usage and health for your local agent. Data stays in this browser.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onExport}
              className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            >
              <Download size={16} />
              Export CSV
            </button>
            <button
              type="button"
              onClick={refresh}
              className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            >
              <Activity size={16} />
              Refresh
            </button>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <MetricCard
            label="Total tokens"
            value={fmtNum(stats.totalTokens)}
            sub={`${fmtNum(stats.totalInputTokens)} in · ${fmtNum(stats.totalOutputTokens)} out`}
            icon={Cpu}
            accent="#6366f1"
          />
          <MetricCard
            label="Estimated cost"
            value={fmtMoney(stats.totalCostUsd)}
            sub="Sum of billed agent turns (Claude)"
            icon={Coins}
            accent="#22c55e"
          />
          <MetricCard
            label="Active time"
            value={fmtDuration(stats.estimatedActiveMinutes)}
            sub="Session span (capped per chat)"
            icon={Clock}
            accent="#38bdf8"
          />
          <MetricCard
            label="Tool calls"
            value={fmtNum(stats.totalToolCalls)}
            sub={`${stats.totalSessions} sessions · ${stats.totalUserMessages} prompts`}
            icon={Wrench}
            accent="#f97316"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Model breakdown */}
          <div
            className="lg:col-span-2 rounded-xl border p-6"
            style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
          >
            <h2 className="text-sm font-semibold flex items-center gap-2 mb-4">
              <Cpu size={16} style={{ color: 'var(--accent)' }} />
              Usage by model
            </h2>
            {stats.modelRows.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                No model usage yet. Start a conversation in Chat.
              </p>
            ) : (
              <div className="space-y-4">
                {stats.modelRows.map((row) => (
                  <div key={row.model}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-mono truncate pr-2" style={{ color: 'var(--text-primary)' }}>
                        {row.model}
                      </span>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {fmtNum(row.tokens)} tok · {fmtMoney(row.costUsd)}
                      </span>
                    </div>
                    <div
                      className="h-2 rounded-full overflow-hidden"
                      style={{ background: 'var(--bg-hover)' }}
                    >
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, row.pctOfTokens)}%`,
                          background: 'linear-gradient(90deg, var(--accent), #a855f7)',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Intent + cache */}
          <div
            className="rounded-xl border p-6 space-y-6"
            style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
          >
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <Zap size={16} style={{ color: 'var(--c-run)' }} />
                Intent mix
              </h2>
              {stats.intentRows.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>—</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {stats.intentRows.map((r) => (
                    <li key={r.intent} className="flex justify-between gap-2">
                      <span className="capitalize" style={{ color: 'var(--text-secondary)' }}>{r.intent}</span>
                      <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {r.count} ({r.pct.toFixed(0)}%)
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
              <h3 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
                Prompt cache
              </h3>
              <div className="flex items-center gap-2 text-sm">
                <Database size={14} style={{ color: 'var(--accent-light)' }} />
                <span style={{ color: 'var(--text-secondary)' }}>
                  {fmtNum(stats.totalCacheRead)} read · {fmtNum(stats.totalCacheWrite)} write
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 7-day activity */}
        <div
          className="rounded-xl border p-6 mb-8"
          style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
        >
          <h2 className="text-sm font-semibold flex items-center gap-2 mb-4">
            <Activity size={16} style={{ color: 'var(--accent)' }} />
            Last 7 days
          </h2>
          <div className="flex items-end gap-1 md:gap-2 h-36">
            {stats.last7Days.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-2 min-w-0">
                <div
                  className="w-full rounded-t-md transition-all"
                  style={{
                    height: `${Math.max(8, (d.tokens / maxDayTok) * 100)}%`,
                    minHeight: 8,
                    background:
                      d.tokens > 0
                        ? 'linear-gradient(180deg, var(--accent-light), var(--accent))'
                        : 'var(--bg-hover)',
                  }}
                  title={`${d.day}: ${d.tokens} tokens`}
                />
                <span className="text-[10px] md:text-xs truncate w-full text-center font-mono" style={{ color: 'var(--text-muted)' }}>
                  {d.day.slice(5)}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
            Bar height = tokens attributed to sessions updated that day (local time).
          </p>
        </div>

        {/* Sessions table */}
        <div
          className="rounded-xl border overflow-hidden mb-8"
          style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
        >
          <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <MessageSquare size={16} style={{ color: 'var(--accent)' }} />
              Recent sessions
            </h2>
            <button
              type="button"
              onClick={onClearAll}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10"
            >
              <Trash2 size={14} />
              Clear all data
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>
                  <th className="px-4 py-3 font-medium">Conversation</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Updated</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Duration</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Tokens</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Cost</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Model</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Tools</th>
                </tr>
              </thead>
              <tbody>
                {stats.sessionRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                      No sessions yet.
                    </td>
                  </tr>
                ) : (
                  stats.sessionRows.slice(0, 25).map((r) => (
                    <tr key={r.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-4 py-3 max-w-[200px] truncate font-medium" title={r.title}>
                        {r.title}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {r.updatedAt.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{fmtDuration(r.durationMin)}</td>
                      <td className="px-4 py-3 font-mono tabular-nums">{fmtNum(r.tokens)}</td>
                      <td className="px-4 py-3 font-mono tabular-nums">{fmtMoney(r.costUsd)}</td>
                      <td className="px-4 py-3 font-mono text-xs truncate max-w-[140px]" title={r.primaryModel}>
                        {r.primaryModel}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{r.toolCalls}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* About + tips */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div
            className="rounded-xl border p-6"
            style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
          >
            <h2 className="text-sm font-semibold flex items-center gap-2 mb-3">
              <BookOpen size={16} style={{ color: 'var(--accent)' }} />
              How Ultronios works
            </h2>
            <ul className="text-sm space-y-2" style={{ color: 'var(--text-secondary)' }}>
              <li>• Classifies each prompt into <strong className="text-[var(--text-primary)]">read / write / run / debug</strong> and picks a Claude model + tools.</li>
              <li>• Runs in your chosen <strong className="text-[var(--text-primary)]">project folder</strong> for file and shell tools.</li>
              <li>• If Claude is unavailable, optional <strong className="text-[var(--text-primary)]">Ollama / Gemini / Groq</strong> fallbacks apply (see env).</li>
              <li>• Token and cost figures come from <strong className="text-[var(--text-primary)]">reported usage</strong> on each agent reply.</li>
            </ul>
          </div>
          <div
            className="rounded-xl border p-6"
            style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
          >
            <h2 className="text-sm font-semibold flex items-center gap-2 mb-3">
              <Sparkles size={16} style={{ color: '#fbbf24' }} />
              Tips
            </h2>
            <ul className="text-sm space-y-2" style={{ color: 'var(--text-secondary)' }}>
              <li>• Use <strong className="text-[var(--text-primary)]">clear prompts</strong> and a set workspace root for better project discovery.</li>
              <li>• <strong className="text-[var(--text-primary)]">Read</strong> intents use lighter models — keep exploratory questions specific.</li>
              <li>• Export CSV for spreadsheets or monthly reviews.</li>
              <li>• {stats.firstActivity && stats.lastActivity
                ? <>Activity from <span className="font-mono text-xs">{stats.firstActivity.toLocaleDateString()}</span> to <span className="font-mono text-xs">{stats.lastActivity.toLocaleDateString()}</span>.</>
                : <>Start chatting to populate analytics.</>}
              </li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
