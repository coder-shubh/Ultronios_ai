import type { Session, ChatMessage } from './types';

export type DashboardStats = {
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  estimatedActiveMinutes: number;
  totalToolCalls: number;
  totalSessions: number;
  totalUserMessages: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  modelRows: Array<{ model: string; tokens: number; costUsd: number; pctOfTokens: number }>;
  intentRows: Array<{ intent: string; count: number; pct: number }>;
  last7Days: Array<{ day: string; tokens: number }>;
  sessionRows: Array<{
    id: string;
    title: string;
    updatedAt: Date;
    durationMin: number;
    tokens: number;
    costUsd: number;
    primaryModel: string;
    toolCalls: number;
  }>;
  firstActivity: Date | null;
  lastActivity: Date | null;
};

function collectFromMessages(messages: ChatMessage[]) {
  let inT = 0;
  let outT = 0;
  let cost = 0;
  let cacheR = 0;
  let cacheW = 0;
  const models: Record<string, { tokens: number; cost: number }> = {};
  const intents: Record<string, number> = {};
  let tools = 0;

  for (const m of messages) {
    if (m.role === 'agent') {
      tools += m.toolCalls?.length ?? 0;
      const u = m.usage;
      if (u) {
        const it = u.inputTokens ?? 0;
        const ot = u.outputTokens ?? 0;
        inT += it;
        outT += ot;
        cost += u.costUsd ?? 0;
        cacheR += u.cacheRead ?? 0;
        cacheW += u.cacheWrite ?? 0;
        const tok = it + ot;
        const mod = u.model || 'unknown';
        if (!models[mod]) models[mod] = { tokens: 0, cost: 0 };
        models[mod].tokens += tok;
        models[mod].cost += u.costUsd ?? 0;
        const intent = (u.intent || 'unknown').toLowerCase();
        intents[intent] = (intents[intent] ?? 0) + 1;
      }
    }
  }

  return { inT, outT, cost, cacheR, cacheW, models, intents, tools };
}

export function computeDashboardStats(sessions: Session[]): DashboardStats {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalToolCalls = 0;
  let totalUserMessages = 0;
  const modelAgg: Record<string, { tokens: number; costUsd: number }> = {};
  const intentAgg: Record<string, number> = {};
  let estimatedActiveMinutes = 0;
  const sessionRows: DashboardStats['sessionRows'] = [];

  let firstActivity: Date | null = null;
  let lastActivity: Date | null = null;

  const now = new Date();
  const dayTokens: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dayTokens[d.toISOString().slice(0, 10)] = 0;
  }

  for (const s of sessions) {
    totalUserMessages += s.messages.filter((m) => m.role === 'user').length;

    const created = s.createdAt instanceof Date ? s.createdAt : new Date(s.createdAt);
    const updated = s.updatedAt instanceof Date ? s.updatedAt : new Date(s.updatedAt);
    const dur = Math.max(0, (+updated - +created) / 60_000);
    estimatedActiveMinutes += Math.min(dur, 24 * 60);

    const c = collectFromMessages(s.messages);
    totalInputTokens += c.inT;
    totalOutputTokens += c.outT;
    totalCostUsd += c.cost;
    totalCacheRead += c.cacheR;
    totalCacheWrite += c.cacheW;
    totalToolCalls += c.tools;

    for (const [k, v] of Object.entries(c.models)) {
      if (!modelAgg[k]) modelAgg[k] = { tokens: 0, costUsd: 0 };
      modelAgg[k].tokens += v.tokens;
      modelAgg[k].costUsd += v.cost;
    }
    for (const [k, v] of Object.entries(c.intents)) {
      intentAgg[k] = (intentAgg[k] ?? 0) + v;
    }

    const dayKey = updated.toISOString().slice(0, 10);
    if (dayKey in dayTokens) {
      dayTokens[dayKey] += s.totalTokens ?? 0;
    }

    let primaryModel = '—';
    let maxT = 0;
    for (const m of s.messages) {
      if (m.role === 'agent' && m.usage?.model) {
        const t = (m.usage.inputTokens ?? 0) + (m.usage.outputTokens ?? 0);
        if (t >= maxT) {
          maxT = t;
          primaryModel = m.usage.model;
        }
      }
    }

    const sessTools = s.messages.reduce(
      (acc, m) => acc + (m.role === 'agent' ? m.toolCalls.length : 0),
      0,
    );

    sessionRows.push({
      id: s.id,
      title: s.title,
      updatedAt: updated,
      durationMin: dur,
      tokens: s.totalTokens,
      costUsd: s.totalCostUsd,
      primaryModel,
      toolCalls: sessTools,
    });

    if (!firstActivity || created < firstActivity) firstActivity = created;
    if (!lastActivity || updated > lastActivity) lastActivity = updated;
  }

  sessionRows.sort((a, b) => +b.updatedAt - +a.updatedAt);

  const totalTokens = totalInputTokens + totalOutputTokens;

  const modelRows = Object.entries(modelAgg)
    .map(([model, v]) => ({
      model,
      tokens: v.tokens,
      costUsd: v.costUsd,
      pctOfTokens: totalTokens > 0 ? (v.tokens / totalTokens) * 100 : 0,
    }))
    .sort((a, b) => b.tokens - a.tokens);

  const intentTotal = Object.values(intentAgg).reduce((a, b) => a + b, 0);
  const intentRows = Object.entries(intentAgg)
    .map(([intent, count]) => ({
      intent,
      count,
      pct: intentTotal > 0 ? (count / intentTotal) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const last7Days: { day: string; tokens: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    last7Days.push({ day: key, tokens: dayTokens[key] ?? 0 });
  }

  return {
    totalTokens,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    estimatedActiveMinutes,
    totalToolCalls,
    totalSessions: sessions.length,
    totalUserMessages,
    totalCacheRead,
    totalCacheWrite,
    modelRows,
    intentRows,
    last7Days,
    sessionRows,
    firstActivity,
    lastActivity,
  };
}

export function exportStatsCsv(stats: DashboardStats): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines: string[] = [];
  lines.push('Ultronios analytics', new Date().toISOString());
  lines.push('');
  lines.push(`total_tokens,${stats.totalTokens}`);
  lines.push(`total_cost_usd,${stats.totalCostUsd}`);
  lines.push(`sessions,${stats.totalSessions}`);
  lines.push('');
  lines.push('session_id,title,updated_iso,tokens,cost_usd,model,tool_calls');
  for (const r of stats.sessionRows) {
    lines.push(
      [
        r.id,
        esc(r.title),
        r.updatedAt.toISOString(),
        String(r.tokens),
        String(r.costUsd),
        esc(r.primaryModel),
        String(r.toolCalls),
      ].join(','),
    );
  }
  return lines.join('\n');
}
