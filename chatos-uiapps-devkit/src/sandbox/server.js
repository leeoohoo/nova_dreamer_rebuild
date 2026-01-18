import fs from 'fs';
import http from 'http';
import path from 'path';
import url from 'url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';

import { copyDir, ensureDir, isDirectory, isFile } from '../lib/fs.js';
import { loadPluginManifest, pickAppFromManifest } from '../lib/plugin.js';
import { resolveInsideDir } from '../lib/path-boundary.js';
import { COMPAT_STATE_ROOT_DIRNAME, STATE_ROOT_DIRNAME } from '../lib/state-constants.js';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN_REGEX = /--ds-[a-z0-9-]+/gi;
const SANDBOX_STATE_DIRNAME = STATE_ROOT_DIRNAME;
const SANDBOX_COMPAT_DIRNAME = COMPAT_STATE_ROOT_DIRNAME;
const GLOBAL_STYLES_CANDIDATES = [
  path.resolve(__dirname, '..', '..', '..', 'common', 'aide-ui', 'components', 'GlobalStyles.jsx'),
  path.resolve(process.cwd(), 'common', 'aide-ui', 'components', 'GlobalStyles.jsx'),
];

function loadTokenNames() {
  for (const candidate of GLOBAL_STYLES_CANDIDATES) {
    try {
      if (!isFile(candidate)) continue;
      const raw = fs.readFileSync(candidate, 'utf8');
      const matches = raw.match(TOKEN_REGEX) || [];
      const names = Array.from(new Set(matches.map((v) => v.toLowerCase())));
      if (names.length > 0) return names.sort();
    } catch {
      // ignore
    }
  }
  return [];
}

function resolveSandboxRoots() {
  const cwd = process.cwd();
  const primary = path.join(cwd, SANDBOX_STATE_DIRNAME);
  const legacy = path.join(cwd, SANDBOX_COMPAT_DIRNAME);
  if (!isDirectory(primary) && isDirectory(legacy)) {
    try {
      copyDir(legacy, primary);
    } catch {
      // ignore compat copy errors
    }
  }
  return { primary, legacy };
}

function resolveSandboxConfigPath({ primaryRoot, legacyRoot }) {
  const primaryPath = path.join(primaryRoot, 'sandbox', 'llm-config.json');
  if (isFile(primaryPath)) return primaryPath;
  const legacyPath = path.join(legacyRoot, 'sandbox', 'llm-config.json');
  if (isFile(legacyPath)) return legacyPath;
  return primaryPath;
}

const DEFAULT_LLM_BASE_URL = 'https://api.openai.com/v1';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry));
  }
  if (isPlainObject(value)) {
    const out = {};
    Object.entries(value).forEach(([key, entry]) => {
      out[key] = cloneValue(entry);
    });
    return out;
  }
  return value;
}

function mergeCallMeta(base, override) {
  if (!base && !override) return null;
  if (!base) return cloneValue(override);
  if (!override) return cloneValue(base);
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return cloneValue(override);
  }
  const merged = cloneValue(base);
  Object.entries(override).forEach(([key, value]) => {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = mergeCallMeta(merged[key], value);
    } else {
      merged[key] = cloneValue(value);
    }
  });
  return merged;
}

function expandCallMetaValue(value, vars) {
  if (typeof value === 'string') {
    let text = value;
    Object.entries(vars).forEach(([key, replacement]) => {
      const token = `$${key}`;
      text = text.split(token).join(String(replacement || ''));
    });
    return text;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => expandCallMetaValue(entry, vars));
  }
  if (isPlainObject(value)) {
    const out = {};
    Object.entries(value).forEach(([key, entry]) => {
      out[key] = expandCallMetaValue(entry, vars);
    });
    return out;
  }
  return value;
}

function buildSandboxCallMeta({ rawCallMeta, rawWorkdir, context } = {}) {
  const ctx = context && typeof context === 'object' ? context : null;
  const defaults = ctx
    ? {
        chatos: {
          uiApp: {
            ...(ctx.pluginId ? { pluginId: ctx.pluginId } : null),
            ...(ctx.appId ? { appId: ctx.appId } : null),
            ...(ctx.pluginDir ? { pluginDir: ctx.pluginDir } : null),
            ...(ctx.dataDir ? { dataDir: ctx.dataDir } : null),
            ...(ctx.stateDir ? { stateDir: ctx.stateDir } : null),
            ...(ctx.sessionRoot ? { sessionRoot: ctx.sessionRoot } : null),
            ...(ctx.projectRoot ? { projectRoot: ctx.projectRoot } : null),
          },
        },
        workdir: ctx.dataDir || ctx.pluginDir || ctx.projectRoot || ctx.sessionRoot || '',
      }
    : null;
  const raw = rawCallMeta && typeof rawCallMeta === 'object' ? rawCallMeta : null;
  if (!defaults && !raw) return null;
  const vars = ctx
    ? {
        pluginId: ctx.pluginId || '',
        appId: ctx.appId || '',
        pluginDir: ctx.pluginDir || '',
        dataDir: ctx.dataDir || '',
        stateDir: ctx.stateDir || '',
        sessionRoot: ctx.sessionRoot || '',
        projectRoot: ctx.projectRoot || '',
      }
    : {};
  const expanded = raw ? expandCallMetaValue(raw, vars) : null;
  let merged = mergeCallMeta(defaults, expanded);
  const workdirRaw = normalizeText(rawWorkdir);
  if (workdirRaw) {
    const expandedWorkdir = expandCallMetaValue(workdirRaw, vars);
    const workdirValue = typeof expandedWorkdir === 'string' ? expandedWorkdir.trim() : '';
    if (workdirValue) {
      merged = mergeCallMeta(merged, { workdir: workdirValue });
    }
  }
  return merged;
}

function loadSandboxLlmConfig(filePath) {
  if (!filePath) return { apiKey: '', baseUrl: '', modelId: '', workdir: '' };
  try {
    if (!fs.existsSync(filePath)) return { apiKey: '', baseUrl: '', modelId: '', workdir: '' };
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      apiKey: normalizeText(parsed?.apiKey),
      baseUrl: normalizeText(parsed?.baseUrl),
      modelId: normalizeText(parsed?.modelId),
      workdir: normalizeText(parsed?.workdir),
    };
  } catch {
    return { apiKey: '', baseUrl: '', modelId: '', workdir: '' };
  }
}

function saveSandboxLlmConfig(filePath, config) {
  if (!filePath) return;
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(config || {}, null, 2), 'utf8');
  } catch {
    // ignore
  }
}

function resolveChatCompletionsUrl(baseUrl) {
  const raw = normalizeText(baseUrl);
  if (!raw) return `${DEFAULT_LLM_BASE_URL}/chat/completions`;
  const normalized = raw.replace(/\/+$/g, '');
  if (normalized.endsWith('/chat/completions')) return normalized;
  if (normalized.includes('/v1')) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

function normalizeMcpName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildMcpToolIdentifier(serverName, toolName) {
  const server = normalizeMcpName(serverName) || 'mcp_server';
  const tool = normalizeMcpName(toolName) || 'tool';
  return `mcp_${server}_${tool}`;
}

function buildMcpToolDescription(serverName, tool) {
  const parts = [];
  if (serverName) parts.push(`[${serverName}]`);
  if (tool?.annotations?.title) parts.push(tool.annotations.title);
  else if (tool?.description) parts.push(tool.description);
  else parts.push('MCP tool');
  return parts.join(' ');
}

function extractContentText(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return '';
  const lines = [];
  blocks.forEach((block) => {
    if (!block || typeof block !== 'object') return;
    switch (block.type) {
      case 'text':
        if (block.text) lines.push(block.text);
        break;
      case 'resource_link':
        lines.push(`resource: ${block.uri || block.resourceId || '(unknown)'}`);
        break;
      case 'image':
        lines.push(`image (${block.mimeType || 'image'}, ${approxSize(block.data)})`);
        break;
      case 'audio':
        lines.push(`audio (${block.mimeType || 'audio'}, ${approxSize(block.data)})`);
        break;
      case 'resource':
        lines.push('resource payload returned (use /mcp to inspect).');
        break;
      default:
        lines.push(`[${block.type}]`);
        break;
    }
  });
  return lines.join('\n');
}

function approxSize(base64Text) {
  if (!base64Text) return 'unknown size';
  const bytes = Math.round((base64Text.length * 3) / 4);
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatMcpToolResult(serverName, toolName, result) {
  const header = `[${serverName}/${toolName}]`;
  if (!result) return `${header} tool returned no result.`;
  if (result.isError) {
    const errorText = extractContentText(result.content) || 'MCP tool failed.';
    return `${header} ❌ ${errorText}`;
  }
  const segments = [];
  const textBlock = extractContentText(result.content);
  if (textBlock) segments.push(textBlock);
  if (result.structuredContent && Object.keys(result.structuredContent).length > 0) {
    segments.push(JSON.stringify(result.structuredContent, null, 2));
  }
  if (segments.length === 0) segments.push('Tool completed with no text output.');
  return `${header}\n${segments.join('\n\n')}`;
}

async function listAllMcpTools(client) {
  const collected = [];
  let cursor = null;
  do {
    // eslint-disable-next-line no-await-in-loop
    const result = await client.listTools(cursor ? { cursor } : undefined);
    if (Array.isArray(result?.tools)) {
      collected.push(...result.tools);
    }
    cursor = result?.nextCursor || null;
  } while (cursor);
  if (typeof client.cacheToolMetadata === 'function') {
    client.cacheToolMetadata(collected);
  }
  return collected;
}

async function connectMcpServer(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const serverName = normalizeText(entry.name) || 'mcp_server';
  const env = { ...process.env };
  if (!env.MODEL_CLI_SESSION_ROOT) env.MODEL_CLI_SESSION_ROOT = process.cwd();
  if (!env.MODEL_CLI_WORKSPACE_ROOT) env.MODEL_CLI_WORKSPACE_ROOT = process.cwd();

  if (entry.command) {
    const client = new Client({ name: 'sandbox', version: '0.1.0' });
    const transport = new StdioClientTransport({
      command: entry.command,
      args: Array.isArray(entry.args) ? entry.args : [],
      cwd: entry.cwd || process.cwd(),
      env,
      stderr: 'pipe',
    });
    await client.connect(transport);
    const tools = await listAllMcpTools(client);
    return { serverName, client, transport, tools };
  }

  if (entry.url) {
    const urlText = normalizeText(entry.url);
    if (!urlText) return null;
    const parsed = new URL(urlText);
    if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') {
      const client = new Client({ name: 'sandbox', version: '0.1.0' });
      const transport = new WebSocketClientTransport(parsed);
      await client.connect(transport);
      const tools = await listAllMcpTools(client);
      return { serverName, client, transport, tools };
    }

    const errors = [];
    try {
      const client = new Client({ name: 'sandbox', version: '0.1.0' });
      const transport = new StreamableHTTPClientTransport(parsed);
      await client.connect(transport);
      const tools = await listAllMcpTools(client);
      return { serverName, client, transport, tools };
    } catch (err) {
      errors.push(`streamable_http: ${err?.message || err}`);
    }
    try {
      const client = new Client({ name: 'sandbox', version: '0.1.0' });
      const transport = new SSEClientTransport(parsed);
      await client.connect(transport);
      const tools = await listAllMcpTools(client);
      return { serverName, client, transport, tools };
    } catch (err) {
      errors.push(`sse: ${err?.message || err}`);
    }
    throw new Error(`Failed to connect MCP server (${serverName}): ${errors.join(' | ')}`);
  }

  return null;
}

function buildAppMcpEntry({ pluginDir, pluginId, app }) {
  const mcp = app?.ai?.mcp && typeof app.ai.mcp === 'object' ? app.ai.mcp : null;
  if (!mcp) return null;
  if (mcp.enabled === false) return null;
  const serverName = mcp?.name ? String(mcp.name).trim() : `${pluginId}.${app.id}`;
  const command = normalizeText(mcp.command) || 'node';
  const args = Array.isArray(mcp.args) ? mcp.args : [];
  const entryRel = normalizeText(mcp.entry);
  if (entryRel) {
    const entryAbs = resolveInsideDir(pluginDir, entryRel);
    return { name: serverName, command, args: [entryAbs, ...args], cwd: pluginDir };
  }
  const urlText = normalizeText(mcp.url);
  if (urlText) {
    return { name: serverName, url: urlText };
  }
  if (normalizeText(mcp.command)) {
    return { name: serverName, command, args, cwd: pluginDir };
  }
  return null;
}

function readPromptSource(source, pluginDir) {
  if (!source) return '';
  if (typeof source === 'string') {
    const rel = source.trim();
    if (!rel) return '';
    const abs = resolveInsideDir(pluginDir, rel);
    if (!isFile(abs)) return '';
    return fs.readFileSync(abs, 'utf8');
  }
  if (typeof source === 'object') {
    const content = normalizeText(source?.content);
    if (content) return content;
    const rel = normalizeText(source?.path);
    if (!rel) return '';
    const abs = resolveInsideDir(pluginDir, rel);
    if (!isFile(abs)) return '';
    return fs.readFileSync(abs, 'utf8');
  }
  return '';
}

function resolveAppMcpPrompt(app, pluginDir) {
  const prompt = app?.ai?.mcpPrompt;
  if (!prompt) return '';
  if (typeof prompt === 'string') {
    return readPromptSource(prompt, pluginDir);
  }
  if (typeof prompt === 'object') {
    const zh = readPromptSource(prompt.zh, pluginDir);
    const en = readPromptSource(prompt.en, pluginDir);
    return zh || en || '';
  }
  return '';
}

async function callOpenAiChat({ apiKey, baseUrl, model, messages, tools, signal }) {
  const endpoint = resolveChatCompletionsUrl(baseUrl);
  const payload = {
    model,
    messages,
    stream: false,
  };
  if (Array.isArray(tools) && tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = 'auto';
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM request failed (${res.status}): ${text || res.statusText}`);
  }
  return await res.json();
}

function sendJson(res, status, obj) {
  const raw = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(raw);
}

function sendText(res, status, text, contentType) {
  res.writeHead(status, {
    'content-type': contentType || 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(text);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function guessContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.mjs' || ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.md') return 'text/markdown; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  return 'application/octet-stream';
}

function serveStaticFile(res, filePath) {
  if (!isFile(filePath)) return false;
  const ct = guessContentType(filePath);
  const buf = fs.readFileSync(filePath);
  res.writeHead(200, { 'content-type': ct, 'cache-control': 'no-store' });
  res.end(buf);
  return true;
}

function startRecursiveWatcher(rootDir, onChange) {
  const root = path.resolve(rootDir);
  if (!isDirectory(root)) return () => {};

  const watchers = new Map();

  const shouldIgnore = (p) => {
    const base = path.basename(p);
    if (!base) return false;
    if (base === 'node_modules') return true;
    if (base === '.git') return true;
    if (base === '.DS_Store') return true;
    return false;
  };

  const scan = (dir) => {
    const abs = path.resolve(dir);
    if (!isDirectory(abs)) return;
    if (shouldIgnore(abs)) return;
    if (!watchers.has(abs)) {
      try {
        const w = fs.watch(abs, (eventType, filename) => {
          const relName = filename ? String(filename) : '';
          const filePath = relName ? path.join(abs, relName) : abs;
          try {
            onChange({ eventType, filePath });
          } catch {
            // ignore
          }
          scheduleRescan();
        });
        watchers.set(abs, w);
      } catch {
        // ignore
      }
    }

    let entries = [];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent?.isDirectory?.()) continue;
      const child = path.join(abs, ent.name);
      if (shouldIgnore(child)) continue;
      scan(child);
    }
  };

  let rescanTimer = null;
  const scheduleRescan = () => {
    if (rescanTimer) return;
    rescanTimer = setTimeout(() => {
      rescanTimer = null;
      scan(root);
    }, 250);
  };

  scan(root);

  return () => {
    if (rescanTimer) {
      try {
        clearTimeout(rescanTimer);
      } catch {
        // ignore
      }
      rescanTimer = null;
    }
    for (const w of watchers.values()) {
      try {
        w.close();
      } catch {
        // ignore
      }
    }
    watchers.clear();
  };
}

function htmlPage() {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ChatOS UI Apps Sandbox</title>
    <style>
      :root {
        color-scheme: light;
        --ds-accent: #00d4ff;
        --ds-accent-2: #7c3aed;
        --ds-panel-bg: rgba(255, 255, 255, 0.86);
        --ds-panel-border: rgba(15, 23, 42, 0.08);
        --ds-subtle-bg: rgba(255, 255, 255, 0.62);
        --ds-selected-bg: linear-gradient(90deg, rgba(0, 212, 255, 0.14), rgba(124, 58, 237, 0.08));
        --ds-focus-ring: rgba(0, 212, 255, 0.32);
        --ds-nav-hover-bg: rgba(15, 23, 42, 0.06);
        --ds-code-bg: #f7f9fb;
        --ds-code-border: #eef2f7;
        --sandbox-bg: #f5f7fb;
        --sandbox-text: #111;
      }
      :root[data-theme='dark'] {
        color-scheme: dark;
        --ds-accent: #00d4ff;
        --ds-accent-2: #a855f7;
        --ds-panel-bg: rgba(17, 19, 28, 0.82);
        --ds-panel-border: rgba(255, 255, 255, 0.14);
        --ds-subtle-bg: rgba(255, 255, 255, 0.04);
        --ds-selected-bg: linear-gradient(90deg, rgba(0, 212, 255, 0.18), rgba(168, 85, 247, 0.14));
        --ds-focus-ring: rgba(0, 212, 255, 0.5);
        --ds-nav-hover-bg: rgba(255, 255, 255, 0.08);
        --ds-code-bg: #0d1117;
        --ds-code-border: #30363d;
        --sandbox-bg: #0f1115;
        --sandbox-text: #eee;
      }
      body {
        margin:0;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
        background: var(--sandbox-bg);
        color: var(--sandbox-text);
      }
      #appRoot { height: 100vh; display:flex; flex-direction:column; }
      #sandboxToolbar {
        flex: 0 0 auto;
        border-bottom: 1px solid var(--ds-panel-border);
        padding: 10px 12px;
        background: var(--ds-panel-bg);
      }
      #headerSlot {
        flex: 0 0 auto;
        border-bottom: 1px solid var(--ds-panel-border);
        padding: 10px 12px;
        background: var(--ds-panel-bg);
      }
      #container { flex: 1 1 auto; min-height:0; overflow:hidden; }
      #containerInner { height:100%; overflow:auto; }
      .muted { opacity: 0.7; font-size: 12px; }
      .bar { display:flex; gap:10px; align-items:center; justify-content:space-between; }
      .btn {
        border:1px solid var(--ds-panel-border);
        background: var(--ds-subtle-bg);
        padding:6px 10px;
        border-radius:10px;
        cursor:pointer;
        font-weight:650;
        color: inherit;
      }
      .btn[data-active='1'] {
        background: var(--ds-selected-bg);
        box-shadow: 0 0 0 2px var(--ds-focus-ring);
      }
      .btn:active { transform: translateY(1px); }
      #promptsPanel {
        position: fixed;
        right: 12px;
        bottom: 12px;
        width: 420px;
        max-height: 70vh;
        display:none;
        flex-direction:column;
        background: var(--ds-panel-bg);
        color: inherit;
        border:1px solid var(--ds-panel-border);
        border-radius:14px;
        overflow:hidden;
        box-shadow: 0 18px 60px rgba(0,0,0,0.18);
      }
      #promptsPanelHeader { padding: 10px 12px; display:flex; align-items:center; justify-content:space-between; border-bottom: 1px solid var(--ds-panel-border); }
      #promptsPanelBody { padding: 10px 12px; overflow:auto; display:flex; flex-direction:column; gap:10px; }
      #promptsFab { position: fixed; right: 16px; bottom: 16px; width: 44px; height: 44px; border-radius: 999px; display:flex; align-items:center; justify-content:center; }
      .card { border: 1px solid var(--ds-panel-border); border-radius: 12px; padding: 10px; background: var(--ds-panel-bg); }
      .row { display:flex; gap:10px; }
      .toolbar-group { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
      .segmented { display:flex; gap:6px; align-items:center; }
      #sandboxInspector {
        position: fixed;
        right: 12px;
        top: 72px;
        width: 360px;
        max-height: 70vh;
        display: none;
        flex-direction: column;
        background: var(--ds-panel-bg);
        border: 1px solid var(--ds-panel-border);
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 14px 40px rgba(0,0,0,0.16);
        z-index: 10;
      }
      #sandboxInspectorHeader {
        padding: 10px 12px;
        display:flex;
        align-items:center;
        justify-content: space-between;
        border-bottom: 1px solid var(--ds-panel-border);
      }
      #sandboxInspectorBody {
        padding: 10px 12px;
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      #llmPanel {
        position: fixed;
        right: 12px;
        top: 72px;
        width: 420px;
        max-height: 70vh;
        display: none;
        flex-direction: column;
        background: var(--ds-panel-bg);
        border: 1px solid var(--ds-panel-border);
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 14px 40px rgba(0,0,0,0.16);
        z-index: 11;
      }
      #llmPanelHeader {
        padding: 10px 12px;
        display:flex;
        align-items:center;
        justify-content: space-between;
        border-bottom: 1px solid var(--ds-panel-border);
      }
      #llmPanelBody {
        padding: 10px 12px;
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .section-title { font-size: 12px; font-weight: 700; opacity: 0.8; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; white-space: pre-wrap; }
      input, textarea, select {
        width:100%;
        padding:8px;
        border-radius:10px;
        border:1px solid var(--ds-panel-border);
        background: var(--ds-subtle-bg);
        color: inherit;
      }
      textarea { min-height: 70px; resize: vertical; }
      label { font-size: 12px; opacity: 0.8; }
      .danger { border-color: rgba(255,0,0,0.35); }
    </style>
  </head>
  <body>
    <div id="appRoot">
      <div id="sandboxToolbar">
        <div class="bar">
          <div>
            <div style="font-weight:800">ChatOS UI Apps Sandbox</div>
            <div class="muted">Host API mock · 模拟 module mount({ container, host, slots })</div>
          </div>
          <div class="row toolbar-group">
            <span class="muted">Theme</span>
            <div class="segmented" role="group" aria-label="Theme">
              <button id="btnThemeLight" class="btn" type="button">Light</button>
              <button id="btnThemeDark" class="btn" type="button">Dark</button>
              <button id="btnThemeSystem" class="btn" type="button">System</button>
            </div>
            <div id="themeStatus" class="muted"></div>
            <div id="sandboxContext" class="muted"></div>
            <button id="btnLlmConfig" class="btn" type="button">AI Config</button>
            <button id="btnInspectorToggle" class="btn" type="button">Inspect</button>
            <button id="btnReload" class="btn" type="button">Reload</button>
          </div>
        </div>
      </div>
      <div id="headerSlot"></div>
      <div id="container"><div id="containerInner"></div></div>
    </div>

    <button id="promptsFab" class="btn" type="button">:)</button>

    <div id="promptsPanel">
      <div id="promptsPanelHeader">
        <div style="font-weight:800">UI Prompts</div>
        <button id="promptsClose" class="btn" type="button">Close</button>
      </div>
      <div id="promptsPanelBody"></div>
    </div>

    <div id="llmPanel" aria-hidden="true">
      <div id="llmPanelHeader">
        <div style="font-weight:800">Sandbox LLM</div>
        <div class="row">
          <button id="btnLlmRefresh" class="btn" type="button">Refresh</button>
          <button id="btnLlmClose" class="btn" type="button">Close</button>
        </div>
      </div>
      <div id="llmPanelBody">
        <div class="card">
          <label for="llmApiKey">API Key</label>
          <input id="llmApiKey" type="password" placeholder="sk-..." autocomplete="off" />
          <div id="llmKeyStatus" class="muted"></div>
        </div>
        <div class="card">
          <label for="llmBaseUrl">Base URL</label>
          <input id="llmBaseUrl" type="text" placeholder="https://api.openai.com/v1" />
        </div>
        <div class="card">
          <label for="llmModelId">Model ID</label>
          <input id="llmModelId" type="text" placeholder="gpt-4o-mini" />
        </div>
        <div class="card">
          <label for="llmWorkdir">Workdir</label>
          <input id="llmWorkdir" type="text" placeholder="(default: dataDir)" />
          <div class="muted">留空使用 dataDir；支持 $dataDir/$pluginDir/$projectRoot</div>
        </div>
        <div class="row">
          <button id="btnLlmSave" class="btn" type="button">Save</button>
          <button id="btnLlmClear" class="btn" type="button">Clear Key</button>
        </div>
        <div id="llmStatus" class="muted"></div>
      </div>
    </div>

    <div id="sandboxInspector" aria-hidden="true">
      <div id="sandboxInspectorHeader">
        <div style="font-weight:800">Sandbox Inspector</div>
        <div class="row">
          <button id="btnInspectorRefresh" class="btn" type="button">Refresh</button>
          <button id="btnInspectorClose" class="btn" type="button">Close</button>
        </div>
      </div>
      <div id="sandboxInspectorBody">
        <div>
          <div class="section-title">Host Context</div>
          <pre id="inspectorContext" class="mono"></pre>
        </div>
        <div>
          <div class="section-title">Theme</div>
          <pre id="inspectorTheme" class="mono"></pre>
        </div>
        <div>
          <div class="section-title">Tokens</div>
          <pre id="inspectorTokens" class="mono"></pre>
        </div>
      </div>
    </div>

    <script type="module" src="/sandbox.mjs"></script>
  </body>
</html>`;
}

function sandboxClientJs() {
  return `const $ = (sel) => document.querySelector(sel);

const container = $('#containerInner');
const headerSlot = $('#headerSlot');
const fab = $('#promptsFab');
const panel = $('#promptsPanel');
const panelBody = $('#promptsPanelBody');
const panelClose = $('#promptsClose');
const btnThemeLight = $('#btnThemeLight');
const btnThemeDark = $('#btnThemeDark');
const btnThemeSystem = $('#btnThemeSystem');
const themeStatus = $('#themeStatus');
const sandboxContext = $('#sandboxContext');
const btnInspectorToggle = $('#btnInspectorToggle');
const sandboxInspector = $('#sandboxInspector');
const btnInspectorClose = $('#btnInspectorClose');
const btnInspectorRefresh = $('#btnInspectorRefresh');
const inspectorContext = $('#inspectorContext');
const inspectorTheme = $('#inspectorTheme');
const inspectorTokens = $('#inspectorTokens');
const btnLlmConfig = $('#btnLlmConfig');
const llmPanel = $('#llmPanel');
const btnLlmClose = $('#btnLlmClose');
const btnLlmRefresh = $('#btnLlmRefresh');
const btnLlmSave = $('#btnLlmSave');
const btnLlmClear = $('#btnLlmClear');
const llmApiKey = $('#llmApiKey');
const llmBaseUrl = $('#llmBaseUrl');
const llmModelId = $('#llmModelId');
const llmWorkdir = $('#llmWorkdir');
const llmStatus = $('#llmStatus');
const llmKeyStatus = $('#llmKeyStatus');

const setPanelOpen = (open) => { panel.style.display = open ? 'flex' : 'none'; };
fab.addEventListener('click', () => setPanelOpen(panel.style.display !== 'flex'));
panelClose.addEventListener('click', () => setPanelOpen(false));
window.addEventListener('chatos:uiPrompts:open', () => setPanelOpen(true));
window.addEventListener('chatos:uiPrompts:close', () => setPanelOpen(false));
window.addEventListener('chatos:uiPrompts:toggle', () => setPanelOpen(panel.style.display !== 'flex'));

const THEME_STORAGE_KEY = 'chatos:sandbox:theme-mode';
const themeListeners = new Set();
const themeButtons = [
  { mode: 'light', el: btnThemeLight },
  { mode: 'dark', el: btnThemeDark },
  { mode: 'system', el: btnThemeSystem },
];
const systemQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

const normalizeThemeMode = (mode) => (mode === 'light' || mode === 'dark' || mode === 'system' ? mode : 'system');

const loadThemeMode = () => {
  try {
    return normalizeThemeMode(String(localStorage.getItem(THEME_STORAGE_KEY) || ''));
  } catch {
    return 'system';
  }
};

let themeMode = loadThemeMode();
let currentTheme = 'light';
let inspectorEnabled = false;
let inspectorTimer = null;

const resolveTheme = () => {
  if (themeMode === 'light' || themeMode === 'dark') return themeMode;
  return systemQuery && systemQuery.matches ? 'dark' : 'light';
};

const emitThemeChange = (theme) => {
  for (const fn of themeListeners) { try { fn(theme); } catch {} }
};

const updateThemeControls = () => {
  for (const { mode, el } of themeButtons) {
    if (!el) continue;
    const active = mode === themeMode;
    el.dataset.active = active ? '1' : '0';
    el.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  if (themeStatus) {
    themeStatus.textContent = themeMode === 'system' ? 'system -> ' + currentTheme : currentTheme;
  }
};

const updateContextStatus = () => {
  if (!sandboxContext) return;
  sandboxContext.textContent = __SANDBOX__.pluginId + ':' + __SANDBOX__.appId;
};

const isInspectorOpen = () => sandboxInspector && sandboxInspector.style.display === 'flex';
const isLlmPanelOpen = () => llmPanel && llmPanel.style.display === 'flex';

const setLlmStatus = (text, isError) => {
  if (!llmStatus) return;
  llmStatus.textContent = text || '';
  llmStatus.style.color = isError ? '#ef4444' : '';
};

const refreshLlmConfig = async () => {
  try {
    setLlmStatus('Loading...');
    const r = await fetch('/api/sandbox/llm-config');
    const j = await r.json();
    if (!j?.ok) throw new Error(j?.message || 'Failed to load config');
    const cfg = j?.config || {};
    if (llmBaseUrl) llmBaseUrl.value = cfg.baseUrl || '';
    if (llmModelId) llmModelId.value = cfg.modelId || '';
    if (llmWorkdir) llmWorkdir.value = cfg.workdir || '';
    if (llmKeyStatus) llmKeyStatus.textContent = cfg.hasApiKey ? 'API key set' : 'API key missing';
    setLlmStatus('');
  } catch (err) {
    setLlmStatus(err?.message || String(err), true);
  }
};

const saveLlmConfig = async ({ clearKey } = {}) => {
  try {
    setLlmStatus('Saving...');
    const payload = {
      baseUrl: llmBaseUrl ? llmBaseUrl.value : '',
      modelId: llmModelId ? llmModelId.value : '',
      workdir: llmWorkdir ? llmWorkdir.value : '',
    };
    const apiKey = llmApiKey ? llmApiKey.value : '';
    if (clearKey) {
      payload.apiKey = '';
    } else if (apiKey && apiKey.trim()) {
      payload.apiKey = apiKey.trim();
    }
    const r = await fetch('/api/sandbox/llm-config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!j?.ok) throw new Error(j?.message || 'Failed to save config');
    if (llmApiKey) llmApiKey.value = '';
    await refreshLlmConfig();
    setLlmStatus('Saved');
  } catch (err) {
    setLlmStatus(err?.message || String(err), true);
  }
};

const setLlmPanelOpen = (open) => {
  if (!llmPanel) return;
  llmPanel.style.display = open ? 'flex' : 'none';
  llmPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (open) refreshLlmConfig();
};

const formatJson = (value) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const tokenNameList = Array.isArray(__SANDBOX__.tokenNames) ? __SANDBOX__.tokenNames : [];
const sandboxContextBase = __SANDBOX__.context || { pluginId: __SANDBOX__.pluginId, appId: __SANDBOX__.appId };

const collectTokens = () => {
  const style = getComputedStyle(document.documentElement);
  const names = new Set(tokenNameList);
  for (let i = 0; i < style.length; i += 1) {
    const name = style[i];
    if (name && name.startsWith('--ds-')) names.add(name);
  }
  return [...names]
    .sort()
    .map((name) => {
      const value = style.getPropertyValue(name).trim();
      return name + ': ' + (value || '(unset)');
    })
    .join('\\n');
};

const readHostContext = () => {
  if (!inspectorEnabled) return null;
  if (typeof host?.context?.get === 'function') return host.context.get();
  return { ...sandboxContextBase, theme: currentTheme, bridge: { enabled: true } };
};

const readThemeInfo = () => ({
  themeMode,
  currentTheme,
  dataTheme: document.documentElement.dataset.theme || '',
  dataThemeMode: document.documentElement.dataset.themeMode || '',
  prefersColorScheme: systemQuery ? (systemQuery.matches ? 'dark' : 'light') : 'unknown',
});

const updateInspector = () => {
  if (!inspectorEnabled) return;
  if (inspectorContext) inspectorContext.textContent = formatJson(readHostContext());
  if (inspectorTheme) inspectorTheme.textContent = formatJson(readThemeInfo());
  if (inspectorTokens) inspectorTokens.textContent = collectTokens();
};

const startInspectorTimer = () => {
  if (inspectorTimer) return;
  inspectorTimer = setInterval(updateInspector, 1000);
};

const stopInspectorTimer = () => {
  if (!inspectorTimer) return;
  clearInterval(inspectorTimer);
  inspectorTimer = null;
};

const setInspectorOpen = (open) => {
  if (!sandboxInspector) return;
  sandboxInspector.style.display = open ? 'flex' : 'none';
  sandboxInspector.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (open) {
    updateInspector();
    startInspectorTimer();
  } else {
    stopInspectorTimer();
  }
};

const updateInspectorIfOpen = () => {
  if (!inspectorEnabled) return;
  if (isInspectorOpen()) updateInspector();
};

const applyThemeMode = (mode, { persist = true } = {}) => {
  themeMode = normalizeThemeMode(mode);
  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {
      // ignore
    }
  }
  const nextTheme = resolveTheme();
  const prevTheme = currentTheme;
  currentTheme = nextTheme;
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.dataset.themeMode = themeMode;
  updateThemeControls();
  updateInspectorIfOpen();
  if (nextTheme !== prevTheme) emitThemeChange(nextTheme);
};

if (systemQuery && typeof systemQuery.addEventListener === 'function') {
  systemQuery.addEventListener('change', () => {
    if (themeMode === 'system') applyThemeMode('system', { persist: false });
  });
}

if (btnThemeLight) btnThemeLight.addEventListener('click', () => applyThemeMode('light'));
if (btnThemeDark) btnThemeDark.addEventListener('click', () => applyThemeMode('dark'));
if (btnThemeSystem) btnThemeSystem.addEventListener('click', () => applyThemeMode('system'));
if (btnLlmConfig) btnLlmConfig.addEventListener('click', () => setLlmPanelOpen(!isLlmPanelOpen()));
if (btnLlmClose) btnLlmClose.addEventListener('click', () => setLlmPanelOpen(false));
if (btnLlmRefresh) btnLlmRefresh.addEventListener('click', () => refreshLlmConfig());
if (btnLlmSave) btnLlmSave.addEventListener('click', () => saveLlmConfig());
if (btnLlmClear) btnLlmClear.addEventListener('click', () => saveLlmConfig({ clearKey: true }));
if (btnInspectorToggle) btnInspectorToggle.addEventListener('click', () => setInspectorOpen(!isInspectorOpen()));
if (btnInspectorClose) btnInspectorClose.addEventListener('click', () => setInspectorOpen(false));
if (btnInspectorRefresh) btnInspectorRefresh.addEventListener('click', () => updateInspector());

applyThemeMode(themeMode || 'system', { persist: false });
updateContextStatus();

const entries = [];
const listeners = new Set();
const emitUpdate = () => {
  const payload = { path: '(sandbox)', entries: [...entries] };
  for (const fn of listeners) { try { fn(payload); } catch {} }
  renderPrompts();
};

const uuid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2));

function renderPrompts() {
  panelBody.textContent = '';
  const pending = new Map();
  for (const e of entries) {
    if (e?.type !== 'ui_prompt') continue;
    const id = String(e?.requestId || '');
    if (!id) continue;
    if (e.action === 'request') pending.set(id, e);
    if (e.action === 'response') pending.delete(id);
  }

  if (pending.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = '暂无待办（request 后会出现在这里）';
    panelBody.appendChild(empty);
    return;
  }

  for (const [requestId, req] of pending.entries()) {
    const card = document.createElement('div');
    card.className = 'card';

    const title = document.createElement('div');
    title.style.fontWeight = '800';
    title.textContent = req?.prompt?.title || '(untitled)';

    const msg = document.createElement('div');
    msg.className = 'muted';
    msg.style.marginTop = '6px';
    msg.textContent = req?.prompt?.message || '';

    const source = document.createElement('div');
    source.className = 'muted';
    source.style.marginTop = '6px';
    source.textContent = req?.prompt?.source ? String(req.prompt.source) : '';

    const form = document.createElement('div');
    form.style.marginTop = '10px';
    form.style.display = 'grid';
    form.style.gap = '10px';

    const kind = String(req?.prompt?.kind || '');

    const mkBtn = (label, danger) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn' + (danger ? ' danger' : '');
      btn.textContent = label;
      return btn;
    };

    const submit = async (response) => {
      entries.push({ ts: new Date().toISOString(), type: 'ui_prompt', action: 'response', requestId, response });
      emitUpdate();
    };

    if (kind === 'kv') {
      const fields = Array.isArray(req?.prompt?.fields) ? req.prompt.fields : [];
      const values = {};
      for (const f of fields) {
        const key = String(f?.key || '');
        if (!key) continue;
        const wrap = document.createElement('div');
        const lab = document.createElement('label');
        lab.textContent = f?.label ? String(f.label) : key;
        const input = document.createElement(f?.multiline ? 'textarea' : 'input');
        input.placeholder = f?.placeholder ? String(f.placeholder) : '';
        input.value = f?.default ? String(f.default) : '';
        input.addEventListener('input', () => { values[key] = String(input.value || ''); });
        values[key] = String(input.value || '');
        wrap.appendChild(lab);
        wrap.appendChild(input);
        form.appendChild(wrap);
      }
      const row = document.createElement('div');
      row.className = 'row';
      const ok = mkBtn('Submit');
      ok.addEventListener('click', () => submit({ status: 'ok', values }));
      const cancel = mkBtn('Cancel', true);
      cancel.addEventListener('click', () => submit({ status: 'cancel' }));
      row.appendChild(ok);
      row.appendChild(cancel);
      form.appendChild(row);
    } else if (kind === 'choice') {
      const options = Array.isArray(req?.prompt?.options) ? req.prompt.options : [];
      const multiple = Boolean(req?.prompt?.multiple);
      const selected = new Set();
      const wrap = document.createElement('div');
      const lab = document.createElement('label');
      lab.textContent = '选择';
      const select = document.createElement('select');
      if (multiple) select.multiple = true;
      for (const opt of options) {
        const v = String(opt?.value || '');
        const o = document.createElement('option');
        o.value = v;
        o.textContent = opt?.label ? String(opt.label) : v;
        select.appendChild(o);
      }
      select.addEventListener('change', () => {
        selected.clear();
        for (const o of select.selectedOptions) selected.add(String(o.value));
      });
      wrap.appendChild(lab);
      wrap.appendChild(select);
      form.appendChild(wrap);
      const row = document.createElement('div');
      row.className = 'row';
      const ok = mkBtn('Submit');
      ok.addEventListener('click', () => submit({ status: 'ok', value: multiple ? Array.from(selected) : Array.from(selected)[0] || '' }));
      const cancel = mkBtn('Cancel', true);
      cancel.addEventListener('click', () => submit({ status: 'cancel' }));
      row.appendChild(ok);
      row.appendChild(cancel);
      form.appendChild(row);
    } else {
      const row = document.createElement('div');
      row.className = 'row';
      const ok = mkBtn('OK');
      ok.addEventListener('click', () => submit({ status: 'ok' }));
      const cancel = mkBtn('Cancel', true);
      cancel.addEventListener('click', () => submit({ status: 'cancel' }));
      row.appendChild(ok);
      row.appendChild(cancel);
      form.appendChild(row);
    }

    card.appendChild(title);
    if (msg.textContent) card.appendChild(msg);
    if (source.textContent) card.appendChild(source);
    card.appendChild(form);
    panelBody.appendChild(card);
  }
}

const buildChatMessages = (list) => {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const msg of list) {
    const role = String(msg?.role || '').trim();
    const text = typeof msg?.text === 'string' ? msg.text : '';
    if (!text || !text.trim()) continue;
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;
    out.push({ role, text });
  }
  return out;
};

const callSandboxChat = async (payload, signal) => {
  const r = await fetch('/api/llm/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload || {}),
    signal,
  });
  const j = await r.json();
  if (!j?.ok) throw new Error(j?.message || 'Sandbox LLM call failed');
  return j;
};

const getTheme = () => currentTheme || resolveTheme();

const host = {
  bridge: { enabled: true },
  context: { get: () => ({ ...sandboxContextBase, theme: getTheme(), bridge: { enabled: true } }) },
  theme: {
    get: getTheme,
    onChange: (listener) => {
      if (typeof listener !== 'function') return () => {};
      themeListeners.add(listener);
      return () => themeListeners.delete(listener);
    },
  },
  admin: {
    state: async () => ({ ok: true, state: {} }),
    onUpdate: () => () => {},
    models: { list: async () => ({ ok: true, models: [] }) },
    secrets: { list: async () => ({ ok: true, secrets: [] }) },
  },
  registry: {
    list: async () => ({ ok: true, apps: [__SANDBOX__.registryApp] }),
  },
  backend: {
    invoke: async (method, params) => {
      const r = await fetch('/api/backend/invoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, params }),
      });
      const j = await r.json();
      if (j?.ok === false) throw new Error(j?.message || 'invoke failed');
      return j?.result;
    },
  },
  uiPrompts: {
    read: async () => ({ path: '(sandbox)', entries: [...entries] }),
    onUpdate: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    request: async (payload) => {
      const requestId = payload?.requestId ? String(payload.requestId) : uuid();
      const prompt = payload?.prompt && typeof payload.prompt === 'object' ? { ...payload.prompt } : null;
      if (prompt && !prompt.source) prompt.source = __SANDBOX__.pluginId + ':' + __SANDBOX__.appId;
      entries.push({ ts: new Date().toISOString(), type: 'ui_prompt', action: 'request', requestId, runId: payload?.runId, prompt });
      emitUpdate();
      return { ok: true, requestId };
    },
    respond: async (payload) => {
      const requestId = String(payload?.requestId || '');
      if (!requestId) throw new Error('requestId is required');
      const response = payload?.response && typeof payload.response === 'object' ? payload.response : null;
      entries.push({ ts: new Date().toISOString(), type: 'ui_prompt', action: 'response', requestId, runId: payload?.runId, response });
      emitUpdate();
      return { ok: true };
    },
    open: () => (setPanelOpen(true), { ok: true }),
    close: () => (setPanelOpen(false), { ok: true }),
    toggle: () => (setPanelOpen(panel.style.display !== 'flex'), { ok: true }),
  },
  ui: { navigate: (menu) => ({ ok: true, menu }) },
  chat: (() => {
    const clone = (v) => JSON.parse(JSON.stringify(v));

    const agents = [
      {
        id: 'sandbox-agent',
        name: 'Sandbox Agent',
        description: 'Mock agent for ChatOS UI Apps Sandbox',
      },
    ];

    const sessions = new Map();
    const defaultSessionByAgent = new Map();
    const messagesBySession = new Map();

    const listeners = new Set();
    const activeRuns = new Map(); // sessionId -> { aborted: boolean, timers: number[] }

    const emit = (payload) => {
      for (const sub of listeners) {
        const filter = sub?.filter && typeof sub.filter === 'object' ? sub.filter : {};
        if (filter?.sessionId && String(filter.sessionId) !== String(payload?.sessionId || '')) continue;
        if (Array.isArray(filter?.types) && filter.types.length > 0) {
          const t = String(payload?.type || '');
          if (!filter.types.includes(t)) continue;
        }
        try {
          sub.fn(payload);
        } catch {
          // ignore
        }
      }
    };

    const ensureAgent = async () => {
      if (agents.length > 0) return agents[0];
      const created = { id: 'sandbox-agent', name: 'Sandbox Agent', description: 'Mock agent' };
      agents.push(created);
      return created;
    };

    const ensureSession = async (agentId) => {
      const aid = String(agentId || '').trim() || (await ensureAgent()).id;
      const existingId = defaultSessionByAgent.get(aid);
      if (existingId && sessions.has(existingId)) return sessions.get(existingId);

      const id = 'sandbox-session-' + uuid();
      const session = { id, agentId: aid, createdAt: new Date().toISOString() };
      sessions.set(id, session);
      defaultSessionByAgent.set(aid, id);
      if (!messagesBySession.has(id)) messagesBySession.set(id, []);
      return session;
    };

    const agentsApi = {
      list: async () => ({ ok: true, agents: clone(agents) }),
      ensureDefault: async () => ({ ok: true, agent: clone(await ensureAgent()) }),
      create: async (payload) => {
        const agent = {
          id: 'sandbox-agent-' + uuid(),
          name: payload?.name ? String(payload.name) : 'Sandbox Agent',
          description: payload?.description ? String(payload.description) : '',
          modelId: payload?.modelId ? String(payload.modelId) : '',
        };
        agents.unshift(agent);
        return { ok: true, agent: clone(agent) };
      },
      update: async (id, patch) => {
        const agentId = String(id || '').trim();
        if (!agentId) throw new Error('id is required');
        const idx = agents.findIndex((a) => a.id === agentId);
        if (idx < 0) throw new Error('agent not found');
        const a = agents[idx];
        if (patch?.name) a.name = String(patch.name);
        if (patch?.description) a.description = String(patch.description);
        if (patch?.modelId) a.modelId = String(patch.modelId);
        return { ok: true, agent: clone(a) };
      },
      delete: async (id) => {
        const agentId = String(id || '').trim();
        if (!agentId) throw new Error('id is required');
        const idx = agents.findIndex((a) => a.id === agentId);
        if (idx < 0) return { ok: true, deleted: false };
        agents.splice(idx, 1);
        return { ok: true, deleted: true };
      },
      createForApp: async (payload) => {
        const name = payload?.name ? String(payload.name) : 'App Agent (' + __SANDBOX__.appId + ')';
        return await agentsApi.create({ ...payload, name });
      },
    };

    const sessionsApi = {
      list: async () => ({ ok: true, sessions: clone(Array.from(sessions.values())) }),
      ensureDefault: async (payload) => {
        const session = await ensureSession(payload?.agentId);
        return { ok: true, session: clone(session) };
      },
      create: async (payload) => {
        const agentId = payload?.agentId ? String(payload.agentId) : (await ensureAgent()).id;
        const id = 'sandbox-session-' + uuid();
        const session = { id, agentId, createdAt: new Date().toISOString() };
        sessions.set(id, session);
        if (!messagesBySession.has(id)) messagesBySession.set(id, []);
        return { ok: true, session: clone(session) };
      },
    };

    const messagesApi = {
      list: async (payload) => {
        const sessionId = String(payload?.sessionId || '').trim();
        if (!sessionId) throw new Error('sessionId is required');
        const msgs = messagesBySession.get(sessionId) || [];
        return { ok: true, messages: clone(msgs) };
      },
    };

    const abort = async (payload) => {
      const sessionId = String(payload?.sessionId || '').trim();
      if (!sessionId) throw new Error('sessionId is required');
      const run = activeRuns.get(sessionId);
      if (run) {
        run.aborted = true;
        if (run.controller) {
          try {
            run.controller.abort();
          } catch {
            // ignore
          }
        }
        for (const t of run.timers) {
          try {
            clearTimeout(t);
          } catch {
            // ignore
          }
        }
        activeRuns.delete(sessionId);
      }
      emit({ type: 'assistant_abort', sessionId, ts: new Date().toISOString() });
      return { ok: true };
    };

    const send = async (payload) => {
      const sessionId = String(payload?.sessionId || '').trim();
      const text = String(payload?.text || '').trim();
      if (!sessionId) throw new Error('sessionId is required');
      if (!text) throw new Error('text is required');

      if (!sessions.has(sessionId)) throw new Error('session not found');

      const msgs = messagesBySession.get(sessionId) || [];
      const userMsg = { id: 'msg-' + uuid(), role: 'user', text, ts: new Date().toISOString() };
      msgs.push(userMsg);
      messagesBySession.set(sessionId, msgs);
      emit({ type: 'user_message', sessionId, message: clone(userMsg) });

      const assistantMsg = { id: 'msg-' + uuid(), role: 'assistant', text: '', ts: new Date().toISOString() };
      msgs.push(assistantMsg);
      emit({ type: 'assistant_start', sessionId, message: clone(assistantMsg) });

      const run = { aborted: false, timers: [], controller: new AbortController() };
      activeRuns.set(sessionId, run);

      let result = null;
      try {
        const session = sessions.get(sessionId);
        const agent = session ? agents.find((a) => a.id === session.agentId) : null;
        const agentModelId = agent?.modelId ? String(agent.modelId) : '';
        const chatPayload = {
          messages: buildChatMessages(msgs),
          modelId: typeof payload?.modelId === 'string' && payload.modelId.trim() ? payload.modelId : agentModelId,
          modelName: typeof payload?.modelName === 'string' ? payload.modelName : '',
          systemPrompt: typeof payload?.systemPrompt === 'string' ? payload.systemPrompt : '',
          disableTools: payload?.disableTools === true,
        };
        result = await callSandboxChat(chatPayload, run.controller.signal);
      } catch (err) {
        activeRuns.delete(sessionId);
        if (run.aborted) {
          emit({ type: 'assistant_abort', sessionId, ts: new Date().toISOString() });
          return { ok: true, aborted: true };
        }
        const errText = '[sandbox error] ' + (err?.message || String(err));
        assistantMsg.text = errText;
        emit({ type: 'assistant_delta', sessionId, delta: errText });
        emit({ type: 'assistant_end', sessionId, message: clone(assistantMsg), error: errText });
        return { ok: false, error: errText };
      }

      if (run.aborted) {
        activeRuns.delete(sessionId);
        emit({ type: 'assistant_abort', sessionId, ts: new Date().toISOString() });
        return { ok: true, aborted: true };
      }

      const toolTrace = Array.isArray(result?.toolTrace) ? result.toolTrace : [];
      for (const trace of toolTrace) {
        if (!trace) continue;
        if (trace.tool) {
          emit({ type: 'tool_call', sessionId, tool: trace.tool, args: trace.args || null });
        }
        if (trace.result !== undefined) {
          emit({ type: 'tool_result', sessionId, tool: trace.tool, result: trace.result });
        }
      }

      const out = typeof result?.content === 'string' ? result.content : '';
      if (!out) {
        activeRuns.delete(sessionId);
        emit({ type: 'assistant_end', sessionId, message: clone(assistantMsg) });
        return { ok: true };
      }

      const chunks = [];
      for (let i = 0; i < out.length; i += 16) chunks.push(out.slice(i, i + 16));

      chunks.forEach((delta, idx) => {
        const t = setTimeout(() => {
          if (run.aborted) return;
          assistantMsg.text += delta;
          emit({ type: 'assistant_delta', sessionId, delta });
          if (idx === chunks.length - 1) {
            activeRuns.delete(sessionId);
            emit({ type: 'assistant_end', sessionId, message: clone(assistantMsg) });
          }
        }, 50 + idx * 40);
        run.timers.push(t);
      });

      return { ok: true };
    };

    const events = {
      subscribe: (filter, fn) => {
        if (typeof fn !== 'function') throw new Error('listener is required');
        const sub = { filter: filter && typeof filter === 'object' ? { ...filter } : {}, fn };
        listeners.add(sub);
        return () => listeners.delete(sub);
      },
      unsubscribe: () => (listeners.clear(), { ok: true }),
    };

    return {
      agents: agentsApi,
      sessions: sessionsApi,
      messages: messagesApi,
      send,
      abort,
      events,
    };
  })(),
};

inspectorEnabled = true;
updateInspector();

let dispose = null;

async function loadAndMount() {
  if (typeof dispose === 'function') { try { await dispose(); } catch {} dispose = null; }
  container.textContent = '';

  const entryUrl = __SANDBOX__.entryUrl;
  const mod = await import(entryUrl + (entryUrl.includes('?') ? '&' : '?') + 't=' + Date.now());
  const mount = mod?.mount || mod?.default?.mount || (typeof mod?.default === 'function' ? mod.default : null);
  if (typeof mount !== 'function') throw new Error('module entry must export mount()');
  const ret = await mount({ container, host, slots: { header: headerSlot } });
  if (typeof ret === 'function') dispose = ret;
  else if (ret && typeof ret.dispose === 'function') dispose = () => ret.dispose();
}

const renderError = (e) => {
  const pre = document.createElement('pre');
  pre.style.padding = '12px';
  pre.style.whiteSpace = 'pre-wrap';
  pre.textContent = '[sandbox] ' + (e?.stack || e?.message || String(e));
  container.appendChild(pre);
};

const scheduleReload = (() => {
  let t = null;
  return () => {
    if (t) return;
    t = setTimeout(() => {
      t = null;
      loadAndMount().catch(renderError);
    }, 80);
  };
})();

try {
  const es = new EventSource('/events');
  es.addEventListener('reload', () => scheduleReload());
} catch {
  // ignore
}

$('#btnReload').addEventListener('click', () => loadAndMount().catch(renderError));

loadAndMount().catch(renderError);
`;
}

async function loadBackendFactory({ pluginDir, manifest }) {
  const entryRel = manifest?.backend?.entry ? String(manifest.backend.entry).trim() : '';
  if (!entryRel) return null;
  const abs = resolveInsideDir(pluginDir, entryRel);
  const fileUrl = url.pathToFileURL(abs).toString();
  const mod = await import(fileUrl + `?t=${Date.now()}`);
  if (typeof mod?.createUiAppsBackend !== 'function') {
    throw new Error('backend entry must export createUiAppsBackend(ctx)');
  }
  return mod.createUiAppsBackend;
}

export async function startSandboxServer({ pluginDir, port = 4399, appId = '' }) {
  const { manifest } = loadPluginManifest(pluginDir);
  const app = pickAppFromManifest(manifest, appId);
  const effectiveAppId = String(app?.id || '');
  const entryRel = String(app?.entry?.path || '').trim();
  if (!entryRel) throw new Error('apps[i].entry.path is required');

  const entryAbs = resolveInsideDir(pluginDir, entryRel);
  if (!isFile(entryAbs)) throw new Error(`module entry not found: ${entryRel}`);

  const entryUrl = `/plugin/${encodeURIComponent(entryRel).replaceAll('%2F', '/')}`;

  let backendInstance = null;
  let backendFactory = null;

  const { primary: sandboxRoot, legacy: legacySandboxRoot } = resolveSandboxRoots();
  const sandboxConfigPath = resolveSandboxConfigPath({ primaryRoot: sandboxRoot, legacyRoot: legacySandboxRoot });
  let sandboxLlmConfig = loadSandboxLlmConfig(sandboxConfigPath);
  const getAppMcpPrompt = () => resolveAppMcpPrompt(app, pluginDir);
  const appMcpEntry = buildAppMcpEntry({ pluginDir, pluginId: String(manifest?.id || ''), app });

  let mcpRuntime = null;
  let mcpRuntimePromise = null;
  let sandboxCallMeta = null;

  const resetMcpRuntime = async () => {
    const runtime = mcpRuntime;
    mcpRuntime = null;
    mcpRuntimePromise = null;
    if (runtime?.transport && typeof runtime.transport.close === 'function') {
      try {
        await runtime.transport.close();
      } catch {
        // ignore
      }
    }
    if (runtime?.client && typeof runtime.client.close === 'function') {
      try {
        await runtime.client.close();
      } catch {
        // ignore
      }
    }
  };

  const ensureMcpRuntime = async () => {
    if (!appMcpEntry) return null;
    if (mcpRuntime) return mcpRuntime;
    if (!mcpRuntimePromise) {
      mcpRuntimePromise = (async () => {
        const handle = await connectMcpServer(appMcpEntry);
        if (!handle) return null;
        const toolEntries = Array.isArray(handle.tools)
          ? handle.tools.map((tool) => {
              const identifier = buildMcpToolIdentifier(handle.serverName, tool?.name);
              return {
                identifier,
                serverName: handle.serverName,
                toolName: tool?.name,
                client: handle.client,
                definition: {
                  type: 'function',
                  function: {
                    name: identifier,
                    description: buildMcpToolDescription(handle.serverName, tool),
                    parameters:
                      tool?.inputSchema && typeof tool.inputSchema === 'object'
                        ? tool.inputSchema
                        : { type: 'object', properties: {} },
                  },
                },
              };
            })
          : [];
        const toolMap = new Map(toolEntries.map((entry) => [entry.identifier, entry]));
        return { ...handle, toolEntries, toolMap };
      })();
    }
    mcpRuntime = await mcpRuntimePromise;
    return mcpRuntime;
  };

  const getSandboxLlmConfig = () => ({ ...sandboxLlmConfig });

  const updateSandboxLlmConfig = (patch) => {
    if (!patch || typeof patch !== 'object') return getSandboxLlmConfig();
    const next = { ...sandboxLlmConfig };
    if (Object.prototype.hasOwnProperty.call(patch, 'apiKey')) {
      next.apiKey = normalizeText(patch.apiKey);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'baseUrl')) {
      next.baseUrl = normalizeText(patch.baseUrl);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'modelId')) {
      next.modelId = normalizeText(patch.modelId);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'workdir')) {
      next.workdir = normalizeText(patch.workdir);
    }
    sandboxLlmConfig = next;
    saveSandboxLlmConfig(sandboxConfigPath, next);
    return { ...next };
  };

  const runSandboxChat = async ({ messages, modelId, modelName, systemPrompt, disableTools, signal } = {}) => {
    const cfg = getSandboxLlmConfig();
    const apiKey = normalizeText(cfg.apiKey || process.env.SANDBOX_LLM_API_KEY);
    const baseUrl = normalizeText(cfg.baseUrl) || DEFAULT_LLM_BASE_URL;
    const effectiveModel = normalizeText(modelId) || normalizeText(modelName) || normalizeText(cfg.modelId);
    if (!apiKey) {
      throw new Error('Sandbox API key not configured. Use "AI Config" in the sandbox toolbar.');
    }
    if (!effectiveModel) {
      throw new Error('Sandbox modelId not configured. Use "AI Config" in the sandbox toolbar.');
    }

    const prompt = normalizeText(systemPrompt) || (!disableTools ? normalizeText(getAppMcpPrompt()) : '');
    const openAiMessages = [];
    if (prompt) openAiMessages.push({ role: 'system', content: prompt });
    const inputMessages = Array.isArray(messages) ? messages : [];
    for (const msg of inputMessages) {
      const role = normalizeText(msg?.role);
      if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;
      const text = typeof msg?.text === 'string' ? msg.text : typeof msg?.content === 'string' ? msg.content : '';
      if (!text || !text.trim()) continue;
      openAiMessages.push({ role, content: String(text) });
    }
    if (openAiMessages.length === 0) throw new Error('No input messages provided.');

    let toolEntries = [];
    let toolMap = new Map();
    if (!disableTools) {
      const runtime = await ensureMcpRuntime();
      if (runtime?.toolEntries?.length) {
        toolEntries = runtime.toolEntries;
        toolMap = runtime.toolMap || new Map();
      }
    }
    const toolDefs = toolEntries.map((entry) => entry.definition);

    const toolTrace = [];
    let iteration = 0;
    const maxToolPasses = 8;
    let workingMessages = openAiMessages.slice();

    while (iteration < maxToolPasses) {
      const response = await callOpenAiChat({
        apiKey,
        baseUrl,
        model: effectiveModel,
        messages: workingMessages,
        tools: toolDefs,
        signal,
      });
      const message = response?.choices?.[0]?.message;
      if (!message) throw new Error('Empty model response.');
      const content = typeof message.content === 'string' ? message.content : '';
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (toolCalls.length > 0 && toolMap.size > 0 && !disableTools) {
        workingMessages.push({ role: 'assistant', content, tool_calls: toolCalls });
        for (const call of toolCalls) {
          const toolName = typeof call?.function?.name === 'string' ? call.function.name : '';
          const toolEntry = toolName ? toolMap.get(toolName) : null;
          let args = {};
          let resultText = '';
          if (!toolEntry) {
            resultText = `[error] Tool not registered: ${toolName || 'unknown'}`;
          } else {
            const rawArgs = typeof call?.function?.arguments === 'string' ? call.function.arguments : '{}';
            try {
              args = JSON.parse(rawArgs || '{}');
            } catch (err) {
              resultText = '[error] Failed to parse tool arguments: ' + (err?.message || String(err));
              args = {};
            }
            if (!resultText) {
              const toolResult = await toolEntry.client.callTool({
                name: toolEntry.toolName,
                arguments: args,
                ...(sandboxCallMeta ? { _meta: sandboxCallMeta } : {}),
              });
              resultText = formatMcpToolResult(toolEntry.serverName, toolEntry.toolName, toolResult);
            }
          }
          toolTrace.push({ tool: toolName || 'unknown', args, result: resultText });
          workingMessages.push({ role: 'tool', tool_call_id: String(call?.id || ''), content: resultText });
        }
        iteration += 1;
        continue;
      }
      return { content, model: effectiveModel, toolTrace };
    }

    throw new Error('Too many tool calls. Aborting.');
  };

  const ctxBase = {
    pluginId: String(manifest?.id || ''),
    pluginDir,
    stateDir: path.join(sandboxRoot, 'state', 'chatos'),
    sessionRoot: process.cwd(),
    projectRoot: process.cwd(),
    dataDir: '',
    llm: {
      complete: async (payload) => {
        const input = typeof payload?.input === 'string' ? payload.input : '';
        const normalized = String(input || '').trim();
        if (!normalized) throw new Error('input is required');
        const result = await runSandboxChat({
          messages: [{ role: 'user', text: normalized }],
          modelId: typeof payload?.modelId === 'string' ? payload.modelId : '',
          modelName: typeof payload?.modelName === 'string' ? payload.modelName : '',
          systemPrompt: typeof payload?.systemPrompt === 'string' ? payload.systemPrompt : '',
          disableTools: payload?.disableTools === true,
        });
        return {
          ok: true,
          model: result.model,
          content: result.content,
          toolTrace: result.toolTrace,
        };
      },
    },
  };
  ctxBase.dataDir = path.join(sandboxRoot, 'data', ctxBase.pluginId);
  ensureDir(ctxBase.stateDir);
  ensureDir(ctxBase.dataDir);
  sandboxCallMeta = buildSandboxCallMeta({
    rawCallMeta: app?.ai?.mcp?.callMeta,
    rawWorkdir: getSandboxLlmConfig().workdir,
    context: {
      pluginId: ctxBase.pluginId,
      appId: effectiveAppId,
      pluginDir: ctxBase.pluginDir,
      dataDir: ctxBase.dataDir,
      stateDir: ctxBase.stateDir,
      sessionRoot: ctxBase.sessionRoot,
      projectRoot: ctxBase.projectRoot,
    },
  });

  const sseClients = new Set();
  const sseWrite = (res, event, data) => {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data ?? null)}\n\n`);
    } catch {
      // ignore
    }
  };
  const sseBroadcast = (event, data) => {
    for (const res of sseClients) {
      sseWrite(res, event, data);
    }
  };

  let changeSeq = 0;
  const stopWatch = startRecursiveWatcher(pluginDir, ({ eventType, filePath }) => {
    const rel = filePath ? path.relative(pluginDir, filePath).replaceAll('\\', '/') : '';
    const base = rel ? path.basename(rel) : '';
    if (!rel) return;
    if (base === '.DS_Store') return;
    if (base.endsWith('.map')) return;

    changeSeq += 1;
    if (rel.startsWith('backend/')) {
      backendInstance = null;
      backendFactory = null;
    }
    resetMcpRuntime().catch(() => {});
    sseBroadcast('reload', { seq: changeSeq, eventType: eventType || '', path: rel });
  });

  const server = http.createServer(async (req, res) => {
    try {
      const parsed = url.parse(req.url || '/', true);
      const pathname = parsed.pathname || '/';

      if (req.method === 'GET' && pathname === '/') {
        return sendText(res, 200, htmlPage(), 'text/html; charset=utf-8');
      }

      if (req.method === 'GET' && pathname === '/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        res.write(': connected\n\n');
        sseClients.add(res);
        const ping = setInterval(() => {
          try {
            res.write(': ping\n\n');
          } catch {
            // ignore
          }
        }, 15000);
        req.on('close', () => {
          try {
            clearInterval(ping);
          } catch {
            // ignore
          }
          sseClients.delete(res);
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/sandbox.mjs') {
        const tokenNames = loadTokenNames();
        const sandboxContext = {
          pluginId: ctxBase.pluginId,
          appId: effectiveAppId,
          pluginDir: ctxBase.pluginDir,
          dataDir: ctxBase.dataDir,
          stateDir: ctxBase.stateDir,
          sessionRoot: ctxBase.sessionRoot,
          projectRoot: ctxBase.projectRoot,
          workdir: sandboxCallMeta?.workdir || ctxBase.dataDir || '',
        };
        const js = sandboxClientJs()
          .replaceAll('__SANDBOX__.context', JSON.stringify(sandboxContext))
          .replaceAll('__SANDBOX__.pluginId', JSON.stringify(ctxBase.pluginId))
          .replaceAll('__SANDBOX__.appId', JSON.stringify(effectiveAppId))
          .replaceAll('__SANDBOX__.entryUrl', JSON.stringify(entryUrl))
          .replaceAll('__SANDBOX__.registryApp', JSON.stringify({ plugin: { id: ctxBase.pluginId }, id: effectiveAppId, entry: { type: 'module', url: entryUrl } }))
          .replaceAll('__SANDBOX__.tokenNames', JSON.stringify(tokenNames));
        return sendText(res, 200, js, 'text/javascript; charset=utf-8');
      }

      if (req.method === 'GET' && pathname.startsWith('/plugin/')) {
        const rel = decodeURIComponent(pathname.slice('/plugin/'.length));
        const abs = resolveInsideDir(pluginDir, rel);
        if (!serveStaticFile(res, abs)) return sendText(res, 404, 'Not found');
        return;
      }

      if (req.method === 'GET' && pathname === '/api/manifest') {
        return sendJson(res, 200, { ok: true, manifest });
      }

      if (pathname === '/api/sandbox/llm-config') {
        if (req.method === 'GET') {
          const cfg = getSandboxLlmConfig();
          return sendJson(res, 200, {
            ok: true,
            config: {
              baseUrl: cfg.baseUrl || '',
              modelId: cfg.modelId || '',
              workdir: cfg.workdir || '',
              hasApiKey: Boolean(cfg.apiKey),
            },
          });
        }
        if (req.method === 'POST') {
          try {
            const payload = await readJsonBody(req);
            const patch = payload?.config && typeof payload.config === 'object' ? payload.config : payload;
            const next = updateSandboxLlmConfig({
              ...(Object.prototype.hasOwnProperty.call(patch || {}, 'apiKey') ? { apiKey: patch.apiKey } : {}),
              ...(Object.prototype.hasOwnProperty.call(patch || {}, 'baseUrl') ? { baseUrl: patch.baseUrl } : {}),
              ...(Object.prototype.hasOwnProperty.call(patch || {}, 'modelId') ? { modelId: patch.modelId } : {}),
              ...(Object.prototype.hasOwnProperty.call(patch || {}, 'workdir') ? { workdir: patch.workdir } : {}),
            });
            return sendJson(res, 200, {
              ok: true,
              config: {
                baseUrl: next.baseUrl || '',
                modelId: next.modelId || '',
                workdir: next.workdir || '',
                hasApiKey: Boolean(next.apiKey),
              },
            });
          } catch (err) {
            return sendJson(res, 200, { ok: false, message: err?.message || String(err) });
          }
        }
        return sendJson(res, 405, { ok: false, message: 'Method not allowed' });
      }

      if (pathname === '/api/llm/chat') {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, message: 'Method not allowed' });
        try {
          const payload = await readJsonBody(req);
          const messages = Array.isArray(payload?.messages) ? payload.messages : [];
          const result = await runSandboxChat({
            messages,
            modelId: typeof payload?.modelId === 'string' ? payload.modelId : '',
            modelName: typeof payload?.modelName === 'string' ? payload.modelName : '',
            systemPrompt: typeof payload?.systemPrompt === 'string' ? payload.systemPrompt : '',
            disableTools: payload?.disableTools === true,
          });
          return sendJson(res, 200, {
            ok: true,
            model: result.model,
            content: result.content,
            toolTrace: result.toolTrace || [],
          });
        } catch (err) {
          return sendJson(res, 200, { ok: false, message: err?.message || String(err) });
        }
      }

      if (pathname === '/api/backend/invoke') {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, message: 'Method not allowed' });
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', async () => {
          try {
            const payload = body ? JSON.parse(body) : {};
            const method = typeof payload?.method === 'string' ? payload.method.trim() : '';
            if (!method) return sendJson(res, 400, { ok: false, message: 'method is required' });
            const params = payload?.params;

            if (!backendFactory) backendFactory = await loadBackendFactory({ pluginDir, manifest });
            if (!backendFactory) return sendJson(res, 200, { ok: false, message: 'backend not configured in plugin.json' });

            if (!backendInstance || typeof backendInstance !== 'object' || !backendInstance.methods) {
              backendInstance = await backendFactory({ ...ctxBase });
            }
            const fn = backendInstance?.methods?.[method];
            if (typeof fn !== 'function') return sendJson(res, 404, { ok: false, message: `method not found: ${method}` });
            const result = await fn(params, { ...ctxBase });
            return sendJson(res, 200, { ok: true, result });
          } catch (e) {
            return sendJson(res, 200, { ok: false, message: e?.message || String(e) });
          }
        });
        return;
      }

      sendText(res, 404, 'Not found');
    } catch (e) {
      sendJson(res, 500, { ok: false, message: e?.message || String(e) });
    }
  });
  server.once('close', () => {
    stopWatch();
    resetMcpRuntime().catch(() => {});
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  // eslint-disable-next-line no-console
  console.log(`Sandbox running:
  http://localhost:${port}/
pluginDir:
  ${pluginDir}
app:
  ${ctxBase.pluginId}:${effectiveAppId}
`);
}
