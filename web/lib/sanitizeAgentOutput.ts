/**
 * Remove artefacts that local LLMs sometimes emit in their visible reply:
 * - Fake tool call JSON blocks
 * - Raw <tool_call> / <function_call> XML tags
 * - Orphaned ``` json ``` fences that contain tool call payloads
 * - Trailing whitespace / repeated blank lines
 */

const TOOL_CALL_BLOCK_RE =
  /```(?:json)?\s*\{[\s\S]*?"(?:name|function|tool_call|tool_use)"[\s\S]*?```/gi;

const XML_TOOL_TAG_RE =
  /<(?:tool_call|function_call|tool_use)[\s\S]*?<\/(?:tool_call|function_call|tool_use)>/gi;

const INLINE_TOOL_JSON_RE =
  /\{[\s\S]{0,2000}"(?:name|function)":\s*"[a-z_]+"[\s\S]{0,2000}"(?:arguments|parameters|input)":/gi;

export function sanitizeAgentOutput(text: string): string {
  let out = text;
  out = out.replace(TOOL_CALL_BLOCK_RE, '');
  out = out.replace(XML_TOOL_TAG_RE, '');
  out = out.replace(INLINE_TOOL_JSON_RE, '');
  // Collapse 3+ consecutive blank lines → 2
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}
