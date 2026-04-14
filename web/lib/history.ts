import type { Session, ChatMessage } from './types';

const KEY = 'forge_sessions';
const MAX_SESSIONS = 100;

// ─── Serialise / deserialise (Date fields survive JSON roundtrip) ─────────────

function revive(_k: string, v: unknown): unknown {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v);
  return v;
}

function load(): Session[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw, revive) as Session[];
  } catch {
    return [];
  }
}

function save(sessions: Session[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  } catch {
    // storage quota — silently ignore
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getSessions(): Session[] {
  return load().sort((a, b) => +b.updatedAt - +a.updatedAt);
}

export function getSession(id: string): Session | undefined {
  return load().find((s) => s.id === id);
}

export function createSession(cwd: string): Session {
  const session: Session = {
    id: crypto.randomUUID(),
    title: 'New conversation',
    cwd,
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    totalCostUsd: 0,
    totalTokens: 0,
  };
  const sessions = load();
  sessions.unshift(session);
  save(sessions);
  return session;
}

export function updateSession(id: string, messages: ChatMessage[]): void {
  const sessions = load();
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx === -1) return;

  const userMessages = messages.filter((m) => m.role === 'user');
  const firstUser = userMessages[0]?.content ?? 'New conversation';
  const title = firstUser.length > 50 ? firstUser.slice(0, 50) + '…' : firstUser;

  const totalCostUsd = messages.reduce((acc, m) => acc + (m.usage?.costUsd ?? 0), 0);
  const totalTokens  = messages.reduce(
    (acc, m) => acc + (m.usage?.inputTokens ?? 0) + (m.usage?.outputTokens ?? 0),
    0,
  );

  sessions[idx] = {
    ...sessions[idx],
    title,
    messages,
    updatedAt: new Date(),
    totalCostUsd,
    totalTokens,
  };
  save(sessions);
}

/** Persist project folder when user picks a path or resets (UI `cwd` must match stored session). */
export function updateSessionCwd(id: string, cwd: string): void {
  const sessions = load();
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx === -1) return;
  sessions[idx] = { ...sessions[idx], cwd, updatedAt: new Date() };
  save(sessions);
}

export function deleteSession(id: string): void {
  save(load().filter((s) => s.id !== id));
}

export function clearAllSessions(): void {
  localStorage.removeItem(KEY);
}
