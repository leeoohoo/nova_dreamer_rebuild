import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import YAML from 'yaml';
import { uiAppsPluginSchema, uiAppAiConfigSchema } from './schemas.js';
import { getRegistryCenter } from '../backend/registry-center.js';

const DEFAULT_MANIFEST_FILE = 'plugin.json';
const DEFAULT_MAX_MANIFEST_BYTES = 256 * 1024;
const DEFAULT_MAX_PROMPT_BYTES = 128 * 1024;

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
  return manager;
}

class UiAppsManager {
  constructor(options = {}) {
    this.projectRoot = typeof options.projectRoot === 'string' ? options.projectRoot : process.cwd();
    this.defaultsRoot =
      typeof options.defaultsRoot === 'string' && options.defaultsRoot.trim()
        ? path.resolve(options.defaultsRoot.trim())
        : null;
    this.stateDir = typeof options.stateDir === 'string' ? options.stateDir : null;
    this.sessionRoot = typeof options.sessionRoot === 'string' ? options.sessionRoot : this.stateDir ? path.dirname(this.stateDir) : null;
    this.manifestFile = typeof options.manifestFile === 'string' && options.manifestFile.trim() ? options.manifestFile.trim() : DEFAULT_MANIFEST_FILE;
    this.maxManifestBytes = Number.isFinite(options.maxManifestBytes) ? options.maxManifestBytes : DEFAULT_MAX_MANIFEST_BYTES;
    this.maxPromptBytes = Number.isFinite(options.maxPromptBytes) ? options.maxPromptBytes : DEFAULT_MAX_PROMPT_BYTES;
    this.adminServices = options.adminServices || null;
    this.onAdminMutation = typeof options.onAdminMutation === 'function' ? options.onAdminMutation : null;
    this.syncAiContributes = typeof options.syncAiContributes === 'boolean' ? options.syncAiContributes : false;
    this.llm = options.llm || null;

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
      const sanitizeExposeList = (value) => {
        if (value === true) return true;
        if (!Array.isArray(value)) return null;
        const out = [];
        const seen = new Set();
        value.forEach((item) => {
          const v = typeof item === 'string' ? item.trim() : '';
          if (!v || seen.has(v)) return;
          seen.add(v);
          out.push(v);
        });
        return out.length > 0 ? out : null;
      };
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
        mcpServers: sanitizeExposeList(ai?.mcpServers),
        prompts: sanitizeExposeList(ai?.prompts),
      };
    };

    const sanitizeAppForUi = (app) => ({
      ...app,
      ai: sanitizeAiForUi(app?.ai),
    });

    const plugins = pluginsInternal.map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      source: plugin.source,
      backend: plugin.backend ? { entry: plugin.backend.entry, available: Boolean(plugin.backend.resolved) } : null,
      apps: plugin.apps.map(sanitizeAppForUi),
    }));
    const apps = pluginsInternal
      .flatMap((plugin) =>
        plugin.apps.map((app) => ({
          ...sanitizeAppForUi(app),
          plugin: { id: plugin.id, name: plugin.name, version: plugin.version },
        }))
      )
      .sort((a, b) => a.name.localeCompare(b.name));

    this.registryMap = byId;
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
      mcpServers: Object.prototype.hasOwnProperty.call(ai || {}, 'mcpServers') ? ai.mcpServers : null,
      prompts: Object.prototype.hasOwnProperty.call(ai || {}, 'prompts') ? ai.prompts : null,
    };
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
      return { ok: false, message: `Plugin not found: ${pluginId}` };
    }
    if (!plugin.backend?.resolved) {
      return { ok: false, message: `Plugin backend not configured: ${pluginId}` };
    }

    try {
      const backend = await this.#getBackend(plugin);
      const fn = backend?.methods?.[method];
      if (typeof fn !== 'function') {
        return { ok: false, message: `Method not found: ${method}` };
      }
      const result = await fn(params, this.#buildInvokeContext(pluginId, plugin));
      return { ok: true, result };
    } catch (err) {
      return { ok: false, message: err?.message || String(err) };
    }
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
        plugins.push({
          id: plugin.id,
          providerAppId: plugin.providerAppId || '',
          name: plugin.name,
          version: plugin.version,
          description: plugin.description,
          source,
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
        const entry = this.#resolveEntry(pluginDir, app.entry, 'entry.path');
        let compactEntry = null;
        if (app?.entry?.compact) {
          try {
            compactEntry = this.#resolveEntry(pluginDir, app.entry.compact, 'entry.compact.path');
          } catch (err) {
            errors.push({
              dir: pluginDir,
              source: 'entry',
              message: `App "${plugin?.id}:${appId}" compact entry error: ${err?.message || String(err)}`,
            });
          }
        }
        const ai = this.#resolveAi(pluginDir, plugin?.id, app, errors);
        apps.push({
          id: app.id,
          name: app.name,
          description: app.description || '',
          icon: app.icon || '',
          entry: compactEntry ? { ...entry, compact: compactEntry } : entry,
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
    const pluginId = typeof pluginIdRaw === 'string' ? pluginIdRaw.trim() : '';
    const appId = typeof app?.id === 'string' ? app.id.trim() : '';
    if (!pluginId || !appId) return null;
    const aiInline = app?.ai && typeof app.ai === 'object' ? app.ai : null;
    if (!aiInline) return null;

    const normalizeExposeList = (value) => {
      if (value === true) return true;
      if (value === false) return false;
      if (!Array.isArray(value)) return null;
      const out = [];
      const seen = new Set();
      value.forEach((item) => {
        const v = typeof item === 'string' ? item.trim() : '';
        if (!v || seen.has(v)) return;
        seen.add(v);
        out.push(v);
      });
      return out.length > 0 ? out : null;
    };

    const normalizeExposeValue = (value) => {
      const normalized = normalizeExposeList(value);
      if (normalized === true || normalized === false) return normalized;
      if (Array.isArray(normalized) && normalized.length > 0) return normalized;
      return null;
    };

    const normalizeDefaultsKey = (value) =>
      String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '');

    const serverName = `${pluginId}.${appId}`;
    const normalizeMcpServerName = (value) =>
      String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '');
    const promptBase = `mcp_${normalizeMcpServerName(serverName)}`;
    const promptNames = { zh: promptBase, en: `${promptBase}__en` };

    const buildPromptSource = (src, fallbackLabel) => {
      if (!src) return null;
      if (typeof src === 'string') {
        return { path: src, content: '', label: fallbackLabel };
      }
      if (typeof src === 'object') {
        const pathValue = typeof src?.path === 'string' ? src.path : '';
        const contentValue = typeof src?.content === 'string' ? src.content : '';
        return { path: pathValue, content: contentValue, label: fallbackLabel };
      }
      return null;
    };

    const compactContext = (value) => {
      if (!value || typeof value !== 'object') return {};
      const out = {};
      Object.entries(value).forEach(([key, entry]) => {
        if (typeof entry === 'string') {
          const trimmed = entry.trim();
          if (trimmed) out[key] = trimmed;
          return;
        }
        if (entry !== undefined && entry !== null) out[key] = entry;
      });
      return out;
    };

    const resolveCallMetaValue = (value, ctx) => {
      if (typeof value === 'string') {
        const key = value.startsWith('$') ? value.slice(1) : '';
        if (key && Object.prototype.hasOwnProperty.call(ctx, key)) {
          const resolved = ctx[key];
          return typeof resolved === 'string' ? resolved : resolved ?? value;
        }
        return value;
      }
      if (Array.isArray(value)) {
        return value.map((entry) => resolveCallMetaValue(entry, ctx));
      }
      if (value && typeof value === 'object') {
        const out = {};
        Object.entries(value).forEach(([key, entry]) => {
          out[key] = resolveCallMetaValue(entry, ctx);
        });
        return out;
      }
      return value;
    };

    const mergeCallMeta = (base, override) => {
      if (!base) return override || null;
      if (!override) return base;
      if (Array.isArray(base) || Array.isArray(override)) return override;
      if (typeof base !== 'object' || typeof override !== 'object') return override;
      const out = { ...base };
      Object.entries(override).forEach(([key, entry]) => {
        if (Object.prototype.hasOwnProperty.call(base, key)) {
          out[key] = mergeCallMeta(base[key], entry);
        } else {
          out[key] = entry;
        }
      });
      return out;
    };

    const quoteCmdArg = (token) => {
      const raw = String(token || '');
      if (!raw) return '';
      if (/[\\\s"]/g.test(raw)) return JSON.stringify(raw);
      return raw;
    };
    const resolvePathWithinPlugin = (relPath, label) => {
      const rel = typeof relPath === 'string' ? relPath.trim() : '';
      if (!rel) return '';
      const resolved = path.resolve(pluginDir, rel);
      const relative = path.relative(pluginDir, resolved);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`${label} must be within plugin directory`);
      }
      return resolved;
    };

    const readDefaultsAiConfigFile = () => {
      const defaultsRoot = this.defaultsRoot;
      if (!defaultsRoot) return null;
      const pluginKey = normalizeDefaultsKey(pluginId);
      const appKey = normalizeDefaultsKey(appId);
      if (!pluginKey || !appKey) return null;

      const baseDir = path.join(defaultsRoot, 'shared', 'defaults', 'ui-apps-expose');
      let baseStat = null;
      try {
        baseStat = fs.statSync(baseDir);
      } catch {
        baseStat = null;
      }
      if (!baseStat?.isDirectory?.()) return null;

      const candidates = [
        `${pluginKey}__${appKey}.yaml`,
        `${pluginKey}__${appKey}.yml`,
        `${pluginKey}__${appKey}.json`,
      ];
      for (const name of candidates) {
        const resolved = path.resolve(baseDir, name);
        const relative = path.relative(baseDir, resolved);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
          continue;
        }
        let stat = null;
        try {
          stat = fs.statSync(resolved);
        } catch {
          stat = null;
        }
        if (!stat?.isFile?.()) continue;

        const maxBytes = Math.min(this.maxManifestBytes, 128 * 1024);
        if (stat.size > maxBytes) {
          errors.push({
            dir: pluginDir,
            source: 'ai',
            message: `App "${pluginId}:${appId}" defaults ai config too large (${stat.size} bytes): ${path.relative(defaultsRoot, resolved)}`,
          });
          continue;
        }

        let raw = '';
        try {
          raw = fs.readFileSync(resolved, 'utf8');
        } catch (err) {
          errors.push({
            dir: pluginDir,
            source: 'ai',
            message: `App "${pluginId}:${appId}" defaults ai config read failed: ${err?.message || String(err)}`,
          });
          continue;
        }

        let parsed = null;
        try {
          const ext = path.extname(resolved).toLowerCase();
          if (ext === '.json') {
            parsed = JSON.parse(raw);
          } else if (ext === '.yaml' || ext === '.yml') {
            parsed = YAML.parse(raw);
          } else {
            const trimmed = String(raw || '').trim();
            parsed = trimmed.startsWith('{') || trimmed.startsWith('[') ? JSON.parse(trimmed) : YAML.parse(trimmed);
          }
        } catch (err) {
          errors.push({
            dir: pluginDir,
            source: 'ai',
            message: `App "${pluginId}:${appId}" defaults ai config parse failed: ${err?.message || String(err)}`,
          });
          continue;
        }

        try {
          return uiAppAiConfigSchema.parse(parsed);
        } catch (err) {
          errors.push({
            dir: pluginDir,
            source: 'ai',
            message: `App "${pluginId}:${appId}" defaults ai config invalid: ${err?.message || String(err)}`,
          });
          continue;
        }
      }
      return null;
    };

    const readAiConfigFile = () => {
      const rel = typeof aiInline?.config === 'string' ? aiInline.config.trim() : '';
      if (!rel) return null;

      let resolved = '';
      try {
        resolved = resolvePathWithinPlugin(rel, 'ai.config');
      } catch (err) {
        errors.push({
          dir: pluginDir,
          source: 'ai',
          message: `App "${pluginId}:${appId}" ai.config error: ${err?.message || String(err)}`,
        });
        return null;
      }
      if (!resolved) return null;

      let stat = null;
      try {
        stat = fs.statSync(resolved);
      } catch {
        errors.push({
          dir: pluginDir,
          source: 'ai',
          message: `App "${pluginId}:${appId}" ai.config not found: ${rel}`,
        });
        return null;
      }
      if (!stat.isFile()) {
        errors.push({
          dir: pluginDir,
          source: 'ai',
          message: `App "${pluginId}:${appId}" ai.config must be a file: ${rel}`,
        });
        return null;
      }
      const maxBytes = Math.min(this.maxManifestBytes, 128 * 1024);
      if (stat.size > maxBytes) {
        errors.push({
          dir: pluginDir,
          source: 'ai',
          message: `App "${pluginId}:${appId}" ai.config too large (${stat.size} bytes): ${rel}`,
        });
        return null;
      }

      let raw = '';
      try {
        raw = fs.readFileSync(resolved, 'utf8');
      } catch (err) {
        errors.push({
          dir: pluginDir,
          source: 'ai',
          message: `App "${pluginId}:${appId}" ai.config read failed: ${err?.message || String(err)}`,
        });
        return null;
      }

      let parsed = null;
      const ext = path.extname(rel).toLowerCase();
      try {
        if (ext === '.json') {
          parsed = JSON.parse(raw);
        } else if (ext === '.yaml' || ext === '.yml') {
          parsed = YAML.parse(raw);
        } else {
          const trimmed = String(raw || '').trim();
          parsed = trimmed.startsWith('{') || trimmed.startsWith('[') ? JSON.parse(trimmed) : YAML.parse(trimmed);
        }
      } catch (err) {
        errors.push({
          dir: pluginDir,
          source: 'ai',
          message: `App "${pluginId}:${appId}" ai.config parse failed: ${err?.message || String(err)}`,
        });
        return null;
      }

      try {
        return uiAppAiConfigSchema.parse(parsed);
      } catch (err) {
        errors.push({
          dir: pluginDir,
          source: 'ai',
          message: `App "${pluginId}:${appId}" ai.config invalid: ${err?.message || String(err)}`,
        });
        return null;
      }
    };

    const defaultsConfig = readDefaultsAiConfigFile();
    const loadedConfig = readAiConfigFile();

    const resolveExpose = (inlineValue, fileValue, defaultsValue) => {
      const inline = normalizeExposeValue(inlineValue);
      const fromFile = normalizeExposeValue(fileValue);
      const fromDefaults = normalizeExposeValue(defaultsValue);

      if (inline === false) return null;
      if (Array.isArray(inline)) return inline;
      if (inline === true) {
        if (fromFile === false) return null;
        if (Array.isArray(fromFile) || fromFile === true) return fromFile;
        if (fromDefaults === false) return null;
        if (Array.isArray(fromDefaults) || fromDefaults === true) return fromDefaults;
        return true;
      }
      // inline unset: only allow file-based config, do not auto-enable defaults
      if (fromFile === false) return null;
      if (Array.isArray(fromFile) || fromFile === true) return fromFile;
      return null;
    };

    const exposeMcpServers = resolveExpose(aiInline?.mcpServers, loadedConfig?.mcpServers, defaultsConfig?.mcpServers);
    const exposePrompts = resolveExpose(aiInline?.prompts, loadedConfig?.prompts, defaultsConfig?.prompts);

    const ai = { ...(defaultsConfig || {}), ...(loadedConfig || {}), ...(aiInline || {}) };
    if (ai && typeof ai === 'object') {
      delete ai.config;
    }

    const buildUiAppCallMeta = () => {
      const dataDir = this.dataRootDir ? path.join(this.dataRootDir, pluginId) : '';
      const context = {
        pluginId,
        appId,
        pluginDir,
        dataDir,
        stateDir: this.stateDir,
        sessionRoot: this.sessionRoot,
        projectRoot: this.projectRoot,
      };
    const uiAppContext = compactContext(context);
    const baseMeta = {};
    if (Object.keys(uiAppContext).length > 0) {
      baseMeta.chatos = { uiApp: uiAppContext };
    }
    if (dataDir) {
      baseMeta.workdir = dataDir;
    }
    const baseMetaValue = Object.keys(baseMeta).length > 0 ? baseMeta : null;
    const rawCallMeta = ai?.mcp?.callMeta && typeof ai.mcp.callMeta === 'object' ? ai.mcp.callMeta : null;
    const resolvedCallMeta = rawCallMeta ? resolveCallMetaValue(rawCallMeta, context) : null;
    return mergeCallMeta(baseMetaValue, resolvedCallMeta);
  };
    const callMeta = ai?.mcp ? buildUiAppCallMeta() : null;

    const hasExposeMcpServers = exposeMcpServers === true || Array.isArray(exposeMcpServers);
    const hasExposePrompts = exposePrompts === true || Array.isArray(exposePrompts);
    if (!ai || (!ai.mcp && !ai.mcpPrompt && !ai.agent && !hasExposeMcpServers && !hasExposePrompts)) return null;

    const resolveMcpUrl = () => {
      const rawUrl = typeof ai?.mcp?.url === 'string' ? ai.mcp.url.trim() : '';
      if (rawUrl) return rawUrl;
      const entryRel = typeof ai?.mcp?.entry === 'string' ? ai.mcp.entry.trim() : '';
      if (!entryRel) return '';
      let entryAbs = '';
      try {
        entryAbs = resolvePathWithinPlugin(entryRel, 'ai.mcp.entry');
      } catch (err) {
        errors.push({
          dir: pluginDir,
          source: 'ai',
          message: `App "${pluginId}:${appId}" ai.mcp.entry error: ${err?.message || String(err)}`,
        });
        return '';
      }
      if (entryAbs) {
        try {
          const stat = fs.statSync(entryAbs);
          if (!stat.isFile()) {
            errors.push({
              dir: pluginDir,
              source: 'ai',
              message: `App "${pluginId}:${appId}" ai.mcp.entry must be a file: ${entryRel}`,
            });
          }
        } catch {
          errors.push({
            dir: pluginDir,
            source: 'ai',
            message: `App "${pluginId}:${appId}" ai.mcp.entry not found: ${entryRel}`,
          });
        }
      }

      const command = typeof ai?.mcp?.command === 'string' && ai.mcp.command.trim() ? ai.mcp.command.trim() : 'node';
      const args = Array.isArray(ai?.mcp?.args) ? ai.mcp.args : [];
      const parts = [command, entryAbs || entryRel, ...args].map(quoteCmdArg).filter(Boolean);
      return parts.length > 0 ? `cmd://${parts.join(' ')}` : '';
    };

    const mcp = ai.mcp
      ? {
          name: serverName,
          url: resolveMcpUrl(),
          description: ai.mcp.description || '',
          tags: Array.isArray(ai.mcp.tags) ? ai.mcp.tags : [],
          enabled: typeof ai.mcp.enabled === 'boolean' ? ai.mcp.enabled : undefined,
          allowMain: typeof ai.mcp.allowMain === 'boolean' ? ai.mcp.allowMain : undefined,
          allowSub: typeof ai.mcp.allowSub === 'boolean' ? ai.mcp.allowSub : undefined,
          callMeta: callMeta || undefined,
          auth: ai.mcp.auth || undefined,
        }
      : null;

    const mcpPrompt = ai.mcpPrompt
      ? {
          title: typeof ai.mcpPrompt?.title === 'string' ? ai.mcpPrompt.title : '',
          zh: buildPromptSource(ai.mcpPrompt?.zh, 'zh'),
          en: buildPromptSource(ai.mcpPrompt?.en, 'en'),
          names: promptNames,
        }
      : null;

    const agent = ai.agent
      ? {
          name: ai.agent.name,
          description: ai.agent.description || '',
          modelId: ai.agent.modelId || '',
        }
      : null;

    if (mcpPrompt && !mcpPrompt.zh && !mcpPrompt.en) {
      errors.push({
        dir: pluginDir,
        source: 'ai',
        message: `App "${pluginId}:${appId}" ai.mcpPrompt is configured but missing zh/en content`,
      });
    }

    return { mcp, mcpPrompt, agent, mcpServers: exposeMcpServers, prompts: exposePrompts };
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

      try {
        registry.registerApp(providerAppId, { name: plugin?.name || providerAppId, version: plugin?.version || '' });
      } catch {
        // ignore
      }

      (Array.isArray(plugin?.apps) ? plugin.apps : []).forEach((app) => {
        const appId = typeof app?.id === 'string' ? app.id.trim() : '';
        if (!appId) return;

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
            registry.registerMcpServer(providerAppId, {
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
              registry.registerPrompt(providerAppId, {
                id: promptName,
                name: promptName,
                title,
                type: 'system',
                content,
                allowMain: true,
                allowSub: true,
              });
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
    const services = this.adminServices;
    if (!services?.mcpServers || !services?.prompts) return false;

    const now = () => new Date().toISOString();
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

    const normalizePromptNameKey = (name) => String(name || '').trim().toLowerCase();
    const normalizeServerKey = (name) => String(name || '').trim().toLowerCase();

    const existingServers = services.mcpServers.list ? services.mcpServers.list() : [];
    const serverByName = new Map(
      (Array.isArray(existingServers) ? existingServers : [])
        .filter((srv) => srv?.name)
        .map((srv) => [normalizeServerKey(srv.name), srv])
    );

    const existingPrompts = services.prompts.list ? services.prompts.list() : [];
    const promptByName = new Map(
      (Array.isArray(existingPrompts) ? existingPrompts : [])
        .filter((p) => p?.name)
        .map((p) => [normalizePromptNameKey(p.name), p])
    );

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

	  let changed = false;
	  let registry = null;
	  try {
	    registry = getRegistryCenter({ db: services?.mcpServers?.db });
	  } catch {
	    registry = null;
	  }

		  pluginsInternal.forEach((plugin) => {
		    const pluginId = typeof plugin?.id === 'string' ? plugin.id.trim() : '';
		    const pluginDir = typeof plugin?.pluginDir === 'string' ? plugin.pluginDir : '';
		    if (!pluginId || !pluginDir) return;
		    const providerAppIdRaw = typeof plugin?.providerAppId === 'string' ? plugin.providerAppId.trim() : '';
		    const providerAppId = providerAppIdRaw || pluginId;
	      (Array.isArray(plugin?.apps) ? plugin.apps : []).forEach((app) => {
        const appId = typeof app?.id === 'string' ? app.id.trim() : '';
        if (!appId) return;
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
          const desired = {
            name: String(mcp.name || '').trim(),
            url: String(mcp.url || '').trim(),
            description: String(mcp.description || '').trim(),
            tags: desiredTags,
            enabled: typeof mcp.enabled === 'boolean' ? mcp.enabled : true,
            allowMain: typeof mcp.allowMain === 'boolean' ? mcp.allowMain : true,
            allowSub: typeof mcp.allowSub === 'boolean' ? mcp.allowSub : true,
            auth: mcp.auth || undefined,
            callMeta: mcp.callMeta || undefined,
            updatedAt: now(),
          };

          const key = normalizeServerKey(desired.name);
          const existing = serverByName.get(key) || null;
	          if (!existing) {
	          try {
	            const created = services.mcpServers.create(desired);
	            serverByName.set(key, created);
	            changed = true;

		            if (registry) {
		              try {
		                registry.registerMcpServer(providerAppId, {
		                  id: created.name,
		                  name: created.name,
		                  url: created.url,
		                  description: created.description,
	                  tags: created.tags,
	                  enabled: created.enabled,
	                  allowMain: created.allowMain,
	                  allowSub: created.allowSub,
	                  auth: created.auth,
	                });
	              } catch (err) {
	                console.error(`[RegistryCenter] Failed to register MCP server ${created.name}:`, err);
	              }
	            }
	          } catch (err) {
	            errors.push({
	              dir: pluginDir,
	              source: 'ai.mcp',
	              message: `Failed to create MCP server "${desired.name}": ${err?.message || String(err)}`,
              });
            }
          } else {
            const patch = {};
            if (existing.url !== desired.url) patch.url = desired.url;
            if ((existing.description || '') !== (desired.description || '')) patch.description = desired.description || '';
            const existingTags = Array.isArray(existing.tags) ? existing.tags.slice().sort() : [];
            const nextTags = Array.isArray(desired.tags) ? desired.tags.slice().sort() : [];
            if (JSON.stringify(existingTags) !== JSON.stringify(nextTags)) patch.tags = desired.tags;
            if (existing.enabled !== desired.enabled) patch.enabled = desired.enabled;
            if (existing.allowMain !== desired.allowMain) patch.allowMain = desired.allowMain;
            if (existing.allowSub !== desired.allowSub) patch.allowSub = desired.allowSub;
            const existingAuth = existing.auth || undefined;
            const nextAuth = desired.auth || undefined;
            if (JSON.stringify(existingAuth || null) !== JSON.stringify(nextAuth || null)) patch.auth = nextAuth || undefined;
            const existingCallMeta = existing.callMeta || undefined;
            const nextCallMeta = desired.callMeta || undefined;
            if (JSON.stringify(existingCallMeta || null) !== JSON.stringify(nextCallMeta || null)) {
              patch.callMeta = nextCallMeta || undefined;
            }

	            if (Object.keys(patch).length > 0) {
	              try {
	                const updated = services.mcpServers.update(existing.id, patch);
	                serverByName.set(key, updated);
	                changed = true;

		                if (registry) {
		                  try {
		                    registry.registerMcpServer(providerAppId, {
		                      id: updated.name,
		                      name: updated.name,
		                      url: updated.url,
		                      description: updated.description,
	                      tags: updated.tags,
	                      enabled: updated.enabled,
	                      allowMain: updated.allowMain,
	                      allowSub: updated.allowSub,
	                      auth: updated.auth,
	                    });
	                  } catch (err) {
	                    console.error(`[RegistryCenter] Failed to update MCP server ${updated.name}:`, err);
	                  }
	                }
	              } catch (err) {
	                errors.push({
	                  dir: pluginDir,
	                  source: 'ai.mcp',
	                  message: `Failed to update MCP server "${desired.name}": ${err?.message || String(err)}`,
                });
              }
            }
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
            { lang: 'zh', name: promptNames.zh, source: prompt.zh, label: 'ai.mcpPrompt.zh' },
            { lang: 'en', name: promptNames.en, source: prompt.en, label: 'ai.mcpPrompt.en' },
          ].filter((v) => v?.source && v?.name);

          variants.forEach((variant) => {
            let content = '';
            try {
              content = readPromptSource(pluginDir, variant.source, variant.label);
            } catch (err) {
              errors.push({
                dir: pluginDir,
                source: 'ai.mcpPrompt',
                message: `Failed to read ${variant.label} for "${pluginId}:${appId}": ${err?.message || String(err)}`,
              });
              return;
            }
            if (!content) return;

            const desired = {
              name: String(variant.name || '').trim(),
              title,
              type: 'system',
              content,
              allowMain: true,
              allowSub: true,
              updatedAt: now(),
            };
            const key = normalizePromptNameKey(desired.name);
            const existing = promptByName.get(key) || null;
	          if (!existing) {
	            try {
	              const created = services.prompts.create(desired);
	              promptByName.set(key, created);
	              changed = true;

		              if (registry) {
		                try {
		                  registry.registerPrompt(providerAppId, {
		                    id: desired.name,
		                    name: desired.name,
		                    title: desired.title,
		                    type: desired.type,
	                    content: desired.content,
	                    allowMain: desired.allowMain,
	                    allowSub: desired.allowSub,
	                  });
	                } catch (err) {
	                  console.error(`[RegistryCenter] Failed to register Prompt ${desired.name}:`, err);
	                }
	              }
	            } catch (err) {
	              errors.push({
	                dir: pluginDir,
	                source: 'ai.mcpPrompt',
	                message: `Failed to create Prompt "${desired.name}": ${err?.message || String(err)}`,
                });
              }
              return;
            }

            const patch = {};
            if ((existing.title || '') !== (desired.title || '')) patch.title = desired.title || '';
            if ((existing.type || '') !== desired.type) patch.type = desired.type;
            if ((existing.content || '') !== desired.content) patch.content = desired.content;
            if (existing.allowMain !== desired.allowMain) patch.allowMain = desired.allowMain;
            if (existing.allowSub !== desired.allowSub) patch.allowSub = desired.allowSub;

	          if (Object.keys(patch).length > 0) {
	            try {
	              const updated = services.prompts.update(existing.id, patch);
	              promptByName.set(key, updated);
	              changed = true;

		              if (registry) {
		                try {
		                  registry.registerPrompt(providerAppId, {
		                    id: desired.name,
		                    name: desired.name,
		                    title: updated.title,
		                    type: updated.type,
	                    content: updated.content,
	                    allowMain: updated.allowMain,
	                    allowSub: updated.allowSub,
	                  });
	                } catch (err) {
	                  console.error(`[RegistryCenter] Failed to update Prompt ${desired.name}:`, err);
	                }
	              }
	            } catch (err) {
	              errors.push({
	                dir: pluginDir,
	                source: 'ai.mcpPrompt',
	                message: `Failed to update Prompt "${desired.name}": ${err?.message || String(err)}`,
                });
              }
            }
          });
        }
      });
    });

    return changed;
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

  #resolveEntry(pluginDir, entry, label = 'entry.path') {
    const entryType = entry?.type;
    if (entryType !== 'module') {
      throw new Error('Only "module" entry type is supported');
    }
    const relPath = typeof entry?.path === 'string' ? entry.path.trim() : '';
    if (!relPath) throw new Error(`${label} is required`);
    const resolved = path.resolve(pluginDir, relPath);
    const relative = path.relative(pluginDir, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`${label} must be within plugin directory`);
    }
    if (!fs.existsSync(resolved)) {
      throw new Error(`${label} not found: ${relPath}`);
    }

    let stat = null;
    try {
      stat = fs.statSync(resolved);
    } catch {
      throw new Error(`${label} not found: ${relPath}`);
    }
    if (!stat.isFile()) {
      throw new Error(`${label} must be a file for module apps: ${relPath}`);
    }

    return { type: 'module', url: pathToFileURL(resolved).toString() };
  }

  #buildInvokeContext(pluginId, plugin) {
    const pluginDir = typeof plugin?.pluginDir === 'string' ? plugin.pluginDir : '';
    const dataDir = this.dataRootDir ? path.join(this.dataRootDir, pluginId) : '';
    this.#ensureDir(dataDir);
    const llmComplete =
      this.llm && typeof this.llm.complete === 'function' ? this.llm.complete.bind(this.llm) : null;
    return {
      pluginId,
      pluginDir,
      dataDir,
      stateDir: this.stateDir,
      sessionRoot: this.sessionRoot,
      projectRoot: this.projectRoot,
      llm: llmComplete
        ? {
            complete: llmComplete,
          }
        : null,
    };
  }

  async #getBackend(plugin) {
    const pluginId = typeof plugin?.id === 'string' ? plugin.id.trim() : '';
    if (!pluginId) throw new Error('pluginId is required');
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
