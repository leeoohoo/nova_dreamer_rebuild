import fs from 'fs';
import path from 'path';

export function ensureAllSubagentsInstalled({ installedSubagentsPath, pluginsDirList, enableAllSubagents = false }) {
  if (!installedSubagentsPath) return;
  const roots = Array.isArray(pluginsDirList) ? pluginsDirList.filter(Boolean) : [];
  if (roots.length === 0) return;

  const allPluginIds = new Set();
  roots.forEach((root) => {
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      entries.forEach((entry) => {
        if (!entry?.isDirectory?.()) return;
        const id = String(entry.name || '').trim();
        if (!id || id.startsWith('.')) return;
        allPluginIds.add(id);
      });
    } catch {
      // ignore missing roots
    }
  });
  if (allPluginIds.size === 0) return;

  const enabledById = new Map();
  try {
    if (fs.existsSync(installedSubagentsPath)) {
      const raw = fs.readFileSync(installedSubagentsPath, 'utf8');
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed?.plugins) ? parsed.plugins : Array.isArray(parsed) ? parsed : [];
      list.forEach((item) => {
        if (!item) return;
        if (typeof item === 'string') {
          enabledById.set(item, true);
          return;
        }
        if (typeof item === 'object') {
          const id = String(item.id || item.plugin || item.name || '').trim();
          if (!id) return;
          enabledById.set(id, item.enabled !== false);
        }
      });
    }
  } catch {
    // ignore parse errors
  }

  const merged = [];
  const sortedIds = Array.from(allPluginIds).sort((a, b) => a.localeCompare(b));
  sortedIds.forEach((id) => {
    const enabled = enableAllSubagents ? true : enabledById.get(id) !== false;
    merged.push({ id, enabled });
    enabledById.delete(id);
  });
  enabledById.forEach((enabled, id) => {
    merged.push({ id, enabled: enableAllSubagents ? true : enabled !== false });
  });

  try {
    fs.mkdirSync(path.dirname(installedSubagentsPath), { recursive: true });
    fs.writeFileSync(installedSubagentsPath, JSON.stringify({ plugins: merged }, null, 2), 'utf8');
  } catch {
    // ignore write errors
  }
}

export function readLegacyState(filePath) {
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

export function maybePurgeUiAppsSyncedAdminData({ stateDir, adminServices, hostApp } = {}) {
  const stateDirPath = typeof stateDir === 'string' ? stateDir : '';
  const services = adminServices;
  if (!stateDirPath || !services?.mcpServers || !services?.prompts) return { removedServers: 0, removedPrompts: 0 };
  const normalizeHost = (value) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
  const resolvedHost = normalizeHost(hostApp) || normalizeHost(process.env.MODEL_CLI_HOST_APP);
  if (resolvedHost !== 'chatos') return { removedServers: 0, removedPrompts: 0 };

  const markerPath = path.join(stateDirPath, '.uiapps-ai-sync-purged.json');
  try {
    if (fs.existsSync(markerPath)) {
      return { removedServers: 0, removedPrompts: 0 };
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
    fs.mkdirSync(stateDirPath, { recursive: true });
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

  return { removedServers, removedPrompts };
}
