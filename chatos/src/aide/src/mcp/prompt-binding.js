import { allowExternalOnlyMcpServers, isExternalOnlyMcpServerName } from '../../shared/host-app.js';

function normalizeMcpServerName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizePromptLanguage(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'zh' || raw === 'en') return raw;
  return '';
}

function getMcpPromptNameForServer(serverName, language) {
  const base = `mcp_${normalizeMcpServerName(serverName)}`;
  const lang = normalizePromptLanguage(language);
  if (lang === 'en') return `${base}__en`;
  return base;
}

function isMcpPromptName(name) {
  const normalized = String(name || '').trim().toLowerCase();
  return normalized.startsWith('mcp_');
}

export function buildMcpPromptBundles({ prompts = [], mcpServers = [], language } = {}) {
  const lang = normalizePromptLanguage(language);
  const allowExternalOnly = allowExternalOnlyMcpServers();
  const promptMap = new Map();
  (Array.isArray(prompts) ? prompts : []).forEach((prompt) => {
    if (!prompt || prompt.type !== 'system') return;
    if (!isMcpPromptName(prompt.name)) return;
    const content = typeof prompt.content === 'string' ? prompt.content.trim() : '';
    if (!content) return;
    const name = String(prompt.name || '').trim().toLowerCase();
    if (!name) return;
    promptMap.set(name, content);
  });

  const normalizeServers = (list) => (Array.isArray(list) ? list : []).filter((srv) => srv?.name);
  const servers = normalizeServers(mcpServers).filter(
    (srv) => allowExternalOnly || !isExternalOnlyMcpServerName(srv.name)
  );

  const buildFor = (predicate) => {
    const selectedNames = [];
    const texts = [];
    const missingPromptNames = [];
    servers.forEach((server) => {
      if (!predicate(server)) return;
      const preferredName = getMcpPromptNameForServer(server.name, lang).toLowerCase();
      const fallbackName = getMcpPromptNameForServer(server.name).toLowerCase();
      const candidates = preferredName === fallbackName ? [preferredName] : [preferredName, fallbackName];
      let resolved = '';
      let usedName = preferredName;
      for (const name of candidates) {
        const content = promptMap.get(name) || '';
        if (content) {
          resolved = content;
          usedName = name;
          break;
        }
      }
      selectedNames.push(usedName);
      if (!resolved) {
        missingPromptNames.push(preferredName);
        return;
      }
      texts.push(resolved);
    });
    return {
      promptNames: selectedNames,
      text: texts.join('\n\n'),
      missingPromptNames,
    };
  };

  return {
    main: buildFor((srv) => srv.enabled !== false && srv.allowMain === true),
    subagent: buildFor((srv) => srv.enabled !== false && srv.allowSub !== false),
  };
}

export { getMcpPromptNameForServer, isMcpPromptName, normalizeMcpServerName };
