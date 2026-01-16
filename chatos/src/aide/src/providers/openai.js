import crypto from 'crypto';
import OpenAI from 'openai';
import { ModelProvider } from './base.js';

function normalizeToolCallId(id) {
  if (typeof id === 'string') {
    return id.trim();
  }
  if (id === undefined || id === null) {
    return '';
  }
  return String(id).trim();
}

function generateToolCallId() {
  const suffix =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString('hex');
  return `call_${suffix}`;
}

export class OpenAIProvider extends ModelProvider {
  static name = 'openai';

  constructor(settings) {
    super(settings);
    this._client = null;
    this._supportsReasoning = this.#detectReasoningSupport();
  }

  async complete(messages, options = {}) {
    const normalized = this._normalizeMessages(messages);
    const payload = {
      model: this.settings.model,
      messages: normalized,
    };
    if (this.settings.temperature !== null && this.settings.temperature !== undefined) {
      payload.temperature = this.settings.temperature;
    }
    if (
      this.settings.max_output_tokens !== null &&
      this.settings.max_output_tokens !== undefined
    ) {
      payload.max_tokens = this.settings.max_output_tokens;
    }
    if (Array.isArray(options.tools) && options.tools.length > 0) {
      payload.tools = options.tools;
      payload.tool_choice = 'auto';
    }
    Object.assign(payload, this.settings.extra_body || {});
    const reasoningEffort =
      typeof this.settings.reasoning_effort === 'string'
        ? this.settings.reasoning_effort.trim()
        : '';
    const modelId = String(payload.model || '').toLowerCase();
    const isGptFamily = modelId.startsWith('gpt-');
    if (isGptFamily && reasoningEffort && payload.reasoning_effort === undefined) {
      payload.reasoning_effort = reasoningEffort;
    }
    const baseUrl = String(this.settings.base_url || '');
    const isDeepSeek = baseUrl.includes('deepseek');
    // DeepSeek reasoner models expose chain-of-thought via reasoning_content.
    // Some deployments require explicitly enabling thinking mode.
    if (isDeepSeek && this._supportsReasoning && payload.thinking === undefined) {
      payload.thinking = { type: 'enabled' };
    }

    if (process.env.MODEL_CLI_LOG_REQUEST === '1') {
      const preview = { ...payload };
      console.error('[model-cli] request payload:', JSON.stringify(preview, null, 2));
    }

    const client = this.#getClient();
    if (options.stream) {
      return this.#streamResponseWithRetry(
        client,
        payload,
        options.onToken,
        options.onReasoning,
        options.signal
      );
    }
    return this.#singleResponseWithRetry(
      client,
      payload,
      options.onToken,
      options.onReasoning,
      options.signal
    );
  }

  #getClient() {
    if (this._client) {
      return this._client;
    }
    const apiKey = this._requireApiKey();
    this._client = new OpenAI({
      apiKey,
      baseURL: this.settings.base_url || undefined,
      defaultHeaders: this.settings.extra_headers || undefined,
    });
    return this._client;
  }

  supportsReasoningContent() {
    return this._supportsReasoning;
  }

  #detectReasoningSupport() {
    const explicit =
      this.settings.reasoning ??
      this.settings.reasoning_mode ??
      this.settings.enable_reasoning ??
      this.settings.supports_reasoning;
    if (explicit !== undefined) {
      return Boolean(explicit);
    }
    const modelId = String(this.settings.model || '').toLowerCase();
    if (!modelId) {
      return false;
    }
    return modelId.includes('reasoner') || modelId.includes('reasoning');
  }

  async #streamResponse(client, payload, onToken, onReasoning, signal) {
    const stream = await client.chat.completions.create(
      { ...payload, stream: true },
      { signal }
    );
    const toolCalls = [];
    let accumulated = '';
    let reasoningBuffer = '';
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        accumulated += delta.content;
        onToken?.(delta.content);
      } else if (Array.isArray(delta.content)) {
        delta.content.forEach((part) => {
          if (typeof part?.text === 'string' && part.text.length > 0) {
            accumulated += part.text;
            onToken?.(part.text);
          }
        });
      }
      if (Array.isArray(delta.tool_calls)) {
        this.#mergeToolCalls(toolCalls, delta.tool_calls);
      }
      const reasoningCandidates = [
        delta.reasoning_content,
        delta.reasoning,
        delta.thinking,
        delta?.additional_kwargs?.reasoning_content,
        delta?.additional_kwargs?.reasoning,
        chunk.choices?.[0]?.reasoning_content,
        chunk.choices?.[0]?.message?.reasoning_content,
        chunk.choices?.[0]?.message?.reasoning,
        chunk.choices?.[0]?.message?.thinking,
        chunk.reasoning_content,
        chunk.reasoning,
        chunk.thinking,
      ];
      let reasoningDelta = '';
      for (const candidate of reasoningCandidates) {
        reasoningDelta = this.#extractReasoningText(candidate);
        if (reasoningDelta) break;
      }
      if (reasoningDelta) {
        reasoningBuffer += reasoningDelta;
        onReasoning?.(reasoningDelta);
      }
    }
    const reasoningText = reasoningBuffer.trim().length > 0 ? reasoningBuffer : '';
    const normalizedToolCalls = this.#normalizeToolCalls(toolCalls);
    return {
      content: accumulated,
      reasoning: reasoningText || undefined,
      toolCalls: normalizedToolCalls,
    };
  }

  async #singleResponse(client, payload, onToken, onReasoning, signal) {
    const response = await client.chat.completions.create(payload, { signal });
    const message = response.choices?.[0]?.message;
    const content = message?.content || '';
    if (content) {
      onToken?.(content);
    }
    const reasoningCandidates = [
      message?.reasoning_content,
      message?.reasoning,
      message?.thinking,
      message?.additional_kwargs?.reasoning_content,
      message?.additional_kwargs?.reasoning,
      response.choices?.[0]?.reasoning_content,
      response.reasoning_content,
      response.reasoning,
      response.thinking,
    ];
    let reasoningText = '';
    for (const candidate of reasoningCandidates) {
      reasoningText = this.#extractReasoningText(candidate);
      if (reasoningText) break;
    }
    if (reasoningText) {
      onReasoning?.(reasoningText);
    }
    const normalizedToolCalls = this.#normalizeToolCalls(message?.tool_calls);
    return {
      content,
      reasoning: reasoningText || undefined,
      toolCalls: normalizedToolCalls,
    };
  }

  async #streamResponseWithRetry(client, payload, onToken, onReasoning, signal) {
    const maxRetries = this.#maxRetries();
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await this.#streamResponse(client, payload, onToken, onReasoning, signal);
      } catch (err) {
        lastError = err;
        if (!this.#shouldRetry(err) || attempt === maxRetries) {
          throw err;
        }
        await this.#backoff(attempt);
      }
    }
    throw lastError;
  }

  async #singleResponseWithRetry(client, payload, onToken, onReasoning, signal) {
    const maxRetries = this.#maxRetries();
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await this.#singleResponse(client, payload, onToken, onReasoning, signal);
      } catch (err) {
        lastError = err;
        if (!this.#shouldRetry(err) || attempt === maxRetries) {
          throw err;
        }
        await this.#backoff(attempt);
      }
    }
    throw lastError;
  }

  #maxRetries() {
    const env = Number(process.env.MODEL_CLI_RETRY || '');
    if (Number.isFinite(env) && env >= 0) {
      return env;
    }
    return 2;
  }

  #backoff(attempt) {
    const delay = 250 * (attempt + 1);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  #shouldRetry(err) {
    if (!err) return false;
    const code = (err.code || '').toString().toLowerCase();
    const msg = (err.message || '').toLowerCase();
    const transient = ['econnreset', 'etimedout', 'eai_again', 'enotfound', 'socket hang up'];
    if (transient.includes(code)) return true;
    return (
      msg.includes('econnreset') ||
      msg.includes('socket hang up') ||
      msg.includes('timeout') ||
      msg.includes('network') ||
      msg.includes('connection reset')
    );
  }

  #mergeToolCalls(existing, deltas) {
    for (const delta of deltas) {
      const explicitIndex =
        Number.isInteger(delta.index) && delta.index >= 0 ? delta.index : null;
      let index = explicitIndex;
      if (index === null) {
        const deltaId = normalizeToolCallId(delta.id);
        if (deltaId) {
          const found = existing.findIndex(
            (call) => call && normalizeToolCallId(call.id) === deltaId
          );
          index = found >= 0 ? found : existing.length;
        } else {
          index = existing.length > 0 ? existing.length - 1 : 0;
        }
      }
      const target =
        existing[index] ||
        (existing[index] = {
          id: normalizeToolCallId(delta.id) || generateToolCallId(),
          type: delta.type || 'function',
          function: {
            name: delta.function?.name || '',
            arguments: '',
          },
        });
      const normalizedId = normalizeToolCallId(delta.id);
      if (normalizedId) {
        target.id = normalizedId;
      } else if (!normalizeToolCallId(target.id)) {
        target.id = generateToolCallId();
      }
      if (delta.function?.name) {
        target.function.name = delta.function.name;
      }
      if (delta.function?.arguments) {
        target.function.arguments += String(delta.function.arguments);
      }
    }
  }

  #normalizeToolCalls(toolCalls) {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return undefined;
    }
    const seen = new Set();
    const normalized = [];
    for (const call of toolCalls) {
      if (!call || typeof call !== 'object') {
        continue;
      }
      const next = { ...call };
      let id = normalizeToolCallId(next.id);
      if (!id) {
        id = generateToolCallId();
      }
      while (seen.has(id)) {
        id = generateToolCallId();
      }
      seen.add(id);
      next.id = id;
      if (!next.type) {
        next.type = 'function';
      }
      const fn =
        next.function && typeof next.function === 'object'
          ? { ...next.function }
          : { name: '', arguments: '' };
      if (fn.name !== undefined && fn.name !== null) {
        fn.name = typeof fn.name === 'string' ? fn.name : String(fn.name);
      } else {
        fn.name = '';
      }
      if (fn.arguments === undefined || fn.arguments === null) {
        fn.arguments = '';
      } else if (typeof fn.arguments !== 'string') {
        try {
          fn.arguments = JSON.stringify(fn.arguments);
        } catch {
          fn.arguments = String(fn.arguments);
        }
      }
      next.function = fn;
      normalized.push(next);
    }
    return normalized.length > 0 ? normalized : undefined;
  }

  #extractReasoningText(blocks) {
    if (!blocks) {
      return '';
    }
    if (typeof blocks === 'string') {
      return blocks;
    }
    if (Array.isArray(blocks)) {
      return blocks
        .map((entry) => {
          if (!entry) return '';
          if (typeof entry === 'string') {
            return entry;
          }
          if (typeof entry.text === 'string') {
            return entry.text;
          }
          if (typeof entry.content === 'string') {
            return entry.content;
          }
          if (typeof entry.reasoning_content === 'string') {
            return entry.reasoning_content;
          }
          if (typeof entry.reasoning === 'string') {
            return entry.reasoning;
          }
          if (typeof entry.thinking === 'string') {
            return entry.thinking;
          }
          return '';
        })
        .join('');
    }
    if (typeof blocks === 'object') {
      if (typeof blocks.text === 'string') {
        return blocks.text;
      }
      if (typeof blocks.content === 'string') {
        return blocks.content;
      }
      if (typeof blocks.reasoning_content === 'string') {
        return blocks.reasoning_content;
      }
      if (typeof blocks.reasoning === 'string') {
        return blocks.reasoning;
      }
      if (typeof blocks.thinking === 'string') {
        return blocks.thinking;
      }
    }
    return '';
  }
}
