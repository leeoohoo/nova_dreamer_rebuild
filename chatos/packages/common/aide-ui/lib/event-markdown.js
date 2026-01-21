import { formatJson, truncateText } from './format.js';

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function decodeBase64(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text) return '';
  if (typeof atob === 'function') {
    try {
      return atob(text);
    } catch {
      // ignore
    }
  }
  if (typeof Buffer !== 'undefined') {
    try {
      return Buffer.from(text, 'base64').toString('utf8');
    } catch {
      // ignore
    }
  }
  return '';
}

function toBlockquote(text) {
  const raw = typeof text === 'string' ? text : String(text ?? '');
  if (!raw.trim()) return '';
  return raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function safeInlineCode(text) {
  const raw = String(text ?? '');
  const normalized = raw.replace(/`/g, "'").trim();
  return `\`${normalized}\``;
}

function summarizePatch(patchText) {
  const text = typeof patchText === 'string' ? patchText : '';
  const result = { files: [], additions: 0, deletions: 0, size: text.length, lines: 0 };
  if (!text) return result;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  result.lines = lines.length;

  const files = new Map();
  const ensureFile = (path, action) => {
    const key = String(path || '').trim();
    if (!key) return;
    const existing = files.get(key);
    if (!existing) files.set(key, { path: key, action: action || 'update' });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('*** Add File: ')) {
      ensureFile(line.slice('*** Add File: '.length), 'add');
      continue;
    }
    if (line.startsWith('*** Update File: ')) {
      ensureFile(line.slice('*** Update File: '.length), 'update');
      continue;
    }
    if (line.startsWith('*** Delete File: ')) {
      ensureFile(line.slice('*** Delete File: '.length), 'delete');
      continue;
    }
    if (line.startsWith('+++ ')) {
      const rest = line.slice(4).trim();
      if (rest.startsWith('b/')) ensureFile(rest.slice(2), 'update');
      continue;
    }
    if (line.startsWith('--- ')) {
      const rest = line.slice(4).trim();
      if (rest.startsWith('a/')) ensureFile(rest.slice(2), 'update');
      continue;
    }
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) {
      result.additions += 1;
      continue;
    }
    if (line.startsWith('-')) {
      result.deletions += 1;
      continue;
    }
  }

  result.files = Array.from(files.values());
  return result;
}

function summarizeArgs(toolName, args) {
  const name = typeof toolName === 'string' ? toolName : '';
  const normalized = name.toLowerCase();

  if (args === undefined || args === null) return '_无_';

  if (typeof args === 'string') {
    const trimmed = args.trim();
    if (!trimmed) return '_空字符串_';
    return `\n\`\`\`text\n${truncateText(trimmed, 4000)}\n\`\`\``;
  }

  if (!isPlainObject(args)) {
    return `\n\`\`\`json\n${truncateText(formatJson(args), 4000)}\n\`\`\``;
  }

  const lines = [];
  const push = (label, value) => {
    if (value === undefined || value === null || value === '') return;
    lines.push(`- ${label}: ${value}`);
  };

  const patchText = (() => {
    if (typeof args.patch === 'string') return args.patch;
    if (typeof args.patch_base64 === 'string') return decodeBase64(args.patch_base64);
    if (Array.isArray(args.chunks)) {
      return args.chunks
        .map((chunk) => {
          if (!chunk || typeof chunk.content !== 'string') return '';
          if (chunk.encoding === 'base64') return decodeBase64(chunk.content);
          return chunk.content;
        })
        .join('');
    }
    return '';
  })();

  const looksLikePatchTool =
    normalized.endsWith('_apply_patch') || normalized === 'apply_patch' || normalized.includes('apply_patch');

  if (looksLikePatchTool && patchText) {
    const summary = summarizePatch(patchText);
    push('workdir', safeInlineCode(args.path || '.'));
    if (summary.files.length > 0) {
      const grouped = summary.files
        .slice(0, 8)
        .map((f) => `${safeInlineCode(f.path)}(${f.action})`)
        .join(', ');
      const more = summary.files.length > 8 ? ` …(+${summary.files.length - 8})` : '';
      push('files', `${grouped}${more}`);
    }
    push('diff', safeInlineCode(`+${summary.additions} / -${summary.deletions}`));
    push('patch', safeInlineCode(`${summary.lines} lines, ${summary.size} chars`));
    return lines.length > 0 ? lines.join('\n') : '_无可读参数_';
  }

  const isShell =
    normalized.endsWith('_run_shell_command') ||
    normalized === 'run_shell_command' ||
    normalized.endsWith('_session_run') ||
    normalized === 'session_run';
  if (isShell) {
    push('cwd', safeInlineCode(args.cwd || args.workdir || '.'));
    if (typeof args.command === 'string' && args.command.trim()) {
      const cmd = args.command.trim();
      if (cmd.length <= 140 && !cmd.includes('\n')) {
        push('command', safeInlineCode(cmd));
      } else {
        lines.push('- command:');
        lines.push('```bash');
        lines.push(truncateText(cmd, 4000));
        lines.push('```');
      }
    }
    if (typeof args.timeout_ms === 'number') push('timeout_ms', safeInlineCode(args.timeout_ms));
    return lines.length > 0 ? lines.join('\n') : '_无可读参数_';
  }

  const pathLike = args.path || args.file || args.filename || args.targetPath || args.cwd;
  if (typeof pathLike === 'string' && pathLike.trim()) {
    push('path', safeInlineCode(pathLike.trim()));
  }

  const knownKeys = [
    'query',
    'pattern',
    'glob',
    'depth',
    'includeHidden',
    'encoding',
    'mode',
    'server',
    'name',
    'id',
    'title',
    'status',
  ];
  knownKeys.forEach((key) => {
    const value = args[key];
    if (value === undefined || value === null || value === '') return;
    if (typeof value === 'string') push(safeInlineCode(key), safeInlineCode(truncateText(value, 260)));
    else if (typeof value === 'number' || typeof value === 'boolean')
      push(safeInlineCode(key), safeInlineCode(value));
  });

  const remainingKeys = Object.keys(args || {}).filter((key) => !knownKeys.includes(key) && key !== 'path');
  remainingKeys.slice(0, 6).forEach((key) => {
    const value = args[key];
    if (value === undefined || value === null) return;
    if (typeof value === 'string') push(safeInlineCode(key), safeInlineCode(truncateText(value, 180)));
    else if (typeof value === 'number' || typeof value === 'boolean') push(safeInlineCode(key), safeInlineCode(value));
    else if (Array.isArray(value)) {
      const preview = value
        .slice(0, 6)
        .map((v) => (typeof v === 'string' ? truncateText(v, 60) : String(v)))
        .join(', ');
      push(safeInlineCode(key), safeInlineCode(preview + (value.length > 6 ? ' …' : '')));
    } else {
      push(safeInlineCode(key), safeInlineCode(truncateText(formatJson(value), 120)));
    }
  });

  return lines.length > 0 ? lines.join('\n') : `\n\`\`\`json\n${truncateText(formatJson(args), 4000)}\n\`\`\``;
}

function summarizeResult(result) {
  if (result === undefined || result === null) return '_无_';
  if (typeof result === 'string') {
    const text = result.replace(/\r\n/g, '\n').trim();
    if (!text) return '_空字符串_';
    return `\n\`\`\`text\n${text}\n\`\`\``;
  }
  return `\n\`\`\`json\n${formatJson(result)}\n\`\`\``;
}

function normalizeEventText(payload) {
  if (!payload) return '';
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.content === 'string') return payload.content;
  if (typeof payload.responsePreview === 'string') return payload.responsePreview;
  if (typeof payload.task === 'string') return payload.task;
  return '';
}

export function buildEventMarkdown(event) {
  const type = String(event?.type || '');
  const payload = event?.payload;

  if (type === 'assistant_thinking' || type === 'subagent_thinking') {
    return toBlockquote(normalizeEventText(payload));
  }

  if (
    type === 'user' ||
    type === 'assistant' ||
    type === 'system' ||
    type === 'subagent_assistant' ||
    type === 'subagent_user'
  ) {
    return normalizeEventText(payload);
  }

  if (type === 'mcp_stream' || type === 'mcp_log') {
    const server = payload?.server ? String(payload.server) : '';
    const method = payload?.method ? String(payload.method) : '';
    const params = payload?.params && typeof payload.params === 'object' ? payload.params : null;
    const metaLines = [];
    if (server) metaLines.push(`- server: ${safeInlineCode(server)}`);
    if (method) metaLines.push(`- method: ${safeInlineCode(method)}`);
    if (params?.runId) metaLines.push(`- runId: ${safeInlineCode(params.runId)}`);
    if (params?.status) metaLines.push(`- status: ${safeInlineCode(params.status)}`);
    if (params?.finalTextChunk === true) {
      const idx = Number.isFinite(params?.chunkIndex) ? params.chunkIndex + 1 : '';
      const total = Number.isFinite(params?.chunkCount) ? params.chunkCount : '';
      if (idx || total) metaLines.push(`- chunk: ${safeInlineCode(`${idx || '?'} / ${total || '?'}`)}`);
    }
    const header = metaLines.length > 0 ? `**MCP**\n${metaLines.join('\n')}` : '';
    const text =
      typeof params?.finalText === 'string' && params.finalText.trim()
        ? params.finalText
        : typeof params?.text === 'string' && params.text.trim()
          ? params.text
          : '';
    const eventSummary =
      params?.event?.event?.type || params?.event?.event?.item?.status
        ? `event: ${params?.event?.event?.type || ''} ${params?.event?.event?.item?.status || ''}`.trim()
        : '';
    const dataFallback =
      params?.data !== undefined ? truncateText(formatJson(params.data), 4000) : params?.event ? truncateText(formatJson(params.event), 4000) : '';
    const detail = text || eventSummary || dataFallback;
    if (!detail) return header || '';
    if (text) {
      return [header, text].filter(Boolean).join('\n\n');
    }
    return [header, `\n\`\`\`json\n${detail}\n\`\`\``].filter(Boolean).join('\n\n');
  }

  if (type === 'subagent_start') {
    const agent = payload?.agent ? String(payload.agent) : '';
    const task = payload?.task ? String(payload.task) : '';
    return [agent ? `**agent**: ${safeInlineCode(agent)}` : '', task ? `\n${task}` : ''].filter(Boolean).join('\n');
  }

  if (type === 'subagent_done') {
    const agent = payload?.agent ? String(payload.agent) : '';
    const model = payload?.model ? String(payload.model) : '';
    const preview = payload?.responsePreview ? String(payload.responsePreview) : '';
    const meta = [
      agent ? `- agent: ${safeInlineCode(agent)}` : null,
      model ? `- model: ${safeInlineCode(model)}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    return [meta ? `**Meta**\n${meta}` : '', preview].filter(Boolean).join('\n\n');
  }

  const isToolLike =
    type === 'tool' ||
    type === 'tool_call' ||
    type === 'tool_result' ||
    type === 'subagent_tool' ||
    type === 'subagent_tool_call' ||
    type === 'subagent_tool_result';

  if (isToolLike) {
    const tool = payload?.tool ? String(payload.tool) : '';
    const agent = payload?.agent ? String(payload.agent) : '';
    const args = payload?.args;
    const result = payload?.result;
    const parts = [];
    if (agent) parts.push(`**agent**: ${safeInlineCode(agent)}`);
    if (tool) parts.push(`**tool**: ${safeInlineCode(formatToolLabel(tool) || tool)}`);
    if (args !== undefined) parts.push(`**args**\n${summarizeArgs(tool, args)}`);
    if (result !== undefined) parts.push(`**result**${summarizeResult(result)}`);
    return parts.filter(Boolean).join('\n\n');
  }

  const fallbackText = normalizeEventText(payload);
  if (fallbackText) return fallbackText;

  if (payload !== undefined) {
    return `\n\`\`\`json\n${truncateText(formatJson(payload), 6000)}\n\`\`\``;
  }

  return '';
}

export function formatToolLabel(toolName) {
  const raw = typeof toolName === 'string' ? toolName.trim() : '';
  if (!raw) return '';
  const knownSuffixes = [
    'apply_patch',
    'write_file',
    'read_file',
    'list_directory',
    'search',
    'delete_path',
    'run_shell_command',
    'session_run',
    'session_capture_output',
    'session_kill',
    'list_tasks',
    'add_task',
    'update_task',
    'delete_task',
    'clear_completed',
    'list_journals',
    'add_journal',
    'get_journal',
    'update_journal',
    'delete_journal',
    'prompt',
    'get_sub_agent_status',
    'run_sub_agent',
    'cancel_sub_agent_job',
  ];
  if (!raw.startsWith('mcp_')) return raw;
  for (const suffix of knownSuffixes) {
    const needle = `_${suffix}`;
    if (!raw.endsWith(needle)) continue;
    const server = raw.slice('mcp_'.length, raw.length - needle.length);
    if (!server) continue;
    return `${server}/${suffix}`;
  }
  return raw;
}
