const SUBAGENT_TOOL_DENYLIST = new Set(['invoke_sub_agent']);
const SUBAGENT_TOOL_DENYLIST_PREFIXES = ['mcp_subagent_router_'];

const SUBAGENT_GUARDRAIL_TEXT =
  'Tooling guard: sub-agents cannot call invoke_sub_agent, mcp_subagent_router_* or other sub-agent routing tools (ignore any earlier instructions suggesting that). Complete the task directly with available project/shell/task tools.';

export function withSubagentGuardrails(systemPrompt) {
  const prompt = typeof systemPrompt === 'string' ? systemPrompt.trim() : '';
  return [prompt, SUBAGENT_GUARDRAIL_TEXT].filter(Boolean).join('\n\n');
}

export function filterSubagentTools(tools = [], options = {}) {
  if (!Array.isArray(tools)) {
    return [];
  }

  const allowMcpPrefixes = Array.isArray(options.allowMcpPrefixes)
    ? options.allowMcpPrefixes.map((prefix) => String(prefix || '')).filter(Boolean)
    : null;
  const hasMcpAllowList = Array.isArray(allowMcpPrefixes) && allowMcpPrefixes.length > 0;

  const filtered = new Set();
  tools.forEach((name) => {
    const normalized = String(name || '');
    if (!normalized) return;
    if (SUBAGENT_TOOL_DENYLIST.has(normalized)) return;
    if (SUBAGENT_TOOL_DENYLIST_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
      return;
    }
    if (hasMcpAllowList && normalized.startsWith('mcp_')) {
      if (!allowMcpPrefixes.some((prefix) => normalized.startsWith(prefix))) {
        return;
      }
    }
    filtered.add(normalized);
  });

  return Array.from(filtered);
}

