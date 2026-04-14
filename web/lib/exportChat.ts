import type { ChatMessage } from './types';

export function messagesToMarkdown(messages: ChatMessage[], title?: string): string {
  const header = title ?? 'Ultronios chat';
  const lines: string[] = [`# ${header}`, `Exported ${new Date().toLocaleString()}`, ''];
  for (const m of messages) {
    if (m.role === 'user') {
      lines.push('## You', '', m.content, '');
    } else {
      lines.push('## Assistant', '');
      if (m.toolCalls.length > 0) {
        lines.push('### Tools', '', '```json', JSON.stringify(m.toolCalls, null, 2), '```', '');
      }
      lines.push(m.content.trim() || '_(empty)_', '');
      if (m.usage) {
        const u = m.usage;
        lines.push(
          `*${u.model} · ${u.intent} · ↑${u.inputTokens} ↓${u.outputTokens} · $${u.costUsd.toFixed(5)}*`,
          '',
        );
      }
    }
  }
  return lines.join('\n');
}

export function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
