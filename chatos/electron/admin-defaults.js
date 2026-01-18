import fs from 'fs';
import path from 'path';
import {
  buildAdminSeed,
  extractVariables,
  loadBuiltinPromptFiles,
  parseMcpServers,
  parseModelsWithDefault,
  safeRead,
} from '../src/engine/shared/data/legacy.js';
import { getHostApp } from '../src/common/host-app.js';

export { resolveSessionRoot, persistSessionRoot } from '../src/session-root.js';

export function createAdminDefaultsManager({ defaultPaths, adminDb, adminServices } = {}) {
  if (!defaultPaths) {
    throw new Error('defaultPaths is required');
  }
  if (!adminDb) {
    throw new Error('adminDb is required');
  }
  if (!adminServices) {
    throw new Error('adminServices is required');
  }

  function setSubagentModels({ model, plugins } = {}) {
    const targetModel = typeof model === 'string' ? model.trim() : '';
    if (!targetModel) {
      throw new Error('model is required');
    }
    const builtinPluginsRoot = defaultPaths.pluginsDir;
    const userPluginsRoot = defaultPaths.pluginsDirUser;
    const pluginRoots = [userPluginsRoot, builtinPluginsRoot].filter(Boolean);
    const existingRoots = pluginRoots.filter((root) => {
      try {
        return fs.existsSync(root) && fs.statSync(root).isDirectory();
      } catch {
        return false;
      }
    });
    if (existingRoots.length === 0) {
      throw new Error(`Plugins directory not found: ${defaultPaths.pluginsDir}`);
    }
    const candidates = Array.from(
      new Set(
        existingRoots.flatMap((root) => {
          try {
            return fs
              .readdirSync(root, { withFileTypes: true })
              .filter((entry) => entry.isDirectory())
              .map((entry) => entry.name);
          } catch {
            return [];
          }
        })
      )
    );
    const pluginList =
      Array.isArray(plugins) && plugins.length > 0
        ? candidates.filter((p) => plugins.includes(p))
        : candidates;
    if (pluginList.length === 0) {
      throw new Error('No plugins matched selection');
    }

    const ensureUserCopy = (pluginId) => {
      if (!userPluginsRoot) return null;
      const userDir = path.join(userPluginsRoot, pluginId);
      const builtinDir = builtinPluginsRoot ? path.join(builtinPluginsRoot, pluginId) : null;

      try {
        if (fs.existsSync(path.join(userDir, 'plugin.json'))) {
          return userDir;
        }
      } catch {
        // ignore stat errors
      }

      if (!builtinDir) return null;
      try {
        if (!fs.existsSync(path.join(builtinDir, 'plugin.json'))) {
          return null;
        }
      } catch {
        return null;
      }

      try {
        if (fs.existsSync(userDir)) {
          return userDir;
        }
      } catch {
        // ignore
      }

      fs.mkdirSync(userPluginsRoot, { recursive: true });
      fs.cpSync(builtinDir, userDir, { recursive: true, errorOnExist: true });
      return userDir;
    };

    const summary = { model: targetModel, scanned: 0, updated: 0, skipped: 0, errors: [] };
    pluginList.forEach((pluginId) => {
      try {
        const userDir = ensureUserCopy(pluginId);
        const manifestRoot = userDir || existingRoots.map((root) => path.join(root, pluginId)).find((dir) => {
          try {
            return fs.existsSync(path.join(dir, 'plugin.json'));
          } catch {
            return false;
          }
        });
        if (!manifestRoot) {
          summary.skipped += 1;
          return;
        }
        const manifestPath = path.join(manifestRoot, 'plugin.json');
        summary.scanned += 1;

        const raw = fs.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(raw);
        let changed = false;
        if (Array.isArray(manifest.agents)) {
          manifest.agents = manifest.agents.map((agent) => {
            const next = { ...agent, model: targetModel };
            if (next.model !== agent.model) changed = true;
            return next;
          });
        }
        if (Array.isArray(manifest.commands)) {
          manifest.commands = manifest.commands.map((command) => {
            const next = { ...command, model: targetModel };
            if (next.model !== command.model) changed = true;
            return next;
          });
        }
        if (changed) {
          fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
          summary.updated += 1;
        }
      } catch (err) {
        summary.errors.push({ plugin: pluginId, error: err.message || String(err) });
      }
    });
    return summary;
  }

  function readDefaultMcpServers() {
    const raw =
      safeRead(path.join(path.resolve(defaultPaths.defaultsRoot || ''), 'shared', 'defaults', 'mcp.config.json')) ||
      safeRead(defaultPaths.mcpConfig);
    return parseMcpServers(raw);
  }

  function readDefaultModels() {
    const raw =
      safeRead(path.join(path.resolve(defaultPaths.defaultsRoot || ''), 'shared', 'defaults', 'models.yaml')) ||
      safeRead(defaultPaths.models);
    return parseModelsWithDefault(raw).entries;
  }

  function refreshModelsFromDefaults() {
    const now = new Date().toISOString();
    const existing = adminServices.models.list() || [];
    const existingMap = new Map(existing.map((m) => [m.name, m]));

    readDefaultModels().forEach((model) => {
      if (!model?.name) return;
      const prev = existingMap.get(model.name);
      const payload = {
        id: prev?.id,
        name: model.name,
        provider: prev?.provider || model.provider || '',
        model: prev?.model || model.model || '',
        reasoningEffort: prev?.reasoningEffort ?? model.reasoningEffort ?? '',
        baseUrl: prev?.baseUrl || model.baseUrl || '',
        apiKeyEnv: prev?.apiKeyEnv || model.apiKeyEnv || '',
        tools: Array.isArray(prev?.tools) ? prev.tools : model.tools || [],
        description: prev?.description || model.description || '',
        isDefault: prev?.isDefault ?? model.isDefault ?? false,
        createdAt: prev?.createdAt || now,
        updatedAt: now,
      };
      if (prev) {
        adminDb.update('models', prev.id, payload);
      } else {
        adminDb.insert('models', payload);
      }
    });
  }

  function readDefaultPrompts() {
    return loadBuiltinPromptFiles(defaultPaths) || [];
  }

  function refreshBuiltinsFromDefaults() {
    const now = new Date().toISOString();
    const hostApp = getHostApp() || 'chatos';

    try {
      const existingMcp = adminServices.mcpServers.list();
      const mcpMap = new Map((existingMcp || []).map((item) => [item.name, item]));
      readDefaultMcpServers().forEach((srv) => {
        if (!srv?.name) return;
        const prev = mcpMap.get(srv.name);
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
    } catch (err) {
      console.error('[MCP] 同步内置配置失败', err);
    }

    try {
      const existingPrompts = adminServices.prompts.list();
      const promptMap = new Map((existingPrompts || []).map((item) => [item.name, item]));
      readDefaultPrompts().forEach((prompt) => {
        if (!prompt?.name) return;
        const prev = promptMap.get(prompt.name);
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
        const prev = promptMap.get(name);
        if (prev?.builtin && prev?.id) {
          adminDb.remove('prompts', prev.id);
        }
      });
    } catch (err) {
      console.error('[Prompts] 同步内置配置失败', err);
    }
  }

  function maybeReseedModelsFromYaml() {
    const current = adminServices.models.list();
    const looksBroken =
      current.length > 0 &&
      current.every((m) => !m.provider || !m.model || m.name === 'models' || m.name === 'default_model');
    if (!looksBroken) {
      return;
    }
    const seed = buildAdminSeed(defaultPaths);
    if (Array.isArray(seed.models) && seed.models.length > 0) {
      adminDb.reset('models', seed.models);
    }
  }

  function maybeReseedSubagentsFromPlugins() {
    const current = adminServices.subagents.list();
    const seed = buildAdminSeed(defaultPaths);
    if (!Array.isArray(seed.subagents) || seed.subagents.length === 0) return;
    const enabledMap = new Map(current.map((s) => [s.id, s.enabled]));
    const patched = seed.subagents.map((s) => ({
      ...s,
      enabled: enabledMap.has(s.id) ? enabledMap.get(s.id) : s.enabled,
    }));
    adminDb.reset('subagents', patched);
  }

  return {
    readDefaultMcpServers,
    readDefaultModels,
    readDefaultPrompts,
    refreshBuiltinsFromDefaults,
    refreshModelsFromDefaults,
    maybeReseedModelsFromYaml,
    maybeReseedSubagentsFromPlugins,
    setSubagentModels,
  };
}
