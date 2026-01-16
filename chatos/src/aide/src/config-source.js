import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createDb, getDefaultDbPath } from '../shared/data/storage.js';
import { createAdminServices } from '../shared/data/services/index.js';
import { resolveSessionRoot } from '../shared/session-root.js';
import {
  buildAdminSeed,
  extractVariables,
  loadBuiltinPromptFiles,
  parseMcpServers,
  safeRead,
} from '../shared/data/legacy.js';
import { syncAdminToFiles } from '../shared/data/sync.js';
import { getHostApp } from '../shared/host-app.js';
import { ensureAppStateDir } from '../shared/state-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getAdminServices() {
  const projectRoot = path.resolve(__dirname, '..');
  // 会话根：优先环境变量，其次读取 marker，最后回退 home/cwd
  const sessionRoot = resolveSessionRoot();
  process.env.MODEL_CLI_SESSION_ROOT = sessionRoot;
  const defaultsRoot = projectRoot;
  const stateDir = ensureAppStateDir(sessionRoot);
  const authDir = path.join(stateDir, 'auth');
  const legacyAdminDb = getDefaultDbPath();

  const legacySeed = readLegacyState(legacyAdminDb);
  const defaultPaths = {
    defaultsRoot,
    models: path.join(authDir, 'models.yaml'),
    systemPrompt: path.join(authDir, 'system-prompt.yaml'),
    systemDefaultPrompt: path.join(authDir, 'system-default-prompt.yaml'),
    systemUserPrompt: path.join(authDir, 'system-user-prompt.yaml'),
    subagentSystemPrompt: path.join(authDir, 'subagent-system-prompt.yaml'),
    subagentUserPrompt: path.join(authDir, 'subagent-user-prompt.yaml'),
    mcpConfig: path.join(authDir, 'mcp.config.json'),
    tasks: null,
    events: path.join(stateDir, 'events.jsonl'),
    marketplace: path.join(projectRoot, 'subagents', 'marketplace.json'),
    marketplaceUser: path.join(stateDir, 'subagents', 'marketplace.json'),
    pluginsDir: path.join(projectRoot, 'subagents', 'plugins'),
    pluginsDirUser: path.join(stateDir, 'subagents', 'plugins'),
    installedSubagents: path.join(stateDir, 'subagents.json'),
    adminDb: path.join(stateDir, `${getHostApp() || 'aide'}.db.sqlite`),
  };
  const seed = legacySeed || buildAdminSeed(defaultPaths);
  const adminDb = createDb({
    dbPath: defaultPaths.adminDb,
    seed,
  });
  const services = createAdminServices(adminDb);
  maybeReseedModels(adminDb, services, seed);
  refreshBuiltinMcpServers(adminDb, services, defaultPaths);
  refreshBuiltinPrompts(adminDb, services, defaultPaths);
  maybePurgeUiAppsSyncedAdminData({ stateDir, services });
  syncAdminToFiles(services.snapshot(), {
    modelsPath: defaultPaths.models,
    mcpConfigPath: defaultPaths.mcpConfig,
    subagentsPath: defaultPaths.installedSubagents,
    promptsPath: defaultPaths.systemPrompt,
    systemDefaultPromptPath: defaultPaths.systemDefaultPrompt,
    systemUserPromptPath: defaultPaths.systemUserPrompt,
    subagentPromptsPath: defaultPaths.subagentSystemPrompt,
    subagentUserPromptPath: defaultPaths.subagentUserPrompt,
    tasksPath: defaultPaths.tasks,
  });
  return { services, defaultPaths };
}

function maybePurgeUiAppsSyncedAdminData({ stateDir, services } = {}) {
  const host = getHostApp() || 'aide';
  if (host !== 'chatos' && host !== 'aide') return;
  if (!stateDir || !services?.mcpServers || !services?.prompts) return;

  const markerPath = path.join(stateDir, '.uiapps-ai-sync-purged.json');
  try {
    if (fs.existsSync(markerPath)) {
      return;
    }
  } catch {
    // ignore marker fs errors
  }

  const normalizeTag = (value) => String(value || '').trim().toLowerCase();
  const isUiAppTagged = (record) => {
    const tags = Array.isArray(record?.tags) ? record.tags : [];
    return tags.map(normalizeTag).filter(Boolean).some((tag) => tag === 'uiapp' || tag.startsWith('uiapp:'));
  };
  const normalizeMcpServerName = (value) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
  const getPromptNamesForServer = (serverName) => {
    const base = `mcp_${normalizeMcpServerName(serverName)}`;
    return [base, `${base}__en`];
  };

  const collectPromptNamesForServer = (record, promptNames) => {
    const keys = new Set();
    const serverName = typeof record?.name === 'string' ? record.name.trim() : '';
    if (serverName) keys.add(serverName);
    const tags = Array.isArray(record?.tags) ? record.tags : [];
    tags.forEach((tagRaw) => {
      const tag = normalizeTag(tagRaw);
      if (!tag.startsWith('uiapp:')) return;
      const rest = tag.slice('uiapp:'.length).trim();
      if (!rest) return;
      if (rest.includes('.')) {
        keys.add(rest);
        return;
      }
      const parts = rest.split(':').map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        keys.add(`${parts[0]}.${parts[1]}`);
      }
    });
    keys.forEach((key) => {
      getPromptNamesForServer(key).forEach((name) => promptNames.add(String(name || '').trim().toLowerCase()));
    });
  };

  let removedServers = 0;
  let removedPrompts = 0;
  const promptNames = new Set();

  let servers = [];
  try {
    servers = services.mcpServers.list ? services.mcpServers.list() : [];
  } catch {
    servers = [];
  }
  const uiappServers = (Array.isArray(servers) ? servers : []).filter((srv) => srv?.id && isUiAppTagged(srv));
  uiappServers.forEach((srv) => collectPromptNamesForServer(srv, promptNames));

  uiappServers.forEach((srv) => {
    try {
      if (services.mcpServers.remove(srv.id)) {
        removedServers += 1;
      }
    } catch {
      // ignore
    }
  });

  if (promptNames.size > 0) {
    let prompts = [];
    try {
      prompts = services.prompts.list ? services.prompts.list() : [];
    } catch {
      prompts = [];
    }
    (Array.isArray(prompts) ? prompts : []).forEach((prompt) => {
      const id = prompt?.id;
      const key = String(prompt?.name || '').trim().toLowerCase();
      if (!id || !key || !promptNames.has(key)) return;
      try {
        if (services.prompts.remove(id)) {
          removedPrompts += 1;
        }
      } catch {
        // ignore
      }
    });
  }

  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      markerPath,
      JSON.stringify(
        {
          version: 1,
          purgedAt: new Date().toISOString(),
          removedServers,
          removedPrompts,
        },
        null,
        2
      ),
      'utf8'
    );
  } catch {
    // ignore marker write errors
  }
}

function readLegacyState(filePath) {
  if (!filePath) return null;
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    // ignore legacy read errors
  }
  return null;
}

function refreshBuiltinMcpServers(adminDb, services, defaultPaths) {
  const now = new Date().toISOString();
  const hostApp = getHostApp() || 'aide';
  try {
    const raw =
      safeRead(path.join(path.resolve(defaultPaths.defaultsRoot || ''), 'shared', 'defaults', 'mcp.config.json')) ||
      safeRead(defaultPaths.mcpConfig);
    const defaults = parseMcpServers(raw);
    if (!Array.isArray(defaults) || defaults.length === 0) return;
    const existing = services.mcpServers.list() || [];
    const map = new Map(existing.map((item) => [item.name, item]));
    defaults.forEach((srv) => {
      if (!srv?.name) return;
      const prev = map.get(srv.name);
      const payload = {
        ...srv,
        app_id: prev?.app_id || srv.app_id || hostApp,
        allowMain: typeof prev?.allowMain === 'boolean' ? prev.allowMain : srv.allowMain === true,
        allowSub: typeof prev?.allowSub === 'boolean' ? prev.allowSub : srv.allowSub !== false,
        enabled: typeof prev?.enabled === 'boolean' ? prev.enabled : srv.enabled !== false,
        locked: true,
        id: prev?.id,
        createdAt: prev?.createdAt || now,
        updatedAt: now,
      };
      if (prev) {
        adminDb.update('mcpServers', prev.id, payload);
      } else {
        adminDb.insert('mcpServers', payload);
      }
    });
  } catch {
    // ignore builtin refresh errors
  }
}

function refreshBuiltinPrompts(adminDb, services, defaultPaths) {
  const now = new Date().toISOString();
  try {
    const mergedList = loadBuiltinPromptFiles(defaultPaths) || [];
    if (!Array.isArray(mergedList) || mergedList.length === 0) return;

    const existing = services.prompts.list() || [];
    const map = new Map(existing.map((item) => [item.name, item]));
    mergedList.forEach((prompt) => {
      if (!prompt?.name) return;
      const prev = map.get(prompt.name);
      const allowMain = typeof prev?.allowMain === 'boolean' ? prev.allowMain : prompt.allowMain === true;
      const allowSub = typeof prev?.allowSub === 'boolean' ? prev.allowSub : prompt.allowSub === true;
      const payload = {
        ...prompt,
        builtin: true,
        locked: true,
        content: prompt.content,
        defaultContent: prompt.content,
        allowMain,
        allowSub,
        id: prev?.id,
        createdAt: prev?.createdAt || now,
        updatedAt: now,
        variables: extractVariables(prompt.content),
      };
      if (prev) {
        adminDb.update('prompts', prev.id, payload);
      } else {
        adminDb.insert('prompts', payload);
      }
    });

    ['user_prompt', 'subagent_user_prompt'].forEach((name) => {
      const prev = map.get(name);
      if (prev?.builtin && prev?.id) {
        adminDb.remove('prompts', prev.id);
      }
    });
  } catch {
    // ignore builtin refresh errors
  }
}

function maybeReseedModels(adminDb, services, seed) {
  const current = services.models.list();
  const seedModels = Array.isArray(seed?.models) ? seed.models : [];
  if (current.length === 0 && seedModels.length > 0) {
    adminDb.reset('models', seedModels);
  }
}
