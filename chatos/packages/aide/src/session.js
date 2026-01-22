import crypto from 'crypto';

class ChatSession {
  constructor(systemPrompt = null, options = {}) {
    this.systemPrompt = null;
    this.messages = [];
    this.trailingSystemMessages = [];
    this.extraSystemMessages = [];
    this.sessionId = this.#normalizeSessionId(options.sessionId);
    if (options.extraSystemPrompts !== undefined) {
      this.setExtraSystemPrompts(options.extraSystemPrompts);
    }
    this.reset(systemPrompt);
    if (options.trailingSystemPrompts !== undefined) {
      this.setTrailingSystemPrompts(options.trailingSystemPrompts);
    }
  }

  addUser(content) {
    // DeepSeek reasoner-style APIs expect reasoning_content to be sent only
    // within the same tool-calling turn; clear it when starting a new user turn.
    this.messages.forEach((message) => {
      if (
        message &&
        message.role === 'assistant' &&
        Object.prototype.hasOwnProperty.call(message, 'reasoning_content')
      ) {
        delete message.reasoning_content;
      }
    });
    if (Array.isArray(content)) {
      this.messages.push({
        role: 'user',
        content: content.map((part) => (part && typeof part === 'object' ? { ...part } : part)),
      });
      return;
    }
    this.messages.push({ role: 'user', content: String(content) });
  }

  addAssistant(content, toolCalls = null, metadata = null) {
    const payload = {
      role: 'assistant',
      content: content === null ? null : String(content ?? ''),
    };
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      payload.tool_calls = toolCalls;
    }
    if (
      metadata &&
      Object.prototype.hasOwnProperty.call(metadata, 'reasoning_content') &&
      typeof metadata.reasoning_content === 'string'
    ) {
      payload.reasoning_content = metadata.reasoning_content;
    }
    this.messages.push(payload);
  }

  addToolResult(toolCallId, content, toolName = null) {
    const payload = {
      role: 'tool',
      tool_call_id: String(toolCallId ?? ''),
      content: String(content ?? ''),
    };
    if (toolName !== undefined && toolName !== null && String(toolName).trim()) {
      payload.name = String(toolName);
    }
    this.messages.push(payload);
  }

  getLastUserMessage() {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      const message = this.messages[i];
      if (!message || message.role !== 'user') {
        continue;
      }
      if (typeof message.content === 'string') {
        return message.content;
      }
      if (Array.isArray(message.content)) {
        const text = message.content
          .map((part) => {
            if (!part) return '';
            if (typeof part === 'string') {
              return part;
            }
            if (typeof part.text === 'string') {
              return part.text;
            }
            return '';
          })
          .join('')
          .trim();
        return text;
      }
    }
    return '';
  }

  popLast() {
    if (this.messages.length > 0) {
      this.messages.pop();
    }
  }

  setTrailingSystemPrompts(prompts) {
    this.trailingSystemMessages = normalizeSystemPromptEntries(prompts, 'internal_directives');
  }

  getTrailingSystemPrompts() {
    return Array.isArray(this.trailingSystemMessages)
      ? this.trailingSystemMessages.map((msg) => ({ ...msg }))
      : [];
  }

  setExtraSystemPrompts(prompts) {
    this.extraSystemMessages = normalizeSystemPromptEntries(prompts, 'user_directives');
  }

  getExtraSystemPrompts() {
    return Array.isArray(this.extraSystemMessages)
      ? this.extraSystemMessages.map((msg) => ({ ...msg }))
      : [];
  }

  reset(systemPrompt = undefined) {
    if (systemPrompt !== undefined) {
      if (typeof systemPrompt === 'string') {
        this.systemPrompt = systemPrompt.length > 0 ? systemPrompt : null;
      } else if (systemPrompt === null) {
        this.systemPrompt = null;
      } else {
        const normalized = String(systemPrompt);
        this.systemPrompt = normalized.length > 0 ? normalized : null;
      }
    }
    this.messages = [];
    if (typeof this.systemPrompt === 'string' && this.systemPrompt.length > 0) {
      this.messages.push({ role: 'system', content: this.systemPrompt });
    }
    if (Array.isArray(this.extraSystemMessages) && this.extraSystemMessages.length > 0) {
      this.extraSystemMessages.forEach((msg) => {
        this.messages.push({ ...msg });
      });
    }
  }

  asDicts() {
    const base = this.messages.map((message) => ({ ...message }));
    if (!this.trailingSystemMessages || this.trailingSystemMessages.length === 0) {
      return base;
    }
    const trailing = this.trailingSystemMessages.map((message) => ({ ...message }));
    return base.concat(trailing);
  }

  checkpoint() {
    return this.messages.length;
  }

  restore(length) {
    if (typeof length !== 'number') {
      return;
    }
    this.messages.length = Math.max(0, length);
  }

  setSessionId(sessionId) {
    this.sessionId = this.#normalizeSessionId(sessionId);
  }

  #normalizeSessionId(sessionId) {
    const text = typeof sessionId === 'string' ? sessionId.trim() : '';
    return text || null;
  }
}

function generateSessionId(seedText = '') {
  const seed = `${String(seedText ?? '')}|${new Date().toISOString()}`;
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  return hash.slice(0, 10);
}

function normalizeSystemPromptEntries(prompts, defaultName) {
  if (!prompts) {
    return [];
  }
  const normalized = Array.isArray(prompts) ? prompts : [prompts];
  return normalized
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === 'string') {
        const content = entry.trim();
        if (!content) return null;
        return { role: 'system', content, name: defaultName };
      }
      if (entry && typeof entry === 'object') {
        const content = typeof entry.content === 'string' ? entry.content.trim() : '';
        if (!content) return null;
        const name = entry.name || entry.tag || entry.id || defaultName;
        return { role: 'system', content, name };
      }
      return null;
    })
    .filter(Boolean);
}

export { ChatSession, generateSessionId };
