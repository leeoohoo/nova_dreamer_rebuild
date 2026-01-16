import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { createRestrictedSubAgentManager } from './subagent-restriction.js';
import { resolveAllowedTools } from './tool-selection.js';
import { applySecretsToProcessEnv } from '../../src/common/secrets-env.js';
import { allowExternalOnlyMcpServers, isExternalOnlyMcpServerName } from '../../src/common/host-app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENGINE_ROOT = path.resolve(__dirname, '..', '..', 'src', 'aide');

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
    const [sessionMod, clientMod, configMod, mcpRuntimeMod, subagentRuntimeMod, mcpMod, landConfigMod] = await Promise.all([
      import(pathToFileURL(resolveEngineModule('session.js')).href),
      import(pathToFileURL(resolveEngineModule('client.js')).href),
      import(pathToFileURL(resolveEngineModule('config.js')).href),
      import(pathToFileURL(resolveEngineModule('mcp/runtime.js')).href),
      import(pathToFileURL(resolveEngineModule('subagents/runtime.js')).href),
      import(pathToFileURL(resolveEngineModule('mcp.js')).href),
      import(pathToFileURL(resolveEngineModule('land-config.js')).href),
    ]);
    return {
      ChatSession: sessionMod.ChatSession,
      ModelClient: clientMod.ModelClient,
      createAppConfigFromModels: configMod.createAppConfigFromModels,
      initializeMcpRuntime: mcpRuntimeMod.initializeMcpRuntime,
      runWithSubAgentContext: subagentRuntimeMod.runWithSubAgentContext,
      loadMcpConfig: mcpMod.loadMcpConfig,
      buildLandConfigSelection: landConfigMod.buildLandConfigSelection,
      resolveLandConfig: landConfigMod.resolveLandConfig,
    };
  })();
  return engineDepsPromise;
}

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
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

function appendPromptBlock(baseText, extraText) {
  const base = typeof baseText === 'string' ? baseText.trim() : '';
  const extra = typeof extraText === 'string' ? extraText.trim() : '';
  if (!base) return extra;
  if (!extra) return base;
  return `${base}\n\n${extra}`;
}

function buildToolAllowPrefixes(serverNames, options = {}) {
  const list = Array.isArray(serverNames) ? serverNames : [];
  const prefixes = Array.from(
    new Set(
      list
        .map((name) => String(name || '').trim())
        .filter(Boolean)
        .map((name) => `mcp_${name}_`)
    )
  );
  if (prefixes.length === 0 && options.emptyToNone) {
    return ['__none__'];
  }
  return prefixes;
}

function mergeLandMcpServers({ mcpServers, selectedServers } = {}) {
  const base = Array.isArray(mcpServers) ? mcpServers : [];
  const byId = new Map();
  const byName = new Map();
  base.forEach((srv) => {
    const id = normalizeId(srv?.id);
    if (id && !byId.has(id)) byId.set(id, srv);
    const nameKey = normalizeKey(srv?.name);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, srv);
  });
  const merged = base.slice();
  const selectedIds = [];
  (Array.isArray(selectedServers) ? selectedServers : []).forEach((entry) => {
    const server = entry?.server || entry;
    if (!server) return;
    const nameKey = normalizeKey(server?.name);
    const existingByName = nameKey ? byName.get(nameKey) : null;
    if (existingByName?.id) {
      const id = normalizeId(existingByName.id);
      if (id) selectedIds.push(id);
      return;
    }
    const explicitId = normalizeId(server?.id);
    if (explicitId) {
      if (!byId.has(explicitId)) {
        merged.push(server);
        byId.set(explicitId, server);
      }
      selectedIds.push(explicitId);
      return;
    }
    if (!nameKey) return;
    const generatedId = `registry:${normalizeMcpServerName(server.name) || nameKey}`;
    if (!byId.has(generatedId)) {
      const withId = { ...server, id: generatedId };
      merged.push(withId);
      byId.set(generatedId, withId);
    }
    selectedIds.push(generatedId);
  });
  const uniqueIds = [];
  const seen = new Set();
  selectedIds.forEach((id) => {
    const key = normalizeId(id);
    if (!key || seen.has(key)) return;
    seen.add(key);
    uniqueIds.push(key);
  });
  return { merged, selectedIds: uniqueIds };
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
    if (record?.type !== 'system') return;
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
  const legacyAllowedServers = new Set(['subagent_router', 'task_manager', 'project_files']);
  const serverAllowsMain = (server) => {
    if (isExternalOnlyMcpServerName(server?.name) && !allowExternalOnlyMcpServers()) {
      return false;
    }
    const explicit = server?.allowMain;
    if (explicit === true || explicit === false) return explicit;
    return legacyAllowedServers.has(normalizeMcpServerName(server?.name));
  };
  const selectedMcp = (Array.isArray(agentRecord.mcpServerIds) ? agentRecord.mcpServerIds : [])
    .map((id) => mcpById.get(id))
    .filter((srv) => srv && srv.enabled !== false && serverAllowsMain(srv));

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
        if (record?.type !== 'system') continue;
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
    capabilityLines.push(`- 可用子代理（invoke_sub_agent）: ${names.join(', ')}`);
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
  } = {}) => {
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
          sendEvent({
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
        sendEvent({
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

  const start = async ({ sessionId, agentId, userMessageId, assistantMessageId, text, attachments } = {}) => {
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

    const sessionRecord = store.sessions.get(sid);
    const sessionWorkspaceRoot = normalizeWorkspaceRoot(sessionRecord?.workspaceRoot);
    const effectiveWorkspaceRoot = sessionWorkspaceRoot || normalizeWorkspaceRoot(workspaceRoot) || process.cwd();
    const effectiveAgentId = normalizeId(agentId) || normalizeId(sessionRecord?.agentId);
    const agentRecord = effectiveAgentId ? store.agents.get(effectiveAgentId) : null;
    if (!agentRecord) {
      throw new Error('agent not found for session');
    }

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
      loadMcpConfig,
      buildLandConfigSelection,
      resolveLandConfig,
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
    const landConfigId = typeof runtimeConfig?.landConfigId === 'string' ? runtimeConfig.landConfigId.trim() : '';
    const landConfigRecords = adminServices.landConfigs?.list ? adminServices.landConfigs.list() : [];
    const selectedLandConfig = resolveLandConfig({ landConfigs: landConfigRecords, landConfigId });
    const registrySnapshot = readRegistrySnapshot(adminServices);
    const landSelection = selectedLandConfig
      ? buildLandConfigSelection({
          landConfig: selectedLandConfig,
          prompts,
          mcpServers,
          registryMcpServers: registrySnapshot.mcpServers,
          registryPrompts: registrySnapshot.prompts,
          promptLanguage,
        })
      : null;
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
    const extraMcpServers = [];
    const extraMcpRuntimeServers = [];
    const extraPrompts = [];

    if (!landSelection) {
      const uiRefs = Array.isArray(agentRecord?.uiApps) ? agentRecord.uiApps : [];
      for (const ref of uiRefs) {
        const pluginId = normalizeId(ref?.pluginId);
        const appId = normalizeId(ref?.appId);
        if (!pluginId || !appId) continue;
        const serverName = `${pluginId}.${appId}`;
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
          const explicitMcpValidIds = explicitMcpIds.filter((id) => serverById.has(id));
          if (explicitMcpValidIds.length > 0) {
            explicitMcpValidIds.forEach((id) => derivedMcpServerIds.push(id));
          } else {
            const srv = serverByName.get(serverName.toLowerCase());
            if (srv?.id) {
              derivedMcpServerIds.push(srv.id);
            } else {
              const contribute = await resolveContribution();
              const mcp = contribute?.mcp && typeof contribute.mcp === 'object' ? contribute.mcp : null;
              const mcpUrl = typeof mcp?.url === 'string' ? mcp.url.trim() : '';
              if (mcpUrl) {
                const uiId = `uiapp:${serverName}`;
                const tags = Array.isArray(mcp?.tags) ? mcp.tags : [];
                const mergedTags = [
                  ...tags,
                  'uiapp',
                  `uiapp:${pluginId}`,
                  `uiapp:${pluginId}:${appId}`,
                  `uiapp:${pluginId}.${appId}`,
                ];
                const allowMain = typeof mcp?.allowMain === 'boolean' ? mcp.allowMain : true;
                const allowSub = typeof mcp?.allowSub === 'boolean' ? mcp.allowSub : true;
                const enabled = typeof mcp?.enabled === 'boolean' ? mcp.enabled : true;
                const auth = mcp?.auth || undefined;

                extraMcpServers.push({
                  id: uiId,
                  name: mcp?.name || serverName,
                  url: mcpUrl,
                  description: typeof mcp?.description === 'string' ? mcp.description : '',
                  tags: mergedTags,
                  enabled,
                  allowMain,
                  allowSub,
                  auth,
                  callMeta: mcp?.callMeta || undefined,
                });
                extraMcpRuntimeServers.push({
                  name: mcp?.name || serverName,
                  url: mcpUrl,
                  description: typeof mcp?.description === 'string' ? mcp.description : '',
                  tags: mergedTags,
                  enabled,
                  allowMain,
                  allowSub,
                  auth,
                  callMeta: mcp?.callMeta || undefined,
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
          const explicitPromptValidIds = explicitPromptIds.filter((id) => promptById.has(id));
          if (explicitPromptValidIds.length > 0) {
            explicitPromptValidIds.forEach((id) => derivedPromptIds.push(id));
            continue;
          }

          const preferredName = getMcpPromptNameForServer(serverName, promptLanguage).toLowerCase();
          const fallbackName = getMcpPromptNameForServer(serverName).toLowerCase();
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
        sendEvent({
          type: 'notice',
          message: `[UI Apps] 未找到 MCP server：${missingUiAppServers.slice(0, 6).join(', ')}${
            missingUiAppServers.length > 6 ? ' ...' : ''
          }`,
        });
      }
      if (missingUiAppPrompts.length > 0) {
        sendEvent({
          type: 'notice',
          message: `[UI Apps] 未找到 Prompt：${missingUiAppPrompts.slice(0, 6).join(', ')}${
            missingUiAppPrompts.length > 6 ? ' ...' : ''
          }`,
        });
      }
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
    let effectiveAgent = agentRecord;
    let mergedPrompts = prompts;
    let mergedMcpServers = mcpServers;
    let systemPrompt = '';
    let extraRuntimeServers = extraMcpRuntimeServers;
    let allowedMcpPrefixes = undefined;
    let mainUserPrompt = '';
    let subagentUserPrompt = '';
    let subagentMcpAllowPrefixes = null;
    let skipServers = null;

    if (landSelection) {
      const mainPromptWithMcp = appendPromptBlock(landSelection.main?.promptText, landSelection.main?.mcpPromptText);
      const subPromptWithMcp = appendPromptBlock(landSelection.sub?.promptText, landSelection.sub?.mcpPromptText);
      const { merged: landMcpServers, selectedIds } = mergeLandMcpServers({
        mcpServers,
        selectedServers: landSelection.main?.selectedServers,
      });
      const selectedIdSet = new Set(selectedIds);
      mergedMcpServers = landMcpServers.map((srv) => {
        const id = normalizeId(srv?.id);
        if (id && selectedIdSet.has(id)) {
          return { ...srv, allowMain: true };
        }
        return srv;
      });
      effectiveAgent = {
        ...agentRecord,
        mcpServerIds: selectedIds,
      };
      systemPrompt = buildSystemPrompt({
        agent: effectiveAgent,
        prompts: mergedPrompts,
        subagents,
        mcpServers: mergedMcpServers,
        language: promptLanguage,
        extraPromptNames: [],
        autoMcpPrompts: false,
      });
      systemPrompt = appendPromptBlock(systemPrompt, mainPromptWithMcp);
      allowedMcpPrefixes = buildToolAllowPrefixes(landSelection.main?.selectedServerNames);
      mainUserPrompt = mainPromptWithMcp;
      subagentUserPrompt = subPromptWithMcp;
      subagentMcpAllowPrefixes = buildToolAllowPrefixes(landSelection.sub?.selectedServerNames, { emptyToNone: true });
      extraRuntimeServers = Array.isArray(landSelection.extraMcpServers) ? landSelection.extraMcpServers : [];

      const selectedServerKeys = new Set(
        [...(landSelection.main?.selectedServers || []), ...(landSelection.sub?.selectedServers || [])]
          .map((entry) => normalizeKey(entry?.server?.name))
          .filter(Boolean)
      );
      try {
        const mcpSummary = loadMcpConfig(resolveMcpConfigPath() || defaultPaths.models);
        skipServers = Array.isArray(mcpSummary?.servers)
          ? mcpSummary.servers
              .filter((srv) => srv?.name && !selectedServerKeys.has(normalizeKey(srv.name)))
              .map((srv) => srv.name)
          : [];
      } catch {
        skipServers = [];
      }
    } else {
      effectiveAgent = {
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
      mergedPrompts = Array.isArray(extraPrompts) && extraPrompts.length > 0 ? [...prompts, ...extraPrompts] : prompts;
      mergedMcpServers =
        Array.isArray(extraMcpServers) && extraMcpServers.length > 0 ? [...mcpServers, ...extraMcpServers] : mcpServers;
      systemPrompt = buildSystemPrompt({
        agent: effectiveAgent,
        prompts: mergedPrompts,
        subagents,
        mcpServers: mergedMcpServers,
        language: promptLanguage,
        extraPromptNames: derivedPromptNames,
        autoMcpPrompts: !hasUiApps,
      });
    }

    if (landSelection) {
      const warnList = (label, items) => {
        const list = Array.isArray(items) ? items.filter(Boolean) : [];
        if (list.length === 0) return;
        sendEvent({
          type: 'notice',
          message: `${label}${list.slice(0, 6).join(', ')}${list.length > 6 ? ' ...' : ''}`,
        });
      };
      warnList('[prompts] Missing MCP prompt(s) for main: ', landSelection.main?.missingMcpPromptNames);
      warnList('[prompts] Missing MCP prompt(s) for sub: ', landSelection.sub?.missingMcpPromptNames);
      warnList('[land_config] Missing app MCP servers (main): ', landSelection.main?.missingAppServers);
      warnList('[land_config] Missing app MCP servers (sub): ', landSelection.sub?.missingAppServers);
      warnList('[land_config] Missing prompts (main): ', landSelection.main?.missingPromptNames);
      warnList('[land_config] Missing prompts (sub): ', landSelection.sub?.missingPromptNames);
    }

    const shouldInitMcp = landSelection
      ? (landSelection.main?.selectedServers || []).length > 0 ||
        (landSelection.sub?.selectedServers || []).length > 0 ||
        (Array.isArray(extraRuntimeServers) && extraRuntimeServers.length > 0)
      : Array.isArray(effectiveAgent.mcpServerIds) && effectiveAgent.mcpServerIds.length > 0;
    if (shouldInitMcp) {
      await ensureMcp({
        workspaceRoot: effectiveWorkspaceRoot,
        extraServers: extraRuntimeServers,
        skipServers: landSelection ? skipServers : undefined,
      });
    }

    const toolsOverride = resolveAllowedTools({
      agent: effectiveAgent,
      mcpServers: mergedMcpServers,
      allowedMcpPrefixes,
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
    const chatSession = new ChatSession(systemPrompt || null, { sessionId: sid });
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
      sendEvent({ type: 'assistant_delta', sessionId: sid, messageId: mid, delta: chunk });
    };

    const appendAssistantReasoning = (messageId, delta) => {
      const mid = normalizeId(messageId);
      if (!mid) return;
      const chunk = typeof delta === 'string' ? delta : String(delta || '');
      if (!chunk) return;
      const previous = assistantReasonings.get(mid) || '';
      assistantReasonings.set(mid, `${previous}${chunk}`);
      sendEvent({ type: 'assistant_reasoning_delta', sessionId: sid, messageId: mid, delta: chunk });
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
        sendEvent({ type: 'notice', message: `[Chat] 创建消息失败：${err?.message || String(err)}` });
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
      sendEvent({ type: 'assistant_start', sessionId: sid, message: record });
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
      sendEvent({ type: 'tool_result', sessionId: sid, message: record });
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
        sendEvent({ type: 'assistant_done', sessionId: sid, messageId: finalId });
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
        sendEvent({
          type: aborted ? 'assistant_aborted' : 'assistant_error',
          sessionId: sid,
          messageId: mid,
          message,
        });
      } finally {
        activeRuns.delete(sid);
      }
    };

    void run();
    return { ok: true, sessionId: sid, userMessageId, assistantMessageId: initialAssistantMessageId };
  };

  return { start, abort, dispose };
}
