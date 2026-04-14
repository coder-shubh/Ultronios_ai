export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  model: string;
  intent: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'agent';
  content: string;
  toolCalls: ToolCall[];
  isStreaming: boolean;
  isError?: boolean;
  timestamp: Date;
  usage?: TokenUsage;
};

export type Session = {
  id: string;
  title: string;          // auto-generated from first user message
  cwd: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
  totalCostUsd: number;
  totalTokens: number;
};

export type SSEEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'usage' } & TokenUsage
  | { type: 'meta'; intent: string; model: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
