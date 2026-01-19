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
    }
    if (!isContextLengthError(err)) {
      throw err;
    }
    const signal = options?.signal;
    throwIfAborted(signal);
    const info = parseContextLengthError(err);
    const detail = info?.maxTokens
      ? `（max ${info.maxTokens}, requested ${info.requestedTokens ?? '?'})`
      : '';
    console.log(colors.yellow(`上下文过长，自动总结后重试 ${detail}`));
    if (summaryManager?.forceSummarize) {
      await summaryManager.forceSummarize(session, client, model, { signal });
    } else {
      await summarizeSession(session, client, model, { signal });
    }
    throwIfAborted(signal);
    try {
      return await client.chat(model, session, options);
    } catch (err2) {
      if (!isContextLengthError(err2)) {
        throw err2;
      }
      throwIfAborted(signal);
      console.log(colors.yellow('总结后仍超长，已强制裁剪为最小上下文后重试。'));
      hardTrimSession(session);
      return await client.chat(model, session, options);
    }
  }
}

function isContextLengthError(err) {
  const message = String(err?.message || '');
  return /maximum context length/i.test(message) || /context length/i.test(message);
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
  const message = String(err?.message || '');
  if (!message) return null;
  const maxMatch = message.match(/maximum context length is (\d+)\s*tokens/i);
  if (!maxMatch) return null;
  const requestedMatch = message.match(/requested (\d+)\s*tokens/i);
  return {
    maxTokens: Number(maxMatch[1]),
    requestedTokens: requestedMatch ? Number(requestedMatch[1]) : undefined,
  };
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
