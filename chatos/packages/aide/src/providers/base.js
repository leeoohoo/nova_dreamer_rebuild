import { ConfigError } from '../config.js';

export class ModelProvider {
  constructor(settings) {
    this.settings = settings;
  }

  // To be implemented by subclasses.
  // eslint-disable-next-line class-methods-use-this
  async complete() {
    throw new Error('Not implemented');
  }

  _requireApiKey() {
    const direct = this.settings.api_key ?? this.settings.apiKey;
    const directValue =
      direct === undefined || direct === null ? '' : typeof direct === 'string' ? direct : String(direct);
    if (directValue.trim()) {
      return directValue.trim();
    }

    const envName = typeof this.settings.api_key_env === 'string' ? this.settings.api_key_env.trim() : '';
    if (envName) {
      throw new ConfigError(
        `Missing API key for model ${this.settings.name}. ` +
          `Configure a secret named ${envName} in the Desktop UI (Admin → API Keys). ` +
          `Environment variables are ignored for model API keys.`
      );
    }
    throw new ConfigError(
      `Missing API key for model ${this.settings.name}. ` +
        `Set apiKeyEnv/api_key_env in the model config and create a matching secret in the Desktop UI (Admin → API Keys). ` +
        `Environment variables are ignored for model API keys.`
    );
  }

  _normalizeMessages(messages) {
    const includeReasoning = this.supportsReasoningContent();
    const normalized = [];
    for (const message of messages) {
      const { role } = message;
      if (!role) {
        throw new ConfigError(
          `Messages must include a role; invalid entry for model ${this.settings.name}`
        );
      }
      const normalizedEntry = { role };
      if (message.content !== undefined) {
        if (Array.isArray(message.content)) {
          normalizedEntry.content = message.content.map((part) =>
            part && typeof part === 'object' ? { ...part } : part
          );
        } else {
          normalizedEntry.content = String(message.content ?? '');
        }
      }
      if ((role === 'tool' || role === 'function') && message.name !== undefined && message.name !== null) {
        normalizedEntry.name = String(message.name);
      }
      if (message.tool_call_id !== undefined && message.tool_call_id !== null) {
        normalizedEntry.tool_call_id = String(message.tool_call_id);
      }
      if (Array.isArray(message.tool_calls)) {
        normalizedEntry.tool_calls = message.tool_calls;
      }
      if (includeReasoning && typeof message.reasoning_content === 'string') {
        normalizedEntry.reasoning_content = message.reasoning_content;
      }
      normalized.push(normalizedEntry);
    }
    return normalized;
  }

  // eslint-disable-next-line class-methods-use-this
  supportsReasoningContent() {
    return false;
  }
}
