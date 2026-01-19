import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { createRestrictedSubAgentManager } from './subagent-restriction.js';
import { resolveAllowedTools } from './tool-selection.js';
import { applySecretsToProcessEnv } from '../../packages/common/secrets-env.js';
import { allowExternalOnlyMcpServers, isExternalOnlyMcpServerName } from '../../packages/common/host-app.js';
import { resolveEngineRoot } from '../../src/engine-paths.js';
import { getRegistryCenter } from '../backend/registry-center.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const ENGINE_ROOT = resolveEngineRoot({ projectRoot });
if (!ENGINE_ROOT) {
  throw new Error('Engine sources not found (expected ./packages/aide relative to chatos).');
}

function resolveEngineModule(relativePath) {
  const rel = typeof relativePath === 'string' ? relativePath.trim() : '';
  if (!rel) throw new Error('relativePath is required');
  const srcPath = path.join(ENGINE_ROOT, 'src', rel);
  if (fs.existsSync(srcPath)) return srcPath;
  return path.join(ENGINE_ROOT, 'dist', rel);
}

let engineDepsPromise = null;
async function loadEngineDeps() {
  if (engineDepsPromise) return engineDepsPromise;
  engineDepsPromise = (async () => {
    const [sessionMod, clientMod, configMod, mcpRuntimeMod, subagentRuntimeMod, toolsMod] = await Promise.all([
      import(pathToFileURL(resolveEngineModule('session.js')).href),
      import(pathToFileURL(resolveEngineModule('client.js')).href),
      import(pathToFileURL(resolveEngineModule('config.js')).href),
      import(pathToFileURL(resolveEngineModule('mcp/runtime.js')).href),
      import(pathToFileURL(resolveEngineModule('subagents/runtime.js')).href),
      import(pathToFileURL(resolveEngineModule('tools/index.js')).href),
    ]);
    return {
      ChatSession: sessionMod.ChatSession,
      ModelClient: clientMod.ModelClient,
      createAppConfigFromModels: configMod.createAppConfigFromModels,
      initializeMcpRuntime: mcpRuntimeMod.initializeMcpRuntime,
      runWithSubAgentContext: subagentRuntimeMod.runWithSubAgentContext,
      registerTool: toolsMod.registerTool,
    };
  })();
  return engineDepsPromise;
}

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueIds(list) {
  const out = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((item) => {
    const value = normalizeId(item);
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  });
  return out;
}

function normalizeWorkspaceRoot(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return '';
  return path.resolve(trimmed);
}

function normalizePromptLanguage(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'zh' || raw === 'en') return raw;
  return '';
}

function normalizeMcpServerName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeImageDataUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  if (!raw.startsWith('data:image/')) return '';
  return raw;
}

function normalizeImageAttachments(value) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const id = normalizeId(entry.id);
    const dataUrl = normalizeImageDataUrl(entry.dataUrl || entry.url);
    if (!dataUrl) continue;
    const dedupeKey = id || dataUrl;
    if (dedupeKey && seen.has(dedupeKey)) continue;
    if (dedupeKey) seen.add(dedupeKey);
    out.push({
      id,
      type: 'image',
      name: typeof entry.name === 'string' ? entry.name.trim() : '',
      mimeType: typeof entry.mimeType === 'string' ? entry.mimeType.trim() : '',
      dataUrl,
    });
  }
  return out;
}

function buildUserMessageContent({ text, attachments, allowVisionInput } = {}) {
  const trimmedText = typeof text === 'string' ? text.trim() : '';
  const images = allowVisionInput ? normalizeImageAttachments(attachments) : [];
  const parts = [];
  if (trimmedText) {
    parts.push({ type: 'text', text: trimmedText });
  }
  images.forEach((img) => {
    if (!img?.dataUrl) return;
    parts.push({ type: 'image_url', image_url: { url: img.dataUrl } });
  });
  if (parts.length === 0) return null;
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text;
  return parts;
}


function getMcpPromptNameForServer(serverName, language) {
  const base = `mcp_${normalizeMcpServerName(serverName)}`;
  const lang = normalizePromptLanguage(language);
  if (lang === 'en') return `${base}__en`;
  return base;
}

function buildSystemPrompt({ agent, prompts, subagents, mcpServers, language, extraPromptNames, autoMcpPrompts = true } = {}) {
  const agentRecord = agent && typeof agent === 'object' ? agent : {};
  const inlineAgentPrompt = typeof agentRecord?.prompt === 'string' ? agentRecord.prompt.trim() : '';
  const promptById = new Map((Array.isArray(prompts) ? prompts : []).map((p) => [p.id, p]));
  const promptByName = new Map(
    (Array.isArray(prompts) ? prompts : [])
      .filter((p) => p?.name)
      .map((p) => [String(p.name).trim().toLowerCase(), p])
  );
  const promptSections = (Array.isArray(agentRecord.promptIds) ? agentRecord.promptIds : [])
    .map((id) => promptById.get(id))
    .map((p) => (typeof p?.content === 'string' ? p.content.trim() : ''))
    .filter(Boolean);
  const selectedPromptNames = new Set(
    (Array.isArray(agentRecord.promptIds) ? agentRecord.promptIds : [])
      .map((id) => promptById.get(id))
      .map((p) => String(p?.name || '').trim().toLowerCase())
      .filter(Boolean)
  );

  const extraPromptSections = [];
  const addedExtra = new Set();
  (Array.isArray(extraPromptNames) ? extraPromptNames : []).forEach((name) => {
    const key = String(name || '').trim().toLowerCase();
    if (!key || selectedPromptNames.has(key) || addedExtra.has(key)) return;
    const record = promptByName.get(key);
    const content = typeof record?.content === 'string' ? record.content.trim() : '';
    if (!content) return;
    extraPromptSections.push(content);
    addedExtra.add(key);
  });

  const enabledSubagents = new Map(
    (Array.isArray(subagents) ? subagents : [])
      .filter((s) => s?.enabled !== false && s?.id)
      .map((s) => [s.id, s])
  );
  const selectedSubagents = (Array.isArray(agentRecord.subagentIds) ? agentRecord.subagentIds : [])
    .map((id) => enabledSubagents.get(id))
    .filter(Boolean);
  const skills = Array.isArray(agentRecord.skills) ? agentRecord.skills.map((s) => String(s).trim()).filter(Boolean) : [];

  const mcpById = new Map((Array.isArray(mcpServers) ? mcpServers : []).filter((s) => s?.id).map((s) => [s.id, s]));
  const serverAllowed = (server) => {
    if (isExternalOnlyMcpServerName(server?.name) && !allowExternalOnlyMcpServers()) {
      return false;
    }
    return true;
  };
  const selectedMcp = (Array.isArray(agentRecord.mcpServerIds) ? agentRecord.mcpServerIds : [])
    .map((id) => mcpById.get(id))
    .filter((srv) => srv && srv.enabled !== false && serverAllowed(srv));

  const mcpPromptTexts = [];
  if (autoMcpPrompts && selectedMcp.length > 0) {
    const lang = normalizePromptLanguage(language);
    selectedMcp.forEach((server) => {
      const preferredName = getMcpPromptNameForServer(server?.name, lang).toLowerCase();
      const fallbackName = getMcpPromptNameForServer(server?.name).toLowerCase();
      const candidates = preferredName === fallbackName ? [preferredName] : [preferredName, fallbackName];
      for (const name of candidates) {
        if (selectedPromptNames.has(name)) continue;
        if (addedExtra.has(name)) continue;
        const record = promptByName.get(name);
        const content = typeof record?.content === 'string' ? record.content.trim() : '';
        if (!content) continue;
        mcpPromptTexts.push(content);
        break;
      }
    });
  }

  const capabilityLines = [];
  if (selectedSubagents.length > 0) {
    const names = selectedSubagents.map((s) => s.name || s.id).filter(Boolean).slice(0, 12);
    capabilityLines.push(`- 可用子代理: ${names.join(', ')}`);
  }
  if (skills.length > 0) {
    capabilityLines.push(`- 偏好 skills: ${skills.slice(0, 24).join(', ')}`);
  }
  if (selectedMcp.length > 0) {
    const names = selectedMcp.map((s) => s.name || s.id).filter(Boolean).slice(0, 12);
    capabilityLines.push(`- 可用 MCP servers: ${names.join(', ')}`);
  }

  const blocks = [];
  if (inlineAgentPrompt) {
    blocks.push(inlineAgentPrompt);
  }
  if (promptSections.length > 0) {
    blocks.push(promptSections.join('\n\n'));
  }
  if (extraPromptSections.length > 0) {
    blocks.push(extraPromptSections.join('\n\n'));
  }
  if (mcpPromptTexts.length > 0) {
    blocks.push(mcpPromptTexts.join('\n\n'));
  }
  if (capabilityLines.length > 0) {
    blocks.push(['【能力范围】', ...capabilityLines].join('\n'));
  }
  return blocks.join('\n\n').trim();
}

export function createChatRunner({
  adminServices,
  defaultPaths,
  sessionRoot,
  workspaceRoot,
  subAgentManager,
  uiApps,
  store,
  sendEvent,
} = {}) {
  if (!adminServices) throw new Error('adminServices is required');
  if (!defaultPaths?.models) throw new Error('defaultPaths.models is required');
  if (!store) throw new Error('store is required');
  if (typeof sendEvent !== 'function') throw new Error('sendEvent is required');

  const activeRuns = new Map();
  let mcpRuntime = null;
  let mcpInitPromise = null;
  let mcpWorkspaceRoot = '';
  let mcpInitWorkspaceRoot = '';
  let mcpConfigMtimeMs = null;
  let mcpSignature = '';
  let mcpInitSignature = '';
  const MCP_INIT_TIMEOUT_MS = 4_000;
  const MCP_INIT_TIMEOUT = Symbol('mcp_init_timeout');

  const resolveUiAppAi = uiApps && typeof uiApps.getAiContribution === 'function' ? uiApps.getAiContribution.bind(uiApps) : null;
  let registry = null;
  try {
    const registryDb = adminServices?.mcpServers?.db || null;
    registry = registryDb ? getRegistryCenter({ db: registryDb }) : null;
  } catch {
    registry = null;
  }
  let uiAppsTrustMap = new Map();
  const refreshUiAppsTrust = async () => {
    uiAppsTrustMap = new Map();
    if (!uiApps || typeof uiApps.listRegistry !== 'function') return;
    try {
      const snapshot = await uiApps.listRegistry();
      const plugins = Array.isArray(snapshot?.plugins) ? snapshot.plugins : [];
      uiAppsTrustMap = new Map(
        plugins
          .map((plugin) => [normalizeId(plugin?.id), plugin?.trusted === true])
          .filter(([id]) => id)
      );
    } catch {
      uiAppsTrustMap = new Map();
    }
  };
  const isUiAppTrusted = (pluginId) => {
    const pid = normalizeId(pluginId);
    if (!pid) return false;
    return uiAppsTrustMap.get(pid) === true;
  };
  const normalizeRegistryName = (value) => String(value || '').trim().toLowerCase();
  const resolveUiAppRegistryAccess = (pluginId, appId) => {
    if (!registry) return null;
    const pid = normalizeId(pluginId);
    const aid = normalizeId(appId);
    if (!pid || !aid) return null;
    const appKey = `${pid}.${aid}`;
    let servers = [];
    let prompts = [];
    try {
      servers = registry.getMcpServersForApp(appKey) || [];
    } catch {
      servers = [];
    }
    try {
      prompts = registry.getPromptsForApp(appKey) || [];
    } catch {
      prompts = [];
    }
    const serversByName = new Map(
      servers
        .filter((srv) => srv?.name)
        .map((srv) => [normalizeRegistryName(srv.name), srv])
    );
    const promptsByName = new Map(
      prompts
        .filter((p) => p?.name)
        .map((p) => [normalizeRegistryName(p.name), p])
    );
    const serversById = new Map(
      servers
        .filter((srv) => srv?.id)
        .map((srv) => [String(srv.id), srv])
    );
    const promptsById = new Map(
      prompts
        .filter((p) => p?.id)
        .map((p) => [String(p.id), p])
    );
    const serverIds = new Set(Array.from(serversById.keys()));
    const promptIds = new Set(Array.from(promptsById.keys()));
    return {
      appKey,
      servers,
      prompts,
      serversByName,
      promptsByName,
      serversById,
      promptsById,
      serverIds,
      promptIds,
    };
  };

  const computeMcpSignature = (servers, skipServers) => {
    const list = Array.isArray(servers) ? servers : [];
    const items = list
      .map((entry) => {
        const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
        const url = typeof entry?.url === 'string' ? entry.url.trim() : '';
        if (!name || !url) return null;
        return `${name}\u0000${url}`;
      })
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    const skips = Array.isArray(skipServers)
      ? skipServers
          .map((value) => String(value || '').trim().toLowerCase())
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b))
      : [];
    return `${items.join('\u0001')}\u0002${skips.join('\u0001')}`;
  };

  const resolveMcpConfigPath = () => {
    const explicit = typeof defaultPaths?.mcpConfig === 'string' ? defaultPaths.mcpConfig.trim() : '';
    if (explicit) return explicit;
    const anchor = typeof defaultPaths?.models === 'string' ? defaultPaths.models.trim() : '';
    if (!anchor) return '';
    return path.join(path.dirname(anchor), 'mcp.config.json');
  };

  const readMcpConfigMtimeMs = () => {
    const configPath = resolveMcpConfigPath();
    if (!configPath) return null;
    try {
      const stat = fs.statSync(configPath);
      return Number.isFinite(stat?.mtimeMs) ? stat.mtimeMs : null;
    } catch {
      return null;
    }
  };

  const dispose = async () => {
    for (const entry of activeRuns.values()) {
      try {
        entry.controller?.abort();
      } catch {
        // ignore
      }
    }
    activeRuns.clear();
    try {
      await mcpRuntime?.shutdown?.();
    } catch {
      // ignore
    }
    mcpRuntime = null;
    mcpInitPromise = null;
    mcpWorkspaceRoot = '';
    mcpInitWorkspaceRoot = '';
    mcpConfigMtimeMs = null;
    mcpSignature = '';
    mcpInitSignature = '';
  };

  const abort = (sessionId) => {
    const sid = normalizeId(sessionId);
    const entry = activeRuns.get(sid);
    if (!entry) return { ok: false, message: 'no active run' };
    try {
      entry.controller.abort();
    } catch {
      // ignore
    }
    return { ok: true };
  };

  const ensureMcp = async ({
    timeoutMs = MCP_INIT_TIMEOUT_MS,
    workspaceRoot: desiredWorkspaceRoot,
    extraServers,
    skipServers,
    emitEvent,
  } = {}) => {
    const notify = typeof emitEvent === 'function' ? emitEvent : sendEvent;
    const effectiveWorkspaceRoot =
      normalizeWorkspaceRoot(desiredWorkspaceRoot) || normalizeWorkspaceRoot(workspaceRoot) || process.cwd();
    const signature = computeMcpSignature(extraServers, skipServers);
    const currentMtime = readMcpConfigMtimeMs();
    const workspaceMatches = normalizeWorkspaceRoot(mcpWorkspaceRoot) === effectiveWorkspaceRoot;
    const configMatches =
      currentMtime === null || mcpConfigMtimeMs === null ? true : currentMtime === mcpConfigMtimeMs;
    const signatureMatches = mcpSignature === signature;
    if (mcpRuntime && workspaceMatches && configMatches && signatureMatches) return mcpRuntime;
    if (
      mcpInitPromise &&
      (normalizeWorkspaceRoot(mcpInitWorkspaceRoot) !== effectiveWorkspaceRoot || mcpInitSignature !== signature)
    ) {
      try {
        await mcpInitPromise;
      } catch {
        // ignore
      }
    }
    if (mcpRuntime && (!workspaceMatches || !configMatches || !signatureMatches)) {
      try {
        await mcpRuntime?.shutdown?.();
      } catch {
        // ignore
      }
      mcpRuntime = null;
      mcpWorkspaceRoot = '';
      mcpConfigMtimeMs = null;
      mcpSignature = '';
    }
    if (!mcpInitPromise) {
      mcpInitWorkspaceRoot = effectiveWorkspaceRoot;
      mcpInitSignature = signature;
      mcpInitPromise = (async () => {
        try {
          const { initializeMcpRuntime } = await loadEngineDeps();
          const configPath = resolveMcpConfigPath() || defaultPaths.models;
          mcpRuntime = await initializeMcpRuntime(configPath, sessionRoot, effectiveWorkspaceRoot, {
            caller: 'main',
            extraServers,
            skipServers,
          });
          mcpWorkspaceRoot = effectiveWorkspaceRoot;
          mcpConfigMtimeMs = readMcpConfigMtimeMs();
          mcpSignature = signature;
        } catch (err) {
          mcpRuntime = null;
          mcpWorkspaceRoot = '';
          mcpConfigMtimeMs = null;
          mcpSignature = '';
          notify({
            type: 'notice',
            message: `[MCP] 初始化失败（root=${effectiveWorkspaceRoot}）：${err?.message || String(err)}`,
          });
        } finally {
          mcpInitPromise = null;
          mcpInitWorkspaceRoot = '';
          mcpInitSignature = '';
        }
        return mcpRuntime;
      })();
    }
    if (!timeoutMs || timeoutMs <= 0) {
      return mcpInitPromise;
    }
    let timer = null;
    try {
      const result = await Promise.race([
        mcpInitPromise,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(MCP_INIT_TIMEOUT), timeoutMs);
        }),
      ]);
      if (result === MCP_INIT_TIMEOUT) {
        notify({
          type: 'notice',
          message: `[MCP] 初始化超过 ${timeoutMs}ms，已跳过（后台仍会继续初始化）。`,
        });
        return null;
      }
      return result;
    } finally {
      if (timer) {
        try {
          clearTimeout(timer);
        } catch {
          // ignore
        }
      }
    }
  };

  const start = async ({
    sessionId,
    agentId,
    userMessageId,
    assistantMessageId,
    text,
    attachments,
    onComplete,
  } = {}) => {
    const sid = normalizeId(sessionId);
    const normalizedText = typeof text === 'string' ? text.trim() : '';
    const initialAssistantMessageId = normalizeId(assistantMessageId);
    if (!sid) throw new Error('sessionId is required');
    if (!normalizedText && (!Array.isArray(attachments) || attachments.length === 0)) {
      throw new Error('text is required');
    }
    if (!initialAssistantMessageId) throw new Error('assistantMessageId is required');

    if (activeRuns.has(sid)) {
      abort(sid);
    }

    const controller = new AbortController();
    activeRuns.set(sid, { controller, messageId: initialAssistantMessageId });
    const completionCallback = typeof onComplete === 'function' ? onComplete : null;

    const baseSendEvent = sendEvent;
    const sessionRecord = store.sessions.get(sid);
    const scopedSendEvent = baseSendEvent;

    const sessionWorkspaceRoot = normalizeWorkspaceRoot(sessionRecord?.workspaceRoot);
    const requestedAgentId = normalizeId(agentId);
    const effectiveAgentId = requestedAgentId || normalizeId(sessionRecord?.agentId);
    if (!effectiveAgentId) {
      throw new Error('agentId is required');
    }
    const agentRecord = effectiveAgentId ? store.agents.get(effectiveAgentId) : null;
    if (!agentRecord) {
      throw new Error('agent not found for session');
    }
    const agentWorkspaceRoot = normalizeWorkspaceRoot(agentRecord?.workspaceRoot);
    const effectiveWorkspaceRoot =
      agentWorkspaceRoot || sessionWorkspaceRoot || normalizeWorkspaceRoot(workspaceRoot) || process.cwd();

    const models = adminServices.models.list();
    const modelRecord = models.find((m) => m?.id === agentRecord.modelId);
    if (!modelRecord) {
      throw new Error('model not found for agent');
    }
    const allowVisionInput = modelRecord.supportsVision === true;

    const {
      ChatSession,
      ModelClient,
      createAppConfigFromModels,
      runWithSubAgentContext,
    } = await loadEngineDeps();

    applySecretsToProcessEnv(adminServices);
    const secrets = adminServices.secrets?.list ? adminServices.secrets.list() : [];
    const config = createAppConfigFromModels(models, secrets);
    const client = new ModelClient(config);

    const runtimeConfig = adminServices.settings?.getRuntimeConfig ? adminServices.settings.getRuntimeConfig() : null;
    const promptLanguage = runtimeConfig?.promptLanguage || null;

    const prompts = adminServices.prompts.list();
    const subagents = adminServices.subagents.list();
    const mcpServers = adminServices.mcpServers.list();
    const serverById = new Map(
      (Array.isArray(mcpServers) ? mcpServers : [])
        .filter((srv) => srv?.id)
        .map((srv) => [String(srv.id), srv])
    );
    const serverByName = new Map(
      (Array.isArray(mcpServers) ? mcpServers : [])
        .filter((srv) => srv?.name && srv?.id)
        .map((srv) => [String(srv.name).trim().toLowerCase(), srv])
    );
    const promptById = new Map(
      (Array.isArray(prompts) ? prompts : [])
        .filter((p) => p?.id)
        .map((p) => [String(p.id), p])
    );
    const promptByName = new Map(
      (Array.isArray(prompts) ? prompts : [])
        .filter((p) => p?.name)
        .map((p) => [String(p.name).trim().toLowerCase(), p])
    );
    const derivedMcpServerIds = [];
    const derivedPromptIds = [];
    const derivedPromptNames = [];
    const missingUiAppServers = [];
    const missingUiAppPrompts = [];
    const deniedUiAppServers = [];
    const deniedUiAppPrompts = [];
    const extraMcpServers = [];
    const extraMcpRuntimeServers = [];
    const extraPrompts = [];
    const untrustedUiApps = new Set();

    await refreshUiAppsTrust();

    const uiRefs = Array.isArray(agentRecord?.uiApps) ? agentRecord.uiApps : [];
    for (const ref of uiRefs) {
      const pluginId = normalizeId(ref?.pluginId);
      const appId = normalizeId(ref?.appId);
      if (!pluginId || !appId) continue;
      if (!isUiAppTrusted(pluginId)) {
        untrustedUiApps.add(`${pluginId}.${appId}`);
        continue;
      }
      const serverName = `${pluginId}.${appId}`;
      const registryAccess = resolveUiAppRegistryAccess(pluginId, appId);
      const wantsMcp = ref?.mcp !== false;
      const wantsPrompt = ref?.prompt !== false;

      let resolvedContribution = undefined;
      const resolveContribution = async () => {
        if (resolvedContribution !== undefined) return resolvedContribution;
        if (!resolveUiAppAi) {
          resolvedContribution = null;
          return null;
        }
        try {
          resolvedContribution = await resolveUiAppAi({ pluginId, appId });
          return resolvedContribution;
        } catch {
          resolvedContribution = null;
          return null;
        }
      };

      if (wantsMcp) {
        const explicitMcpIds = Array.isArray(ref?.mcpServerIds)
          ? ref.mcpServerIds.map((id) => normalizeId(id)).filter(Boolean)
          : [];
        const explicitAllowedIds = [];
        if (explicitMcpIds.length > 0) {
          explicitMcpIds.forEach((id) => {
            const adminServer = serverById.get(id);
            if (adminServer) {
              if (registryAccess) {
                const allowedByName = registryAccess.serversByName.get(
                  String(adminServer?.name || '').trim().toLowerCase()
                );
                if (allowedByName) {
                  explicitAllowedIds.push(id);
                }
              } else {
                explicitAllowedIds.push(id);
              }
              return;
            }
            if (registryAccess && registryAccess.serverIds.has(id)) {
              explicitAllowedIds.push(id);
            }
          });
        }

        if (explicitAllowedIds.length > 0) {
          explicitAllowedIds.forEach((id) => derivedMcpServerIds.push(id));
          if (registryAccess?.serversById) {
            explicitAllowedIds.forEach((id) => {
              if (serverById.has(id)) return;
              const record = registryAccess.serversById.get(id);
              if (!record?.url) return;
              extraMcpServers.push({
                id: record.id,
                name: record.name || record.provider_server_id || record.id,
                url: record.url,
                description: typeof record?.description === 'string' ? record.description : '',
                tags: Array.isArray(record?.tags) ? record.tags : [],
                enabled: record?.enabled !== false,
                allowMain: true,
                allowSub: true,
                auth: record?.auth || undefined,
                callMeta: record?.callMeta || undefined,
              });
              extraMcpRuntimeServers.push({
                name: record.name || record.provider_server_id || record.id,
                url: record.url,
                description: typeof record?.description === 'string' ? record.description : '',
                tags: Array.isArray(record?.tags) ? record.tags : [],
                enabled: record?.enabled !== false,
                allowMain: true,
                allowSub: true,
                auth: record?.auth || undefined,
                callMeta: record?.callMeta || undefined,
              });
            });
          }
        } else {
          const srv = serverByName.get(serverName.toLowerCase());
          const registryAllowed = registryAccess?.serversByName?.get(serverName.toLowerCase()) || null;
          if (srv?.id) {
            if (registryAccess && !registryAllowed) {
              deniedUiAppServers.push(serverName);
            } else {
              derivedMcpServerIds.push(srv.id);
            }
          } else {
            const contribute = await resolveContribution();
            const mcp = contribute?.mcp && typeof contribute.mcp === 'object' ? contribute.mcp : null;
            const mcpUrl = typeof mcp?.url === 'string' ? mcp.url.trim() : '';
            if (registryAccess && !registryAllowed) {
              deniedUiAppServers.push(serverName);
            } else if (mcpUrl) {
              const uiId = registryAllowed?.id || `uiapp:${serverName}`;
              const tags = Array.isArray(mcp?.tags) ? mcp.tags : [];
              const mergedTags = [
                ...tags,
                'uiapp',
                `uiapp:${pluginId}`,
                `uiapp:${pluginId}:${appId}`,
                `uiapp:${pluginId}.${appId}`,
              ];
              const enabled =
                typeof registryAllowed?.enabled === 'boolean'
                  ? registryAllowed.enabled
                  : typeof mcp?.enabled === 'boolean'
                    ? mcp.enabled
                    : true;
              const auth = registryAllowed?.auth || mcp?.auth || undefined;

              extraMcpServers.push({
                id: uiId,
                name: registryAllowed?.name || mcp?.name || serverName,
                url: registryAllowed?.url || mcpUrl,
                description: typeof registryAllowed?.description === 'string'
                  ? registryAllowed.description
                  : typeof mcp?.description === 'string'
                    ? mcp.description
                    : '',
                tags: Array.isArray(registryAllowed?.tags) ? registryAllowed.tags : mergedTags,
                enabled,
                allowMain: true,
                allowSub: true,
                auth,
                callMeta: registryAllowed?.callMeta || mcp?.callMeta || undefined,
              });
              extraMcpRuntimeServers.push({
                name: registryAllowed?.name || mcp?.name || serverName,
                url: registryAllowed?.url || mcpUrl,
                description: typeof registryAllowed?.description === 'string'
                  ? registryAllowed.description
                  : typeof mcp?.description === 'string'
                    ? mcp.description
                    : '',
                tags: Array.isArray(registryAllowed?.tags) ? registryAllowed.tags : mergedTags,
                enabled,
                allowMain: true,
                allowSub: true,
                auth,
                callMeta: registryAllowed?.callMeta || mcp?.callMeta || undefined,
              });
              derivedMcpServerIds.push(uiId);
            } else {
              missingUiAppServers.push(serverName);
            }
          }
        }
      }

      if (wantsPrompt) {
        const explicitPromptIds = Array.isArray(ref?.promptIds)
          ? ref.promptIds.map((id) => normalizeId(id)).filter(Boolean)
          : [];
        const explicitAllowedPromptIds = [];
        if (explicitPromptIds.length > 0) {
          explicitPromptIds.forEach((id) => {
            const adminPrompt = promptById.get(id);
            if (adminPrompt) {
              if (registryAccess) {
                const allowedByName = registryAccess.promptsByName.get(
                  String(adminPrompt?.name || '').trim().toLowerCase()
                );
                if (allowedByName) {
                  explicitAllowedPromptIds.push(id);
                } else {
                  deniedUiAppPrompts.push(adminPrompt?.name || id);
                }
              } else {
                explicitAllowedPromptIds.push(id);
              }
              return;
            }

            if (registryAccess && registryAccess.promptIds.has(id)) {
              explicitAllowedPromptIds.push(id);
              const record = registryAccess.promptsById?.get(id);
              if (record?.content) {
                extraPrompts.push({
                  id: record.id,
                  name: record.name || record.provider_prompt_id || id,
                  title: typeof record?.title === 'string' ? record.title : '',
                  type: 'system',
                  content: String(record.content || '').trim(),
                  allowMain: true,
                  allowSub: true,
                  tags: Array.isArray(record?.tags) ? record.tags : [],
                });
              }
              return;
            }

            if (registryAccess) {
              deniedUiAppPrompts.push(id);
            }
          });
        }

        if (explicitAllowedPromptIds.length > 0) {
          explicitAllowedPromptIds.forEach((id) => derivedPromptIds.push(id));
          continue;
        }

        const preferredName = getMcpPromptNameForServer(serverName, promptLanguage).toLowerCase();
        const fallbackName = getMcpPromptNameForServer(serverName).toLowerCase();
        if (registryAccess) {
          const allowedPrompt =
            registryAccess.promptsByName.get(preferredName) ||
            (preferredName === fallbackName ? null : registryAccess.promptsByName.get(fallbackName));
          if (!allowedPrompt) {
            deniedUiAppPrompts.push(preferredName);
            continue;
          }
          const allowedName = String(allowedPrompt?.name || '').trim().toLowerCase() || preferredName;
          const localPrompt = promptByName.get(allowedName);
          const localContent = typeof localPrompt?.content === 'string' ? localPrompt.content.trim() : '';
          if (localContent) {
            derivedPromptNames.push(allowedName);
            continue;
          }
          const registryContent = typeof allowedPrompt?.content === 'string' ? allowedPrompt.content.trim() : '';
          if (registryContent) {
            extraPrompts.push({
              id: allowedPrompt.id || `uiapp:${allowedName}`,
              name: allowedPrompt.name || allowedName,
              title: typeof allowedPrompt?.title === 'string' ? allowedPrompt.title : '',
              type: 'system',
              content: registryContent,
              allowMain: true,
              allowSub: true,
              tags: Array.isArray(allowedPrompt?.tags) ? allowedPrompt.tags : [],
            });
            derivedPromptNames.push(allowedName);
            continue;
          }
          missingUiAppPrompts.push(allowedName);
          continue;
        }

        const preferred = promptByName.get(preferredName);
        const preferredContent = typeof preferred?.content === 'string' ? preferred.content.trim() : '';
        if (preferredContent) {
          derivedPromptNames.push(preferredName);
          continue;
        }
        const fallback = preferredName === fallbackName ? null : promptByName.get(fallbackName);
        const fallbackContent = typeof fallback?.content === 'string' ? fallback.content.trim() : '';
        if (fallbackContent) {
          derivedPromptNames.push(fallbackName);
          continue;
        }

        const contribute = await resolveContribution();
        const prompt = contribute?.mcpPrompt && typeof contribute.mcpPrompt === 'object' ? contribute.mcpPrompt : null;
        const zhText = typeof prompt?.zh === 'string' ? prompt.zh.trim() : '';
        const enText = typeof prompt?.en === 'string' ? prompt.en.trim() : '';
        const lang = normalizePromptLanguage(promptLanguage) || 'zh';

        let pickedName = '';
        let pickedText = '';
        if (lang === 'en' && enText) {
          pickedName = preferredName;
          pickedText = enText;
        } else if (zhText) {
          pickedName = fallbackName;
          pickedText = zhText;
        } else if (enText) {
          pickedName = preferredName;
          pickedText = enText;
        }

        if (pickedName && pickedText) {
          extraPrompts.push({
            id: `uiapp:${pickedName}`,
            name: pickedName,
            title: typeof prompt?.title === 'string' ? prompt.title : '',
            type: 'system',
            content: pickedText,
            allowMain: true,
            allowSub: true,
          });
          derivedPromptNames.push(pickedName);
        } else {
          missingUiAppPrompts.push(preferredName);
        }
      }
    }

    if (missingUiAppServers.length > 0) {
      scopedSendEvent({
        type: 'notice',
        message: `[UI Apps] 未找到 MCP server：${missingUiAppServers.slice(0, 6).join(', ')}${
          missingUiAppServers.length > 6 ? ' ...' : ''
        }`,
      });
    }
    if (deniedUiAppServers.length > 0) {
      scopedSendEvent({
        type: 'notice',
        message: `[UI Apps] MCP server 未授权：${deniedUiAppServers.slice(0, 6).join(', ')}${
          deniedUiAppServers.length > 6 ? ' ...' : ''
        }`,
      });
    }
    if (missingUiAppPrompts.length > 0) {
      scopedSendEvent({
        type: 'notice',
        message: `[UI Apps] 未找到 Prompt：${missingUiAppPrompts.slice(0, 6).join(', ')}${
          missingUiAppPrompts.length > 6 ? ' ...' : ''
        }`,
      });
    }
    if (deniedUiAppPrompts.length > 0) {
      scopedSendEvent({
        type: 'notice',
        message: `[UI Apps] Prompt 未授权：${deniedUiAppPrompts.slice(0, 6).join(', ')}${
          deniedUiAppPrompts.length > 6 ? ' ...' : ''
        }`,
      });
    }
    if (untrustedUiApps.size > 0) {
      const list = Array.from(untrustedUiApps);
      scopedSendEvent({
        type: 'notice',
        message: `[UI Apps] 插件未受信任：${list.slice(0, 6).join(', ')}${list.length > 6 ? ' ...' : ''}`,
      });
    }

    const uniqueIds = (list) => {
      const out = [];
      const seen = new Set();
      (Array.isArray(list) ? list : []).forEach((id) => {
        const v = normalizeId(id);
        if (!v || seen.has(v)) return;
        seen.add(v);
        out.push(v);
      });
      return out;
    };
    const effectiveAgent = {
      ...agentRecord,
      mcpServerIds: uniqueIds([
        ...(Array.isArray(agentRecord.mcpServerIds) ? agentRecord.mcpServerIds : []),
        ...derivedMcpServerIds,
      ]),
      promptIds: uniqueIds([
        ...(Array.isArray(agentRecord.promptIds) ? agentRecord.promptIds : []),
        ...derivedPromptIds,
      ]),
    };
    const hasUiApps = Array.isArray(agentRecord?.uiApps) && agentRecord.uiApps.length > 0;
    const mergedPrompts = Array.isArray(extraPrompts) && extraPrompts.length > 0 ? [...prompts, ...extraPrompts] : prompts;
    const mergedMcpServers =
      Array.isArray(extraMcpServers) && extraMcpServers.length > 0 ? [...mcpServers, ...extraMcpServers] : mcpServers;
    const systemPrompt = buildSystemPrompt({
      agent: effectiveAgent,
      prompts: mergedPrompts,
      subagents,
      mcpServers: mergedMcpServers,
      language: promptLanguage,
      extraPromptNames: derivedPromptNames,
      autoMcpPrompts: !hasUiApps,
    });

    const extraRuntimeServers = Array.isArray(extraMcpRuntimeServers) ? extraMcpRuntimeServers : [];
    const mainUserPrompt = '';
    const subagentUserPrompt = '';
    const subagentMcpAllowPrefixes = null;

    const shouldInitMcp =
      (Array.isArray(effectiveAgent.mcpServerIds) && effectiveAgent.mcpServerIds.length > 0) ||
      (Array.isArray(extraRuntimeServers) && extraRuntimeServers.length > 0);
    if (shouldInitMcp) {
      await ensureMcp({
        workspaceRoot: effectiveWorkspaceRoot,
        extraServers: extraRuntimeServers,
        emitEvent: scopedSendEvent,
      });
    }

    let toolsOverride = resolveAllowedTools({
      agent: effectiveAgent,
      mcpServers: mergedMcpServers,
    });
    const restrictedManager = subAgentManager
      ? createRestrictedSubAgentManager(subAgentManager, {
          allowedPluginIds: effectiveAgent.subagentIds,
          allowedSkills: effectiveAgent.skills,
        })
      : null;

    const history = store.messages
      .list(sid)
      .filter((msg) => msg?.id !== userMessageId && msg?.id !== initialAssistantMessageId);
    const chatSession = new ChatSession(systemPrompt || null, {
      sessionId: sid,
    });
    let pendingToolCallIds = null;
    history.forEach((msg) => {
      const role = msg?.role;
      if (role === 'user') {
        const content = buildUserMessageContent({
          text: msg?.content || '',
          attachments: msg?.attachments,
          allowVisionInput,
        });
        if (content) {
          chatSession.addUser(content);
        }
        pendingToolCallIds = null;
        return;
      }
      if (role === 'assistant') {
        const toolCalls = Array.isArray(msg?.toolCalls) ? msg.toolCalls.filter(Boolean) : null;
        const usableToolCalls = toolCalls && toolCalls.length > 0 ? toolCalls : null;
        chatSession.addAssistant(msg?.content || '', usableToolCalls);
        if (usableToolCalls) {
          pendingToolCallIds = new Set(
            usableToolCalls.map((call) => normalizeId(call?.id)).filter(Boolean)
          );
        } else {
          pendingToolCallIds = null;
        }
        return;
      }
      if (role === 'tool') {
        const callId = normalizeId(msg?.toolCallId);
        if (!callId) return;
        if (!pendingToolCallIds || !pendingToolCallIds.has(callId)) return;
        chatSession.addToolResult(callId, msg?.content || '');
        pendingToolCallIds.delete(callId);
      }
    });
    const currentUserContent = buildUserMessageContent({
      text: normalizedText,
      attachments,
      allowVisionInput,
    });
    if (!currentUserContent) {
      throw new Error('text is required');
    }
    chatSession.addUser(currentUserContent);

    let currentAssistantId = initialAssistantMessageId;
    const assistantTexts = new Map([[currentAssistantId, '']]);
    const assistantReasonings = new Map([[currentAssistantId, '']]);

    const appendAssistantText = (messageId, delta) => {
      const mid = normalizeId(messageId);
      if (!mid) return;
      const chunk = typeof delta === 'string' ? delta : String(delta || '');
      if (!chunk) return;
      const previous = assistantTexts.get(mid) || '';
      assistantTexts.set(mid, `${previous}${chunk}`);
      scopedSendEvent({ type: 'assistant_delta', sessionId: sid, messageId: mid, delta: chunk });
    };

    const appendAssistantReasoning = (messageId, delta) => {
      const mid = normalizeId(messageId);
      if (!mid) return;
      const chunk = typeof delta === 'string' ? delta : String(delta || '');
      if (!chunk) return;
      const previous = assistantReasonings.get(mid) || '';
      assistantReasonings.set(mid, `${previous}${chunk}`);
      scopedSendEvent({ type: 'assistant_reasoning_delta', sessionId: sid, messageId: mid, delta: chunk });
    };

    const syncAssistantRecord = (messageId, patch) => {
      const mid = normalizeId(messageId);
      if (!mid) return;
      try {
        store.messages.update(mid, patch || {});
      } catch {
        // ignore
      }
    };

    const onBeforeRequest = ({ iteration } = {}) => {
      const idx = Number.isFinite(iteration) ? iteration : 0;
      if (idx <= 0) {
        currentAssistantId = initialAssistantMessageId;
        if (!assistantTexts.has(currentAssistantId)) {
          assistantTexts.set(currentAssistantId, '');
        }
        if (!assistantReasonings.has(currentAssistantId)) {
          assistantReasonings.set(currentAssistantId, '');
        }
        activeRuns.set(sid, { controller, messageId: currentAssistantId });
        return;
      }
      let record = null;
      try {
        record = store.messages.create({ sessionId: sid, role: 'assistant', content: '' });
      } catch (err) {
        scopedSendEvent({ type: 'notice', message: `[Chat] 创建消息失败：${err?.message || String(err)}` });
        return;
      }
      currentAssistantId = normalizeId(record?.id) || currentAssistantId;
      if (!assistantTexts.has(currentAssistantId)) {
        assistantTexts.set(currentAssistantId, '');
      }
      if (!assistantReasonings.has(currentAssistantId)) {
        assistantReasonings.set(currentAssistantId, '');
      }
      activeRuns.set(sid, { controller, messageId: currentAssistantId });
      scopedSendEvent({ type: 'assistant_start', sessionId: sid, message: record });
    };

    const onToken = (delta) => {
      appendAssistantText(currentAssistantId, delta);
    };

    const onReasoning = (delta) => {
      appendAssistantReasoning(currentAssistantId, delta);
    };

    const onAssistantStep = ({ text, toolCalls, reasoning } = {}) => {
      const mid = normalizeId(currentAssistantId);
      if (!mid) return;
      const streamedText = assistantTexts.get(mid) || '';
      const fallbackText = typeof text === 'string' ? text : '';
      const currentText = streamedText || fallbackText;
      const streamedReasoning = assistantReasonings.get(mid) || '';
      const fallbackReasoning = typeof reasoning === 'string' ? reasoning : '';
      const currentReasoning = streamedReasoning || fallbackReasoning;
      const usableToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0 ? toolCalls : null;
      const patch = {
        content: currentText,
        ...(usableToolCalls ? { toolCalls: usableToolCalls } : {}),
        ...(currentReasoning ? { reasoning: currentReasoning } : {}),
      };
      syncAssistantRecord(mid, patch);
    };

    const onToolResult = ({ tool, callId, result }) => {
      const toolName = typeof tool === 'string' ? tool : '';
      const toolCallId = typeof callId === 'string' ? callId : '';
      const content = typeof result === 'string' ? result : String(result || '');
      const record = store.messages.create({
        sessionId: sid,
        role: 'tool',
        toolCallId,
        toolName,
        content,
      });
      scopedSendEvent({ type: 'tool_result', sessionId: sid, message: record });
    };

    const run = async () => {
      try {
        let finalResponseText = '';
        const context = restrictedManager
          ? {
              manager: restrictedManager,
              getClient: () => client,
              getCurrentModel: () => modelRecord.name,
              userPrompt: mainUserPrompt,
              subagentUserPrompt,
              subagentMcpAllowPrefixes,
              toolHistory: null,
              registerToolResult: null,
              eventLogger: null,
            }
          : null;

        const runChat = async () =>
          client.chat(modelRecord.name, chatSession, {
            stream: true,
            toolsOverride,
            caller: 'main',
            signal: controller.signal,
            onBeforeRequest,
            onToken,
            onReasoning,
            onAssistantStep,
            onToolResult,
          });

        if (context) {
          finalResponseText = await runWithSubAgentContext(context, runChat);
        } else {
          finalResponseText = await runChat();
        }

        const finalId = normalizeId(currentAssistantId) || initialAssistantMessageId;
        const finalText = assistantTexts.get(finalId) || finalResponseText || '';
        const finalReasoning = assistantReasonings.get(finalId) || '';
        syncAssistantRecord(
          finalId,
          finalReasoning ? { content: finalText, reasoning: finalReasoning } : { content: finalText }
        );
        store.sessions.update(sid, { updatedAt: new Date().toISOString() });
        scopedSendEvent({ type: 'assistant_done', sessionId: sid, messageId: finalId });
        if (completionCallback) {
          try {
            completionCallback({
              ok: true,
              aborted: false,
              sessionId: sid,
              agentId: effectiveAgentId,
              messageId: finalId,
              text: finalText,
              reasoning: finalReasoning,
            });
          } catch {
            // ignore
          }
        }
      } catch (err) {
        const aborted = err?.name === 'AbortError' || controller.signal.aborted;
        const message = aborted ? '已停止' : err?.message || String(err);
        const mid = normalizeId(currentAssistantId) || initialAssistantMessageId;
        const existing = assistantTexts.get(mid) || '';
        const existingReasoning = assistantReasonings.get(mid) || '';
        syncAssistantRecord(mid, {
          content: existing || (aborted ? '' : `[error] ${message}`),
          ...(existingReasoning ? { reasoning: existingReasoning } : {}),
        });
        store.sessions.update(sid, { updatedAt: new Date().toISOString() });
        scopedSendEvent({
          type: aborted ? 'assistant_aborted' : 'assistant_error',
          sessionId: sid,
          messageId: mid,
          message,
        });
        if (completionCallback) {
          try {
            completionCallback({
              ok: false,
              aborted,
              sessionId: sid,
              agentId: effectiveAgentId,
              messageId: mid,
              text: existing || (aborted ? '' : `[error] ${message}`),
              reasoning: existingReasoning,
              error: message,
            });
          } catch {
            // ignore
          }
        }
      } finally {
        activeRuns.delete(sid);
      }
    };

    void run();
    return { ok: true, sessionId: sid, userMessageId, assistantMessageId: initialAssistantMessageId };
  };

  return { start, abort, dispose };
}
