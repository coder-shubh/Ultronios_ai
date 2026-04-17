import Anthropic from '@anthropic-ai/sdk';

export type ServerlessIntent = 'read' | 'write' | 'run' | 'debug';

/**
 * Claude Agent SDK (`query()`) shells out to the Claude Code CLI — that binary is not available
 * in Netlify/Vercel serverless. Use the Messages API instead when this returns true.
 */
export function shouldUseAnthropicMessagesApi(): boolean {
  if (process.env.USE_CLAUDE_AGENT_SDK === '1') return false;
  return (
    process.env.NETLIFY === 'true' ||
    Boolean(process.env.VERCEL) ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    process.env.DISABLE_CLAUDE_CODE_AGENT === '1'
  );
}

/** Override via ANTHROPIC_MODEL_READ / ANTHROPIC_MODEL_WRITE (same IDs as Anthropic Console). */
function modelForIntent(intent: ServerlessIntent): string {
  const readRun = process.env.ANTHROPIC_MODEL_READ ?? 'claude-3-5-haiku-20241022';
  const writeDebug = process.env.ANTHROPIC_MODEL_WRITE ?? 'claude-sonnet-4-20250514';
  return intent === 'read' || intent === 'run' ? readRun : writeDebug;
}

export async function runAnthropicMessagesStream(params: {
  userPrompt: string;
  systemPrompt: string;
  intent: ServerlessIntent;
  send: (e: Record<string, unknown>) => void;
}): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }

  const anthropic = new Anthropic({ apiKey });
  const model = modelForIntent(params.intent);

  const stream = anthropic.messages.stream({
    model,
    max_tokens: 8192,
    system: params.systemPrompt,
    messages: [{ role: 'user', content: params.userPrompt }],
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      params.send({ type: 'text', content: event.delta.text });
    }
  }

  const final = await stream.finalMessage();
  const u = final.usage;
  params.send({
    type: 'usage',
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    costUsd: 0,
    model,
    intent: params.intent,
  });
  params.send({ type: 'done' });
}
