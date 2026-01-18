#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fork } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { performance } from 'perf_hooks';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolveAppStateDir } from '../shared/state-paths.js';
import {
  filterAgents,
  jsonTextResponse,
  normalizeSkills,
  parseArgs,
  serializeAgent,
  withSubagentGuardrails,
  withTaskTracking,
} from './subagent/utils.js';
import { registerSubagentTools } from './subagent/register-tools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENGINE_ROOT = path.resolve(__dirname, '..');

function resolveEngineModule(relativePath) {
  const rel = typeof relativePath === 'string' ? relativePath.trim() : '';
  if (!rel) throw new Error('relativePath is required');
  const srcPath = path.join(ENGINE_ROOT, 'src', rel);
  if (!fs.existsSync(srcPath)) {
    throw new Error(`Engine source not found: ${srcPath}`);
  }
  return srcPath;
}

async function importEngine(relativePath) {
  const target = resolveEngineModule(relativePath);
  return await import(pathToFileURL(target).href);
}

const [
  { createSubAgentManager },
  { selectAgent },
  { createAppConfigFromModels },
  { getAdminServices },
  { ModelClient },
  { ChatSession, generateSessionId },
  { initializeMcpRuntime },
  { listTools },
  { buildUserPromptMessages },
  { buildLandConfigSelection, resolveLandConfig },
  { createEventLogger },
] = await Promise.all([
  importEngine('subagents/index.js'),
  importEngine('subagents/selector.js'),
  importEngine('config.js'),
  importEngine('config-source.js'),
  importEngine('client.js'),
  importEngine('session.js'),
  importEngine('mcp/runtime.js'),
  importEngine('tools/index.js'),
  importEngine('prompts.js'),
  importEngine('land-config.js'),
  importEngine('event-log.js'),
]);

const args = parseArgs(process.argv.slice(2));
const isWorkerMode = args.worker === true || args.worker === '1' || process.env.SUBAGENT_WORKER === '1';
const server = new McpServer({
  name: 'subagent_router',
  version: '0.1.0',
});
const CURRENT_FILE = fileURLToPath(import.meta.url);

function readRegistrySnapshot(services) {
  const db = services?.mcpServers?.db || services?.prompts?.db || null;
  if (!db || typeof db.list !== 'function') {
    return { mcpServers: [], prompts: [], mcpGrants: [], promptGrants: [] };
  }
  try {
    return {
      mcpServers: db.list('registryMcpServers') || [],
      prompts: db.list('registryPrompts') || [],
      mcpGrants: db.list('mcpServerGrants') || [],
      promptGrants: db.list('promptGrants') || [],
    };
  } catch {
    return { mcpServers: [], prompts: [], mcpGrants: [], promptGrants: [] };
  }
}

function appendPromptBlock(baseText, extraText) {
  const base = typeof baseText === 'string' ? baseText.trim() : '';
  const extra = typeof extraText === 'string' ? extraText.trim() : '';
  if (!base) return extra;
  if (!extra) return base;
  return `${base}\n\n${extra}`;
}

const { services: adminServices, defaultPaths } = getAdminServices();
const runtimeConfig = adminServices.settings?.getRuntimeConfig ? adminServices.settings.getRuntimeConfig() : null;
const promptLanguage = runtimeConfig?.promptLanguage || null;
const landConfigId = typeof runtimeConfig?.landConfigId === 'string' ? runtimeConfig.landConfigId.trim() : '';
const landConfigRecords = adminServices.landConfigs?.list ? adminServices.landConfigs.list() : [];
const selectedLandConfig = resolveLandConfig({ landConfigs: landConfigRecords, landConfigId });
const registrySnapshot = readRegistrySnapshot(adminServices);
const promptRecords = adminServices.prompts.list();
const mcpServerRecords = adminServices.mcpServers.list();
const landSelection = selectedLandConfig
  ? buildLandConfigSelection({
      landConfig: selectedLandConfig,
      prompts: promptRecords,
      mcpServers: mcpServerRecords,
      registryMcpServers: registrySnapshot.mcpServers,
      registryPrompts: registrySnapshot.prompts,
      registryMcpGrants: registrySnapshot.mcpGrants,
      registryPromptGrants: registrySnapshot.promptGrants,
      promptLanguage,
    })
  : null;
const combinedSubagentPrompt = landSelection
  ? appendPromptBlock(landSelection.sub.promptText, landSelection.sub.mcpPromptText)
  : '';
const manager = createSubAgentManager({
  internalSystemPrompt: '',
});
const userPromptMessages = buildUserPromptMessages(combinedSubagentPrompt, 'subagent_user_prompt');
if (landSelection) {
  if ((landSelection.sub?.missingMcpPromptNames || []).length > 0) {
    console.error(
      `[prompts] Missing MCP prompt(s) for subagent_router subagent sessions: ${landSelection.sub.missingMcpPromptNames.join(
        ', '
      )}`
    );
  }
  if ((landSelection.sub?.missingAppServers || []).length > 0) {
    console.error(
      `[land_config] Missing app MCP servers (subagent_router): ${landSelection.sub.missingAppServers.join(', ')}`
    );
  }
}
let cachedConfig = null;
let cachedClient = null;
let mcpRuntimePromise = null;
const mcpConfigPath =
  process.env.SUBAGENT_CONFIG_PATH ||
  args.config ||
  defaultPaths?.mcpConfig ||
  path.join(defaultPaths?.defaultsRoot || process.cwd(), 'shared', 'defaults', 'mcp.config.json');
const SESSION_ROOT = process.env.MODEL_CLI_SESSION_ROOT || process.cwd();
const WORKSPACE_ROOT = process.env.MODEL_CLI_WORKSPACE_ROOT || process.env.MODEL_CLI_SESSION_ROOT || process.cwd();
const RUN_ID = typeof process.env.MODEL_CLI_RUN_ID === 'string' ? process.env.MODEL_CLI_RUN_ID.trim() : '';
const TOOL_ALLOW_LIST = ['invoke_sub_agent', 'get_current_time', 'echo_text'];
let TOOL_ALLOW_PREFIXES = null;
const TOOL_DENY_PREFIXES = ['mcp_subagent_router_']; // block recursive routing; allow all other MCP tools
const eventLogPath =
  process.env.MODEL_CLI_EVENT_LOG ||
  defaultPaths?.events ||
  path.join(resolveAppStateDir(SESSION_ROOT), 'events.jsonl');
const eventLogger = createEventLogger(eventLogPath);
const HEARTBEAT_INTERVAL_MS = 10000;
const HEARTBEAT_STALE_MS = 120000;
const DEFAULT_MODEL_NAME = 'deepseek_chat';

if (landSelection) {
  const prefixes = Array.from(
    new Set((landSelection.sub?.selectedServerNames || []).map((name) => `mcp_${name}_`))
  );
  TOOL_ALLOW_PREFIXES = prefixes.length > 0 ? prefixes : ['__none__'];
}

appendRunPid({ pid: process.pid, kind: isWorkerMode ? 'subagent_worker' : 'mcp', name: 'subagent_router' });
registerProcessShutdownHooks();

function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

function touchFile(filePath) {
  try {
    ensureDir(path.dirname(filePath));
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf8');
    }
  } catch {
    // ignore
  }
}

function readCursor(cursorPath) {
  try {
    if (!fs.existsSync(cursorPath)) return 0;
    const raw = fs.readFileSync(cursorPath, 'utf8');
    const num = Number(String(raw || '').trim());
    return Number.isFinite(num) && num >= 0 ? Math.floor(num) : 0;
  } catch {
    return 0;
  }
}

function persistCursor(cursorPath, cursor) {
  const num = Number(cursor);
  if (!Number.isFinite(num) || num < 0) return;
  try {
    fs.writeFileSync(cursorPath, String(Math.floor(num)), 'utf8');
  } catch {
    // ignore
  }
}

function createRunInboxListener({ runId, sessionRoot, consumerId, onEntry, skipExisting } = {}) {
  const rid = typeof runId === 'string' ? runId.trim() : '';
  const root = typeof sessionRoot === 'string' ? sessionRoot.trim() : '';
  if (!rid || !root) return null;
  const cb = typeof onEntry === 'function' ? onEntry : null;
  if (!cb) return null;
  const consumer = typeof consumerId === 'string' && consumerId.trim() ? consumerId.trim() : String(process.pid);
  const dir = path.join(resolveAppStateDir(root), 'terminals');
  const inboxPath = path.join(dir, `${rid}.inbox.jsonl`);
  const cursorPath = path.join(dir, `${rid}.inbox.${consumer}.cursor`);
  ensureDir(dir);
  touchFile(inboxPath);

  let cursor = readCursor(cursorPath);
  if (skipExisting === true && !fs.existsSync(cursorPath)) {
    try {
      cursor = fs.statSync(inboxPath).size;
      persistCursor(cursorPath, cursor);
    } catch {
      // ignore
    }
  }
  let partial = '';
  let watcher = null;
  let poll = null;
  let draining = false;

  const drain = () => {
    if (draining) return;
    draining = true;
    try {
      const buf = fs.readFileSync(inboxPath);
      const total = buf.length;
      if (cursor > total) {
        cursor = 0;
      }
      if (total <= cursor) {
        return;
      }
      const chunk = buf.slice(cursor);
      cursor = total;
      persistCursor(cursorPath, cursor);
      partial += chunk.toString('utf8');
      const lines = partial.split('\n');
      partial = lines.pop() || '';
      lines.forEach((line) => {
        const trimmed = String(line || '').trim();
        if (!trimmed) return;
        try {
          const parsed = JSON.parse(trimmed);
          cb(parsed);
        } catch {
          // ignore parse failures
        }
      });
    } catch {
      // ignore read failures
    } finally {
      draining = false;
    }
  };

  try {
    watcher = fs.watch(inboxPath, { persistent: false }, () => drain());
    if (watcher && typeof watcher.on === 'function') {
      watcher.on('error', (err) => {
        try {
          console.error(`[subagent_router] inbox watcher error: ${err?.message || err}`);
        } catch {
          // ignore
        }
        try {
          watcher?.close?.();
        } catch {
          // ignore
        }
        watcher = null;
      });
    }
  } catch {
    watcher = null;
  }
  poll = setInterval(drain, 650);
  if (poll && typeof poll.unref === 'function') poll.unref();
  drain();

  const close = () => {
    if (watcher) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
      watcher = null;
    }
    if (poll) {
      clearInterval(poll);
      poll = null;
    }
  };

  return { close };
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[subagent_router] ready');
}

if (isWorkerMode) {
  runWorkerJob().catch((err) => {
    console.error('[subagent_router worker] crashed:', err);
    process.exit(1);
  });
} else {
  registerSubagentTools({
    server,
    z,
    manager,
    jsonTextResponse,
    serializeAgent,
    normalizeSkills,
    pickAgent,
    executeSubAgent,
    buildJobResultPayload,
    createAsyncJob,
    startAsyncJob,
    formatJobStatus,
    hydrateStaleStatus,
    getJobStore: () => jobStore,
    performance,
  });
  main().catch((err) => {
    console.error('[subagent_router] crashed:', err);
    process.exit(1);
  });
}

async function pickAgent({ agentId, category, skills, query, commandId, task }) {
  if (agentId) {
    const ref = manager.getAgent(agentId);
    if (!ref) return null;
    if (commandId && !hasCommand(ref, commandId)) return null;
    return ref;
  }
  
  // Try AI-based suggestion if task is provided
  if (task) {
    try {
      const aiResult = await suggestAgentWithAI(manager.listAgents(), task, { category, query, commandId });
      if (aiResult && aiResult.agent_id && aiResult.confidence > 0.6) {
        const aiRef = manager.getAgent(aiResult.agent_id);
        if (aiRef) {
          return aiRef;
        }
      }
    } catch (err) {
      // ignore AI errors and fall back to rule-based
    }
  }

  const candidates = filterAgents(manager.listAgents(), {
    filterCategory: category,
    query: commandId ? commandId : query,
  }).filter((agent) => (commandId ? hasCommand(agent, commandId) : true));
  if (candidates.length === 0) {
    return selectAgent(manager, { category, skills, query: commandId || query });
  }
  const first = candidates[0];
  return manager.getAgent(first.id) || selectAgent(manager, { category, skills, query });
}

function hasCommand(agentOrRef, commandId) {
  if (!commandId) return true;
  const needle = String(commandId).toLowerCase().trim();
  if (!needle) return true;
  if (!agentOrRef) return false;

  // `hasCommand` is used with two different shapes:
  // 1) items from `manager.listAgents()` which include a `commands` array
  // 2) an `{ plugin, agent }` ref from `manager.getAgent()`
  const commands =
    (Array.isArray(agentOrRef.commands) && agentOrRef.commands) ||
    (Array.isArray(agentOrRef.agent?.commands) && agentOrRef.agent.commands) ||
    (Array.isArray(agentOrRef.plugin?.commands) && agentOrRef.plugin.commands) ||
    [];

  if (commands.length > 0) {
    return commands.some((c) => {
      const id = typeof c === 'string' ? c : c?.id || '';
      const name = typeof c === 'string' ? c : c?.name || '';
      return id.toLowerCase().includes(needle) || name.toLowerCase().includes(needle);
    });
  }

  // Fallback for plugins that only expose a commandMap.
  const map = agentOrRef.plugin?.commandMap;
  if (map && typeof map.get === 'function') {
    for (const [id, cmd] of map.entries()) {
      const name = cmd?.name || '';
      if (String(id).toLowerCase().includes(needle) || String(name).toLowerCase().includes(needle)) {
        return true;
      }
    }
  }

  return false;
}

function resolveCommand(plugin, commandId) {
  if (!plugin || !commandId) return null;
  const needle = String(commandId).toLowerCase().trim();
  if (plugin.commandMap && plugin.commandMap.size > 0) {
    for (const [id, cmd] of plugin.commandMap.entries()) {
      const name = cmd?.name || '';
      if (id.toLowerCase() === needle || name.toLowerCase() === needle) {
        return { plugin, command: cmd };
      }
    }
  }
  if (Array.isArray(plugin.commands)) {
    const hit = plugin.commands.find((cmd) => {
      const id = String(cmd?.id || '').toLowerCase();
      const name = String(cmd?.name || '').toLowerCase();
      return id === needle || name === needle;
    });
    if (hit) {
      return { plugin, command: hit };
    }
  }
  return null;
}

async function loadAppConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }
  const models = adminServices.models.list();
  const secrets = adminServices.secrets?.list ? adminServices.secrets.list() : [];
  cachedConfig = createAppConfigFromModels(models, secrets);
  const runtime = await ensureMcpRuntime();
  if (runtime) {
    runtime.applyToConfig(cachedConfig);
  }
  applyToolWhitelist(cachedConfig);
  return cachedConfig;
}

function getClient(config) {
  if (cachedClient) {
    return cachedClient;
  }
  cachedClient = new ModelClient(config);
  return cachedClient;
}

async function ensureMcpRuntime() {
  if (mcpRuntimePromise) {
    return mcpRuntimePromise;
  }
  mcpRuntimePromise = (async () => {
    try {
      const skip = new Set(['subagent_router']); // Prevent recursive self-connection.
      try {
        const servers = adminServices?.mcpServers?.list?.() || [];
        if (landSelection) {
          const allowed = new Set(
            (landSelection.sub?.selectedServers || [])
              .map((entry) => String(entry?.server?.name || '').toLowerCase())
              .filter(Boolean)
          );
          servers.forEach((srv) => {
            if (!srv?.name) return;
            if (!allowed.has(String(srv.name || '').toLowerCase())) {
              skip.add(srv.name);
            }
          });
        }
      } catch {
        // ignore admin snapshot errors
      }
      return await initializeMcpRuntime(mcpConfigPath, SESSION_ROOT, WORKSPACE_ROOT, {
        caller: 'subagent',
        skipServers: Array.from(skip),
        extraServers: landSelection?.extraMcpServers || [],
        eventLogger,
      });
    } catch (err) {
      console.error('[subagent_router] MCP init failed:', err.message);
      return null;
    }
  })();
  return mcpRuntimePromise;
}

function applyToolWhitelist(config) {
  if (!config || !config.models) return;
  const registered = new Set(listTools());
  Object.values(config.models).forEach((settings) => {
    if (!settings) return;
    const normalized = new Set();
    const addIfAllowed = (name) => {
      if (!name) return;
      if (!isToolAllowed(name)) return;
      if (!registered.has(name)) return;
      normalized.add(name);
    };
    (Array.isArray(settings.tools) ? settings.tools : []).forEach(addIfAllowed);
    settings.tools = Array.from(normalized);
  });
}

function isToolAllowed(name) {
  if (!name) return false;
  const value = String(name || '').trim();
  // Prevent nested sub-agent calls from inside sub-agent sessions.
  if (value === 'invoke_sub_agent') {
    return false;
  }
  // Explicit deny list to prevent sub-agents from calling the subagent router tools.
  if (TOOL_DENY_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return false;
  }
  const allowMcpPrefixes = Array.isArray(TOOL_ALLOW_PREFIXES) ? TOOL_ALLOW_PREFIXES : null;
  if (value.startsWith('mcp_') && allowMcpPrefixes && allowMcpPrefixes.length > 0) {
    if (!allowMcpPrefixes.some((prefix) => value.startsWith(prefix))) {
      return false;
    }
  }
  // Otherwise allow all registered tools (including shell/code writer/etc.).
  return true;
}

async function executeSubAgent({ task, agentId, category, skills = [], model, query, commandId }) {
  const agentRef = await pickAgent({ agentId, category, skills, query, commandId, task });
  if (!agentRef) {
    throw new Error('No sub-agent available; install relevant plugins first.');
  }
  const normalizedSkills = normalizeSkills(skills);
  let systemPrompt = '';
  let internalPrompt = '';
  let usedSkills = [];
  let reasoning = true;
  let commandMeta = null;
  let commandModel = null;

  const commands = Array.isArray(agentRef.plugin?.commands) ? agentRef.plugin.commands : [];
  const effectiveCommandId =
    commandId ||
    agentRef.agent.defaultCommand ||
    (commands.length === 1 ? commands[0]?.id || commands[0]?.name || null : null);

  if (effectiveCommandId) {
    const commandRef = resolveCommand(agentRef.plugin, effectiveCommandId);
    if (!commandRef) {
      throw new Error(`Sub-agent ${agentRef.agent.id} does not contain command ${effectiveCommandId}`);
    }
    const promptInfo = manager.buildCommandPrompt(commandRef, task);
    systemPrompt = promptInfo.systemPrompt;
    internalPrompt = promptInfo.internalPrompt || '';
    reasoning = promptInfo.extra?.reasoning !== false;
    commandModel = commandRef.command.model || null;
    commandMeta = {
      id: commandRef.command.id || commandRef.command.name || effectiveCommandId,
      name: commandRef.command.name || commandRef.command.id || effectiveCommandId,
    };
  } else {
    const promptInfo = manager.buildSystemPrompt(agentRef, normalizedSkills);
    systemPrompt = promptInfo.systemPrompt;
    internalPrompt = promptInfo.internalPrompt || '';
    usedSkills = promptInfo.usedSkills || normalizedSkills;
    reasoning = promptInfo.extra?.reasoning !== false;
  }

  const config = await loadAppConfig();
  const client = getClient(config);
  const targetModel =
    model || // explicit override from request
    commandModel || // model declared on the command, if any
    agentRef.agent.model || // per-agent model from plugin manifest
    (typeof config.getModel === 'function' ? config.getModel(null).name : null); // default fallback
  if (!targetModel) {
    throw new Error('Target model could not be resolved; check configuration.');
  }
  const sessionPrompt = withSubagentGuardrails(withTaskTracking(systemPrompt, internalPrompt));
  eventLogger?.log?.('subagent_start', {
    agent: agentRef.agent.id,
    task,
    command: commandMeta?.id || null,
  });
  const session = new ChatSession(sessionPrompt, {
    sessionId: generateSessionId(task || ''),
    trailingSystemPrompts: internalPrompt ? [internalPrompt] : [],
    extraSystemPrompts: userPromptMessages,
  });
  session.addUser(task);

  const pendingCorrections = [];
  let activeController = null;
  const shouldAcceptTarget = (target) => {
    const value = typeof target === 'string' ? target.trim() : '';
    if (!value || value === 'all') return true;
    if (value === 'subagent_worker') return isWorkerMode;
    if (value === 'subagent_router') return !isWorkerMode;
    return false;
  };
  const inboxListener = createRunInboxListener({
    runId: RUN_ID,
    sessionRoot: SESSION_ROOT,
    consumerId: `subagent_${isWorkerMode ? 'worker' : 'router'}_${process.pid}`,
    skipExisting: true,
    onEntry: (entry) => {
      if (!entry || typeof entry !== 'object') return;
      if (String(entry.type || '') !== 'correction') return;
      if (!shouldAcceptTarget(entry.target)) return;
      const text = typeof entry.text === 'string' ? entry.text.trim() : '';
      if (!text) return;
      pendingCorrections.push(text);
      eventLogger?.log?.('subagent_user', {
        agent: agentRef.agent.id,
        text,
        source: 'ui',
        target: typeof entry.target === 'string' ? entry.target : undefined,
      });
      eventLogger?.log?.('subagent_notice', {
        agent: agentRef.agent.id,
        text: '收到纠正：已中止当前请求，正在带着纠正继续执行…',
        source: 'ui',
      });
      if (activeController && !activeController.signal.aborted) {
        try {
          activeController.abort();
        } catch {
          // ignore
        }
      }
    },
  });

  const applyCorrections = () => {
    if (pendingCorrections.length === 0) return;
    const merged = pendingCorrections.splice(0, pendingCorrections.length);
    const combined = merged.join('\n');
    session.addUser(`【用户纠正】\n${combined}`);
  };

  let response;
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      applyCorrections();
      const controller = new AbortController();
      activeController = controller;
      try {
        // eslint-disable-next-line no-await-in-loop
        response = await client.chat(targetModel, session, {
          stream: true, // align with main flow to reduce request size/buffered responses
          reasoning,
          signal: controller.signal,
          onToolCall: ({ tool, args }) => {
            eventLogger?.log?.('subagent_tool_call', { agent: agentRef.agent.id, tool, args });
          },
          onToolResult: ({ tool, result }) => {
            const preview = typeof result === 'string' ? result : JSON.stringify(result || {});
            eventLogger?.log?.('subagent_tool_result', {
              agent: agentRef.agent.id,
              tool,
              result: preview,
            });
          },
        });
        break;
      } catch (err) {
        if (err?.name === 'AbortError' && pendingCorrections.length > 0) {
          continue;
        }
        throw err;
      } finally {
        if (activeController === controller) {
          activeController = null;
        }
      }
    }
  } finally {
    try {
      inboxListener?.close?.();
    } catch {
      // ignore
    }
  }

  if (response === undefined) {
    throw new Error('Sub-agent was interrupted too many times; no final response produced.');
  }

  const responsePreview =
    typeof response === 'string' ? response : JSON.stringify(response || {});
  eventLogger?.log?.('subagent_done', {
    agent: agentRef.agent.id,
    model: targetModel,
    command: commandMeta?.id || null,
    responsePreview,
  });

  return {
    agentRef,
    usedSkills,
    commandMeta,
    targetModel,
    response,
  };
}

function buildJobResultPayload(result) {
  if (!result || !result.agentRef || !result.agentRef.agent || !result.agentRef.plugin) {
    return null;
  }
  return {
    agent_id: result.agentRef.agent.id,
    agent_name: result.agentRef.agent.name,
    plugin: result.agentRef.plugin.id,
    model: result.targetModel,
    skills: result.usedSkills,
    command: result.commandMeta,
    response: result.response,
  };
}

const jobStore = new Map();

function createAsyncJob(params) {
  const id = `job_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
  const now = new Date().toISOString();
  const nowMono = performance.now();
  const job = {
    id,
    status: 'pending',
    params: { ...params },
    createdAt: now,
    updatedAt: now,
    updatedAtMono: nowMono,
    result: null,
    error: null,
    heartbeatStale: false,
  };
  jobStore.set(id, job);
  return job;
}

function formatJobStatus(job) {
  const heartbeatAgeMs =
    job && Number.isFinite(job.updatedAtMono)
      ? Math.max(0, performance.now() - job.updatedAtMono)
      : null;
  return {
    job_id: job.id,
    status: job.status,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    heartbeat_age_ms: heartbeatAgeMs,
    heartbeat_stale: Boolean(job.heartbeatStale),
    result: job.status === 'done' ? job.result : null,
    error: job.error,
  };
}

function startAsyncJob(job) {
  const current = jobStore.get(job.id);
  if (!current) return;
  current.status = 'running';
  current.updatedAt = new Date().toISOString();
  current.updatedAtMono = performance.now();
  current.heartbeatStale = false;

  let child;
  try {
    const env = {
      ...process.env,
      SUBAGENT_JOB_DATA: JSON.stringify(current.params || {}),
      SUBAGENT_CONFIG_PATH: mcpConfigPath,
      SUBAGENT_WORKER: '1',
      MODEL_CLI_SESSION_ROOT: SESSION_ROOT,
      MODEL_CLI_WORKSPACE_ROOT: WORKSPACE_ROOT,
      MODEL_CLI_EVENT_LOG: eventLogPath,
    };
    child = fork(CURRENT_FILE, ['--worker'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
  } catch (err) {
    current.status = 'error';
    current.updatedAt = new Date().toISOString();
    current.error = `Failed to start sub-agent worker: ${err?.message || err}`;
    return;
  }

  current.workerPid = Number.isFinite(child.pid) ? child.pid : null;
  current.worker = child;
  appendRunPid({ pid: child.pid, kind: 'subagent_worker', name: current.id });

  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      const text = chunk?.toString?.() || '';
      if (text.trim().length > 0) {
        console.error(`[subagent_router worker] ${text.trimEnd()}`);
      }
    });
  }
  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      const text = chunk?.toString?.() || '';
      if (text.trim().length > 0) {
        console.error(`[subagent_router worker] ${text.trimEnd()}`);
      }
    });
  }

  const finalize = (updater, { force } = {}) => {
    const j = jobStore.get(job.id);
    if (!j) return;
    if (!force && (j.status === 'done' || j.status === 'error')) return;
    updater(j);
    j.updatedAt = new Date().toISOString();
    j.updatedAtMono = performance.now();
    j.heartbeatStale = false;
  };

  child.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'heartbeat') {
      const j = jobStore.get(job.id);
      if (!j || j.status !== 'running') {
        return;
      }
      j.updatedAt = new Date().toISOString();
      j.updatedAtMono = performance.now();
      j.heartbeatStale = false;
      return;
    }
    if (msg.type === 'result') {
      finalize((j) => {
        j.status = 'done';
        j.result = msg.result || null;
        j.error = null;
      }, { force: true });
    } else if (msg.type === 'error') {
      finalize((j) => {
        j.status = 'error';
        j.error = msg.error || 'Sub-agent worker error';
      }, { force: true });
    }
  });

  child.on('error', (err) => {
    finalize(
      (j) => {
        j.status = 'error';
        j.error = `Sub-agent worker process error: ${err?.message || err}`;
      },
      { force: true }
    );
  });

  child.on('exit', (code, signal) => {
    const entry = jobStore.get(job.id);
    if (entry && entry.worker === child) {
      entry.worker = null;
    }
    const status = jobStore.get(job.id);
    if (!status || status.status === 'done' || status.status === 'error') {
      return;
    }
    finalize((j) => {
      j.status = 'error';
      const parts = [];
      if (signal) {
        parts.push(`signal ${signal}`);
      }
      if (Number.isFinite(code)) {
        parts.push(`exit code ${code}`);
      }
      const reason = parts.length > 0 ? ` (${parts.join(', ')})` : '';
      j.error = `Sub-agent worker exited unexpectedly${reason}`;
    });
  });
}

async function runWorkerJob() {
  appendRunPid({ pid: process.pid, kind: 'subagent_worker', name: 'worker' });
  const raw = process.env.SUBAGENT_JOB_DATA;
  if (!raw) {
    console.error('[subagent_router worker] missing SUBAGENT_JOB_DATA');
    process.exit(1);
    return;
  }
  let params;
  try {
    params = JSON.parse(raw);
  } catch (err) {
    console.error('[subagent_router worker] invalid job payload:', err?.message || err);
    process.exit(1);
    return;
  }
  let heartbeat;
  try {
    heartbeat = setInterval(() => {
      try {
        if (process.send) {
          process.send({ type: 'heartbeat', ts: Date.now() });
        }
      } catch {
        // ignore transport errors
      }
    }, HEARTBEAT_INTERVAL_MS);
    const result = await executeSubAgent(params);
    const payload = buildJobResultPayload(result);
    if (payload && process.send) {
      process.send({ type: 'result', result: payload });
    } else if (!payload) {
      throw new Error('Sub-agent worker missing result payload');
    }
  } catch (err) {
    if (process.send) {
      process.send({ type: 'error', error: err?.message || String(err) });
    }
    console.error('[subagent_router worker] failed to execute job:', err?.message || err);
    if (heartbeat) {
      clearInterval(heartbeat);
    }
    process.exit(1);
    return;
  }
  if (heartbeat) {
    clearInterval(heartbeat);
  }
  process.exit(0);
}

function hydrateStaleStatus(job) {
  if (job.status !== 'running') return;
  const last = Number.isFinite(job.updatedAtMono) ? job.updatedAtMono : NaN;
  if (!Number.isFinite(last)) {
    job.heartbeatStale = false;
    return;
  }
  const ageMs = performance.now() - last;
  job.heartbeatStale = ageMs > HEARTBEAT_STALE_MS;
}

function appendRunPid({ pid, kind, name } = {}) {
  if (!RUN_ID) return;
  const root = typeof SESSION_ROOT === 'string' && SESSION_ROOT.trim() ? SESSION_ROOT.trim() : '';
  const num = Number(pid);
  if (!root || !Number.isFinite(num) || num <= 0) return;
  const dir = path.join(resolveAppStateDir(root), 'terminals');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
  const pidsPath = path.join(dir, `${RUN_ID}.pids.jsonl`);
  const payload = {
    ts: new Date().toISOString(),
    runId: RUN_ID,
    pid: num,
    kind: typeof kind === 'string' && kind.trim() ? kind.trim() : 'process',
    name: typeof name === 'string' && name.trim() ? name.trim() : undefined,
  };
  try {
    fs.appendFileSync(pidsPath, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch {
    // ignore
  }
}

function killAllWorkers({ signal = 'SIGKILL' } = {}) {
  const sig = typeof signal === 'string' && signal ? signal : 'SIGKILL';
  jobStore.forEach((job) => {
    const child = job?.worker;
    if (!child || typeof child.kill !== 'function') return;
    if (child.killed) return;
    try {
      child.kill(sig);
    } catch {
      // ignore
    }
  });
}

function registerProcessShutdownHooks() {
  if (process.env.SUBAGENT_WORKER === '1' || isWorkerMode) {
    return;
  }
  const stop = (signal) => {
    try {
      killAllWorkers({ signal: 'SIGTERM' });
    } catch {
      // ignore
    }
    try {
      killAllWorkers({ signal: 'SIGKILL' });
    } catch {
      // ignore
    }
    try {
      process.exit(signal === 'SIGINT' ? 130 : 143);
    } catch {
      // ignore
    }
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('exit', () => {
    try {
      killAllWorkers({ signal: 'SIGKILL' });
    } catch {
      // ignore
    }
  });
}

async function suggestAgentWithAI(agents, task, hints = {}) {
  const summaries = agents.map(summarizeAgentForPrompt);
  const hintText = [
    hints.category ? `Preferred Category: ${hints.category}` : '',
    hints.query ? `Search Query: ${hints.query}` : '',
    hints.commandId ? `Required Command: ${hints.commandId}` : ''
  ].filter(Boolean).join('\n');

  const systemPrompt = `You are an intelligent router for a multi-agent system.
Your task is to select the most suitable sub-agent for the user's request.

Available Agents:
${JSON.stringify(summaries, null, 2)}

User Request: "${task}"
${hintText}

Analyze the request and available agents.
Return a JSON object with the following structure (no markdown formatting, just raw JSON):
{
  "agent_id": "The ID of the chosen agent",
  "reason": "A brief explanation of why this agent was chosen",
  "confidence": 0.0 to 1.0
}`;

  const config = await loadAppConfig();
  const client = getClient(config);
  
  // Use the default model for routing (matching CLI behavior)
  const model = config.defaultModel || Object.keys(config.models)[0] || DEFAULT_MODEL_NAME;
  
  if (!model) {
      return null;
  }

  const session = new ChatSession(systemPrompt, {
    sessionId: generateSessionId('router_' + Date.now()),
  });
  // We already put the task in the system prompt context, but adding a user message triggers the generation
  session.addUser('Please analyze the request and select the best agent in JSON format.');

  try {
    let fullText = '';
    await client.chat(model, session, {
      stream: true,
      reasoning: false,
      
      onToken: (token) => {
        console.error(`[suggestAgentWithAI] token: ${JSON.stringify(token)}`);
        fullText += token;
      }
    });
    
    const text = fullText;
    // Clean up markdown code blocks if present
    const cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
    // Find the first '{' and last '}'
    const start = cleanText.indexOf('{');
    const end = cleanText.lastIndexOf('}');
    if (start >= 0 && end >= 0) {
        return JSON.parse(cleanText.substring(start, end + 1));
    }
    return JSON.parse(cleanText);
  } catch (err) {
    console.error('[suggestAgentWithAI] Error:', err);
    return null;
  }
}

function summarizeAgentForPrompt(agent) {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    category: agent.category || agent.pluginCategory,
    skills: (agent.skills || []).map(s => s.id),
    commands: (agent.commands || []).map(c => typeof c === 'string' ? c : c.id || c.name)
  };
}
