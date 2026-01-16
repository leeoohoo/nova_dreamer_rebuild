import path from 'path';

import { allowExternalOnlyMcpServers, isExternalOnlyMcpServerName } from '../../src/common/host-app.js';

export function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeWorkspaceRoot(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return '';
  return path.resolve(trimmed);
}

export function normalizePromptLanguage(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'zh' || raw === 'en') return raw;
  return '';
}

export function normalizeMcpServerName(value) {
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

export function buildUserMessageContent({ text, attachments, allowVisionInput } = {}) {
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

export function getMcpPromptNameForServer(serverName, language) {
  const base = `mcp_${normalizeMcpServerName(serverName)}`;
  const lang = normalizePromptLanguage(language);
  if (lang === 'en') return `${base}__en`;
  return base;
}

export function buildSystemPrompt({
  agent,
  prompts,
  subagents,
  mcpServers,
  language,
  extraPromptNames,
  autoMcpPrompts = true,
} = {}) {
  const agentRecord = agent && typeof agent === 'object' ? agent : {};
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
