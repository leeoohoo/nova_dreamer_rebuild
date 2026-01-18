import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { uiAppsPluginSchema } from './schemas.js';
import { isUiAppsPluginTrusted, setUiAppsPluginTrust } from './trust-store.js';
import { resolveUiAppsAi, syncUiAppsAiContributes } from './ai.js';
import { getRegistryCenter } from '../backend/registry-center.js';
import { createRuntimeLogger } from '../../src/common/state-core/runtime-log.js';

const DEFAULT_MANIFEST_FILE = 'plugin.json';
const DEFAULT_MAX_MANIFEST_BYTES = 256 * 1024;
const DEFAULT_MAX_PROMPT_BYTES = 128 * 1024;

function resolveBoolEnv(value, fallback = false) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(raw)) return false;
  return fallback;
}

export function createUiAppsManager(options = {}) {
  return new UiAppsManager(options);
}

export function registerUiAppsApi(ipcMain, options = {}) {
  const manager = createUiAppsManager(options);
  ipcMain.handle('uiApps:list', async () => manager.listRegistry());
  ipcMain.handle('uiApps:ai:get', async (_event, payload = {}) => {
    try {
      const data = await manager.getAiContribution(payload);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, message: err?.message || String(err) };
    }
  });
  ipcMain.handle('uiApps:invoke', async (_event, payload = {}) => manager.invoke(payload));
  ipcMain.handle('uiApps:plugins:trust', async (_event, payload = {}) => manager.setPluginTrust(payload));
  return manager;
}

class UiAppsManager {
  constructor(options = {}) {
    this.projectRoot = typeof options.projectRoot === 'string' ? options.projectRoot : process.cwd();
    this.stateDir = typeof options.stateDir === 'string' ? options.stateDir : null;
    this.sessionRoot = typeof options.sessionRoot === 'string' ? options.sessionRoot : this.stateDir ? path.dirname(this.stateDir) : null;
    this.manifestFile = typeof options.manifestFile === 'string' && options.manifestFile.trim() ? options.manifestFile.trim() : DEFAULT_MANIFEST_FILE;
    this.maxManifestBytes = Number.isFinite(options.maxManifestBytes) ? options.maxManifestBytes : DEFAULT_MAX_MANIFEST_BYTES;
    this.maxPromptBytes = Number.isFinite(options.maxPromptBytes) ? options.maxPromptBytes : DEFAULT_MAX_PROMPT_BYTES;
    this.adminServices = options.adminServices || null;
    this.onAdminMutation = typeof options.onAdminMutation === 'function' ? options.onAdminMutation : null;
    this.syncAiContributes = typeof options.syncAiContributes === 'boolean' ? options.syncAiContributes : false;

    this.builtinPluginsDir =
      typeof options.builtinPluginsDir === 'string' && options.builtinPluginsDir.trim()
        ? path.resolve(options.builtinPluginsDir.trim())
        : path.join(this.projectRoot, 'ui_apps', 'plugins');

    this.userPluginsDir =
      typeof options.userPluginsDir === 'string' && options.userPluginsDir.trim()
        ? path.resolve(options.userPluginsDir.trim())
        : this.stateDir
          ? path.join(this.stateDir, 'ui_apps', 'plugins')
          : null;

    this.dataRootDir = this.stateDir ? path.join(this.stateDir, 'ui_apps', 'data') : null;

    this.registryMap = new Map();
    this.backendCache = new Map();
    this.loggedErrorKeys = new Set();
    this.runtimeLogger =
      this.stateDir && this.stateDir.trim()
        ? createRuntimeLogger({
            filePath: path.join(this.stateDir, 'runtime-log.jsonl'),
            scope: 'UI_APPS',
          })
        : null;
  }

  async listRegistry() {
    const pluginDirs = {
      builtin: this.builtinPluginsDir,
      user: this.userPluginsDir,
    };

    this.#ensureDir(this.userPluginsDir);
    this.#ensureDir(this.dataRootDir);

    const errors = [];
    const builtin = this.#scanPluginsDir(this.builtinPluginsDir, 'builtin', errors);
    const user = this.userPluginsDir ? this.#scanPluginsDir(this.userPluginsDir, 'user', errors) : [];

    const byId = new Map();
    builtin.forEach((plugin) => {
      byId.set(plugin.id, plugin);
    });
    user.forEach((plugin) => {
      byId.set(plugin.id, plugin);
    });

    const pluginsInternal = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));

    if (this.adminServices) {
      try {
        this.#syncRegistryCenterFromUiApps(pluginsInternal, errors);
      } catch (err) {
        errors.push({
          dir: '(uiApps registry sync)',
          source: 'registry',
          message: err?.message || String(err),
        });
      }
    }

    let didMutateAdmin = false;
    if (this.syncAiContributes && this.adminServices) {
      try {
        didMutateAdmin = this.#syncAiContributes(pluginsInternal, errors);
      } catch (err) {
        errors.push({
          dir: '(uiApps ai sync)',
          source: 'ai',
          message: err?.message || String(err),
        });
      }
      if (didMutateAdmin && this.onAdminMutation) {
        try {
          await this.onAdminMutation();
        } catch (err) {
          errors.push({
            dir: '(uiApps ai sync)',
            source: 'ai',
            message: `Failed to broadcast admin change: ${err?.message || String(err)}`,
          });
        }
      }
    }

    const sanitizeAiForUi = (ai) => {
      if (!ai || typeof ai !== 'object') return null;
      const mcp = ai?.mcp && typeof ai.mcp === 'object' ? ai.mcp : null;
      const mcpPrompt = ai?.mcpPrompt && typeof ai.mcpPrompt === 'object' ? ai.mcpPrompt : null;
      const agent = ai?.agent && typeof ai.agent === 'object' ? ai.agent : null;
      const sanitizePromptSource = (src) => {
        if (!src || typeof src !== 'object') return null;
        const p = typeof src.path === 'string' ? src.path : '';
        return p ? { path: p } : null;
      };
      return {
        mcp: mcp
          ? {
              name: mcp.name || '',
              url: mcp.url || '',
              description: mcp.description || '',
              tags: Array.isArray(mcp.tags) ? mcp.tags : [],
              enabled: typeof mcp.enabled === 'boolean' ? mcp.enabled : undefined,
              allowMain: typeof mcp.allowMain === 'boolean' ? mcp.allowMain : undefined,
              allowSub: typeof mcp.allowSub === 'boolean' ? mcp.allowSub : undefined,
            }
          : null,
        mcpPrompt: mcpPrompt
          ? {
              title: mcpPrompt.title || '',
              zh: sanitizePromptSource(mcpPrompt.zh),
              en: sanitizePromptSource(mcpPrompt.en),
              names: mcpPrompt.names || null,
            }
          : null,
        agent: agent
          ? {
              name: agent.name || '',
              description: agent.description || '',
              modelId: agent.modelId || '',
            }
          : null,
      };
    };

    const sanitizeAppForUi = (app) => ({
      ...app,
      ai: sanitizeAiForUi(app?.ai),
    });

    const plugins = pluginsInternal.map((plugin) => ({
      id: plugin.id,
      providerAppId: plugin.providerAppId || '',
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      source: plugin.source,
      trusted: plugin.trusted === true,
      backend: plugin.backend ? { entry: plugin.backend.entry, available: Boolean(plugin.backend.resolved) } : null,
      apps: plugin.apps.map(sanitizeAppForUi),
    }));
    const apps = pluginsInternal
      .flatMap((plugin) =>
        plugin.apps.map((app) => ({
          ...sanitizeAppForUi(app),
          plugin: {
            id: plugin.id,
            name: plugin.name,
            version: plugin.version,
            source: plugin.source,
            trusted: plugin.trusted === true,
            backend: plugin.backend ? { entry: plugin.backend.entry, available: Boolean(plugin.backend.resolved) } : null,
          },
        }))
      )
      .sort((a, b) => a.name.localeCompare(b.name));

    this.registryMap = byId;
    if (errors.length > 0) {
      errors.forEach((entry) => {
        const key = `${entry?.source || 'unknown'}:${entry?.dir || ''}:${entry?.message || ''}`;
        this.#logRuntimeOnce(key, 'warn', 'UI Apps registry error', entry);
      });
    }
    return { ok: true, pluginDirs, plugins, apps, errors };
  }

  async getAiContribution(payload = {}) {
    const pluginId = typeof payload?.pluginId === 'string' ? payload.pluginId.trim() : '';
    const appId = typeof payload?.appId === 'string' ? payload.appId.trim() : '';
    if (!pluginId || !appId) return null;

    if (!this.registryMap.size) {
      await this.listRegistry();
    }
    let plugin = this.registryMap.get(pluginId);
    if (!plugin) {
      await this.listRegistry();
      plugin = this.registryMap.get(pluginId);
    }
    if (!plugin) return null;

    const pluginDir = typeof plugin?.pluginDir === 'string' ? plugin.pluginDir : '';
    if (!pluginDir) return null;

    const app = (Array.isArray(plugin?.apps) ? plugin.apps : []).find((entry) => String(entry?.id || '').trim() === appId);
    const ai = app?.ai && typeof app.ai === 'object' ? app.ai : null;
    if (!ai) return null;

    const resolvePathWithinPlugin = (rel, label) => {
      const relPath = typeof rel === 'string' ? rel.trim() : '';
      if (!relPath) return null;
      const resolved = path.resolve(pluginDir, relPath);
      const relative = path.relative(pluginDir, resolved);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`${label} must be within plugin directory`);
      }
      return resolved;
    };

    const readPromptSource = (source, label) => {
      if (!source || typeof source !== 'object') return '';
      const content = typeof source?.content === 'string' ? source.content : '';
      if (content && content.trim()) return content.trim();
      const relPath = typeof source?.path === 'string' ? source.path : '';
      if (!relPath) return '';
      const resolved = resolvePathWithinPlugin(relPath, label);
      if (!resolved) return '';
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        throw new Error(`${label} must be a file: ${relPath}`);
      }
      if (stat.size > this.maxPromptBytes) {
        throw new Error(`${label} too large (${stat.size} bytes): ${relPath}`);
      }
      const raw = fs.readFileSync(resolved, 'utf8');
      return String(raw || '').trim();
    };

    const mcp = ai?.mcp && typeof ai.mcp === 'object' ? ai.mcp : null;
    const mcpPrompt = ai?.mcpPrompt && typeof ai.mcpPrompt === 'object' ? ai.mcpPrompt : null;
    let zh = '';
    let en = '';
    if (mcpPrompt) {
      try {
        zh = readPromptSource(mcpPrompt.zh, 'ai.mcpPrompt.zh');
      } catch {
        zh = '';
      }
      try {
        en = readPromptSource(mcpPrompt.en, 'ai.mcpPrompt.en');
      } catch {
        en = '';
      }
    }

    return {
      pluginId,
      appId,
      pluginDir,
      mcp: mcp && typeof mcp.url === 'string' && mcp.url.trim() ? mcp : null,
      mcpPrompt: mcpPrompt
        ? {
            title: typeof mcpPrompt?.title === 'string' ? mcpPrompt.title : '',
            names: mcpPrompt?.names && typeof mcpPrompt.names === 'object' ? mcpPrompt.names : null,
            zh,
            en,
          }
        : null,
      agent: ai?.agent && typeof ai.agent === 'object' ? ai.agent : null,
    };
  }

  async setPluginTrust(payload = {}) {
    const pluginId = typeof payload?.pluginId === 'string' ? payload.pluginId.trim() : '';
    if (!pluginId) return { ok: false, message: 'pluginId is required' };
    if (!this.stateDir) return { ok: false, message: 'stateDir not available' };
    const trusted = payload?.trusted === true;

    if (!this.registryMap.size) {
      await this.listRegistry();
    }
    let plugin = this.registryMap.get(pluginId);
    if (!plugin) {
      await this.listRegistry();
      plugin = this.registryMap.get(pluginId);
    }
    if (!plugin) {
      return { ok: false, message: `Plugin not found: ${pluginId}` };
    }

    setUiAppsPluginTrust({ pluginId, stateDir: this.stateDir, trusted });
    await this.listRegistry();
    return { ok: true, trusted };
  }

  async invoke(payload = {}) {
    const pluginId = typeof payload?.pluginId === 'string' ? payload.pluginId.trim() : '';
    const method = typeof payload?.method === 'string' ? payload.method.trim() : '';
    const params = payload?.params;
    if (!pluginId) return { ok: false, message: 'pluginId is required' };
    if (!method) return { ok: false, message: 'method is required' };

    if (!this.registryMap.size) {
      await this.listRegistry();
    }
    let plugin = this.registryMap.get(pluginId);
    if (!plugin) {
      await this.listRegistry();
      plugin = this.registryMap.get(pluginId);
    }
    if (!plugin) {
      this.#logRuntime('warn', 'UI Apps invoke failed: plugin not found', { pluginId, method });
      return { ok: false, message: `Plugin not found: ${pluginId}` };
    }
    if (!plugin.backend?.resolved) {
      this.#logRuntime('warn', 'UI Apps invoke failed: backend not configured', { pluginId, method });
      return { ok: false, message: `Plugin backend not configured: ${pluginId}` };
    }

    try {
      const backend = await this.#getBackend(plugin);
      const fn = backend?.methods?.[method];
      if (typeof fn !== 'function') {
        this.#logRuntime('warn', 'UI Apps invoke failed: method not found', { pluginId, method });
        return { ok: false, message: `Method not found: ${method}` };
      }
      const result = await fn(params, this.#buildInvokeContext(pluginId, plugin));
      return { ok: true, result };
    } catch (err) {
      this.#logRuntime('error', 'UI Apps invoke failed', { pluginId, method }, err);
      return { ok: false, message: err?.message || String(err) };
    }
  }

  #logRuntime(level, message, meta, err) {
    const logger = this.runtimeLogger;
    if (!logger) return;
    const fn = typeof logger[level] === 'function' ? logger[level] : logger.info;
    if (typeof fn !== 'function') return;
    fn(message, meta, err);
  }

  #logRuntimeOnce(key, level, message, meta, err) {
    if (!key) {
      this.#logRuntime(level, message, meta, err);
      return;
    }
    if (this.loggedErrorKeys.has(key)) return;
    this.loggedErrorKeys.add(key);
    this.#logRuntime(level, message, meta, err);
  }

  #isPluginTrusted(plugin) {
    const pluginId = typeof plugin?.id === 'string' ? plugin.id.trim() : '';
    if (!pluginId) return false;
    return isUiAppsPluginTrusted({
      pluginId,
      source: plugin?.source,
      stateDir: this.stateDir,
      env: process.env,
    });
  }

  #allowUntrustedBackend() {
    return resolveBoolEnv(process.env.MODEL_CLI_UIAPPS_ALLOW_UNTRUSTED_BACKEND, false);
  }

  #ensureDir(dirPath) {
    const normalized = typeof dirPath === 'string' ? dirPath.trim() : '';
    if (!normalized) return;
    try {
      fs.mkdirSync(normalized, { recursive: true });
    } catch {
      // ignore
    }
  }

  #scanPluginsDir(dirPath, source, errors) {
    const normalized = typeof dirPath === 'string' ? dirPath.trim() : '';
    if (!normalized) return [];

    let entries = [];
    try {
      entries = fs.readdirSync(normalized, { withFileTypes: true });
    } catch {
      return [];
    }

    const plugins = [];
    entries.forEach((entry) => {
      if (!entry?.isDirectory?.()) return;
      const pluginDir = path.join(normalized, entry.name);
      const manifestPath = path.join(pluginDir, this.manifestFile);
      try {
        if (!fs.existsSync(manifestPath)) return;
      } catch {
        return;
      }
      try {
        const parsed = this.#readPluginManifest(manifestPath);
        const plugin = uiAppsPluginSchema.parse(parsed);
        const apps = this.#resolveApps(pluginDir, plugin, errors);
        const backend = this.#resolveBackend(pluginDir, plugin, errors);
        const trusted = this.#isPluginTrusted({ id: plugin.id, source });
        plugins.push({
          id: plugin.id,
          providerAppId: plugin.providerAppId || '',
          name: plugin.name,
          version: plugin.version,
          description: plugin.description,
          source,
          trusted,
          backend,
          apps,
          pluginDir,
        });
      } catch (err) {
        errors.push({
          dir: pluginDir,
          source,
          message: err?.message || String(err),
        });
      }
    });

    return plugins;
  }

  #readPluginManifest(manifestPath) {
    const stat = fs.statSync(manifestPath);
    if (stat.size > this.maxManifestBytes) {
      throw new Error(`Manifest too large (${stat.size} bytes): ${manifestPath}`);
    }
    const raw = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(raw);
  }

  #resolveApps(pluginDir, plugin, errors) {
    const seenIds = new Set();
    const apps = [];
    (Array.isArray(plugin.apps) ? plugin.apps : []).forEach((app) => {
      const appId = typeof app?.id === 'string' ? app.id.trim() : '';
      if (!appId) return;
      if (seenIds.has(appId)) {
        errors.push({
          dir: pluginDir,
          source: 'manifest',
          message: `Duplicate app id "${appId}" in plugin "${plugin?.id}"`,
        });
        return;
      }
      seenIds.add(appId);

      try {
        const entry = this.#resolveEntry(pluginDir, app.entry);
        const ai = this.#resolveAi(pluginDir, plugin?.id, app, errors);
        apps.push({
          id: app.id,
          name: app.name,
          description: app.description || '',
          icon: app.icon || '',
          entry,
          ai,
          route: `apps/plugin/${encodeURIComponent(plugin.id)}/${encodeURIComponent(app.id)}`,
        });
      } catch (err) {
        errors.push({
          dir: pluginDir,
          source: 'entry',
          message: `App "${plugin?.id}:${appId}" entry error: ${err?.message || String(err)}`,
        });
      }
    });
    return apps;
  }

  #resolveAi(pluginDir, pluginIdRaw, app, errors) {
    return resolveUiAppsAi(pluginDir, pluginIdRaw, app, errors, {
      stateDir: this.stateDir,
      sessionRoot: this.sessionRoot,
      projectRoot: this.projectRoot,
      dataRootDir: this.dataRootDir,
    });
  }

  #syncRegistryCenterFromUiApps(pluginsInternal, errors) {
    const services = this.adminServices;
    if (!services?.mcpServers) return;

    let registry = null;
    try {
      registry = getRegistryCenter({ db: services.mcpServers.db });
    } catch {
      registry = null;
    }
    if (!registry) return;

    const uniqStrings = (list) => {
      const out = [];
      const seen = new Set();
      (Array.isArray(list) ? list : []).forEach((item) => {
        const v = String(item || '').trim();
        if (!v || seen.has(v)) return;
        seen.add(v);
        out.push(v);
      });
      return out;
    };

    const resolvePathWithinPlugin = (pluginDir, rel, label) => {
      const relPath = typeof rel === 'string' ? rel.trim() : '';
      if (!relPath) return null;
      const resolved = path.resolve(pluginDir, relPath);
      const relative = path.relative(pluginDir, resolved);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`${label} must be within plugin directory`);
      }
      return resolved;
    };

    const readPromptSource = (pluginDir, source, label) => {
      if (!source) return '';
      const content = typeof source?.content === 'string' ? source.content : '';
      if (content && content.trim()) return content.trim();
      const relPath = typeof source?.path === 'string' ? source.path : '';
      if (!relPath) return '';
      const resolved = resolvePathWithinPlugin(pluginDir, relPath, label);
      if (!resolved) return '';
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        throw new Error(`${label} must be a file: ${relPath}`);
      }
      if (stat.size > this.maxPromptBytes) {
        throw new Error(`${label} too large (${stat.size} bytes): ${relPath}`);
      }
      const raw = fs.readFileSync(resolved, 'utf8');
      return String(raw || '').trim();
    };

    pluginsInternal.forEach((plugin) => {
      const pluginId = typeof plugin?.id === 'string' ? plugin.id.trim() : '';
      const pluginDir = typeof plugin?.pluginDir === 'string' ? plugin.pluginDir : '';
      if (!pluginId || !pluginDir) return;

      const providerAppIdRaw = typeof plugin?.providerAppId === 'string' ? plugin.providerAppId.trim() : '';
      const providerAppId = providerAppIdRaw || pluginId;
      const allowGrants = plugin?.trusted === true;

      try {
        registry.registerApp(providerAppId, { name: plugin?.name || providerAppId, version: plugin?.version || '' });
      } catch {
        // ignore
      }

      (Array.isArray(plugin?.apps) ? plugin.apps : []).forEach((app) => {
        const appId = typeof app?.id === 'string' ? app.id.trim() : '';
        if (!appId) return;
        const consumerAppId = `${pluginId}.${appId}`;

        const ai = app?.ai && typeof app.ai === 'object' ? app.ai : null;
        if (!ai) return;

        const mcp = ai?.mcp && typeof ai.mcp === 'object' ? ai.mcp : null;
        if (mcp?.name && mcp?.url) {
          const desiredTags = uniqStrings([
            ...(Array.isArray(mcp.tags) ? mcp.tags : []),
            'uiapp',
            `uiapp:${pluginId}`,
            `uiapp:${pluginId}:${appId}`,
            `uiapp:${pluginId}.${appId}`,
          ]).sort((a, b) => a.localeCompare(b));
          try {
            const serverRecord = registry.registerMcpServer(providerAppId, {
              id: String(mcp.name || '').trim(),
              name: String(mcp.name || '').trim(),
              url: String(mcp.url || '').trim(),
              description: String(mcp.description || '').trim(),
              tags: desiredTags,
              enabled: typeof mcp.enabled === 'boolean' ? mcp.enabled : true,
              allowMain: typeof mcp.allowMain === 'boolean' ? mcp.allowMain : true,
              allowSub: typeof mcp.allowSub === 'boolean' ? mcp.allowSub : true,
              auth: mcp.auth || undefined,
            });
            if (serverRecord?.id) {
              if (allowGrants) {
                try {
                  registry.grantMcpServerAccess(consumerAppId, serverRecord.id);
                } catch (err) {
                  errors.push({
                    dir: pluginDir,
                    source: 'registry',
                    message: `Failed to grant MCP server "${mcp.name}" to "${consumerAppId}": ${err?.message || String(err)}`,
                  });
                }
              } else {
                try {
                  registry.revokeMcpServerAccess(consumerAppId, serverRecord.id);
                } catch (err) {
                  errors.push({
                    dir: pluginDir,
                    source: 'registry',
                    message: `Failed to revoke MCP server "${mcp.name}" from "${consumerAppId}": ${err?.message || String(err)}`,
                  });
                }
              }
            }
          } catch (err) {
            errors.push({
              dir: pluginDir,
              source: 'registry',
              message: `Failed to register MCP server "${mcp.name}" for "${providerAppId}": ${err?.message || String(err)}`,
            });
          }
        }

        const prompt = ai?.mcpPrompt && typeof ai.mcpPrompt === 'object' ? ai.mcpPrompt : null;
        const promptNames = prompt?.names && typeof prompt.names === 'object' ? prompt.names : null;
        if (prompt && promptNames) {
          const title =
            typeof prompt.title === 'string' && prompt.title.trim()
              ? prompt.title.trim()
              : `${app?.name || appId} MCP Prompt`;

          const variants = [
            { name: promptNames.zh, source: prompt.zh, label: 'ai.mcpPrompt.zh' },
            { name: promptNames.en, source: prompt.en, label: 'ai.mcpPrompt.en' },
          ].filter((v) => v?.source && v?.name);

          variants.forEach((variant) => {
            let content = '';
            try {
              content = readPromptSource(pluginDir, variant.source, variant.label);
            } catch (err) {
              errors.push({
                dir: pluginDir,
                source: 'registry',
                message: `Failed to read ${variant.label} for "${pluginId}:${appId}": ${err?.message || String(err)}`,
              });
              return;
            }
            if (!content) return;

            const promptName = String(variant.name || '').trim();
            if (!promptName) return;
            try {
              const promptRecord = registry.registerPrompt(providerAppId, {
                id: promptName,
                name: promptName,
                title,
                type: 'system',
                content,
                allowMain: true,
                allowSub: true,
              });
              if (promptRecord?.id) {
                if (allowGrants) {
                  try {
                    registry.grantPromptAccess(consumerAppId, promptRecord.id);
                  } catch (err) {
                    errors.push({
                      dir: pluginDir,
                      source: 'registry',
                      message: `Failed to grant Prompt "${promptName}" to "${consumerAppId}": ${err?.message || String(err)}`,
                    });
                  }
                } else {
                  try {
                    registry.revokePromptAccess(consumerAppId, promptRecord.id);
                  } catch (err) {
                    errors.push({
                      dir: pluginDir,
                      source: 'registry',
                      message: `Failed to revoke Prompt "${promptName}" from "${consumerAppId}": ${err?.message || String(err)}`,
                    });
                  }
                }
              }
            } catch (err) {
              errors.push({
                dir: pluginDir,
                source: 'registry',
                message: `Failed to register Prompt "${promptName}" for "${providerAppId}": ${err?.message || String(err)}`,
              });
            }
          });
        }
      });
    });
  }

  #syncAiContributes(pluginsInternal, errors) {
    const trustedPlugins = (Array.isArray(pluginsInternal) ? pluginsInternal : []).filter((plugin) => plugin?.trusted === true);
    return syncUiAppsAiContributes(
      { adminServices: this.adminServices, maxPromptBytes: this.maxPromptBytes },
      trustedPlugins,
      errors
    );
  }

  #resolveBackend(pluginDir, plugin, errors) {
    const rel = typeof plugin?.backend?.entry === 'string' ? plugin.backend.entry.trim() : '';
    if (!rel) return null;

    const resolved = path.resolve(pluginDir, rel);
    const relative = path.relative(pluginDir, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      errors.push({
        dir: pluginDir,
        source: 'backend',
        message: 'backend.entry must be within plugin directory',
      });
      return { entry: rel, resolved: null };
    }

    let stat = null;
    try {
      stat = fs.statSync(resolved);
    } catch {
      errors.push({
        dir: pluginDir,
        source: 'backend',
        message: `backend.entry not found: ${rel}`,
      });
      return { entry: rel, resolved: null };
    }

    if (!stat.isFile()) {
      errors.push({
        dir: pluginDir,
        source: 'backend',
        message: `backend.entry must be a file: ${rel}`,
      });
      return { entry: rel, resolved: null };
    }

    return { entry: rel, resolved, mtimeMs: stat.mtimeMs };
  }

  #resolveEntry(pluginDir, entry) {
    const resolveEntryItem = (raw, label = 'entry') => {
      const normalized = typeof raw === 'string' ? { type: 'module', path: raw } : raw;
      const entryType = normalized?.type;
      if (entryType !== 'module') {
        if (label === 'entry') throw new Error('Only module entry is supported');
        throw new Error(`Only module ${label} is supported`);
      }
      const relPath = typeof normalized?.path === 'string' ? normalized.path.trim() : '';
      if (!relPath) throw new Error(`${label}.path is required`);
      const resolved = path.resolve(pluginDir, relPath);
      const relative = path.relative(pluginDir, resolved);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`${label}.path must be within plugin directory`);
      }
      if (!fs.existsSync(resolved)) {
        throw new Error(`${label}.path not found: ${relPath}`);
      }

      let stat = null;
      try {
        stat = fs.statSync(resolved);
      } catch {
        throw new Error(`${label}.path not found: ${relPath}`);
      }
      if (!stat.isFile()) {
        throw new Error(`${label}.path must be a file for module apps: ${relPath}`);
      }

      return { type: entryType, url: pathToFileURL(resolved).toString() };
    };

    const resolved = resolveEntryItem(entry, 'entry');
    const compact = entry && typeof entry === 'object' ? entry.compact : null;
    if (compact) {
      resolved.compact = resolveEntryItem(compact, 'entry.compact');
    }
    return resolved;
  }

  #buildInvokeContext(pluginId, plugin) {
    const pluginDir = typeof plugin?.pluginDir === 'string' ? plugin.pluginDir : '';
    const dataDir = this.dataRootDir ? path.join(this.dataRootDir, pluginId) : '';
    this.#ensureDir(dataDir);
    return {
      pluginId,
      pluginDir,
      dataDir,
      stateDir: this.stateDir,
      sessionRoot: this.sessionRoot,
      projectRoot: this.projectRoot,
    };
  }

  async #getBackend(plugin) {
    const pluginId = typeof plugin?.id === 'string' ? plugin.id.trim() : '';
    if (!pluginId) throw new Error('pluginId is required');
    const trusted = this.#isPluginTrusted(plugin);
    if (!trusted && !this.#allowUntrustedBackend()) {
      throw new Error(`Plugin backend disabled for untrusted plugin: ${pluginId}`);
    }
    const backendResolved = plugin?.backend?.resolved;
    if (!backendResolved) throw new Error(`Plugin backend not available: ${pluginId}`);

    let stat = null;
    try {
      stat = fs.statSync(backendResolved);
    } catch {
      // ignore
    }
    const mtimeMs = Number.isFinite(stat?.mtimeMs) ? stat.mtimeMs : Number.isFinite(plugin?.backend?.mtimeMs) ? plugin.backend.mtimeMs : 0;

    const cached = this.backendCache.get(pluginId);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached;
    }

    if (cached?.dispose) {
      try {
        await cached.dispose();
      } catch {
        // ignore dispose errors
      }
    }
    this.backendCache.delete(pluginId);

    const moduleUrl = `${pathToFileURL(backendResolved).toString()}?mtime=${encodeURIComponent(String(mtimeMs || Date.now()))}`;
    const mod = await import(moduleUrl);
    const create = mod?.createUiAppsBackend;
    if (typeof create !== 'function') {
      throw new Error(`Plugin backend must export "createUiAppsBackend" (${pluginId})`);
    }
    const ctx = this.#buildInvokeContext(pluginId, plugin);
    const instance = await create(ctx);
    const methods = instance?.methods;
    if (!methods || typeof methods !== 'object') {
      throw new Error(`createUiAppsBackend() must return { methods } (${pluginId})`);
    }
    const dispose = typeof instance?.dispose === 'function' ? instance.dispose.bind(instance) : null;
    const next = { mtimeMs, methods, dispose };
    this.backendCache.set(pluginId, next);
    return next;
  }
}
