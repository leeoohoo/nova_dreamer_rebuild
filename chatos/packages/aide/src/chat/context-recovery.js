import * as colors from '../colors.js';
import { generateSessionId } from '../session.js';

import { summarizeSession, throwIfAborted } from './summary.js';

async function chatWithContextRecovery({ client, model, session, options, summaryManager }) {
  // If a previous run was aborted mid-tool-call, the session may contain an assistant tool_calls
  // message without all tool results. Providers will 400 on that; repair it up-front.
  repairDanglingToolCalls(session, { preserveLatestUser: true });
  try {
    return await client.chat(model, session, options);
  } catch (err) {
    if (isToolCallProtocolError(err)) {
      const signal = options?.signal;
      throwIfAborted(signal);
      const repaired = repairDanglingToolCalls(session, { preserveLatestUser: true });
      if (repaired) {
        console.log(colors.yellow('检测到悬挂的 tool_calls，已自动清理并重试。'));
        throwIfAborted(signal);
        return await client.chat(model, session, options);
      }
      console.log(colors.yellow('检测到 tool_calls 协议错误，但未能修复，继续抛出。'));
    }
    if (!isContextLengthError(err)) {
      throw err;
    }
    const signal = options?.signal;
    throwIfAborted(signal);
    const info = parseContextLengthError(err);
    const detail = formatContextErrorDetail(info);
    console.log(colors.yellow(`上下文过长，准备自动总结后重试${detail}`));
    let summarized = false;
    let summaryError = null;
    try {
      if (summaryManager?.forceSummarize) {
        summarized = await summaryManager.forceSummarize(session, client, model, { signal });
      } else {
        summarized = await summarizeSession(session, client, model, { signal });
      }
    } catch (errSummary) {
      summaryError = errSummary;
      const summaryMessage = normalizeErrorText(errSummary?.message || errSummary);
      console.log(colors.yellow(`自动总结失败${summaryMessage ? `：${summaryMessage}` : ''}`));
    }
    throwIfAborted(signal);
    if (!summarized) {
      const reason = summaryError ? '自动总结失败' : '自动总结未缩短上下文';
      console.log(colors.yellow(`${reason}，将裁剪为最小上下文后重试。`));
      hardTrimSession(session);
      return await client.chat(model, session, options);
    }
    try {
      return await client.chat(model, session, options);
    } catch (err2) {
      if (!isContextLengthError(err2)) {
        throw err2;
      }
      throwIfAborted(signal);
      const nextInfo = parseContextLengthError(err2);
      const nextDetail = formatContextErrorDetail(nextInfo);
      console.log(colors.yellow(`总结后仍超长，已强制裁剪为最小上下文后重试${nextDetail}`));
      hardTrimSession(session);
      return await client.chat(model, session, options);
    }
  }
}

function isContextLengthError(err) {
  const info = extractErrorInfo(err);
  const status = info.status;
  const messageText = info.messages.join('\n').toLowerCase();
  const codeText = [info.code, info.type].filter(Boolean).join(' ').toLowerCase();
  const codePatterns = [
    /context[_\s-]?length/,
    /context_length_exceeded/,
    /max[_\s-]?tokens?/,
    /token[_\s-]?limit/,
    /context_window/,
    /length_exceeded/,
  ];
  const messagePatterns = [
    /maximum context length/,
    /context length/,
    /context window/,
    /token limit/,
    /max(?:imum)?\s*tokens?/,
    /too many tokens/,
    /exceed(?:ed|s)?\s*(?:the )?(?:maximum )?(?:context|token)/,
    /input.*too long/,
    /prompt.*too long/,
    /上下文.*(过长|超出|超长|超过|上限|限制)/,
    /上下文长度/,
    /(token|tokens).*(超|超过|上限|限制)/,
    /最大.*(上下文|token)/,
    /输入.*过长/,
  ];
  const hasCodeHint = matchesAnyPattern(codeText, codePatterns);
  const hasMessageHint = matchesAnyPattern(messageText, messagePatterns);
  if (hasCodeHint || hasMessageHint) {
    return true;
  }
  if (status === 400) {
    const statusHints = /(context|token|length|window|上下文|长度|token)/i;
    return statusHints.test(messageText) || statusHints.test(codeText);
  }
  return false;
}

function isToolCallProtocolError(err) {
  const message = String(err?.message || '');
  if (!message) return false;
  const lower = message.toLowerCase();
  // OpenAI-style error: "An assistant message with 'tool_calls' must be followed by tool messages..."
  return (
    lower.includes('tool_calls') &&
    (lower.includes('tool_call_id') ||
      lower.includes('tool messages') ||
      lower.includes('insufficient tool') ||
      lower.includes("role 'tool'") ||
      lower.includes('role \"tool\"') ||
      lower.includes('messages with role') ||
      lower.includes('must be a response to a preceding message'))
  );
}

function parseContextLengthError(err) {
  const info = extractErrorInfo(err);
  const messages = info.messages;
  const text = messages.join('\n');
  const structured = extractStructuredTokenCounts(err);
  const parsed = extractTokenCountsFromText(text);
  const maxTokens = structured.maxTokens ?? parsed.maxTokens;
  const requestedTokens = structured.requestedTokens ?? parsed.requestedTokens;
  if (
    !info.status &&
    !info.message &&
    !info.code &&
    !info.type &&
    !maxTokens &&
    !requestedTokens
  ) {
    return null;
  }
  return {
    status: info.status,
    code: info.code || undefined,
    type: info.type || undefined,
    message: info.message || undefined,
    rawMessages: messages,
    maxTokens,
    requestedTokens,
  };
}

function formatContextErrorDetail(info) {
  if (!info) return '';
  const parts = [];
  if (Number.isFinite(info.status)) parts.push(`status ${info.status}`);
  if (info.code) parts.push(`code ${info.code}`);
  if (info.type) parts.push(`type ${info.type}`);
  if (Number.isFinite(info.maxTokens)) parts.push(`max ${info.maxTokens}`);
  if (Number.isFinite(info.requestedTokens)) parts.push(`requested ${info.requestedTokens}`);
  if (info.message) parts.push(`message: ${truncateText(info.message, 140)}`);
  return parts.length > 0 ? `（${parts.join(', ')}）` : '';
}

function extractErrorInfo(err) {
  const status = getErrorStatus(err);
  const messages = collectErrorMessages(err);
  const codes = collectErrorCodes(err);
  const types = collectErrorTypes(err);
  return {
    status,
    messages,
    message: messages[0] || '',
    code: codes[0] || '',
    type: types[0] || '',
  };
}

function getErrorStatus(err) {
  const candidates = [
    err?.status,
    err?.statusCode,
    err?.response?.status,
    err?.response?.statusCode,
    err?.response?.data?.status,
    err?.response?.data?.statusCode,
  ];
  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return null;
}

function collectErrorMessages(err) {
  const messages = [];
  const push = (value) => {
    const text = normalizeErrorText(value);
    if (text) messages.push(text);
  };
  push(err?.message);
  push(err?.error?.message);
  push(err?.error?.error?.message);
  push(err?.response?.data?.error?.message);
  push(err?.response?.data?.message);
  push(err?.response?.data?.error_description);
  push(err?.response?.data?.error?.detail);
  push(err?.response?.data?.error?.details);
  if (typeof err?.response?.data === 'string') push(err.response.data);
  if (typeof err?.data === 'string') push(err.data);
  if (typeof err?.error === 'string') push(err.error);
  return Array.from(new Set(messages));
}

function collectErrorCodes(err) {
  const codes = [];
  const push = (value) => {
    const text = normalizeErrorText(value);
    if (text) codes.push(text);
  };
  push(err?.code);
  push(err?.error?.code);
  push(err?.error?.error?.code);
  push(err?.response?.data?.error?.code);
  push(err?.response?.data?.code);
  return Array.from(new Set(codes));
}

function collectErrorTypes(err) {
  const types = [];
  const push = (value) => {
    const text = normalizeErrorText(value);
    if (text) types.push(text);
  };
  push(err?.type);
  push(err?.error?.type);
  push(err?.error?.error?.type);
  push(err?.response?.data?.error?.type);
  push(err?.response?.data?.type);
  return Array.from(new Set(types));
}

function normalizeErrorText(value) {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error && typeof value.message === 'string') {
    return value.message.trim();
  }
  return '';
}

function matchesAnyPattern(text, patterns) {
  if (!text) return false;
  return patterns.some((pattern) => pattern.test(text));
}

function extractStructuredTokenCounts(err) {
  const maxTokens = pickNumber(
    err?.error?.max_tokens,
    err?.error?.maxTokens,
    err?.error?.context_length,
    err?.error?.context_length_max,
    err?.error?.context_window,
    err?.error?.limit,
    err?.response?.data?.error?.max_tokens,
    err?.response?.data?.error?.maxTokens,
    err?.response?.data?.error?.context_length,
    err?.response?.data?.error?.context_length_max,
    err?.response?.data?.error?.context_window,
    err?.response?.data?.error?.limit,
    err?.response?.data?.max_tokens,
    err?.response?.data?.maxTokens,
    err?.response?.data?.context_length,
    err?.response?.data?.context_window,
    err?.data?.error?.max_tokens,
    err?.data?.max_tokens
  );
  const requestedTokens = pickNumber(
    err?.error?.requested_tokens,
    err?.error?.requestedTokens,
    err?.error?.total_tokens,
    err?.error?.prompt_tokens,
    err?.response?.data?.error?.requested_tokens,
    err?.response?.data?.error?.requestedTokens,
    err?.response?.data?.error?.total_tokens,
    err?.response?.data?.error?.prompt_tokens,
    err?.response?.data?.requested_tokens,
    err?.response?.data?.total_tokens,
    err?.data?.error?.requested_tokens,
    err?.data?.requested_tokens
  );
  return { maxTokens, requestedTokens };
}

function extractTokenCountsFromText(text) {
  const source = typeof text === 'string' ? text : '';
  if (!source.trim()) return {};
  const comparePatterns = [
    /(\d+)\s*tokens?\s*(?:>|>=|exceeds|over|greater than)\s*(\d+)\s*tokens?/i,
    /(\d+)\s*token(?:s)?\s*(?:超过|大于|超出|高于)\s*(\d+)\s*token(?:s)?/i,
  ];
  for (const pattern of comparePatterns) {
    const match = source.match(pattern);
    if (match) {
      const requestedTokens = toNumber(match[1]);
      const maxTokens = toNumber(match[2]);
      return { maxTokens, requestedTokens };
    }
  }
  const maxPatterns = [
    /maximum context length is (\d+)\s*tokens?/i,
    /maximum context length.*?(\d+)\s*tokens?/i,
    /context(?:\s*length)?(?:\s*limit| window)?\s*(?:is|:)?\s*(\d+)\s*tokens?/i,
    /max(?:imum)?\s*(?:is|:)?\s*(\d+)\s*tokens?/i,
    /max(?:imum)?\s*tokens?\s*(?:is|:)?\s*(\d+)/i,
    /token(?:s)?\s*limit(?:\s*is|:)?\s*(\d+)/i,
    /(?:up to|at most)\s*(\d+)\s*tokens?/i,
    /最大[^0-9]{0,6}(\d+)\s*(?:token|tokens)?/i,
    /上限[^0-9]{0,6}(\d+)\s*(?:token|tokens)?/i,
    /最多[^0-9]{0,6}(\d+)\s*(?:token|tokens)?/i,
    /上下文[^0-9]{0,6}(\d+)\s*(?:token|tokens)?/i,
  ];
  let maxTokens;
  for (const pattern of maxPatterns) {
    const match = source.match(pattern);
    if (match) {
      maxTokens = toNumber(match[1]);
      if (Number.isFinite(maxTokens)) break;
    }
  }
  const requestedPatterns = [
    /requested\s*(\d+)\s*tokens?/i,
    /you requested\s*(\d+)\s*tokens?/i,
    /request(?:ed)?\s*token(?:s)?\s*(\d+)/i,
    /input.*?(\d+)\s*tokens?/i,
    /prompt.*?(\d+)\s*tokens?/i,
    /请求[^0-9]{0,6}(\d+)\s*(?:token|tokens)?/i,
    /输入[^0-9]{0,6}(\d+)\s*(?:token|tokens)?/i,
    /已用[^0-9]{0,6}(\d+)\s*(?:token|tokens)?/i,
    /使用[^0-9]{0,6}(\d+)\s*(?:token|tokens)?/i,
  ];
  let requestedTokens;
  for (const pattern of requestedPatterns) {
    const match = source.match(pattern);
    if (match) {
      requestedTokens = toNumber(match[1]);
      if (Number.isFinite(requestedTokens)) break;
    }
  }
  return { maxTokens, requestedTokens };
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function pickNumber(...values) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return undefined;
}

function truncateText(text, maxLength = 160) {
  const value = typeof text === 'string' ? text.trim() : String(text ?? '');
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function hardTrimSession(session) {
  if (!session || !Array.isArray(session.messages)) {
    return;
  }
  const lastUser = (() => {
    for (let i = session.messages.length - 1; i >= 0; i -= 1) {
      const msg = session.messages[i];
      if (msg && msg.role === 'user') {
        return { ...msg };
      }
    }
    return null;
  })();
  const retained = [];
  if (session.systemPrompt) {
    retained.push({ role: 'system', content: session.systemPrompt });
  }
  if (typeof session.getExtraSystemPrompts === 'function') {
    retained.push(...session.getExtraSystemPrompts());
  }
  retained.push({
    role: 'system',
    content: '【会话裁剪】因上下文过长，已丢弃历史细节；如需保留关键信息，请在下一条消息补充要点。',
    name: 'conversation_trim_notice',
  });
  if (lastUser) {
    retained.push(lastUser);
  }
  session.messages = retained;
}

function ensureSessionId(session, seedText = '') {
  if (!session) return null;
  if (session.sessionId) {
    process.env.MODEL_CLI_SESSION_ID = session.sessionId;
    return session.sessionId;
  }
  const generated = generateSessionId(seedText);
  session.setSessionId(generated);
  process.env.MODEL_CLI_SESSION_ID = generated;
  console.log(colors.green(`Session ID: ${generated}`));
  return generated;
}

function discardLatestTurn(session) {
  if (!session || !Array.isArray(session.messages) || session.messages.length === 0) {
    return;
  }
  // Remove any assistant/tool messages produced after the latest user message,
  // then drop that user message as well. This prevents dangling tool_calls after abort.
  while (session.messages.length > 0) {
    const last = session.messages[session.messages.length - 1];
    if (!last || last.role !== 'user') {
      session.messages.pop();
      continue;
    }
    session.messages.pop();
    break;
  }
  repairDanglingToolCalls(session);
}

function repairDanglingToolCalls(session, options = {}) {
  if (!session || !Array.isArray(session.messages) || session.messages.length === 0) {
    return false;
  }
  const preserveLatestUser = options?.preserveLatestUser === true;
  const original = session.messages;

  const normalizeId = (value) => {
    if (typeof value === 'string') return value.trim();
    if (value === undefined || value === null) return '';
    return String(value).trim();
  };

  let counter = 0;
  const generateId = () => {
    counter += 1;
    return `call_${generateSessionId(`tool-${counter}`)}`;
  };

  const latestUserText = preserveLatestUser
    ? (() => {
        for (let i = original.length - 1; i >= 0; i -= 1) {
          const msg = original[i];
          if (msg && msg.role === 'user' && typeof msg.content === 'string' && msg.content.trim()) {
            return msg.content;
          }
        }
        return '';
      })()
    : '';

  const repaired = [];
  let changed = false;
  let pending = null;

  const dropPending = () => {
    if (!pending) return;
    repaired.length = pending.startIndex;
    pending = null;
    changed = true;
  };

  for (const msg of original) {
    if (!msg || typeof msg !== 'object') {
      changed = true;
      continue;
    }
    const role = msg.role;
    const hasToolCalls =
      role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;

    if (hasToolCalls) {
      dropPending();

      const calls = [];
      const expectedIds = [];
      const expectedSet = new Set();
      for (const call of msg.tool_calls) {
        if (!call || typeof call !== 'object') {
          changed = true;
          continue;
        }
        const nextCall = { ...call };
        let id = normalizeId(call.id);
        if (!id) {
          id = generateId();
          changed = true;
        }
        while (expectedSet.has(id)) {
          id = generateId();
          changed = true;
        }
        nextCall.id = id;
        expectedIds.push(id);
        expectedSet.add(id);
        calls.push(nextCall);
      }

      const assistantMsg = calls.length > 0 ? { ...msg, tool_calls: calls } : { ...msg };
      if (calls.length > 0) {
        pending = {
          startIndex: repaired.length,
          expectedIds,
          expectedSet,
          seen: new Set(),
          nextUnassignedIndex: 0,
        };
      } else {
        delete assistantMsg.tool_calls;
      }
      repaired.push(assistantMsg);
      continue;
    }

    if (role === 'tool') {
      if (!pending) {
        changed = true;
        continue;
      }
      let toolCallId = normalizeId(msg.tool_call_id);
      if (toolCallId && !pending.expectedSet.has(toolCallId)) {
        changed = true;
        continue;
      }
      if (!toolCallId) {
        while (
          pending.nextUnassignedIndex < pending.expectedIds.length &&
          pending.seen.has(pending.expectedIds[pending.nextUnassignedIndex])
        ) {
          pending.nextUnassignedIndex += 1;
        }
        if (pending.nextUnassignedIndex >= pending.expectedIds.length) {
          changed = true;
          continue;
        }
        toolCallId = pending.expectedIds[pending.nextUnassignedIndex];
        pending.nextUnassignedIndex += 1;
        changed = true;
      }
      const toolMsg = { ...msg, tool_call_id: toolCallId };
      repaired.push(toolMsg);
      pending.seen.add(toolCallId);
      if (pending.seen.size >= pending.expectedSet.size) {
        pending = null;
      }
      continue;
    }

    if (pending) {
      dropPending();
    }
    repaired.push({ ...msg });
  }

  if (pending) {
    dropPending();
  }

  if (!changed) {
    return false;
  }
  session.messages = repaired;
  if (preserveLatestUser && latestUserText) {
    const hasUser = session.messages.some(
      (msg) => msg && msg.role === 'user' && typeof msg.content === 'string' && msg.content.trim()
    );
    if (!hasUser) {
      try {
        session.addUser(latestUserText);
      } catch {
        // ignore
      }
    }
  }
  return true;
}

export { chatWithContextRecovery, discardLatestTurn, ensureSessionId };
