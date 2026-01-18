#!/usr/bin/env node

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ConfigError, createAppConfigFromModels } from '../../src/engine/src/config.js';
import { ChatSession } from '../../src/engine/src/session.js';
import { ModelClient } from '../../src/engine/src/client.js';
import * as colors from '../../src/engine/src/colors.js';
import { createLogger } from '../../src/engine/src/logger.js';
import { runStartupWizard } from '../../src/engine/src/ui/index.js';
import { initializeMcpRuntime } from '../../src/engine/src/mcp/runtime.js';
import { loadPromptProfilesFromDb } from '../../src/engine/src/prompts.js';
import { chatLoop } from '../../src/engine/src/chat-loop.js';
import { loadMcpConfig } from '../../src/engine/src/mcp.js';
import { buildLandConfigSelection, resolveLandConfig } from '../../src/engine/src/land-config.js';
import { createSubAgentManager } from '../../src/engine/src/subagents/index.js';
import { generateConfigReport, writeReport } from '../../src/engine/src/report.js';
import { writeSessionReport } from '../../src/engine/src/session-report.js';
import { createEventLogger } from '../../src/engine/src/event-log.js';
import { getAdminServices } from '../../src/engine/src/config-source.js';
import { listTools } from '../../src/engine/src/tools/index.js';
import { terminalPlatform } from '../../src/engine/src/terminal/platform/index.js';
import { resolveSessionRoot, persistSessionRoot } from '../../src/engine/shared/session-root.js';
import { applySecretsToProcessEnv } from '../../src/engine/shared/secrets-env.js';
import { ensureAppStateDir, resolveAppStateDir } from '../../src/engine/shared/state-paths.js';
import { allowExternalOnlyMcpServers, isExternalOnlyMcpServerName } from '../../src/engine/shared/host-app.js';
import { createRuntimeLogger } from '../../src/engine/shared/runtime-log.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_MODEL_NAME = 'deepseek_chat';
const log = createLogger();
const mcpLog = createLogger('MCP');

const COMMANDS = {
  MODELS: 'models',
  CHAT: 'chat',
};

if (!process.env.MODEL_CLI_HOST_APP) {
  process.env.MODEL_CLI_HOST_APP = 'chatos';
}

main().catch((err) => {
  log.error('Unexpected failure', err);
  process.exitCode = 1;
});

function ensureRunId() {
  const existing = typeof process.env.MODEL_CLI_RUN_ID === 'string' ? process.env.MODEL_CLI_RUN_ID.trim() : '';
  if (existing) return existing;
  const short = crypto.randomUUID().split('-')[0];
  const generated = `run-${Date.now().toString(36)}-${short}`;
  process.env.MODEL_CLI_RUN_ID = generated;
  return generated;
}

function registerRun({ sessionRoot, workspaceRoot, command, args } = {}) {
  try {
    const runId = ensureRunId();
    const stateRoot = typeof sessionRoot === 'string' && sessionRoot.trim() ? sessionRoot.trim() : '';
    const stateDir = resolveAppStateDir(stateRoot || process.cwd());
    fs.mkdirSync(stateDir, { recursive: true });
    const registryPath = path.join(stateDir, 'runs.jsonl');
    const entry = {
      ts: new Date().toISOString(),
      runId,
      pid: process.pid,
      cwd: typeof workspaceRoot === 'string' && workspaceRoot.trim() ? workspaceRoot.trim() : process.cwd(),
      workspaceRoot:
        typeof workspaceRoot === 'string' && workspaceRoot.trim() ? workspaceRoot.trim() : process.cwd(),
      sessionRoot: stateRoot || process.env.MODEL_CLI_SESSION_ROOT || '',
      command: command || '',
      args: Array.isArray(args) ? args : [],
    };
    fs.appendFileSync(registryPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // ignore registry errors
  }
}

function writeTerminalStatusFile({ state, currentMessage } = {}) {
  const runId = ensureRunId();
  const sessionRoot =
    typeof process.env.MODEL_CLI_SESSION_ROOT === 'string' && process.env.MODEL_CLI_SESSION_ROOT.trim()
      ? process.env.MODEL_CLI_SESSION_ROOT.trim()
      : '';
  if (!runId || !sessionRoot) return;
  const dir = path.join(resolveAppStateDir(sessionRoot), 'terminals');
  const statusPath = path.join(dir, `${runId}.status.json`);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
  const payload = {
    runId,
    pid: process.pid,
    state: typeof state === 'string' && state.trim() ? state.trim() : 'idle',
    currentMessage: typeof currentMessage === 'string' ? currentMessage : '',
    updatedAt: new Date().toISOString(),
  };
  const text = `${JSON.stringify(payload)}\n`;
  try {
    const tmpPath = `${statusPath}.tmp`;
    fs.writeFileSync(tmpPath, text, 'utf8');
    fs.renameSync(tmpPath, statusPath);
    return;
  } catch {
    // ignore and fall back
  }
  try {
    fs.writeFileSync(statusPath, text, 'utf8');
  } catch {
    // ignore
  }
}

async function main() {
  terminalPlatform.ensureUtf8Console();
  // 每次 CLI 启动（每个终端进程）生成一个 runId，便于 UI 按终端区分日志
  ensureRunId();
  process.env.MODEL_CLI_RUN_PID = String(process.pid);

  // 统一会话根目录，供 MCP 服务器和 UI 读取同一状态（tasks/admin.db）
  const sessionRoot = resolveSessionRoot();
  process.env.MODEL_CLI_SESSION_ROOT = sessionRoot;
  persistSessionRoot(sessionRoot);
  ensureAppStateDir(sessionRoot);
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || command === '--help' || command === '-h') {
    printUsage();
    return;
  }
  registerRun({ sessionRoot, workspaceRoot: process.cwd(), command, args: argv.slice(1) });
  const args = argv.slice(1);
  if (command === COMMANDS.MODELS) {
    let parsed;
    try {
      parsed = parseOptions(args, {
        '--config': { key: 'config', type: 'string' },
        '-c': { key: 'config', type: 'string' },
      });
    } catch (err) {
      console.error(colors.yellow(err.message));
      process.exit(1);
    }
    if (parsed.options.config) {
      console.error(colors.yellow('[config] --config 已弃用/忽略：Models/API Keys 统一从 Desktop Admin DB 读取。'));
    }
    runListModels();
    return;
  }
  if (command === COMMANDS.CHAT) {
    let parsed;
    try {
      parsed = parseOptions(args, {
        '--config': { key: 'config', type: 'string' },
        '-c': { key: 'config', type: 'string' },
        '--model': { key: 'model', type: 'string' },
        '-m': { key: 'model', type: 'string' },
        '--system': { key: 'system', type: 'string' },
        '--stream': { key: 'stream', type: 'boolean', value: true },
        '--no-stream': { key: 'stream', type: 'boolean', value: false },
        '--ui': { key: 'ui', type: 'boolean', value: true },
        '--no-ui': { key: 'ui', type: 'boolean', value: false },
      });
    } catch (err) {
      console.error(colors.yellow(err.message));
      process.exit(1);
    }
    if (parsed.options.config) {
      console.error(colors.yellow('[config] --config 已弃用/忽略：Models/API Keys 统一从 Desktop Admin DB 读取。'));
    }
    // UI 会通过 terminals/<runId>.status.json 判断 CLI 是否已就绪；在重初始化/加载 DB/MCP 之前先写入启动状态，
    // 避免 Electron 在 CLI 仍启动中时误判为“未上报状态/旧版本”。
    writeTerminalStatusFile({ state: 'starting' });
    await runChat(parsed.options);
    return;
  }
  console.error(colors.yellow(`Unknown command ${command}`));
  printUsage();
}

function printUsage() {
  console.log(`model-cli-js (Node.js)

Usage:
  model-cli-js models
  model-cli-js chat [--model <name>] [--system <prompt>] [--no-stream] [--no-ui]

Inline commands while chatting:
  :help    Show inline command list
  :models  List configured models
  :use     Switch active model
  :reset   Clear the current conversation
  :save    Write transcript to Markdown
  :exit    Leave the chat

Slash commands:
  /model      Reopen the guided setup UI
  /prompt     Override the active system prompt
  /mcp        Show MCP server configuration
  /mcp_set    Interactive MCP configuration wizard
  /mcp_tools  Enable or disable registered MCP tools
  /tool       Show the latest tool outputs (e.g. /tool T1)`);
}

function parseOptions(argv, allowed) {
  const options = {};
  const positional = [];
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (!token.startsWith('-')) {
      positional.push(token);
      i += 1;
      continue;
    }
    const [flag, inlineValue] = token.split('=');
    const spec = allowed[flag];
    if (!spec) {
      throw new Error(`Unknown option ${flag}`);
    }
    if (spec.type === 'boolean') {
      if (inlineValue !== undefined) {
        options[spec.key] = parseBoolean(inlineValue, flag);
      } else if (spec.value !== undefined) {
        options[spec.key] = spec.value;
      } else {
        options[spec.key] = true;
      }
      i += 1;
      continue;
    }
    let value = inlineValue;
    if (value === undefined) {
      value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`Option ${flag} requires a value`);
      }
      i += 1;
    }
    options[spec.key] = value;
    i += 1;
  }
  return { options, positional };
}

function parseBoolean(value, flag) {
  const normalized = String(value).toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n'].includes(normalized)) {
    return false;
  }
  throw new Error(`Option ${flag} expected a boolean value but received "${value}"`);
}

function appendPromptBlock(baseText, extraText) {
  const base = typeof baseText === 'string' ? baseText.trim() : '';
  const extra = typeof extraText === 'string' ? extraText.trim() : '';
  if (!base) return extra;
  if (!extra) return base;
  return `${base}\n\n${extra}`;
}

function applyRuntimeSettings(config) {
  const normalized = {};
  const envLandConfigId =
    typeof process.env.MODEL_CLI_LAND_CONFIG_ID === 'string' ? process.env.MODEL_CLI_LAND_CONFIG_ID.trim() : '';
  if (envLandConfigId) {
    normalized.landConfigId = envLandConfigId;
  }
  if (!config || typeof config !== 'object') {
    return normalized;
  }
  const normalizeLanguage = (value) => {
    const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (raw === 'zh' || raw === 'en') return raw;
    return undefined;
  };
  const pickNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
  };
  const setFlag = (key, enabled) => {
    process.env[key] = enabled ? '1' : '0';
  };
  const setNumberEnv = (key, value) => {
    if (Number.isFinite(value)) {
      process.env[key] = String(value);
    }
  };
  const summaryThreshold = pickNumber(config.summaryTokenThreshold);
  const maxToolPasses = pickNumber(config.maxToolPasses);
  if (summaryThreshold !== undefined) {
    normalized.summaryThreshold = summaryThreshold;
    setNumberEnv('MODEL_CLI_SUMMARY_TOKENS', summaryThreshold);
  }
  if (maxToolPasses !== undefined) {
    normalized.maxToolPasses = maxToolPasses;
  }
  const promptLanguage = normalizeLanguage(config.promptLanguage);
  if (promptLanguage) {
    normalized.promptLanguage = promptLanguage;
    process.env.MODEL_CLI_PROMPT_LANGUAGE = promptLanguage;
  }
  if (!envLandConfigId && typeof config.landConfigId === 'string') {
    normalized.landConfigId = config.landConfigId.trim();
  }
  setFlag('MODEL_CLI_AUTO_ROUTE', Boolean(config.autoRoute));
  setFlag('MODEL_CLI_LOG_REQUEST', Boolean(config.logRequests));
  setFlag('MODEL_CLI_STREAM_RAW', Boolean(config.streamRaw));
  setNumberEnv('MODEL_CLI_TOOL_PREVIEW_LIMIT', pickNumber(config.toolPreviewLimit));
  setNumberEnv('MODEL_CLI_RETRY', pickNumber(config.retry));
  setNumberEnv('MODEL_CLI_MCP_TIMEOUT_MS', pickNumber(config.mcpTimeoutMs));
  setNumberEnv('MODEL_CLI_MCP_MAX_TIMEOUT_MS', pickNumber(config.mcpMaxTimeoutMs));
  return normalized;
}

function runListModels() {
  const { services } = getAdminServices();
  const config = createAppConfigFromModels(services.models.list(), services.secrets.list());
  console.log(renderModelsTable(config));
}

function readRegistrySnapshot(services) {
  const db = services?.mcpServers?.db || services?.prompts?.db || null;
  if (!db || typeof db.list !== 'function') {
    return { mcpServers: [], prompts: [] };
  }
  try {
    return {
      mcpServers: db.list('registryMcpServers') || [],
      prompts: db.list('registryPrompts') || [],
    };
  } catch {
    return { mcpServers: [], prompts: [] };
  }
}

async function runChat(options) {
  let resolvedOptions = { ...options };
  // Ensure status exists early so UI can enqueue control commands while initialization is running.
  writeTerminalStatusFile({ state: 'starting' });
  const { services, defaultPaths } = getAdminServices();
  const runtimeLogger = createRuntimeLogger({
    sessionRoot: process.env.MODEL_CLI_SESSION_ROOT || process.cwd(),
    scope: 'CLI',
  });
  runtimeLogger?.info('cli.start', {
    runId: process.env.MODEL_CLI_RUN_ID || '',
    cwd: process.cwd(),
    hostApp: process.env.MODEL_CLI_HOST_APP || '',
  });
  applySecretsToProcessEnv(services);
  const runtimeConfig = services.settings.getRuntimeConfig
    ? services.settings.getRuntimeConfig()
    : null;
  const runtimeOptions = applyRuntimeSettings(runtimeConfig);
  const interactiveTerminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const uiRequested = resolvedOptions.ui === true;
  if (uiRequested && !interactiveTerminal) {
    console.log(colors.yellow('UI 启动向导需要交互式终端，已自动跳过。'));
  }
  const config = createAppConfigFromModels(services.models.list(), services.secrets.list());
  if (!resolvedOptions.model) {
    resolvedOptions.model =
      config.defaultModel || Object.keys(config.models)[0] || DEFAULT_MODEL_NAME;
  }
  const promptRecords = services.prompts.list();
  const mcpServerRecords = services.mcpServers.list();
  const landConfigRecords = services.landConfigs?.list ? services.landConfigs.list() : [];
  const promptStore = loadPromptProfilesFromDb(promptRecords);
  const promptLanguage = runtimeOptions.promptLanguage || null;
  const landConfigId = typeof runtimeOptions.landConfigId === 'string' ? runtimeOptions.landConfigId.trim() : '';
  const selectedLandConfig = resolveLandConfig({ landConfigs: landConfigRecords, landConfigId });
  const registrySnapshot = readRegistrySnapshot(services);
  const landSelection = selectedLandConfig
    ? buildLandConfigSelection({
        landConfig: selectedLandConfig,
        prompts: promptRecords,
        mcpServers: mcpServerRecords,
        registryMcpServers: registrySnapshot.mcpServers,
        registryPrompts: registrySnapshot.prompts,
        promptLanguage,
      })
    : null;
  const landConfigActive = Boolean(landSelection);
  runtimeLogger?.info('land_config.resolve', {
    active: landConfigActive,
    id: selectedLandConfig?.id || landConfigId || '',
    name: selectedLandConfig?.name || '',
    mainPrompts: landSelection?.main?.promptNames?.length || 0,
    mainMcpServers: landSelection?.main?.selectedServerNames?.length || 0,
    subPrompts: landSelection?.sub?.promptNames?.length || 0,
    subMcpServers: landSelection?.sub?.selectedServerNames?.length || 0,
  });
  const mainPromptWithMcp = landSelection
    ? appendPromptBlock(landSelection.main.promptText, landSelection.main.mcpPromptText)
    : '';
  const subagentPromptWithMcp = landSelection
    ? appendPromptBlock(landSelection.sub.promptText, landSelection.sub.mcpPromptText)
    : '';
  if (!landConfigActive && resolvedOptions.system) {
    console.log(colors.yellow('[prompts] land_config 未启用，已忽略内置/默认 prompt；仅使用 --system 覆盖。'));
    runtimeLogger?.warn('land_config.inactive', { systemOverride: true });
  }
  if (landConfigActive && resolvedOptions.system) {
    console.log(colors.yellow('[prompts] land_config 已启用，忽略 --system 覆盖。'));
    runtimeLogger?.warn('land_config.override_ignored', { systemOverride: true });
  }
  if (!landConfigActive && !resolvedOptions.system) {
    console.log(colors.yellow('[prompts] land_config 未启用，system prompt 为空。'));
    runtimeLogger?.warn('land_config.inactive', { systemOverride: false });
  }
  const mcpSummary = loadMcpConfig(defaultPaths.mcpConfig);
  const subAgentManager = createSubAgentManager({
    internalSystemPrompt: '',
  });
  const subAgentList = subAgentManager.listAgents();
  const resolvedConfigPath = defaultPaths.models;
  const sessionReportPath = path.join(path.dirname(resolvedConfigPath), 'session-report.html');
  const tasksPath = null; // 任务只存 admin.db，不再写 tasks.json
  const eventLogPath =
    process.env.MODEL_CLI_EVENT_LOG ||
    defaultPaths.events ||
    path.join(resolveAppStateDir(process.env.MODEL_CLI_SESSION_ROOT || process.cwd()), 'events.jsonl');
  const eventLogger = createEventLogger(eventLogPath);
  let toolHistoryRef = null;
  let mcpRuntime = null;
  try {
    // 使用会话根（默认主目录或显式指定的 MODEL_CLI_SESSION_ROOT）作为 MCP 状态根，
    // 工作目录仍由 mcp.config 中的 --root 结合当前工作目录解析。
    const normalizeServerKey = (value) => String(value || '').trim().toLowerCase();
    const selectedServerKeys = landSelection
      ? new Set(
          [
            ...(landSelection.main?.selectedServers || []),
            ...(landSelection.sub?.selectedServers || []),
          ]
            .map((entry) => normalizeServerKey(entry?.server?.name))
            .filter(Boolean)
        )
      : null;
    const skipServers = landSelection
      ? Array.isArray(mcpSummary?.servers)
        ? mcpSummary.servers
            .filter((srv) => srv?.name && !selectedServerKeys.has(normalizeServerKey(srv.name)))
            .map((srv) => srv.name)
        : []
      : Array.isArray(mcpSummary?.servers)
        ? mcpSummary.servers
            .filter(
              (srv) =>
                srv?.name &&
                srv.enabled !== false &&
                srv.allowMain !== true &&
                srv.allowSub === false
            )
            .map((srv) => srv.name)
        : [];
    mcpRuntime = await initializeMcpRuntime(
      resolvedConfigPath,
      process.env.MODEL_CLI_SESSION_ROOT,
      process.cwd(),
      {
        caller: 'main',
        skipServers,
        extraServers: landSelection?.extraMcpServers || [],
        eventLogger,
      }
    );
    if (mcpRuntime) {
      mcpRuntime.applyToConfig(config);
    }
  } catch (err) {
    mcpLog.error('初始化失败', err);
    runtimeLogger?.error('mcp.init_failed', { mode: 'main' }, err);
  }
  const client = new ModelClient(config);
  const targetSettings = config.getModel(resolvedOptions.model || null);

  const mainAllowed = ['invoke_sub_agent', 'get_current_time'];
  const legacyAllowedServers = new Set(['subagent_router', 'task_manager', 'project_files']);
  const normalizeServerName = (value) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_');
  const allowExternalOnly = allowExternalOnlyMcpServers();
  const serverAllowsMain = (server) => {
    if (isExternalOnlyMcpServerName(server?.name) && !allowExternalOnly) {
      return false;
    }
    const explicit = server?.allowMain;
    if (explicit === true || explicit === false) {
      return explicit;
    }
    const name = normalizeServerName(server?.name);
    return legacyAllowedServers.has(name);
  };
  const allowPrefixes = landSelection
    ? Array.from(new Set((landSelection.main?.selectedServerNames || []).map((name) => `mcp_${name}_`)))
    : Array.isArray(mcpSummary?.servers)
      ? mcpSummary.servers
          .filter((srv) => srv?.name && serverAllowsMain(srv))
          .map((srv) => `mcp_${normalizeServerName(srv.name)}_`)
      : ['mcp_subagent_router_', 'mcp_task_manager_', 'mcp_project_files_'];
  const subagentAllowPrefixes = landSelection
    ? (() => {
        const prefixes = Array.from(
          new Set((landSelection.sub?.selectedServerNames || []).map((name) => `mcp_${name}_`))
        );
        return prefixes.length > 0 ? prefixes : ['__none__'];
      })()
    : Array.isArray(mcpSummary?.servers)
      ? mcpSummary.servers
          .filter(
            (srv) =>
              srv?.name &&
              srv.allowSub !== false &&
              (allowExternalOnly || !isExternalOnlyMcpServerName(srv.name))
          )
          .map((srv) => `mcp_${normalizeServerName(srv.name)}_`)
      : null;
  const registeredTools = new Set(listTools());
  const filterMainTools = (modelName) => {
    const settings = config.getModel(modelName || targetSettings.name);
    const current = Array.isArray(settings.tools) ? settings.tools.slice() : [];
    const next = new Set();
    const addIfRegistered = (name) => {
      const normalized = String(name || '');
      if (!normalized) return;
      if (!registeredTools.has(normalized)) return;
      next.add(normalized);
    };
    mainAllowed.forEach(addIfRegistered);
    current.forEach((name) => {
      const toolName = String(name || '');
      if (!toolName) return;
      if (
        mainAllowed.includes(toolName) ||
        allowPrefixes.some((prefix) => toolName.startsWith(prefix))
      ) {
        addIfRegistered(toolName);
      }
    });
    return Array.from(next);
  };
  // Apply once to initial model settings to avoid leaking broader tool list
  targetSettings.tools = filterMainTools(targetSettings.name);

  const systemOverride = landConfigActive ? undefined : resolvedOptions.system;
  const sessionSystem = landConfigActive
    ? (typeof mainPromptWithMcp === 'string' ? mainPromptWithMcp : '')
    : systemOverride !== undefined
      ? String(systemOverride || '')
      : '';

  // Generate config snapshot report for quick inspection
  try {
    const promptLabel = landConfigActive
      ? `land_config:${selectedLandConfig?.id || landConfigId || 'unknown'}`
      : systemOverride !== undefined
        ? '(system_override)'
        : '(none)';
    const promptText = landConfigActive ? mainPromptWithMcp : (typeof systemOverride === 'string' ? systemOverride : '');
    const html = generateConfigReport({
      modelsPath: resolvedConfigPath,
      models: config.models,
      activeModel: targetSettings.name,
      mcpPath: mcpSummary?.path,
      mcpServers: mcpSummary?.servers,
      systemPromptPath: promptLabel,
      systemPrompt: promptText,
      promptProfiles: promptStore?.prompts,
      subAgents: subAgentList,
    });
    const reportPath = path.join(path.dirname(resolvedConfigPath), 'config-report.html');
    writeReport(reportPath, html);
    console.log(colors.green(`Config snapshot written to: ${reportPath}`));
  } catch (err) {
    console.error(colors.yellow(`[report] Failed to write config snapshot: ${err.message}`));
  }

  const userPromptText = landConfigActive ? mainPromptWithMcp : '';
  const subagentUserPromptText = landConfigActive ? subagentPromptWithMcp : '';

  if (landSelection) {
    if ((landSelection.main?.missingMcpPromptNames || []).length > 0) {
      console.log(
        colors.yellow(
          `[prompts] Missing MCP prompt(s) for main: ${landSelection.main.missingMcpPromptNames.join(', ')}`
        )
      );
      runtimeLogger?.warn('land_config.missing_mcp_prompts', {
        scope: 'main',
        prompts: landSelection.main.missingMcpPromptNames,
      });
    }
    if ((landSelection.sub?.missingMcpPromptNames || []).length > 0) {
      console.log(
        colors.yellow(
          `[prompts] Missing MCP prompt(s) for subagent: ${landSelection.sub.missingMcpPromptNames.join(', ')}`
        )
      );
      runtimeLogger?.warn('land_config.missing_mcp_prompts', {
        scope: 'sub',
        prompts: landSelection.sub.missingMcpPromptNames,
      });
    }
    if ((landSelection.main?.missingAppServers || []).length > 0) {
      console.log(
        colors.yellow(
          `[land_config] Missing app MCP servers (main): ${landSelection.main.missingAppServers.join(', ')}`
        )
      );
      runtimeLogger?.warn('land_config.missing_app_mcp', {
        scope: 'main',
        apps: landSelection.main.missingAppServers,
      });
    }
    if ((landSelection.sub?.missingAppServers || []).length > 0) {
      console.log(
        colors.yellow(
          `[land_config] Missing app MCP servers (sub): ${landSelection.sub.missingAppServers.join(', ')}`
        )
      );
      runtimeLogger?.warn('land_config.missing_app_mcp', {
        scope: 'sub',
        apps: landSelection.sub.missingAppServers,
      });
    }
    if ((landSelection.main?.missingPromptNames || []).length > 0) {
      console.log(
        colors.yellow(
          `[land_config] Missing prompts (main): ${landSelection.main.missingPromptNames.join(', ')}`
        )
      );
      runtimeLogger?.warn('land_config.missing_prompts', {
        scope: 'main',
        prompts: landSelection.main.missingPromptNames,
      });
    }
    if ((landSelection.sub?.missingPromptNames || []).length > 0) {
      console.log(
        colors.yellow(
          `[land_config] Missing prompts (sub): ${landSelection.sub.missingPromptNames.join(', ')}`
        )
      );
      runtimeLogger?.warn('land_config.missing_prompts', {
        scope: 'sub',
        prompts: landSelection.sub.missingPromptNames,
      });
    }
  }

  const session = new ChatSession(sessionSystem);
  console.log(`Using config DB at: ${defaultPaths.adminDb}`);
  const streamEnabled =
    resolvedOptions.stream !== undefined ? resolvedOptions.stream : true;
  let sessionReportError = null;
  const updateSessionReport = () => {
    try {
      writeSessionReport({
        session,
        toolHistory: toolHistoryRef,
        tasksPath,
        reportPath: sessionReportPath,
        modelName: targetSettings.name,
      });
    } catch (err) {
      if (!sessionReportError) {
        sessionReportError = err;
        console.error(colors.yellow(`[report] Failed to write session snapshot: ${err.message}`));
      }
    }
  };
  try {
    console.log(colors.green(`Session report will update at: ${sessionReportPath}`));
    console.log(colors.green(`Event log at: ${eventLogPath}`));
    updateSessionReport();
    runtimeLogger?.info('chat_loop.start', { model: targetSettings.name, stream: streamEnabled });
    await chatLoop(client, targetSettings.name, session, {
      systemOverride,
      stream: streamEnabled,
      configPath: resolvedConfigPath,
      systemConfigFromDb: null,
      userPrompt: userPromptText,
      subagentUserPrompt: subagentUserPromptText,
      landConfigActive,
      landConfigPrompt: userPromptText,
      landConfigInfo: landConfigActive
        ? { id: selectedLandConfig?.id || landConfigId || '', name: selectedLandConfig?.name || '' }
        : null,
      subagentMcpAllowPrefixes: subagentAllowPrefixes,
      allowUi: interactiveTerminal,
      promptStore,
      mainTools: filterMainTools,
      summaryThreshold: runtimeOptions.summaryThreshold,
      maxToolPasses: runtimeOptions.maxToolPasses,
      onToolHistoryAvailable: (toolHistory) => {
        toolHistoryRef = toolHistory;
        updateSessionReport();
      },
      updateSessionReport,
      eventLogger,
      runtimeLogger,
      onSessionSnapshot: () => {},
    });
    runtimeLogger?.info('chat_loop.exit', { model: targetSettings.name });
  } catch (err) {
    runtimeLogger?.error('chat_loop.failed', { model: targetSettings.name }, err);
    throw err;
  } finally {
    // If we fail before chatLoop initializes terminalControl, still mark exited so UI won't treat it as an unmanaged run.
    writeTerminalStatusFile({ state: 'exited' });
    if (mcpRuntime) {
      await mcpRuntime.shutdown().catch(() => {});
    }
  }
}

function loadAppConfig(configPath) {
  throw new ConfigError('YAML config loading is disabled; CLI now reads admin.db only.');
}

function renderModelsTable(config) {
  const headers = ['Name', 'Provider', 'Model ID', 'System Prompt'];
  const rows = Object.entries(config.models).map(([name, settings]) => {
    const prompt = (settings.system_prompt || '').trim();
    const preview = prompt.length > 40 ? `${prompt.slice(0, 37)}...` : prompt || '-';
    return [name, settings.provider, settings.model, preview];
  });
  const widths = headers.map((header, index) => {
    const candidate = rows.reduce((max, row) => Math.max(max, row[index].length), header.length);
    return candidate;
  });
  const line = (row) =>
    row
      .map((cell, idx) => cell.padEnd(widths[idx]))
      .join(' | ');
  const divider = widths
    .map((w) => '-'.repeat(w))
    .join('-|-');
  const lines = [line(headers), divider, ...rows.map((row) => line(row))];
  return lines.join('\n');
}
