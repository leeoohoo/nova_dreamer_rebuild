function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeId(value) {
  return String(value || '').trim();
}

function makeCompositeId(providerAppId, providerLocalId) {
  const provider = normalizeKey(providerAppId);
  const local = normalizeId(providerLocalId);
  if (!provider) throw new Error('providerAppId is required');
  if (!local) throw new Error('provider local id is required');
  return `${provider}::${local}`;
}

function uniqStrings(list) {
  const out = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((item) => {
    const v = String(item || '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  });
  return out;
}

function sortByCreatedAtDesc(items) {
  return (Array.isArray(items) ? items : [])
    .slice()
    .sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')));
}

const TABLES = {
  apps: 'appRegistrations',
  mcpServers: 'registryMcpServers',
  prompts: 'registryPrompts',
  mcpGrants: 'mcpServerGrants',
  promptGrants: 'promptGrants',
};

export function createRegistryCenter(options = {}) {
  const db = options?.db;
  if (!db) {
    throw new Error('RegistryCenter requires { db }');
  }
  return new RegistryCenter(db);
}

export class RegistryCenter {
  constructor(db) {
    this.db = db;
  }

  registerApp(appIdRaw, appInfo = {}) {
    const appId = normalizeKey(appIdRaw);
    if (!appId) throw new Error('appId is required');
    const name = typeof appInfo?.name === 'string' && appInfo.name.trim() ? appInfo.name.trim() : appId;
    const version = typeof appInfo?.version === 'string' && appInfo.version.trim() ? appInfo.version.trim() : '';

    const existing = this.db.get(TABLES.apps, appId);
    const next = {
      id: appId,
      app_id: appId,
      app_name: name,
      app_version: version || undefined,
    };

    if (existing) {
      return this.db.update(TABLES.apps, appId, next);
    }
    return this.db.insert(TABLES.apps, next);
  }

  isAppRegistered(appIdRaw) {
    const appId = normalizeKey(appIdRaw);
    if (!appId) return false;
    return Boolean(this.db.get(TABLES.apps, appId));
  }

  listApps() {
    return sortByCreatedAtDesc(this.db.list(TABLES.apps) || []);
  }

  registerMcpServer(providerAppIdRaw, serverConfig = {}) {
    const providerAppId = normalizeKey(providerAppIdRaw);
    if (!providerAppId) throw new Error('providerAppId is required');

    const providerServerId = normalizeId(serverConfig?.id || serverConfig?.name);
    if (!providerServerId) throw new Error('server id is required');
    const id = makeCompositeId(providerAppId, providerServerId);
    const url = normalizeId(serverConfig?.url);
    if (!url) throw new Error('server url is required');

    this.registerApp(providerAppId, { name: providerAppId });

    const existing = this.db.get(TABLES.mcpServers, id);
    const record = {
      id,
      provider_app_id: providerAppId,
      provider_server_id: providerServerId,
      name: normalizeId(serverConfig?.name || providerServerId) || providerServerId,
      url,
      description: typeof serverConfig?.description === 'string' ? serverConfig.description : '',
      tags: uniqStrings(serverConfig?.tags),
      enabled: typeof serverConfig?.enabled === 'boolean' ? serverConfig.enabled : true,
      allowMain: typeof serverConfig?.allowMain === 'boolean' ? serverConfig.allowMain : true,
      allowSub: typeof serverConfig?.allowSub === 'boolean' ? serverConfig.allowSub : true,
      auth: serverConfig?.auth || undefined,
    };

    if (existing) {
      return this.db.update(TABLES.mcpServers, id, record);
    }
    return this.db.insert(TABLES.mcpServers, record);
  }

  registerPrompt(providerAppIdRaw, promptConfig = {}) {
    const providerAppId = normalizeKey(providerAppIdRaw);
    if (!providerAppId) throw new Error('providerAppId is required');

    const providerPromptId = normalizeId(promptConfig?.id || promptConfig?.name);
    if (!providerPromptId) throw new Error('prompt id is required');
    const id = makeCompositeId(providerAppId, providerPromptId);

    const name = normalizeId(promptConfig?.name || providerPromptId) || providerPromptId;
    const type = normalizeId(promptConfig?.type || 'system') || 'system';
    const content = typeof promptConfig?.content === 'string' ? promptConfig.content : '';
    if (!content.trim()) throw new Error('prompt content is required');

    this.registerApp(providerAppId, { name: providerAppId });

    const existing = this.db.get(TABLES.prompts, id);
    const record = {
      id,
      provider_app_id: providerAppId,
      provider_prompt_id: providerPromptId,
      name,
      title: typeof promptConfig?.title === 'string' ? promptConfig.title : '',
      type,
      content,
      tags: uniqStrings(promptConfig?.tags),
      allowMain: typeof promptConfig?.allowMain === 'boolean' ? promptConfig.allowMain : true,
      allowSub: typeof promptConfig?.allowSub === 'boolean' ? promptConfig.allowSub : true,
    };

    if (existing) {
      return this.db.update(TABLES.prompts, id, record);
    }
    return this.db.insert(TABLES.prompts, record);
  }

  grantMcpServerAccess(appIdRaw, serverIdRaw) {
    const appId = normalizeKey(appIdRaw);
    const serverId = normalizeId(serverIdRaw);
    if (!appId) throw new Error('appId is required');
    if (!serverId) throw new Error('serverId is required');

    this.registerApp(appId, { name: appId });

    const id = `${appId}::${serverId}`;
    const existing = this.db.get(TABLES.mcpGrants, id);
    const record = { id, app_id: appId, server_id: serverId, grantedAt: new Date().toISOString() };
    if (existing) {
      return this.db.update(TABLES.mcpGrants, id, record);
    }
    return this.db.insert(TABLES.mcpGrants, record);
  }

  revokeMcpServerAccess(appIdRaw, serverIdRaw) {
    const appId = normalizeKey(appIdRaw);
    const serverId = normalizeId(serverIdRaw);
    if (!appId) throw new Error('appId is required');
    if (!serverId) throw new Error('serverId is required');
    const id = `${appId}::${serverId}`;
    return this.db.remove(TABLES.mcpGrants, id);
  }

  hasMcpServerAccess(appIdRaw, serverIdRaw) {
    const appId = normalizeKey(appIdRaw);
    const serverId = normalizeId(serverIdRaw);
    if (!appId || !serverId) return false;
    const id = `${appId}::${serverId}`;
    return Boolean(this.db.get(TABLES.mcpGrants, id));
  }

  grantPromptAccess(appIdRaw, promptIdRaw) {
    const appId = normalizeKey(appIdRaw);
    const promptId = normalizeId(promptIdRaw);
    if (!appId) throw new Error('appId is required');
    if (!promptId) throw new Error('promptId is required');

    this.registerApp(appId, { name: appId });

    const id = `${appId}::${promptId}`;
    const existing = this.db.get(TABLES.promptGrants, id);
    const record = { id, app_id: appId, prompt_id: promptId, grantedAt: new Date().toISOString() };
    if (existing) {
      return this.db.update(TABLES.promptGrants, id, record);
    }
    return this.db.insert(TABLES.promptGrants, record);
  }

  revokePromptAccess(appIdRaw, promptIdRaw) {
    const appId = normalizeKey(appIdRaw);
    const promptId = normalizeId(promptIdRaw);
    if (!appId) throw new Error('appId is required');
    if (!promptId) throw new Error('promptId is required');
    const id = `${appId}::${promptId}`;
    return this.db.remove(TABLES.promptGrants, id);
  }

  hasPromptAccess(appIdRaw, promptIdRaw) {
    const appId = normalizeKey(appIdRaw);
    const promptId = normalizeId(promptIdRaw);
    if (!appId || !promptId) return false;
    const id = `${appId}::${promptId}`;
    return Boolean(this.db.get(TABLES.promptGrants, id));
  }

  getMcpServersForApp(targetAppIdRaw, allowedServerIds = null) {
    const targetAppId = normalizeKey(targetAppIdRaw);
    if (!targetAppId) throw new Error('targetAppId is required');

    const grants = this.db.list(TABLES.mcpGrants) || [];
    const granted = grants.filter((g) => g?.app_id === targetAppId).map((g) => g?.server_id).filter(Boolean);
    const allowed =
      Array.isArray(allowedServerIds) && allowedServerIds.length > 0
        ? new Set(allowedServerIds.map((id) => normalizeId(id)).filter(Boolean))
        : null;
    const grantedSet = new Set(granted.filter(Boolean));

    return (this.db.list(TABLES.mcpServers) || []).filter((srv) => {
      const id = srv?.id;
      if (!id) return false;
      if (!grantedSet.has(id)) return false;
      if (allowed && !allowed.has(id)) return false;
      return srv?.enabled !== false;
    });
  }

  getPromptsForApp(targetAppIdRaw, allowedPromptIds = null) {
    const targetAppId = normalizeKey(targetAppIdRaw);
    if (!targetAppId) throw new Error('targetAppId is required');

    const grants = this.db.list(TABLES.promptGrants) || [];
    const granted = grants.filter((g) => g?.app_id === targetAppId).map((g) => g?.prompt_id).filter(Boolean);
    const allowed =
      Array.isArray(allowedPromptIds) && allowedPromptIds.length > 0
        ? new Set(allowedPromptIds.map((id) => normalizeId(id)).filter(Boolean))
        : null;
    const grantedSet = new Set(granted.filter(Boolean));

    return (this.db.list(TABLES.prompts) || []).filter((prompt) => {
      const id = prompt?.id;
      if (!id) return false;
      if (!grantedSet.has(id)) return false;
      if (allowed && !allowed.has(id)) return false;
      return true;
    });
  }

  listAllMcpServers(providerAppIdRaw = null) {
    const normalizedProvider = providerAppIdRaw ? normalizeKey(providerAppIdRaw) : '';
    const all = this.db.list(TABLES.mcpServers) || [];
    if (!normalizedProvider) return all;
    return all.filter((srv) => srv?.provider_app_id === normalizedProvider);
  }

  listAllPrompts(providerAppIdRaw = null) {
    const normalizedProvider = providerAppIdRaw ? normalizeKey(providerAppIdRaw) : '';
    const all = this.db.list(TABLES.prompts) || [];
    if (!normalizedProvider) return all;
    return all.filter((p) => p?.provider_app_id === normalizedProvider);
  }

  getMcpServerGrantsForApp(appIdRaw) {
    const appId = normalizeKey(appIdRaw);
    if (!appId) throw new Error('appId is required');
    const grants = this.db.list(TABLES.mcpGrants) || [];
    const servers = this.db.list(TABLES.mcpServers) || [];
    const serverById = new Map(servers.filter((s) => s?.id).map((s) => [s.id, s]));
    return grants
      .filter((g) => g?.app_id === appId)
      .map((g) => {
        const server = serverById.get(g?.server_id) || null;
        return {
          app_id: g?.app_id || appId,
          server_id: g?.server_id || '',
          grantedAt: g?.grantedAt || '',
          provider_app_id: server?.provider_app_id || '',
          server_name: server?.name || '',
          server_url: server?.url || '',
        };
      });
  }
}

let REGISTRY_CENTER_INSTANCE = null;

export function initRegistryCenter(options = {}) {
  const db = options?.db;
  if (!db) throw new Error('initRegistryCenter requires { db }');
  REGISTRY_CENTER_INSTANCE = createRegistryCenter({ db });
  return REGISTRY_CENTER_INSTANCE;
}

export function getRegistryCenter(options = {}) {
  if (REGISTRY_CENTER_INSTANCE) return REGISTRY_CENTER_INSTANCE;
  const db = options?.db;
  if (!db) {
    throw new Error('RegistryCenter not initialized (pass { db } or call initRegistryCenter)');
  }
  REGISTRY_CENTER_INSTANCE = createRegistryCenter({ db });
  return REGISTRY_CENTER_INSTANCE;
}
