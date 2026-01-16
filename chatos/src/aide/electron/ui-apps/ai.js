import fs from 'fs';
import path from 'path';

export function resolveUiAppsAi(pluginDir, pluginIdRaw, app, errors) {
  const pluginId = typeof pluginIdRaw === 'string' ? pluginIdRaw.trim() : '';
  const appId = typeof app?.id === 'string' ? app.id.trim() : '';
  const ai = app?.ai && typeof app.ai === 'object' ? app.ai : null;
  if (!ai || (!ai.mcp && !ai.mcpPrompt && !ai.agent)) return null;
  if (!pluginId || !appId) return null;

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

  return { mcp, mcpPrompt, agent };
}

export function syncUiAppsAiContributes({ adminServices, maxPromptBytes }, pluginsInternal, errors) {
  const services = adminServices;
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
    (Array.isArray(existingServers) ? existingServers : []).filter((srv) => srv?.name).map((srv) => [normalizeServerKey(srv.name), srv])
  );

  const existingPrompts = services.prompts.list ? services.prompts.list() : [];
  const promptByName = new Map(
    (Array.isArray(existingPrompts) ? existingPrompts : []).filter((p) => p?.name).map((p) => [normalizePromptNameKey(p.name), p])
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
    if (Number.isFinite(maxPromptBytes) && stat.size > maxPromptBytes) {
      throw new Error(`${label} too large (${stat.size} bytes): ${relPath}`);
    }
    const raw = fs.readFileSync(resolved, 'utf8');
    return String(raw || '').trim();
  };

  let changed = false;

  (Array.isArray(pluginsInternal) ? pluginsInternal : []).forEach((plugin) => {
    const pluginId = typeof plugin?.id === 'string' ? plugin.id.trim() : '';
    const pluginDir = typeof plugin?.pluginDir === 'string' ? plugin.pluginDir : '';
    if (!pluginId || !pluginDir) return;
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
          updatedAt: now(),
        };

        const key = normalizeServerKey(desired.name);
        const existing = serverByName.get(key) || null;
        if (!existing) {
          try {
            const created = services.mcpServers.create(desired);
            serverByName.set(key, created);
            changed = true;
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

          if (Object.keys(patch).length > 0) {
            try {
              const updated = services.mcpServers.update(existing.id, patch);
              serverByName.set(key, updated);
              changed = true;
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
        const title = typeof prompt.title === 'string' && prompt.title.trim() ? prompt.title.trim() : `${app?.name || appId} MCP Prompt`;

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

