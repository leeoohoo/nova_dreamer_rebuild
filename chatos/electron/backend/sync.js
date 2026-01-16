import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { safeRead } from './legacy.js';

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeYaml(filePath, payload) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, YAML.stringify(payload), 'utf8');
}

function writeJson(filePath, payload) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function buildModelsYamlPayload(models = []) {
  const result = {};
  models.forEach((m) => {
    result[m.name] = {
      provider: m.provider || '',
      model: m.model || '',
      base_url: m.baseUrl || m.base_url || '',
      baseUrl: m.baseUrl || m.base_url || '',
      api_key_env: m.apiKeyEnv || m.api_key_env || '',
      tools: Array.isArray(m.tools) ? m.tools : [],
      description: m.description || '',
    };
  });
  const defaultModel = models.find((m) => m.isDefault)?.name || models[0]?.name || '';
  return {
    default_model: defaultModel || undefined,
    models: result,
  };
}

function buildMcpConfig(mcpServers = []) {
  return {
    servers: mcpServers.map((s) => ({
      name: s.name || '',
      url: s.url || '',
      description: s.description || '',
      auth: s.auth || undefined,
      tags: s.tags || [],
      callMeta: s.callMeta || undefined,
    })),
  };
}

function buildSubagentsPayload(subagents = []) {
  return {
    plugins: subagents.map((s) => ({
      id: s.id || undefined,
      name: s.name || '',
      description: s.description || '',
      entry: s.entry || '',
      enabled: s.enabled !== false,
      agents: s.agents || [],
      tags: s.tags || [],
      skills: s.skills || [],
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })),
  };
}

function buildPromptsYaml(prompts = []) {
  const payload = {};
  prompts.forEach((p) => {
    payload[p.name] = p.content || '';
  });
  return payload;
}

export function syncAdminToFiles(snapshot, paths) {
  if (!paths) return;
  const summary = {};

  if (paths.modelsPath && Array.isArray(snapshot?.models)) {
    writeYaml(paths.modelsPath, buildModelsYamlPayload(snapshot.models));
    summary.modelsPath = paths.modelsPath;
  }
  if (paths.mcpConfigPath && Array.isArray(snapshot?.mcpServers)) {
    writeJson(paths.mcpConfigPath, buildMcpConfig(snapshot.mcpServers));
    summary.mcpConfigPath = paths.mcpConfigPath;
  }
  if (paths.subagentsPath && Array.isArray(snapshot?.subagents)) {
    writeJson(paths.subagentsPath, buildSubagentsPayload(snapshot.subagents));
    summary.subagentsPath = paths.subagentsPath;
  }
  if (paths.promptsPath && Array.isArray(snapshot?.prompts)) {
    writeYaml(paths.promptsPath, buildPromptsYaml(snapshot.prompts));
    summary.promptsPath = paths.promptsPath;
  }

  return summary;
}
