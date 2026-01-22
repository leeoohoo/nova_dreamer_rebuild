import fs from 'fs';
import os from 'os';
import path from 'path';
import YAML from 'yaml';

import * as colors from '../colors.js';
import { ChatSession } from '../session.js';
import { ModelClient } from '../client.js';
import { resolveSessionRoot } from '../../shared/session-root.js';
import { resolveAuthDir } from '../../shared/state-paths.js';

const DEFAULT_SUMMARY_PROMPT = {
  system:
    '你是一名 AI 助理，负责在对话过长前压缩上下文。请在保持关键信息和待办事项的情况下，用简洁中文总结。输出格式：\n1. 对话要点\n2. 待处理事项',
  user: '{{history}}\n\n请按照上述格式，生成不超过 800 字的总结。',
};

function createSummaryManager(options = {}) {
  const defaultThreshold = 60000;
  const envRaw = process.env.MODEL_CLI_SUMMARY_TOKENS;
  const envThreshold =
    envRaw === undefined || envRaw === null || String(envRaw).trim() === ''
      ? undefined
      : Number(envRaw);
  const configuredThreshold =
    options.summaryThreshold === undefined ? undefined : Number(options.summaryThreshold);
  const threshold = [configuredThreshold, envThreshold, defaultThreshold].find((value) =>
    Number.isFinite(value)
  );
  const enabled = threshold > 0;
  const keepRatio = resolveKeepRatio();
  const configPath = typeof options.configPath === 'string' ? options.configPath : null;
  const eventLogger =
    options.eventLogger && typeof options.eventLogger.log === 'function'
      ? options.eventLogger
      : null;
  let pendingPromise = null;
  const runSummaries = async (session, client, modelName, { force = false, signal } = {}) => {
    if (!session || !client) {
      return false;
    }
    let didSummarize = false;
    let lastSummaryText = '';
    let lastBefore = null;
    let lastAfter = null;
    const targetThreshold = force ? (threshold > 0 ? threshold : defaultThreshold) : threshold;
    const maxPasses = force ? 6 : 3;
    let emitted = false;
    const emitSummaryIfNeeded = () => {
      if (emitted) return;
      emitted = true;
      if (!didSummarize) return;
      const text = typeof lastSummaryText === 'string' ? lastSummaryText.trim() : '';
      if (!text) return;
      const payload = {
        text,
        forced: Boolean(force),
        threshold: targetThreshold,
        keep_ratio: keepRatio,
        before_tokens: Number.isFinite(lastBefore) ? lastBefore : undefined,
        after_tokens: Number.isFinite(lastAfter) ? lastAfter : undefined,
        session_id: typeof session?.sessionId === 'string' ? session.sessionId : null,
      };
      try {
        eventLogger?.log?.('summary', payload);
      } catch {
        // ignore
      }
    };
    for (let pass = 0; pass < maxPasses; pass += 1) {
      throwIfAborted(signal);
      const tokenCount = estimateTokenCount(session.messages);
      if (!force && tokenCount <= threshold) {
        emitSummaryIfNeeded();
        return didSummarize;
      }
      if (force && tokenCount <= targetThreshold && pass > 0) {
        emitSummaryIfNeeded();
        return didSummarize;
      }
      const before = tokenCount;
      const changed = await summarizeSession(session, client, modelName, { keepRatio, signal, configPath });
      const after = estimateTokenCount(session.messages);
      if (!changed || after >= before) {
        emitSummaryIfNeeded();
        return didSummarize;
      }
      didSummarize = true;
      lastBefore = before;
      lastAfter = after;
      const latestSummary = pickLatestSummaryText(session.messages);
      if (latestSummary) {
        lastSummaryText = latestSummary;
      }
      console.log(
        colors.dim(
          `[summary] ${force ? 'Force' : 'Auto'} summary: ~${before} → ~${after} tokens (threshold ~${targetThreshold})`
        )
      );
      if ((!force && after <= threshold) || (force && after <= targetThreshold)) {
        emitSummaryIfNeeded();
        return didSummarize;
      }
    }
    emitSummaryIfNeeded();
    return didSummarize;
  };
  return {
    maybeSummarize: async (session, client, modelName, summaryOptions = {}) => {
      if (!enabled) {
        return false;
      }
      if (pendingPromise) {
        return await pendingPromise;
      }
      const signal = summaryOptions?.signal;
      pendingPromise = runSummaries(session, client, modelName, { signal })
        .catch((err) => {
          if (err?.name === 'AbortError' || signal?.aborted) {
            throw err;
          }
          console.error(colors.yellow(`[summary] Failed to summarize conversation: ${err.message}`));
          return false;
        })
        .finally(() => {
          pendingPromise = null;
        });
      return await pendingPromise;
    },
    forceSummarize: async (session, client, modelName, summaryOptions = {}) => {
      if (pendingPromise) {
        return await pendingPromise;
      }
      const signal = summaryOptions?.signal;
      pendingPromise = runSummaries(session, client, modelName, { force: true, signal })
        .catch((err) => {
          if (err?.name === 'AbortError' || signal?.aborted) {
            throw err;
          }
          console.error(colors.yellow(`[summary] Failed to summarize conversation: ${err.message}`));
          return false;
        })
        .finally(() => {
          pendingPromise = null;
        });
      return await pendingPromise;
    },
    get threshold() {
      return threshold;
    },
    get keepRatio() {
      return keepRatio;
    },
  };

  function resolveKeepRatio() {
    const fallback = 0.3; // Keep the latest ~30% raw; summarize the older ~70%.
    const raw = process.env.MODEL_CLI_SUMMARY_KEEP_RATIO;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(0.95, Math.max(0.05, parsed));
  }
}

function pickLatestSummaryText(messages = []) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || msg.role !== 'system') continue;
    if (msg.name !== 'conversation_summary') continue;
    const content = typeof msg.content === 'string' ? msg.content.trim() : '';
    if (content) return content;
  }
  return '';
}

function createAbortError() {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function estimateTokenCount(messages) {
  if (!Array.isArray(messages)) {
    return 0;
  }
  let total = 0;
  for (const message of messages) {
    if (!message || !message.content) continue;
    const text = extractPlainText(message.content);
    const imageBytes = countImageBytes(message.content);
    // Use UTF-8 byte length to avoid massively undercounting CJK text.
    total += Math.ceil((Buffer.byteLength(text, 'utf8') + imageBytes) / 3);
  }
  return total;
}

function estimateMessageTokens(message) {
  if (!message || !message.content) {
    return 0;
  }
  const text = extractPlainText(message.content);
  const imageBytes = countImageBytes(message.content);
  return Math.ceil((Buffer.byteLength(text, 'utf8') + imageBytes) / 3);
}

async function summarizeSession(session, client, modelName, options = {}) {
  if (!session || !client) {
    return false;
  }
  const signal = options?.signal;
  const keepRatio =
    options && Number.isFinite(options.keepRatio) && options.keepRatio > 0 && options.keepRatio < 1
      ? Number(options.keepRatio)
      : 0.3;

  const baseMessages = [];
  if (session.systemPrompt) {
    baseMessages.push({ role: 'system', content: session.systemPrompt });
  }
  if (typeof session.getExtraSystemPrompts === 'function') {
    baseMessages.push(...session.getExtraSystemPrompts());
  }
  const baseCount = baseMessages.length;
  const all = Array.isArray(session.messages) ? session.messages : [];
  const body = all.slice(baseCount);
  if (body.length < 2) {
    return false;
  }

  const totalBodyTokens = estimateTokenCount(body);
  if (!(totalBodyTokens > 0)) {
    return false;
  }
  const keepTargetTokens = Math.max(1, Math.ceil(totalBodyTokens * keepRatio));
  let keepTokens = 0;
  let tailStartIndex = body.length - 1;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    keepTokens += estimateMessageTokens(body[i]);
    tailStartIndex = i;
    if (keepTokens >= keepTargetTokens) {
      break;
    }
  }

  const lastUserIndex = (() => {
    for (let i = body.length - 1; i >= 0; i -= 1) {
      if (body[i] && body[i].role === 'user') {
        return i;
      }
    }
    return -1;
  })();
  if (lastUserIndex >= 0 && tailStartIndex > lastUserIndex) {
    tailStartIndex = lastUserIndex;
  }
  if (tailStartIndex <= 0) {
    return false;
  }

  const toSummarize = body.slice(0, tailStartIndex);
  const tail = body.slice(tailStartIndex);

  const targetModel = modelName || client.getDefaultModel();
  const summarizer = new ModelClient(client.config);
  const promptConfig = loadSummaryPromptConfig({ configPath: options?.configPath });
  let maxBytes = 60000;
  const minBytes = 4000;
  let summaryText = '';
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    throwIfAborted(signal);
    const summaryPrompt = buildSummaryPrompt(toSummarize, { maxBytes, promptConfig });
    const summarySession = new ChatSession(summaryPrompt.system);
    summaryPrompt.messages.forEach((msg) => summarySession.messages.push({ ...msg }));
    try {
      summaryText = await summarizer.chat(targetModel, summarySession, {
        stream: false,
        disableTools: true,
        maxToolPasses: 1,
        signal,
      });
      break;
    } catch (err) {
      lastError = err;
      if (err?.name === 'AbortError' || signal?.aborted) {
        throw err;
      }
      if (isContextLengthError(err) && maxBytes > minBytes) {
        maxBytes = Math.max(minBytes, Math.floor(maxBytes * 0.5));
        continue;
      }
      throw err;
    }
  }
  const trimmed = (summaryText || '').trim();
  const stamp = new Date().toLocaleString();
  const summaryMessage = trimmed
    ? `【会话总结 ${stamp}】\n${trimmed}`
    : `【会话总结 ${stamp}】\n（自动总结失败${lastError ? `：${lastError.message}` : ''}）`;
  const summaryEntry = {
    role: 'system',
    content: summaryMessage,
    name: 'conversation_summary',
  };

  // 保留：系统 prompt + 用户 prompt + 最新总结 + 最近 ~30% 的原始对话（提升保真）
  session.messages = baseMessages.concat(summaryEntry, tail.map((msg) => ({ ...msg })));
  return true;
}

function buildSummaryPrompt(messages, options = {}) {
  const maxBytes =
    options && Number.isFinite(options.maxBytes) && options.maxBytes > 0
      ? Math.floor(options.maxBytes)
      : undefined;
  const history = renderHistoryForSummary(messages, maxBytes);
  const promptConfig = options?.promptConfig || DEFAULT_SUMMARY_PROMPT;
  const system =
    typeof promptConfig?.system === 'string' && promptConfig.system.trim()
      ? promptConfig.system.trim()
      : DEFAULT_SUMMARY_PROMPT.system;
  const template =
    typeof promptConfig?.user === 'string' && promptConfig.user.trim()
      ? promptConfig.user
      : DEFAULT_SUMMARY_PROMPT.user;
  const userContent = renderSummaryUserTemplate(template, { history });
  return {
    system,
    messages: [{ role: 'user', content: userContent }],
  };
}

function loadSummaryPromptConfig({ configPath } = {}) {
  const promptPath = resolveSummaryPromptPath(configPath);
  try {
    ensureSummaryPromptFile(promptPath);
  } catch (err) {
    return { path: promptPath, ...DEFAULT_SUMMARY_PROMPT };
  }
  let parsed;
  try {
    parsed = YAML.parse(fs.readFileSync(promptPath, 'utf8'));
  } catch {
    return { path: promptPath, ...DEFAULT_SUMMARY_PROMPT };
  }
  const resolvedSystem =
    typeof parsed?.system === 'string'
      ? parsed.system.trim()
      : typeof parsed?.content === 'string'
        ? parsed.content.trim()
        : '';
  const resolvedUser = typeof parsed?.user === 'string' ? parsed.user.trim() : '';
  return {
    path: promptPath,
    system: resolvedSystem || DEFAULT_SUMMARY_PROMPT.system,
    user: resolvedUser || DEFAULT_SUMMARY_PROMPT.user,
  };
}

function resolveSummaryPromptPath(configPath) {
  const envPath =
    typeof process.env.MODEL_CLI_SUMMARY_PROMPT_PATH === 'string'
      ? process.env.MODEL_CLI_SUMMARY_PROMPT_PATH.trim()
      : '';
  if (envPath) {
    return path.resolve(expandHomePath(envPath));
  }
  const baseDir =
    typeof configPath === 'string' && configPath.trim()
      ? path.dirname(configPath)
      : getDefaultConfigDir();
  return path.join(baseDir, 'summary-prompt.yaml');
}

function ensureSummaryPromptFile(filePath) {
  if (!filePath) return;
  if (fs.existsSync(filePath)) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, renderSummaryPromptYaml(DEFAULT_SUMMARY_PROMPT), 'utf8');
}

function renderSummaryPromptYaml(config) {
  const system = typeof config?.system === 'string' ? config.system.trim() : '';
  const user = typeof config?.user === 'string' ? config.user.trim() : '';
  const indent = (text) =>
    String(text || '')
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n');
  return [
    '# Auto-summary prompt config',
    '# Variables: {{history}}',
    'system: |',
    indent(system || DEFAULT_SUMMARY_PROMPT.system),
    'user: |',
    indent(user || DEFAULT_SUMMARY_PROMPT.user),
    '',
  ].join('\n');
}

function renderSummaryUserTemplate(template, { history } = {}) {
  const historyText = typeof history === 'string' ? history : String(history ?? '');
  const rawTemplate = typeof template === 'string' ? template : '';
  if (!rawTemplate.trim()) {
    return renderSummaryUserTemplate(DEFAULT_SUMMARY_PROMPT.user, { history: historyText });
  }
  if (rawTemplate.includes('{{history}}')) {
    return rawTemplate.replaceAll('{{history}}', historyText).trim();
  }
  return `${historyText}\n\n${rawTemplate}`.trim();
}

function expandHomePath(filePath) {
  const text = typeof filePath === 'string' ? filePath : '';
  if (!text.startsWith('~')) {
    return text;
  }
  const home = os.homedir();
  if (!home) return text;
  if (text === '~') return home;
  if (text.startsWith('~/')) return path.join(home, text.slice(2));
  return text;
}

function getDefaultConfigDir() {
  const sessionRoot = resolveSessionRoot();
  const root = sessionRoot || os.homedir() || process.cwd();
  return resolveAuthDir(root);
}

function renderHistoryForSummary(messages, maxBytes = 60000) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return '（无内容）';
  }
  const collected = [];
  const budget =
    Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 60000;
  let usedBytes = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const entry = messages[i];
    if (!entry) continue;
    const role = entry.role || 'unknown';
    const label = role === 'user'
      ? '用户'
      : role === 'assistant'
        ? '助手'
        : role === 'tool'
          ? `工具(${entry.tool_call_id || entry.name || 'tool'})`
          : '系统';
    const prefix = `${label}: `;
    const separator = collected.length > 0 ? '\n\n' : '';
    const headerBytes = Buffer.byteLength(separator + prefix, 'utf8');
    const remaining = budget - usedBytes - headerBytes;
    if (remaining <= 0) {
      break;
    }
    const rawText = extractPlainText(entry.content);
    const ellipsis = '…';
    const ellipsisBytes = Buffer.byteLength(ellipsis, 'utf8');
    const primary = truncateUtf8ByBytes(rawText, remaining);
    let text = primary.text;
    let bodyBytes = primary.usedBytes;
    if (primary.truncated && remaining > ellipsisBytes) {
      const trimmed = truncateUtf8ByBytes(rawText, remaining - ellipsisBytes);
      text = `${trimmed.text}${ellipsis}`;
      bodyBytes = trimmed.usedBytes + ellipsisBytes;
    }
    collected.push(`${prefix}${text}`);
    usedBytes += headerBytes + bodyBytes;
    if (usedBytes >= budget) {
      break;
    }
  }
  return collected.reverse().join('\n\n');
}

function truncateUtf8ByBytes(text, maxBytes) {
  const input = String(text ?? '');
  const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 0;
  if (limit <= 0) {
    return { text: '', usedBytes: 0, truncated: input.length > 0 };
  }
  let used = 0;
  const parts = [];
  for (const ch of input) {
    const codePoint = ch.codePointAt(0);
    const bytes =
      codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (used + bytes > limit) {
      return { text: parts.join(''), usedBytes: used, truncated: true };
    }
    parts.push(ch);
    used += bytes;
  }
  return { text: parts.join(''), usedBytes: used, truncated: false };
}

function extractPlainText(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item.text === 'string') return item.text;
        const url = extractImageUrl(item);
        if (url) return `[image_url bytes=${Buffer.byteLength(url, 'utf8')}]`;
        return '';
      })
      .join(' ');
  }
  if (content && typeof content === 'object' && typeof content.text === 'string') {
    return content.text;
  }
  const url = extractImageUrl(content);
  if (url) {
    return `[image_url bytes=${Buffer.byteLength(url, 'utf8')}]`;
  }
  return String(content ?? '');
}

function extractImageUrl(part) {
  if (!part || typeof part !== 'object') return '';
  if (part.type === 'image_url') {
    if (part.image_url && typeof part.image_url.url === 'string') {
      return part.image_url.url;
    }
    if (typeof part.image_url === 'string') {
      return part.image_url;
    }
  }
  return '';
}

function countImageBytes(content) {
  if (!content) return 0;
  let total = 0;
  const addUrl = (url) => {
    if (typeof url === 'string' && url) {
      total += Buffer.byteLength(url, 'utf8');
    }
  };
  if (Array.isArray(content)) {
    content.forEach((item) => addUrl(extractImageUrl(item)));
    return total;
  }
  if (content && typeof content === 'object') {
    addUrl(extractImageUrl(content));
  }
  return total;
}

export {
  createSummaryManager,
  estimateTokenCount,
  loadSummaryPromptConfig,
  resolveSummaryPromptPath,
  summarizeSession,
  throwIfAborted,
};
