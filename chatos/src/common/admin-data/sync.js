import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

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
    const reasoningEffort =
      typeof m.reasoningEffort === 'string'
        ? m.reasoningEffort
        : typeof m.reasoning_effort === 'string'
          ? m.reasoning_effort
          : '';
    const supportsVision = Boolean(m.supportsVision ?? m.supports_vision);
    result[m.name] = {
      provider: m.provider || '',
      model: m.model || '',
      supports_vision: supportsVision || undefined,
      supportsVision: supportsVision || undefined,
      reasoning_effort: reasoningEffort || undefined,
      reasoningEffort: reasoningEffort || undefined,
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
      app_id: s.app_id || undefined,
      name: s.name || '',
      url: s.url || '',
      description: s.description || '',
      auth: s.auth || undefined,
      tags: s.tags || [],
      enabled: s.enabled !== false,
      allowMain: s.allowMain === true,
      allowSub: s.allowSub !== false,
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
      commands: s.commands || [],
      models: Array.isArray(s.models) ? s.models : [],
      modelImplicit: s.modelImplicit === true,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })),
  };
}

function buildPromptsYaml(prompts = [], options = {}) {
  const include = options?.include ? new Set(options.include) : null;
  const exclude = options?.exclude ? new Set(options.exclude) : null;
  const payload = {};
  prompts.forEach((p) => {
    const name = p?.name;
    if (!name) return;
    if (include && !include.has(name)) return;
    if (exclude && exclude.has(name)) return;
    payload[name] = p.content || '';
  });
  if (include) {
    include.forEach((name) => {
      if (!(name in payload)) {
        payload[name] = '';
      }
    });
  }
  return payload;
}

function buildPromptFile(prompts = [], name, defaults = {}) {
  const promptName = typeof name === 'string' ? name.trim() : '';
  const list = Array.isArray(prompts) ? prompts : [];
  const record = list.find((p) => p?.name === promptName) || null;
  const title =
    typeof record?.title === 'string' && record.title.trim()
      ? record.title.trim()
      : promptName;
  const type =
    typeof record?.type === 'string' && record.type.trim()
      ? record.type.trim()
      : 'system';
  const content = typeof record?.content === 'string' ? record.content : '';
  const allowMain =
    typeof record?.allowMain === 'boolean'
      ? record.allowMain
      : defaults.allowMain === true;
  const allowSub =
    typeof record?.allowSub === 'boolean'
      ? record.allowSub
      : defaults.allowSub === true;

  return {
    name: promptName,
    title,
    type,
    allowMain,
    allowSub,
    content,
  };
}

function buildTasksPayload(tasks = []) {
  return { tasks: tasks.map((t) => ({ ...t })) };
}

function buildEventsPayload(events = []) {
  return events.map((e) => ({
    ...e,
    payload: e.payload,
  }));
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
    writeYaml(
      paths.promptsPath,
      buildPromptFile(snapshot.prompts, 'internal_main', { allowMain: true, allowSub: false })
    );
    summary.promptsPath = paths.promptsPath;
  }
  if (paths.systemDefaultPromptPath && Array.isArray(snapshot?.prompts)) {
    writeYaml(
      paths.systemDefaultPromptPath,
      buildPromptFile(snapshot.prompts, 'default', { allowMain: true, allowSub: false })
    );
    summary.systemDefaultPromptPath = paths.systemDefaultPromptPath;
  }
  if (paths.systemUserPromptPath && Array.isArray(snapshot?.prompts)) {
    writeYaml(
      paths.systemUserPromptPath,
      buildPromptFile(snapshot.prompts, 'user_prompt', { allowMain: true, allowSub: false })
    );
    summary.systemUserPromptPath = paths.systemUserPromptPath;
  }
  if (paths.subagentPromptsPath && Array.isArray(snapshot?.prompts)) {
    writeYaml(
      paths.subagentPromptsPath,
      buildPromptFile(snapshot.prompts, 'internal_subagent', { allowMain: false, allowSub: true })
    );
    summary.subagentPromptsPath = paths.subagentPromptsPath;
  }
  if (paths.subagentUserPromptPath && Array.isArray(snapshot?.prompts)) {
    writeYaml(
      paths.subagentUserPromptPath,
      buildPromptFile(snapshot.prompts, 'subagent_user_prompt', { allowMain: false, allowSub: true })
    );
    summary.subagentUserPromptPath = paths.subagentUserPromptPath;
  }
  if (paths.tasksPath && Array.isArray(snapshot?.tasks)) {
    writeJson(paths.tasksPath, buildTasksPayload(snapshot.tasks));
    summary.tasksPath = paths.tasksPath;
  }
  return summary;
}
