/**
 * Default workspace root for new chats and “Reset path”.
 * Override in `web/.env.local`: NEXT_PUBLIC_AGENT_DEFAULT_CWD=/your/path
 */
export const DEFAULT_WORKSPACE_CWD =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_AGENT_DEFAULT_CWD?.trim()) ||
  '/Users/shubhamkumarsingh/Desktop/ReactProject/Ultronios/ai-agent';
