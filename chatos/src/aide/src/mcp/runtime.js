import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import * as colors from '../colors.js';
import { createLogger } from '../logger.js';
import { loadMcpConfig } from '../mcp.js';
import { registerTool } from '../tools/index.js';
import { performance } from 'perf_hooks';
import { adjustCommandArgs, parseMcpEndpoint } from './runtime/endpoints.js';
import { mapAllSettledWithConcurrency, resolveConcurrency } from './runtime/concurrency.js';
import { allowExternalOnlyMcpServers, isExternalOnlyMcpServerName } from '../../shared/host-app.js';
import { ensureAppDbPath, resolveAppStateDir } from '../../shared/state-paths.js';
import { createRuntimeLogger } from '../../shared/runtime-log.js';
import {
  getDefaultToolMaxTimeoutMs,
  getDefaultToolTimeoutMs,
  maybeForceUiPrompterTimeout as forceUiPrompterTimeout,
  parseTimeoutMs,
  shouldDisableToolTimeout,
  withNoTimeoutOptions,
} from './runtime/timeouts.js';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';

const log = createLogger('MCP');
const require = createRequire(import.meta.url);

const uiAppNodeModulesReady = new Set();
let cachedHostNodeModulesDir = null;

function resolveHostNodeModulesDir() {
  if (cachedHostNodeModulesDir !== null) {
    return cachedHostNodeModulesDir;
  }
  try {
    const pkgJsonPath = require.resolve('@modelcontextprotocol/sdk/package.json');
    const pkgDir = path.dirname(pkgJsonPath);
    const nodeModulesDir = path.dirname(path.dirname(pkgDir));
    cachedHostNodeModulesDir = nodeModulesDir;
    return nodeModulesDir;
  } catch {
    cachedHostNodeModulesDir = '';
    return '';
  }
}

function isPathWithin(root, target) {
  if (!root || !target) return false;
  const relative = path.relative(root, target);
  if (!relative) return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function normalizeCommandPath(token, baseDir) {
  const raw = typeof token === 'string' ? token.trim() : '';
  if (!raw) return '';
  const unquoted = raw.replace(/^['"]|['"]$/g, '');
  if (!unquoted) return '';
  if (path.isAbsolute(unquoted) || /^[a-zA-Z]:[\\/]/.test(unquoted)) {
    return path.resolve(unquoted);
  }
  const base = typeof baseDir === 'string' && baseDir.trim() ? baseDir.trim() : process.cwd();
  return path.resolve(base, unquoted);
}

function isUiAppMcpServer(entry, options = {}) {
  const tags = Array.isArray(entry?.tags) ? entry.tags : [];
  const tagged = tags
    .map((tag) => String(tag || '').trim().toLowerCase())
    .filter(Boolean)
    .some((tag) => tag === 'uiapp' || tag.startsWith('uiapp:'));
  if (tagged) return true;

  const endpoint = options?.endpoint;
  if (!endpoint || endpoint.type !== 'command') return false;
  const sessionRoot = typeof options?.sessionRoot === 'string' ? options.sessionRoot.trim() : '';
  const stateDir = resolveAppStateDir(sessionRoot || process.cwd());
  if (!stateDir) return false;
  const uiAppsRoot = path.join(stateDir, 'ui_apps', 'plugins');
  const args = Array.isArray(endpoint.args) ? endpoint.args : [];
  for (const arg of args) {
    const candidate = normalizeCommandPath(arg, options?.baseDir);
    if (candidate && isPathWithin(uiAppsRoot, candidate)) {
      return true;
    }
  }
  return false;
}

function ensureUiAppNodeModules(sessionRoot, runtimeLogger) {
  const root = typeof sessionRoot === 'string' && sessionRoot.trim() ? sessionRoot.trim() : process.cwd();
  const stateDir = resolveAppStateDir(root);
  if (!stateDir || uiAppNodeModulesReady.has(stateDir)) return;
  uiAppNodeModulesReady.add(stateDir);

  const hostNodeModules = resolveHostNodeModulesDir();
  if (!hostNodeModules) return;

  const target = path.join(stateDir, 'node_modules');
  try {
    if (fs.existsSync(target)) return;
  } catch {
    return;
  }

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  } catch {
    // ignore
  }
  try {
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(hostNodeModules, target, linkType);
  } catch (err) {
    log.warn('UI Apps MCP node_modules 连接失败', err);
    runtimeLogger?.warn('UI Apps MCP node_modules 连接失败', { target, source: hostNodeModules }, err);
  }
}

async function initializeMcpRuntime(
  configPath,
  sessionRoot = process.cwd(),
  workspaceRoot = process.cwd(),
  options = {}
) {
  const runtimeLogger =
    options?.runtimeLogger ||
    createRuntimeLogger({
      sessionRoot,
      scope: 'MCP',
    });
  const eventLogger = options?.eventLogger || null;
  let servers;
  try {
    ({ servers } = loadMcpConfig(configPath));
  } catch (err) {
    log.error('读取 mcp.config.json 失败', err);
    runtimeLogger?.error('读取 mcp.config.json 失败', { configPath }, err);
    eventLogger?.log?.('mcp_error', {
      stage: 'load_config',
      path: configPath || '',
      message: err?.message || String(err),
    });
    return null;
  }
  const extraServers = Array.isArray(options?.extraServers) ? options.extraServers : [];
  const mergedServers = (() => {
    const seen = new Set();
    const out = [];
    [...(Array.isArray(servers) ? servers : []), ...extraServers].forEach((entry) => {
      const key = String(entry?.name || '').trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(entry);
    });
    return out;
  })();
  if (mergedServers.length === 0) return null;
  const allowExternalOnly = allowExternalOnlyMcpServers();
  const enabledServers = mergedServers.filter(
    (entry) => entry && entry.enabled !== false && (allowExternalOnly || !isExternalOnlyMcpServerName(entry.name))
  );
  const skip = new Set(
    Array.isArray(options.skipServers) ? options.skipServers.map((s) => String(s || '').toLowerCase()) : []
  );
  const filteredServers =
    skip.size > 0
      ? enabledServers.filter((entry) => !skip.has(String(entry?.name || '').toLowerCase()))
      : enabledServers;
  const baseDir = configPath ? path.dirname(configPath) : process.cwd();
  const connectTargets = filteredServers.filter((entry) => entry && entry.url);
  const startupConcurrency = resolveConcurrency(
    options?.mcpStartupConcurrency ?? process.env.MODEL_CLI_MCP_STARTUP_CONCURRENCY,
    4
  );
  const runtimeOptions = { ...options, runtimeLogger, eventLogger };
  const settled = await mapAllSettledWithConcurrency(connectTargets, startupConcurrency, (entry) =>
    connectMcpServer(entry, baseDir, sessionRoot, workspaceRoot, runtimeOptions)
  );
  const handles = [];
  settled.forEach((result, idx) => {
    const entry = connectTargets[idx];
    if (!result) return;
    if (result.status === 'fulfilled') {
      if (result.value) handles.push(result.value);
      return;
    }
    log.warn(`无法连接到 ${entry?.name || '<unnamed>'}`, result.reason);
    runtimeLogger?.warn('无法连接到 MCP 服务器', { server: entry?.name || '<unnamed>' }, result.reason);
    eventLogger?.log?.('mcp_error', {
      stage: 'connect',
      server: entry?.name || '<unnamed>',
      message: result.reason?.message || String(result.reason || ''),
    });
  });
  if (handles.length === 0) {
    runtimeLogger?.warn('MCP 启动失败：未连接到任何服务器', {
      servers: connectTargets.map((entry) => entry?.name || '<unnamed>'),
    });
    eventLogger?.log?.('mcp_warning', {
      stage: 'startup',
      message: 'No MCP servers connected',
      servers: connectTargets.map((entry) => entry?.name || '<unnamed>'),
    });
    return null;
  }
  const toolNames = handles.flatMap((handle) =>
    handle.registeredTools.map((tool) => tool.identifier)
  );
  return {
    toolNames,
    applyToConfig: (appConfig) => {
      if (!appConfig || !appConfig.models || toolNames.length === 0) {
        return;
      }
      Object.values(appConfig.models).forEach((settings) => {
        if (!settings) return;
        const current = Array.isArray(settings.tools) ? settings.tools.slice() : [];
        let changed = false;
        for (const toolName of toolNames) {
          if (!current.includes(toolName)) {
            current.push(toolName);
            changed = true;
          }
        }
        if (changed) {
          settings.tools = current;
        }
      });
    },
    async shutdown() {
      await Promise.all(
        handles.map(async (handle) => {
          try {
            await handle.transport.close();
          } catch {
            // ignore
          }
        })
      );
    },
  };
}

async function connectMcpServer(entry, baseDir, sessionRoot, workspaceRoot, runtimeOptions = {}) {
  const runtimeLogger = runtimeOptions?.runtimeLogger;
  const eventLogger = runtimeOptions?.eventLogger || null;
  const endpoint = parseMcpEndpoint(entry.url);
  if (!endpoint) {
    throw new Error('MCP 端点为空或无法解析。');
  }

  if (endpoint.type === 'command') {
    if (isUiAppMcpServer(entry, { endpoint, baseDir, sessionRoot })) {
      ensureUiAppNodeModules(sessionRoot, runtimeLogger);
    }
    const client = new Client({
      name: 'model-cli',
      version: '0.1.0',
    });
    // Inherit parent env so API keys are available to MCP servers (e.g., subagent_router using ModelClient)
    const env = { ...process.env };
    if (sessionRoot) {
      env.MODEL_CLI_SESSION_ROOT = sessionRoot;
    }
    if (workspaceRoot) {
      env.MODEL_CLI_WORKSPACE_ROOT = workspaceRoot;
    }
    // Ensure task-server writes to the app-scoped DB under session root,
    // regardless of where the CLI is launched.
    if (!env.MODEL_CLI_TASK_DB) {
      const stateRoot = env.MODEL_CLI_SESSION_ROOT || sessionRoot || process.cwd();
      env.MODEL_CLI_TASK_DB = ensureAppDbPath(stateRoot);
    }
    if (runtimeOptions?.caller && typeof runtimeOptions.caller === 'string' && runtimeOptions.caller.trim()) {
      env.MODEL_CLI_CALLER = runtimeOptions.caller.trim();
    }
    if (entry.api_key_env) {
      const key = entry.api_key_env.trim();
      if (key && process.env[key]) {
        env[key] = process.env[key];
      }
    }
    const adjustedArgs = adjustCommandArgs(endpoint.args, workspaceRoot);
    const resolved = resolveMcpCommandLine(endpoint.command, adjustedArgs, env);
    const transport = new StdioClientTransport({
      command: resolved.command,
      args: resolved.args,
      cwd: baseDir,
      env,
      stderr: 'pipe',
    });
    const stderrLines = [];
    const maxStderrLines = 30;
    const maxStderrChars = 8000;
    let stderrChars = 0;
    let stderrBuffer = '';
    const pushStderrLine = (line) => {
      if (!line) return;
      if (stderrLines.length >= maxStderrLines) {
        stderrLines.shift();
      }
      const remaining = Math.max(0, maxStderrChars - stderrChars);
      const clipped = remaining > 0 ? String(line).slice(0, remaining) : '';
      if (!clipped) return;
      stderrLines.push(clipped);
      stderrChars += clipped.length;
    };
    const stderrStream = transport.stderr;
    if (stderrStream && typeof stderrStream.on === 'function') {
      stderrStream.on('data', (chunk) => {
        const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
        stderrBuffer += text;
        while (true) {
          const idx = stderrBuffer.indexOf('\n');
          if (idx < 0) break;
          const line = stderrBuffer.slice(0, idx).trimEnd();
          stderrBuffer = stderrBuffer.slice(idx + 1);
          pushStderrLine(line.trim());
        }
        if (stderrBuffer.length > 2048) {
          // avoid unbounded buffer growth on noisy servers with no newlines
          pushStderrLine(stderrBuffer.slice(0, 2048).trim());
          stderrBuffer = '';
        }
      });
    }
    try {
      return await connectAndRegisterTools({
        entry,
        client,
        transport,
        sessionRoot,
        pidName: endpoint.command,
        workspaceRoot,
        runtimeLogger,
        eventLogger,
      });
    } catch (err) {
      const normalizedCommand = String(resolved.command || endpoint.command || '')
        .trim()
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        .toLowerCase();
      const code = err?.code;
      const message = String(err?.message || err || '');
      const isNotFound =
        code === 'ENOENT' ||
        (message.includes('ENOENT') && message.toLowerCase().includes('spawn'));
      if (isNotFound) {
        if (normalizedCommand === 'npx' || normalizedCommand === 'npm') {
          throw new Error(
            `未找到 ${normalizedCommand}（${message}）。如果这是 npm MCP server，请先安装 Node.js（包含 npm/npx），并确保桌面 App 的 PATH 能找到它（Homebrew/Volta/asdf/nvm 等）。`
          );
        }
        throw new Error(`无法启动 MCP 命令：${resolved.command}（${message}）。请确认命令已安装且在 PATH 中。`);
      }
      const stderrTail = stderrLines.join('\n').trim();
      if (stderrTail) {
        throw new Error(`${message}\n\n[MCP stderr]\n${stderrTail}`);
      }
      throw err;
    }
  }

  if (endpoint.type === 'http') {
    const host = String(endpoint.url?.hostname || '').toLowerCase();
    const href = String(endpoint.url?.href || '');
    if (host === 'github.com' || host === 'raw.githubusercontent.com') {
      throw new Error(
        `看起来你配置的是 GitHub 链接（${href}），这通常不是 MCP 端点。若是 npm 包 MCP server，请用：cmd://npx -y <pkg>@latest（或直接填 npx 命令）。`
      );
    }
    const errors = [];
    try {
      const client = new Client({ name: 'model-cli', version: '0.1.0' });
      const transport = new StreamableHTTPClientTransport(endpoint.url);
      return await connectAndRegisterTools({
        entry,
        client,
        transport,
        sessionRoot,
        workspaceRoot,
        runtimeLogger,
        eventLogger,
      });
    } catch (err) {
      errors.push(`streamable_http: ${err?.message || err}`);
    }
    try {
      const client = new Client({ name: 'model-cli', version: '0.1.0' });
      const transport = new SSEClientTransport(endpoint.url);
      return await connectAndRegisterTools({
        entry,
        client,
        transport,
        sessionRoot,
        workspaceRoot,
        runtimeLogger,
        eventLogger,
      });
    } catch (err) {
      errors.push(`sse: ${err?.message || err}`);
    }
    throw new Error(`无法连接到 HTTP MCP 端点：${endpoint.url.href}（${errors.join(' | ')}）`);
  }

  if (endpoint.type === 'ws') {
    const client = new Client({ name: 'model-cli', version: '0.1.0' });
    const transport = new WebSocketClientTransport(endpoint.url);
    return connectAndRegisterTools({ entry, client, transport, sessionRoot, workspaceRoot, runtimeLogger, eventLogger });
  }

  throw new Error(
    `不支持的 MCP 端点类型：${endpoint.type}（支持：cmd://、命令行、http(s)://、ws(s)://）`
  );
}

async function connectAndRegisterTools({
  entry,
  client,
  transport,
  sessionRoot,
  pidName,
  workspaceRoot,
  runtimeLogger,
  eventLogger,
} = {}) {
  if (!client || !transport) {
    throw new Error('Missing MCP client or transport');
  }
  if (transport && typeof transport === 'object') {
    transport.onclose = () => {
      log.warn(`连接 ${entry?.name || '<unnamed>'} 已关闭`);
      runtimeLogger?.warn('MCP 连接已关闭', { server: entry?.name || '<unnamed>' });
      eventLogger?.log?.('mcp_disconnect', { server: entry?.name || '<unnamed>' });
    };
  }
  await client.connect(transport);
  appendRunPid({
    runId: typeof process.env.MODEL_CLI_RUN_ID === 'string' ? process.env.MODEL_CLI_RUN_ID.trim() : '',
    sessionRoot,
    pid: transport?.pid,
    kind: 'mcp',
    name: entry?.name || pidName,
  });
  const toolsFromServer = await fetchAllTools(client);
  if (toolsFromServer.length === 0) {
    log.warn(`${entry?.name || '<unnamed>'} 未公开任何工具。`);
    runtimeLogger?.warn('MCP 未公开工具', { server: entry?.name || '<unnamed>' });
    eventLogger?.log?.('mcp_warning', {
      stage: 'no_tools',
      server: entry?.name || '<unnamed>',
      message: 'No tools exposed',
    });
  }
  const runtimeMeta = buildRuntimeCallMeta({ workspaceRoot });
  const registeredTools = toolsFromServer
    .map((tool) => registerRemoteTool(client, entry, tool, runtimeMeta, runtimeLogger, eventLogger))
    .filter(Boolean);
  return { entry, client, transport, registeredTools };
}

function resolveMcpCommandLine(command, args, env) {
  const resolvedArgs = Array.isArray(args) ? args.slice() : [];
  const resolvedCommand = typeof command === 'string' ? command.trim() : '';
  if (!resolvedCommand) {
    return { command, args: resolvedArgs };
  }

  // In Electron packaged apps we want MCP stdio servers to use the bundled Node runtime
  // (ELECTRON_RUN_AS_NODE=1 + process.execPath), even when the user config references
  // system Node in other forms (absolute path, `/usr/bin/env node`, etc.).
  if (!process?.versions?.electron) {
    return { command: resolvedCommand, args: resolvedArgs };
  }

  const normalizeBasename = (value) => {
    const text = String(value || '').trim().replace(/\\/g, '/');
    const base = text.split('/').pop() || '';
    return base.toLowerCase();
  };

  const isNodeBasename = (base) => base === 'node' || base === 'node.exe' || base === 'nodejs' || base === 'nodejs.exe';
  const isEnvBasename = (base) => base === 'env' || base === 'env.exe';

  const ensureElectronAsNode = () => {
    if (env && typeof env === 'object') {
      env.ELECTRON_RUN_AS_NODE = env.ELECTRON_RUN_AS_NODE || '1';
    }
  };

  const base = normalizeBasename(resolvedCommand);

  // Handle: cmd:///usr/bin/env node /path/server.js ...
  if (isEnvBasename(base) && resolvedArgs.length > 0) {
    const firstArgBase = normalizeBasename(resolvedArgs[0]);
    if (isNodeBasename(firstArgBase)) {
      ensureElectronAsNode();
      return { command: process.execPath, args: resolvedArgs.slice(1) };
    }
  }

  if (!isNodeBasename(base)) {
    return { command: resolvedCommand, args: resolvedArgs };
  }

  // If the config references an absolute system Node path and it exists, keep it.
  // Otherwise fall back to Electron's Node runtime to avoid requiring Node to be installed.
  const isAbsoluteLike = (value) => {
    if (!value) return false;
    if (path.isAbsolute(value)) return true;
    return /^[a-zA-Z]:[\\/]/.test(value);
  };
  if (isAbsoluteLike(resolvedCommand)) {
    try {
      if (fs.existsSync(resolvedCommand)) {
        return { command: resolvedCommand, args: resolvedArgs };
      }
    } catch {
      // fall through to Electron runtime
    }
  }

  ensureElectronAsNode();
  return { command: process.execPath, args: resolvedArgs };
}

async function fetchAllTools(client) {
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
  client.cacheToolMetadata(collected);
  return collected;
}

function summarizeArgs(value) {
  if (value === null || value === undefined) {
    return { type: String(value) };
  }
  if (Array.isArray(value)) {
    return { type: 'array', length: value.length };
  }
  const kind = typeof value;
  if (kind !== 'object') {
    return { type: kind };
  }
  const keys = Object.keys(value);
  return {
    type: 'object',
    keyCount: keys.length,
    keys: keys.slice(0, 20),
  };
}

function registerRemoteTool(client, serverEntry, tool, runtimeMeta, runtimeLogger, eventLogger) {
  const serverName = serverEntry?.name || 'server';
  const normalizedServer = String(serverName || '').toLowerCase();
  if (
    normalizedServer === 'subagent_router' &&
    (tool.name === 'get_sub_agent_status' ||
      tool.name === 'start_sub_agent_async' ||
      tool.name === 'cancel_sub_agent_job')
  ) {
    // Only used internally for async orchestration; not exposed to the model/toolset.
    return null;
  }
  const identifier = buildToolIdentifier(serverName, tool.name);
  const description = buildToolDescription(serverName, tool);
  const parameters =
    tool.inputSchema && typeof tool.inputSchema === 'object'
      ? tool.inputSchema
      : { type: 'object', properties: {} };
  const requestOptions = buildRequestOptions(serverEntry);
  const callMeta = buildCallMeta(serverEntry, runtimeMeta);
  if (normalizedServer === 'subagent_router' && tool.name === 'run_sub_agent') {
    registerTool({
      name: identifier,
      description,
      parameters,
      handler: async (args = {}, toolContext = {}) => {
        const signal = toolContext?.signal;
        let jobId = null;
        try {
          throwIfAborted(signal);
          const start = await callSubagentTool(client, requestOptions, 'start_sub_agent_async', args, { signal });
          jobId = start?.job_id;
          if (!jobId) {
            const errMsg = start?.error ? `：${start.error}` : '：未返回 job_id';
            return `[${serverName}/run_sub_agent] ❌ 无法启动子代理${errMsg}`;
          }
          if (start?.status === 'error') {
            return `[${serverName}/run_sub_agent] ❌ job=${jobId} 启动失败：${start?.error || 'unknown error'}`;
          }
          const pollIntervalMs = 30_000;
          const maxTotalMs = requestOptions.maxTotalTimeout || getDefaultToolMaxTimeoutMs();
          let lastProgressMono = performance.now();
          let deadlineMono = lastProgressMono + maxTotalMs;
          let lastUpdatedAt = -Infinity;
          let lastPollWall = Date.now();
          let consecutiveErrors = 0;
          while (performance.now() < deadlineMono) {
            await sleepWithSignal(pollIntervalMs, signal);
            const nowWall = Date.now();
            const wallGapMs = nowWall - lastPollWall;
            lastPollWall = nowWall;
            // If the process was suspended (e.g., system sleep) or heavily delayed,
            // don't let wall-clock jumps trigger premature timeouts.
            if (wallGapMs > pollIntervalMs * 3) {
              lastProgressMono = performance.now();
              deadlineMono = lastProgressMono + maxTotalMs;
            }
            let status;
            try {
              status = await callSubagentTool(client, requestOptions, 'get_sub_agent_status', {
                job_id: jobId,
              }, { signal });
              consecutiveErrors = 0;
            } catch (err) {
              if (err?.name === 'AbortError') {
                throw err;
              }
              throwIfAborted(signal);
              consecutiveErrors += 1;
              if (consecutiveErrors >= 3) {
                throw err;
              }
              continue;
            }
            const state = status?.status;
            const updatedAt = status?.updated_at ? Date.parse(status.updated_at) : NaN;
            if (state === 'running' && Number.isFinite(updatedAt) && updatedAt > lastUpdatedAt) {
              lastUpdatedAt = updatedAt;
              lastProgressMono = performance.now();
              deadlineMono = lastProgressMono + maxTotalMs; // extend deadline when the job is still making progress
            }
            if (state === 'done') {
              const legacyReturn = process.env.MODEL_CLI_SUBAGENT_MCP_RETURN_JSON === '1';
              if (legacyReturn) {
                const resultText = status?.result
                  ? JSON.stringify(status.result, null, 2)
                  : JSON.stringify(status, null, 2);
                return `[${serverName}/run_sub_agent] ✅ 完成 (job=${jobId})\n${resultText}`;
              }
              const finalResponse = extractSubagentJobResponse(status?.result);
              if (finalResponse) {
                return finalResponse;
              }
              return status?.result
                ? JSON.stringify(status.result, null, 2)
                : JSON.stringify(status, null, 2);
            }
            if (state === 'error') {
              return `[${serverName}/run_sub_agent] ❌ job=${jobId} 失败：${status?.error || 'unknown error'}`;
            }
            throwIfAborted(signal);
          }
          return `[${serverName}/run_sub_agent] ❌ 等待超时 (job=${jobId})`;
        } catch (err) {
          if (err?.name === 'AbortError') {
            if (jobId) {
              try {
                const cancelTimeoutMs = 1500;
                const cancelOptions = {
                  ...requestOptions,
                  timeout: cancelTimeoutMs,
                  maxTotalTimeout: cancelTimeoutMs,
                  resetTimeoutOnProgress: false,
                };
                callSubagentTool(client, cancelOptions, 'cancel_sub_agent_job', { job_id: jobId }).catch(() => {});
              } catch {
                // ignore cancellation failures
              }
            }
            throw err;
          }
          return `[${serverName}/run_sub_agent] ❌ 轮询失败：${err?.message || err}`;
        }
      },
    });
    return { identifier, remoteName: tool.name };
  }
  registerTool({
    name: identifier,
    description,
    parameters,
    handler: async (args = {}, toolContext = {}) => {
      const effectiveOptions = shouldDisableToolTimeout(normalizedServer, tool.name)
        ? withNoTimeoutOptions(requestOptions)
        : requestOptions;
      const optionsWithSignal =
        toolContext?.signal && typeof toolContext.signal === 'object'
          ? { ...effectiveOptions, signal: toolContext.signal }
          : effectiveOptions;
      const injectedArgs = maybeInjectCallerArgs({
        server: normalizedServer,
        tool: tool.name,
        args,
        toolContext,
      });
      const normalizedArgs = forceUiPrompterTimeout({
        server: normalizedServer,
        tool: tool.name,
        args: injectedArgs,
      });
      let response;
      try {
        response = await client.callTool(
          {
            name: tool.name,
            arguments: normalizedArgs,
            ...(callMeta ? { _meta: callMeta } : {}),
          },
          undefined,
          optionsWithSignal
        );
      } catch (err) {
        runtimeLogger?.error(
          'MCP 工具调用失败',
          {
            server: serverName,
            tool: tool.name,
            caller: toolContext?.caller || '',
            args: summarizeArgs(normalizedArgs),
          },
          err
        );
        eventLogger?.log?.('mcp_error', {
          stage: 'tool_call',
          server: serverName,
          tool: tool.name,
          caller: toolContext?.caller || '',
          args: summarizeArgs(normalizedArgs),
          message: err?.message || String(err),
        });
        throw err;
      }
      return formatCallResult(serverName, tool.name, response);
    },
  });
  return { identifier, remoteName: tool.name };
}

function maybeInjectCallerArgs({ server, tool, args, toolContext }) {
  if (server !== 'task_manager') return args;
  if (tool !== 'add_task') return args;
  if (!args || typeof args !== 'object') return args;
  const normalizeCaller = (value) => {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!normalized) return '';
    if (normalized === 'main') return 'main';
    if (normalized === 'sub' || normalized === 'subagent' || normalized === 'worker') return 'subagent';
    return '';
  };
  const caller = normalizeCaller(toolContext?.caller);
  if (!caller) return args;
  if (normalizeCaller(args.caller) === caller) return args;
  return { ...args, caller };
}

function buildToolIdentifier(serverName, toolName) {
  const normalize = (value) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_');
  const server = normalize(serverName) || 'mcp_server';
  const tool = normalize(toolName) || 'tool';
  return `mcp_${server}_${tool}`;
}

function buildToolDescription(serverName, tool) {
  const parts = [];
  if (serverName) {
    parts.push(`[${serverName}]`);
  }
  if (tool.annotations?.title) {
    parts.push(tool.annotations.title);
  } else if (tool.description) {
    parts.push(tool.description);
  } else {
    parts.push('MCP 工具');
  }
  return parts.join(' ');
}

function formatCallResult(serverName, toolName, result) {
  if (!result) {
    return `[${serverName}/${toolName}] 工具未返回结果。`;
  }
  const header = `[${serverName}/${toolName}]`;
  if (result.isError) {
    const errorText = extractContentText(result.content) || 'MCP 工具执行失败。';
    return `${header} ❌ ${errorText}`;
  }
  const segments = [];
  const textBlock = extractContentText(result.content);
  if (textBlock) {
    segments.push(textBlock);
  }
  if (result.structuredContent && Object.keys(result.structuredContent).length > 0) {
    segments.push(JSON.stringify(result.structuredContent, null, 2));
  }
  if (segments.length === 0) {
    segments.push('工具执行成功，但没有可展示的文本输出。');
  }
  return `${header}\n${segments.join('\n\n')}`;
}

function buildCallMeta(serverEntry, runtimeMeta) {
  const base = runtimeMeta && typeof runtimeMeta === 'object' ? runtimeMeta : null;
  const raw = serverEntry?.callMeta ?? serverEntry?.call_meta;
  const override = raw && typeof raw === 'object' ? raw : null;
  if (!base && !override) return null;
  if (!base) return { ...override };
  if (!override) return { ...base };
  return { ...base, ...override };
}

function buildRuntimeCallMeta({ workspaceRoot } = {}) {
  const root = typeof workspaceRoot === 'string' ? workspaceRoot.trim() : '';
  if (!root) return null;
  return { workdir: path.resolve(root) };
}

function buildRequestOptions(serverEntry) {
  const defaultTimeout = getDefaultToolTimeoutMs();
  const defaultMaxTimeout = getDefaultToolMaxTimeoutMs();
  const timeout = parseTimeoutMs(serverEntry?.timeout_ms, defaultTimeout);
  const maxTotal = parseTimeoutMs(
    serverEntry?.max_timeout_ms,
    defaultMaxTimeout,
    timeout || defaultTimeout
  );
  const options = {
    timeout,
    resetTimeoutOnProgress: true,
  };
  if (maxTotal && maxTotal >= timeout) {
    options.maxTotalTimeout = maxTotal;
  }
  return options;
}

async function callSubagentTool(client, requestOptions, name, args, options = {}) {
  const effectiveOptions =
    options?.signal && typeof options.signal === 'object'
      ? { ...requestOptions, signal: options.signal }
      : requestOptions;
  const response = await client.callTool(
    { name, arguments: args },
    undefined,
    effectiveOptions
  );
  return parseJsonContent(response);
}

function extractSubagentJobResponse(result) {
  if (!result || typeof result !== 'object') {
    return '';
  }
  if (typeof result.response === 'string') {
    return result.response.trim();
  }
  if (Array.isArray(result.response)) {
    const joined = result.response
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object' && typeof entry.text === 'string') {
          return entry.text;
        }
        return '';
      })
      .join('');
    return joined.trim();
  }
  return '';
}

function sleepWithSignal(ms, signal) {
  if (!Number.isFinite(ms) || ms <= 0) {
    throwIfAborted(signal);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };
    const cleanup = () => {
      clearTimeout(timer);
      if (signal && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onAbort);
      }
    };
    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function createAbortError() {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

function parseJsonContent(result) {
  if (!result) return null;
  const text = extractContentText(result.content);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractContentText(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return '';
  }
  const lines = [];
  blocks.forEach((block) => {
    if (!block || typeof block !== 'object') {
      return;
    }
    switch (block.type) {
      case 'text':
        if (block.text) {
          lines.push(block.text);
        }
        break;
      case 'resource_link':
        lines.push(`资源链接: ${block.uri || block.resourceId || '(未知 URI)'}`);
        break;
      case 'image':
        lines.push(`图像（${block.mimeType || 'image'}，${approxSize(block.data)}）`);
        break;
      case 'audio':
        lines.push(`音频（${block.mimeType || 'audio'}，${approxSize(block.data)}）`);
        break;
      case 'resource':
        lines.push('内嵌资源返回，内容较大，建议用 /mcp 获取详细信息。');
        break;
      default:
        lines.push(`[${block.type}]`);
        break;
    }
  });
  return lines.join('\n');
}

function approxSize(base64Text) {
  if (!base64Text) return '未知大小';
  const bytes = Math.round((base64Text.length * 3) / 4);
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function appendRunPid({ runId, sessionRoot, pid, kind, name } = {}) {
  const rid = typeof runId === 'string' ? runId.trim() : '';
  const root = typeof sessionRoot === 'string' && sessionRoot.trim() ? sessionRoot.trim() : '';
  const num = Number(pid);
  if (!rid || !root || !Number.isFinite(num) || num <= 0) {
    return;
  }
  const dir = path.join(resolveAppStateDir(root), 'terminals');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
  const pidsPath = path.join(dir, `${rid}.pids.jsonl`);
  const payload = {
    ts: new Date().toISOString(),
    runId: rid,
    pid: num,
    kind: typeof kind === 'string' && kind.trim() ? kind.trim() : 'process',
    name: typeof name === 'string' && name.trim() ? name.trim() : undefined,
  };
  try {
    fs.appendFileSync(pidsPath, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch {
    // ignore pid registry failures
  }
}

export { initializeMcpRuntime };
