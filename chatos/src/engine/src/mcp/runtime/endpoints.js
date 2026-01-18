import path from 'path';

function shellSplit(input) {
  const tokens = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === '\\' && quote === '"' && i + 1 < input.length) {
        i += 1;
        current += input[i];
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    if (char === '\\' && i + 1 < input.length) {
      i += 1;
      current += input[i];
      continue;
    }
    current += char;
  }
  if (quote) {
    throw new Error('命令行参数缺少闭合的引号');
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function parseCommandUrl(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }
  const trimmed = url.trim();
  if (!trimmed.toLowerCase().startsWith('cmd://')) {
    return null;
  }
  const commandLine = trimmed.slice('cmd://'.length).trim();
  if (!commandLine) {
    throw new Error('cmd:// URL 中缺少可执行命令');
  }
  const tokens = shellSplit(commandLine);
  if (tokens.length === 0) {
    throw new Error('cmd:// URL 无法解析命令');
  }
  return { command: tokens[0], args: tokens.slice(1) };
}

function parseMcpEndpoint(input) {
  if (!input || typeof input !== 'string') {
    return null;
  }
  let trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  // Allow users to paste command examples with backticks: `node ./server.js`
  if (trimmed.startsWith('`') && trimmed.endsWith('`') && trimmed.length > 1) {
    trimmed = trimmed.slice(1, -1).trim();
  }

  // Explicit stdio endpoint via cmd://
  const cmd = parseCommandUrl(trimmed);
  if (cmd) {
    return { type: 'command', ...cmd };
  }

  // URL-based transports
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    let url;
    try {
      url = new URL(trimmed);
    } catch (err) {
      throw new Error(`无法解析 MCP URL：${err?.message || err}`);
    }
    const protocol = String(url.protocol || '').toLowerCase();
    if (protocol === 'http:' || protocol === 'https:') {
      return { type: 'http', url };
    }
    if (protocol === 'ws:' || protocol === 'wss:') {
      return { type: 'ws', url };
    }
    throw new Error(`不支持的 MCP URL 协议：${url.protocol || '<unknown>'}`);
  }

  // Otherwise treat as a command line (e.g., "npx -y pkg" or "node ./server.js")
  const tokens = shellSplit(trimmed);
  if (tokens.length === 0) {
    return null;
  }
  return { type: 'command', command: tokens[0], args: tokens.slice(1) };
}

function resolveRootPath(value, rootBase) {
  const base = rootBase || process.cwd();
  if (!value || value === '.') {
    return base;
  }
  if (value === '~') {
    const home = process.env.HOME || process.env.USERPROFILE || base;
    return home;
  }
  const trimmed = value.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }
  return path.resolve(base, trimmed);
}

function adjustCommandArgs(args = [], rootBase) {
  if (!Array.isArray(args) || args.length === 0) {
    return args || [];
  }
  const resolved = [...args];
  for (let i = 0; i < resolved.length; i += 1) {
    const token = resolved[i];
    if (token === '--root' && i + 1 < resolved.length) {
      resolved[i + 1] = resolveRootPath(resolved[i + 1], rootBase);
      i += 1;
      continue;
    }
    const match = typeof token === 'string' ? token.match(/^--root=(.+)$/) : null;
    if (match) {
      resolved[i] = `--root=${resolveRootPath(match[1], rootBase)}`;
    }
  }
  return resolved;
}

export { adjustCommandArgs, parseMcpEndpoint };

