export const DEFAULT_SUBAGENT_MODEL_NAME = 'deepseek_chat';

function normalizeApiKey(value) {
  const raw =
    value === undefined || value === null ? '' : typeof value === 'string' ? value : String(value);
  return raw.trim();
}

function normalizeErrorText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return String(value);
  } catch {
    return '';
  }
}

function redactSecrets(text) {
  if (!text) return '';
  return (
    String(text)
      // Common API key formats (OpenAI/DeepSeek/others)
      .replace(/\bsk-[A-Za-z0-9]{8,}\b/g, 'sk-***')
      // Bearer tokens
      .replace(/\bBearer\s+[A-Za-z0-9._-]{10,}\b/gi, 'Bearer ***')
  );
}

function providerRequiresApiKey(provider) {
  const key = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
  if (!key) return true;
  return (
    key === 'openai' ||
    key === 'deepseek' ||
    key === 'azure' ||
    key === 'openai_compatible' ||
    key === 'openai-compatible'
  );
}

function isModelApiKeyConfigured(client, name) {
  if (!client || typeof client !== 'object') return true;
  const config = client.config;
  if (!config || typeof config !== 'object') return true;

  let settings = null;
  if (typeof config.getModel === 'function') {
    try {
      settings = config.getModel(name);
    } catch {
      return false;
    }
  } else if (config.models && typeof config.models === 'object' && !Array.isArray(config.models)) {
    if (!Object.prototype.hasOwnProperty.call(config.models, name)) {
      return false;
    }
    settings = config.models[name];
  }

  if (!settings || typeof settings !== 'object') return false;
  if (!providerRequiresApiKey(settings.provider)) return true;

  const apiKey = normalizeApiKey(settings.api_key ?? settings.apiKey);
  return Boolean(apiKey);
}

function isModelAvailable(client, name) {
  const candidate = typeof name === 'string' ? name.trim() : '';
  if (!candidate) return false;
  if (!client || typeof client.getModelNames !== 'function') {
    return isModelApiKeyConfigured(client, candidate);
  }
  try {
    const names = client.getModelNames();
    const exists = Array.isArray(names) ? names.includes(candidate) : true;
    if (!exists) return false;
    return isModelApiKeyConfigured(client, candidate);
  } catch {
    return isModelApiKeyConfigured(client, candidate);
  }
}

export function describeModelError(err) {
  const rawStatus = err?.status ?? err?.statusCode ?? err?.response?.status;
  const statusNum = Number(rawStatus);
  const status = Number.isFinite(statusNum) && statusNum > 0 ? statusNum : null;
  const code = normalizeErrorText(err?.code).trim() || null;
  const name = normalizeErrorText(err?.name).trim() || 'Error';
  const rawMessage = normalizeErrorText(err?.message);
  const message = redactSecrets(rawMessage).trim() || null;
  const lower = (message || '').toLowerCase();

  let reason = 'unknown_error';
  if (name === 'ConfigError') {
    reason = 'config_error';
  } else if (status === 401 || name.toLowerCase().includes('authentication')) {
    reason = 'auth_error';
  } else if (status === 403 || name.toLowerCase().includes('permission')) {
    reason = 'permission_denied';
  } else if (status === 404 || name.toLowerCase().includes('notfound')) {
    reason = 'not_found';
  } else if (status === 429 || lower.includes('rate limit')) {
    reason = 'rate_limited';
  } else if (lower.includes('quota') || lower.includes('insufficient_quota')) {
    reason = 'quota_exceeded';
  } else if (status && status >= 500) {
    reason = 'server_error';
  } else if (status && status >= 400) {
    reason = 'invalid_request';
  } else if (
    lower.includes('api key') ||
    lower.includes('unauthorized') ||
    lower.includes('incorrect api') ||
    lower.includes('invalid api')
  ) {
    reason = 'auth_error';
  } else if (lower.includes('forbidden') || lower.includes('permission')) {
    reason = 'permission_denied';
  } else if (code) {
    const transient = ['econnreset', 'etimedout', 'eai_again', 'enotfound', 'socket hang up'];
    if (transient.includes(code.toLowerCase())) {
      reason = 'network_error';
    }
  } else if (
    lower.includes('timeout') ||
    lower.includes('network') ||
    lower.includes('connection reset') ||
    lower.includes('socket hang up')
  ) {
    reason = 'network_error';
  }

  const maxLen = 260;
  const preview =
    message && message.length > maxLen ? `${message.slice(0, maxLen - 3)}...` : message;

  return {
    name,
    status,
    code,
    reason,
    message: preview,
  };
}

export function shouldFallbackToCurrentModelOnError(err) {
  if (!err) return false;
  if (err?.name === 'AbortError') return false;
  const info = describeModelError(err);
  return info.reason !== 'unknown_error';
}

export function resolveSubagentDefaultModel(client, options = {}) {
  const explicit =
    typeof options?.defaultModel === 'string' ? options.defaultModel.trim() : '';
  const env =
    typeof process.env.MODEL_CLI_SUBAGENT_DEFAULT_MODEL === 'string'
      ? process.env.MODEL_CLI_SUBAGENT_DEFAULT_MODEL.trim()
      : '';
  const candidate = explicit || env || DEFAULT_SUBAGENT_MODEL_NAME;
  if (!candidate) return null;

  if (isModelAvailable(client, candidate)) return candidate;
  return null;
}

export function resolveSubagentInvocationModel({ configuredModel, currentModel, client, defaultModel } = {}) {
  const explicit = typeof configuredModel === 'string' ? configuredModel.trim() : '';
  if (explicit) {
    if (isModelAvailable(client, explicit)) {
      return explicit;
    }
    // 子流程配置的模型不可用时：本轮优先回退到主流程当前模型。
    const current = typeof currentModel === 'string' ? currentModel.trim() : '';
    if (current) return current;
  }

  const preferred = resolveSubagentDefaultModel(client, { defaultModel });
  if (preferred) return preferred;

  const current = typeof currentModel === 'string' ? currentModel.trim() : '';
  if (current) return current;

  if (client && typeof client.getDefaultModel === 'function') {
    try {
      return client.getDefaultModel();
    } catch {
      // ignore
    }
  }
  return null;
}

