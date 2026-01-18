import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as colors from './colors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_ROOT = path.resolve(__dirname, '..');

function resolveMcpPath(configPath) {
  const baseDir = configPath ? path.dirname(configPath) : process.cwd();
  return path.join(baseDir, 'mcp.config.json');
}

function normalizeHostAppName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeTag(value) {
  return String(value || '').trim().toLowerCase();
}

function isUiAppServer(entry) {
  const tags = Array.isArray(entry?.tags) ? entry.tags : [];
  return tags
    .map(normalizeTag)
    .filter(Boolean)
    .some((tag) => tag === 'uiapp' || tag.startsWith('uiapp:'));
}

function filterServersForRuntime(servers) {
  const list = Array.isArray(servers) ? servers : [];
  const host = normalizeHostAppName(process.env.MODEL_CLI_HOST_APP || 'chatos');
  if (!host) return list;
  return list.filter((entry) => {
    const uiapp = isUiAppServer(entry);
    // UI Apps 的 MCP servers 仅供 ChatOS(host=chatos) 使用，避免被 AIDE 等独立 host 误接入。
    if (uiapp && host !== 'chatos') return false;
    const explicit = normalizeHostAppName(entry?.app_id || entry?.appId);
    const resolved = explicit || (uiapp ? 'chatos' : host);
    return resolved === host;
  });
}

function loadMcpConfig(configPath) {
  const target = resolveMcpPath(configPath);
  const defaultsFactory = () => getDefaultServers(path.dirname(target));
  if (!fs.existsSync(target)) {
    const allServers = defaultsFactory().map(normalizeServer);
    writeMcpFile(target, allServers);
    return { path: target, servers: filterServersForRuntime(allServers), allServers };
  }
  try {
    const raw = fs.readFileSync(target, 'utf8');
    const parsed = raw ? JSON.parse(raw) : {};
    let allServers = Array.isArray(parsed.servers) ? parsed.servers.map(normalizeServer) : [];
    const baseDir = path.dirname(target);
    const defaults = defaultsFactory().map(normalizeServer);
    if (shouldRefreshLegacyServers(allServers, baseDir, defaults)) {
      allServers = refreshWithDefaultsPreservingUserConfig({
        existing: allServers,
        defaults,
        baseDir,
      });
      writeMcpFile(target, allServers);
    } else {
      const existing = new Set(allServers.map((entry) => String(entry.name || '').toLowerCase()));
      const added = [];
      defaults.forEach((entry) => {
        const key = String(entry.name || '').toLowerCase();
        if (!key || existing.has(key)) return;
        allServers.push(entry);
        existing.add(key);
        added.push(entry.name);
      });
      if (added.length > 0) {
        writeMcpFile(target, allServers);
        console.log(colors.dim(`[MCP] Added built-in servers: ${added.join(', ')}`));
      }
    }
    console.log(colors.dim(`[MCP] Using config: ${target}`));
    return { path: target, servers: filterServersForRuntime(allServers), allServers };
  } catch (err) {
    throw new Error(`Failed to read MCP config ${target}: ${err.message}`);
  }
}

function saveMcpConfig(filePath, servers) {
  const normalized = servers.map(normalizeServer);
  writeMcpFile(filePath, normalized);
}

function writeMcpFile(filePath, servers) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = { servers };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function normalizeServer(entry) {
  if (!entry || typeof entry !== 'object') {
    return {
      app_id: '',
      name: '',
      url: '',
      api_key_env: '',
      description: '',
      auth: undefined,
      callMeta: undefined,
      tags: [],
      enabled: true,
      allowMain: false,
      allowSub: true,
    };
  }
  const tags = Array.isArray(entry.tags)
    ? entry.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
    : [];
  const apiKeyEnv = entry.api_key_env ? String(entry.api_key_env) : entry.apiKeyEnv ? String(entry.apiKeyEnv) : '';
  const description = entry.description ? String(entry.description) : '';
  let auth = undefined;
  if (entry.auth && typeof entry.auth === 'object') {
    auth = entry.auth;
  } else if (entry.headers && typeof entry.headers === 'object') {
    auth = { token: entry.auth?.token, headers: entry.headers };
  } else if (entry.auth) {
    auth = entry.auth;
  }
  const callMeta =
    entry.callMeta && typeof entry.callMeta === 'object'
      ? entry.callMeta
      : entry.call_meta && typeof entry.call_meta === 'object'
        ? entry.call_meta
        : undefined;
  return {
    app_id: String(entry.app_id || entry.appId || ''),
    name: String(entry.name || ''),
    url: String(entry.url || ''),
    api_key_env: apiKeyEnv,
    description,
    auth,
    callMeta,
    tags,
    enabled: entry.enabled !== false && entry.disabled !== true,
    allowMain: entry.allowMain === true || entry.allow_main === true,
    allowSub:
      entry.allowSub !== false &&
      entry.allow_sub !== false &&
      entry.allowSubagent !== false &&
      entry.allow_subagent !== false,
  };
}

function getDefaultServers(baseDir) {
  const entries = [
    {
      name: 'project_files',
      script: path.join(CLI_ROOT, 'mcp_servers', 'filesystem-server.js'),
      args: '--root . --mode read --name project_files',
      description: '浏览/搜索项目文件（只读，默认 root=.）。',
      allowMain: true,
      allowSub: true,
    },
    {
      name: 'code_maintainer',
      script: path.join(CLI_ROOT, 'mcp_servers', 'code-maintainer-server.js'),
      args: '--root . --write --name code_maintainer',
      description: '读写并维护项目代码（含额外工具：read_file_raw/read_file_range/stat_path/move_path/copy_path）。',
      allowMain: false,
      allowSub: true,
    },
    {
      name: 'lsp_bridge',
      script: path.join(CLI_ROOT, 'mcp_servers', 'lsp-bridge-server.js'),
      args: '--root . --name lsp_bridge',
      description:
        'LSP 桥接（hover/definition/completion/diagnostics 等）。依赖本机已安装对应语言的 Language Server；如需把重命名/格式化 edits 应用到磁盘，请启动时加 --write。',
      allowMain: true,
      allowSub: true,
    },
    {
      name: 'code_writer',
      script: path.join(CLI_ROOT, 'mcp_servers', 'filesystem-server.js'),
      args: '--root . --write --name code_writer',
      description:
        '写入/追加/删除项目文件。局部修改优先用 apply_patch（标准 diff）或 edit_file（old_string/new_string 替换）；write_file 仅在需要整块覆盖或追加日志时使用。',
      allowMain: false,
      allowSub: true,
    },
    {
      name: 'shell_tasks',
      script: path.join(CLI_ROOT, 'mcp_servers', 'shell-server.js'),
      args: '--root . --name shell_tasks',
      description: '在受限 root 内执行常见 shell 命令、列出目录等操作。',
      allowMain: false,
      allowSub: true,
    },
    {
      name: 'task_manager',
      script: path.join(CLI_ROOT, 'mcp_servers', 'task-server.js'),
      args: '--root . --name task_manager',
      description: '维护任务清单：新增、列表、更新状态、清理已完成任务（DB 存储）。',
      allowMain: true,
      allowSub: true,
    },
    {
      name: 'project_journal',
      script: path.join(CLI_ROOT, 'mcp_servers', 'project-journal-server.js'),
      args: '--root . --name project_journal',
      description: '记录/查询项目执行日志（实施记录）与项目基础信息（背景、git 地址、主要配置、迭代笔记）。',
      allowMain: true,
      allowSub: true,
    },
    {
      name: 'subagent_router',
      script: path.join(CLI_ROOT, 'mcp_servers', 'subagent-server.js'),
      args: '--name subagent_router',
      description: '子代理目录/路由/执行：列出、查看详情并直接运行子代理任务。',
      allowMain: true,
      allowSub: false,
    },
    {
      name: 'ui_prompter',
      script: path.join(CLI_ROOT, 'mcp_servers', 'ui-prompt-server.js'),
      args: '--name ui_prompter',
      description: '在 Electron UI 的浮动岛上弹出表单/选择项，让用户补充信息或做出决策，并把结果返回给 AI。',
      allowMain: false,
      allowSub: true,
    },
    {
      name: 'chrome_devtools',
      script: path.join(CLI_ROOT, 'mcp_servers', 'chrome-devtools-mcp-server.js'),
      description:
        'Chrome DevTools MCP：让子代理控制/调试本机 Chrome（桌面端内置；CLI 需 Node>=20.19；需要 Chrome）。',
      enabled: false,
      allowMain: false,
      allowSub: true,
    },
  ];
  return entries.map((entry) => ({
    name: entry.name,
    url: entry.url || buildCmdUrl(baseDir, entry.script, entry.args),
    api_key_env: '',
    description: entry.description,
    enabled: entry.enabled !== false,
    allowMain: entry.allowMain === true,
    allowSub: entry.allowSub !== false,
  }));
}

function quoteCmdArg(token) {
  const raw = String(token || '');
  if (!raw) return '';
  if (/[\\\s"]/g.test(raw)) return JSON.stringify(raw);
  return raw;
}

function buildCmdUrl(baseDir, scriptPath, extraArgs) {
  let scriptArg = scriptPath;
  if (baseDir) {
    const relative = path.relative(baseDir, scriptPath);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      scriptArg = relative.startsWith('.') ? relative : `./${relative}`;
    }
  }
  scriptArg = scriptArg.replace(/\\/g, '/');
  const parts = ['cmd://node', quoteCmdArg(scriptArg)];
  if (extraArgs) {
    parts.push(extraArgs);
  }
  return parts.filter(Boolean).join(' ');
}

function shouldRefreshLegacyServers(servers, baseDir, defaults = []) {
  if (!Array.isArray(servers) || servers.length === 0) {
    return true;
  }
  const legacyMarker = '@modelcontextprotocol/server-';
  const allLegacyPlaceholders = servers.every(
    (entry) => typeof entry.url === 'string' && entry.url.includes(legacyMarker)
  );
  if (allLegacyPlaceholders) {
    return true;
  }
  const builtinNames = new Set(
    (Array.isArray(defaults) ? defaults : [])
      .map((entry) => String(entry?.name || '').trim().toLowerCase())
      .filter(Boolean)
  );
  return servers.some((entry) => {
    if (builtinNames.size > 0 && !builtinNames.has(String(entry?.name || '').trim().toLowerCase())) {
      return false;
    }
    const scriptPath = resolveScriptPath(entry.url, baseDir);
    return scriptPath && !fs.existsSync(scriptPath);
  });
}

function resolveScriptPath(url, baseDir) {
  const parsed = parseCmdUrl(url);
  if (!parsed || parsed.command !== 'node' || parsed.args.length === 0) {
    return null;
  }
  const scriptArg = parsed.args[0];
  if (!scriptArg) {
    return null;
  }
  if (path.isAbsolute(scriptArg)) {
    return scriptArg;
  }
  const base = baseDir || process.cwd();
  return path.resolve(base, scriptArg);
}

function parseCmdUrl(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }
  const trimmed = url.trim();
  if (!trimmed.toLowerCase().startsWith('cmd://')) {
    return null;
  }
  const commandLine = trimmed.slice('cmd://'.length).trim();
  if (!commandLine) {
    return null;
  }
  const tokens = shellSplit(commandLine);
  if (tokens.length === 0) {
    return null;
  }
  return {
    command: tokens[0],
    args: tokens.slice(1),
  };
}

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

function normalizeServerKey(name) {
  return String(name || '').trim().toLowerCase();
}

function refreshWithDefaultsPreservingUserConfig({ existing = [], defaults = [], baseDir = '' } = {}) {
  const existingMap = new Map();
  existing.forEach((entry) => {
    const key = normalizeServerKey(entry?.name);
    if (!key || existingMap.has(key)) return;
    existingMap.set(key, entry);
  });

  const used = new Set();
  const merged = [];
  defaults.forEach((def) => {
    const key = normalizeServerKey(def?.name);
    const prev = key ? existingMap.get(key) : null;
    if (!prev) {
      merged.push(def);
      return;
    }
    used.add(key);

    // If the previous url still resolves (e.g., absolute script path exists), keep it;
    // otherwise, fall back to the refreshed default url.
    const prevUrl = typeof prev.url === 'string' ? prev.url : '';
    let nextUrl = def.url;
    const prevScriptPath = resolveScriptPath(prevUrl, baseDir);
    if (!prevScriptPath || fs.existsSync(prevScriptPath)) {
      nextUrl = prevUrl || def.url;
    }

    merged.push({
      ...def,
      ...prev,
      url: nextUrl,
      enabled: prev.enabled !== false,
      allowMain: prev.allowMain === true,
      allowSub: prev.allowSub !== false,
      api_key_env: prev.api_key_env ? String(prev.api_key_env) : def.api_key_env || '',
      description: prev.description ? String(prev.description) : def.description || '',
    });
  });

  // Preserve any non-built-in servers that were present in the user's config.
  existing.forEach((entry) => {
    const key = normalizeServerKey(entry?.name);
    if (!key || used.has(key)) return;
    merged.push(entry);
  });

  return merged;
}

export {
  loadMcpConfig,
  saveMcpConfig,
  resolveMcpPath,
};
