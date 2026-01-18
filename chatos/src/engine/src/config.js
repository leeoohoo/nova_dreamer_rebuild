import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { resolveSessionRoot } from '../shared/session-root.js';
import { resolveAuthDir, resolveStateDirPath } from '../shared/state-paths.js';

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

class AppConfig {
  constructor(models, defaultModel) {
    this.models = models;
    this.defaultModel = defaultModel || null;
  }

  getModel(name) {
    const keys = Object.keys(this.models);
    if (keys.length === 0) {
      throw new ConfigError('No models configured');
    }
    const target = name || this.defaultModel || keys[0];
    const settings = this.models[target];
    if (!settings) {
      throw new ConfigError(`Unknown model ${target}`);
    }
    return settings;
  }
}

function loadConfig(configPath) {
  const resolved = typeof configPath === 'string' ? configPath : String(configPath || '');
  if (!resolved) {
    throw new ConfigError('Config path was not provided');
  }
  if (!fs.existsSync(resolved)) {
    throw new ConfigError(`Config file ${resolved} does not exist`);
  }
  const fileContents = fs.readFileSync(resolved, 'utf8');
  let parsed;
  try {
    parsed = YAML.parse(fileContents) || {};
  } catch (err) {
    throw new ConfigError(`Failed to parse YAML: ${err.message}`);
  }
  const rawModels = parsed.models || {};
  if (rawModels === null || typeof rawModels !== 'object' || Array.isArray(rawModels)) {
    throw new ConfigError('models section must be a mapping');
  }
  const models = {};
  for (const [name, raw] of Object.entries(rawModels)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new ConfigError(`Configuration for ${name} must be a mapping`);
    }
    models[name] = createModelSettings(name, raw);
  }
  const defaultModel = parsed.default_model || parsed.defaultModel || null;
  if (defaultModel && !models[defaultModel]) {
    throw new ConfigError(
      `Configured default_model ${defaultModel} was not found in models list`
    );
  }
  return new AppConfig(models, defaultModel);
}

function createAppConfigFromModels(modelsList = [], secretsList = []) {
  if (!Array.isArray(modelsList) || modelsList.length === 0) {
    throw new ConfigError('No models configured');
  }
  const normalizeSecretName = (value) => String(value || '').trim().toLowerCase();
  const secretValueByName = new Map();
  (Array.isArray(secretsList) ? secretsList : []).forEach((secret) => {
    const name = normalizeSecretName(secret?.name);
    if (!name) return;
    const value = typeof secret?.value === 'string' ? secret.value.trim() : '';
    if (!value) return;
    if (!secretValueByName.has(name)) {
      secretValueByName.set(name, value);
    }
  });
  const models = {};
  let defaultModel = null;
  modelsList.forEach((m) => {
    if (!m.name || !m.provider || !m.model) {
      return;
    }
    const reasoningEffort =
      typeof m.reasoningEffort === 'string'
        ? m.reasoningEffort.trim()
        : typeof m.reasoning_effort === 'string'
          ? m.reasoning_effort.trim()
          : '';
    const apiKeyEnv = m.apiKeyEnv || m.api_key_env || null;
    const resolvedKey = apiKeyEnv
      ? secretValueByName.get(normalizeSecretName(apiKeyEnv)) || null
      : null;
    models[m.name] = {
      name: m.name,
      provider: m.provider,
      model: m.model,
      supports_vision: Boolean(m.supportsVision ?? m.supports_vision),
      reasoning_effort: reasoningEffort || null,
      api_key_env: apiKeyEnv,
      api_key: resolvedKey,
      base_url: m.baseUrl || m.base_url || null,
      system_prompt: m.systemPrompt || null,
      temperature: m.temperature || null,
      max_output_tokens: m.maxOutputTokens || null,
      extra_headers: {},
      extra_body: {},
      tools: Array.isArray(m.tools) ? m.tools : [],
    };
    if (m.isDefault) {
      defaultModel = m.name;
    }
  });
  if (!defaultModel) {
    defaultModel = modelsList.find((m) => m)?.name || null;
  }
  return new AppConfig(models, defaultModel);
}

function createModelSettings(name, raw) {
  if (!raw.provider) {
    throw new ConfigError(`Missing provider for model ${name}`);
  }
  if (!raw.model) {
    throw new ConfigError(`Missing model for model ${name}`);
  }
  const headers = normalizeMapping(raw.extra_headers || raw.extraHeaders, `extra_headers for ${name}`);
  const body = normalizeMapping(raw.extra_body || raw.extraBody, `extra_body for ${name}`);
  const tools = normalizeStringList(raw.tools, `tools for ${name}`);
  return {
    name,
    provider: String(raw.provider),
    model: String(raw.model),
    supports_vision: Boolean(raw.supports_vision ?? raw.supportsVision),
    reasoning_effort: raw.reasoning_effort || raw.reasoningEffort || null,
    api_key_env: raw.api_key_env || raw.apiKeyEnv || null,
    api_key: raw.api_key || raw.apiKey || null,
    base_url: raw.base_url || raw.baseUrl || null,
    system_prompt: raw.system_prompt || raw.systemPrompt || null,
    temperature: raw.temperature === undefined || raw.temperature === null
      ? null
      : Number(raw.temperature),
    max_output_tokens:
      raw.max_output_tokens === undefined && raw.maxOutputTokens === undefined
        ? null
        : Number(
            raw.max_output_tokens ?? raw.maxOutputTokens
          ),
    extra_headers: headers,
    extra_body: body,
    tools,
  };
}

function normalizeMapping(value, label) {
  if (!value) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigError(`${label} must be a mapping`);
  }
  const output = {};
  for (const [key, val] of Object.entries(value)) {
    output[String(key)] = val;
  }
  return output;
}

function normalizeStringList(value, label) {
  if (!value) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ConfigError(`${label} must be a list of strings`);
  }
  return value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new ConfigError(`${label} must contain only strings`);
    }
    return entry;
  });
}

function resolveDefaultConfigPath() {
  const envPath = process.env.MODEL_CLI_CONFIG;
  if (envPath) {
    return path.resolve(envPath);
  }
  const sessionRoot = resolveSessionRoot();
  if (sessionRoot) {
    return resolveStateDirPath(resolveAuthDir(sessionRoot), 'models.yaml');
  }
  const search = findModelsUpwards(process.cwd());
  if (search) {
    return search;
  }
  return path.resolve(process.cwd(), 'models.yaml');
}

function findModelsUpwards(startDir) {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (true) {
    const candidate = path.join(dir, 'models.yaml');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    if (dir === root) {
      break;
    }
    dir = path.dirname(dir);
  }
  return null;
}

export {
  AppConfig,
  ConfigError,
  loadConfig,
  createAppConfigFromModels,
  resolveDefaultConfigPath,
};
