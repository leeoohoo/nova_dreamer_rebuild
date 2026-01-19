import crypto from 'crypto';

export function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

export function createAbortError() {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

export async function raceWithAbort(promise, signal) {
  if (!signal || typeof signal.addEventListener !== 'function') {
    return promise;
  }
  if (signal.aborted) {
    throw createAbortError();
  }
  let onAbort = null;
  const abortPromise = new Promise((_, reject) => {
    onAbort = () => reject(createAbortError());
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, abortPromise]);
  } finally {
    try {
      if (onAbort && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onAbort);
      }
    } catch {
      // ignore
    }
  }
}

export function parseToolArguments(toolName, argsRaw, toolParameters) {
  if (!argsRaw || !argsRaw.trim()) {
    return {};
  }
  const allowedKeys = extractJsonSchemaObjectKeys(toolParameters);
  try {
    return JSON.parse(argsRaw);
  } catch (err) {
    logToolArgumentParseFailure('raw', toolName, argsRaw, err);
    const repaired = repairJsonString(argsRaw, { allowedKeys });
    if (repaired && repaired !== argsRaw) {
      try {
        return JSON.parse(repaired);
      } catch (err2) {
        logToolArgumentParseFailure('repaired', toolName, repaired, err2);
        const repairedFallback = repairJsonString(argsRaw);
        if (repairedFallback && repairedFallback !== repaired && repairedFallback !== argsRaw) {
          try {
            return JSON.parse(repairedFallback);
          } catch (err3) {
            logToolArgumentParseFailure('repaired-fallback', toolName, repairedFallback, err3);
            throw new Error(`Failed to parse arguments for tool ${toolName}: ${err3.message}`);
          }
        }
        throw new Error(`Failed to parse arguments for tool ${toolName}: ${err2.message}`);
      }
    }
    throw new Error(`Failed to parse arguments for tool ${toolName}: ${err.message}`);
  }
}

export function repairJsonString(input, options = {}) {
  if (!input) {
    return input;
  }
  const allowedKeys = options?.allowedKeys instanceof Set ? options.allowedKeys : null;
  let output = '';
  let inString = false;
  let escaping = false;
  let stringIsKey = false;
  const contextStack = [];
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inString) {
      if (escaping) {
        if (isValidJsonEscape(char)) {
          output += `\\${char}`;
        } else if (char === '\n') {
          output += '\\\\n';
        } else if (char === '\r') {
          output += '\\\\r';
        } else if (char) {
          output += `\\\\${char}`;
        } else {
          output += '\\\\';
        }
        escaping = false;
        continue;
      }
      if (char === '\\') {
        escaping = true;
        continue;
      }
      if (char === '"') {
        const containerType = contextStack.length > 0 ? contextStack[contextStack.length - 1].type : null;
        const parentType = contextStack.length > 1 ? contextStack[contextStack.length - 2].type : null;
        if (stringIsKey || shouldTerminateValueString(input, i, containerType, parentType, contextStack.length, allowedKeys)) {
          inString = false;
          stringIsKey = false;
          updateObjectKeyState(contextStack, false);
          output += char;
        } else {
          output += '\\"';
        }
        continue;
      }
      if (char === '\n') {
        output += '\\n';
        continue;
      }
      if (char === '\r') {
        output += '\\r';
        continue;
      }
      const code = char.charCodeAt(0);
      if (Number.isFinite(code) && code >= 0 && code <= 0x1f) {
        output += `\\u${code.toString(16).padStart(4, '0')}`;
        continue;
      }
      output += char;
      continue;
    }
    if (char === '"') {
      inString = true;
      escaping = false;
      stringIsKey = isExpectingKey(contextStack);
      output += char;
      continue;
    }
    if (char === '{') {
      contextStack.push({ type: 'object', expectingKey: true });
      output += char;
      continue;
    }
    if (char === '[') {
      contextStack.push({ type: 'array' });
      output += char;
      continue;
    }
    if (char === '}' || char === ']') {
      contextStack.pop();
      output += char;
      continue;
    }
    if (char === ':') {
      updateObjectKeyState(contextStack, false);
      output += char;
      continue;
    }
    if (char === ',') {
      updateObjectKeyState(contextStack, true);
      output += char;
      continue;
    }
    output += char;
  }
  if (escaping) {
    output += '\\\\';
  }
  if (inString) {
    output += '"';
  }
  return output;
}

function extractJsonSchemaObjectKeys(schema) {
  const out = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object' && node.properties && typeof node.properties === 'object' && !Array.isArray(node.properties)) {
      Object.keys(node.properties).forEach((k) => out.add(k));
      return;
    }
    const composites = ['oneOf', 'anyOf', 'allOf'];
    for (const key of composites) {
      const list = node[key];
      if (Array.isArray(list)) list.forEach(visit);
    }
  };
  visit(schema);
  return out.size > 0 ? out : null;
}

function isValidJsonEscape(char) {
  if (!char) {
    return false;
  }
  if ('"\\/bfnrt'.includes(char)) {
    return true;
  }
  if (char === 'u') {
    return true;
  }
  return false;
}

function isExpectingKey(stack) {
  if (!stack || stack.length === 0) {
    return false;
  }
  const top = stack[stack.length - 1];
  return Boolean(top && top.type === 'object' && top.expectingKey);
}

function updateObjectKeyState(stack, expecting) {
  if (!stack || stack.length === 0) {
    return;
  }
  const top = stack[stack.length - 1];
  if (top && top.type === 'object') {
    top.expectingKey = Boolean(expecting);
  }
}

function shouldTerminateValueString(source, index, containerType, parentType, depth, allowedKeys) {
  const nextIdx = findNextNonWhitespaceIndex(source, index + 1);
  if (nextIdx === -1) {
    return true;
  }
  const next = source[nextIdx];
  const closesObject = containerType === 'object' && next === '}';
  const closesArray = containerType === 'array' && next === ']';

  if (closesObject || closesArray) {
    const afterCloseIdx = findNextNonWhitespaceIndex(source, nextIdx + 1);
    if (afterCloseIdx === -1) {
      return true;
    }
    if (depth <= 1) {
      return false;
    }
    const afterClose = source[afterCloseIdx];
    if (afterClose === ',') return true;
    if (parentType === 'object' && afterClose === '}') return true;
    if (parentType === 'array' && afterClose === ']') return true;
    return false;
  }

  if (next !== ',') return false;

  const afterCommaIdx = findNextNonWhitespaceIndex(source, nextIdx + 1);
  if (afterCommaIdx === -1) {
    return true;
  }
  const afterComma = source[afterCommaIdx];

  if (containerType === 'object') {
    if (afterComma === '}' || afterComma === ']') {
      return false;
    }
    if (afterComma !== '"') {
      return false;
    }
    const keyToken = readJsonStringToken(source, afterCommaIdx);
    if (!keyToken) return false;
    const colonIdx = findNextNonWhitespaceIndex(source, keyToken.endIndex + 1);
    if (colonIdx === -1 || source[colonIdx] !== ':') return false;

    if (allowedKeys && depth === 1 && !allowedKeys.has(keyToken.value)) {
      return false;
    }
    return true;
  }

  if (containerType === 'array') {
    if (afterComma === ']' || afterComma === '}') {
      return false;
    }
    return true;
  }

  return true;
}

function readJsonStringToken(source, startIndex) {
  const str = typeof source === 'string' ? source : '';
  if (startIndex < 0 || startIndex >= str.length) return null;
  if (str[startIndex] !== '"') return null;

  let value = '';
  let escaping = false;
  for (let i = startIndex + 1; i < str.length; i += 1) {
    const char = str[i];
    if (escaping) {
      escaping = false;
      if (char === 'u') {
        const seq = str.slice(i + 1, i + 5);
        if (seq.length === 4 && /^[0-9a-fA-F]{4}$/.test(seq)) {
          try {
            value += String.fromCharCode(parseInt(seq, 16));
          } catch {
            value += `u${seq}`;
          }
          i += 4;
          continue;
        }
      }
      value += char;
      continue;
    }
    if (char === '\\') {
      escaping = true;
      continue;
    }
    if (char === '"') {
      return { value, endIndex: i };
    }
    value += char;
  }
  return null;
}

function findNextNonWhitespaceIndex(source, startIndex) {
  const str = typeof source === 'string' ? source : '';
  for (let i = startIndex; i < str.length; i += 1) {
    if (!isWhitespace(str[i])) {
      return i;
    }
  }
  return -1;
}

function looksLikeObjectKey(source, startIndex) {
  const next = findNextNonWhitespace(source, startIndex);
  if (!next) return false;
  return next.char === '"' || /[a-zA-Z0-9_$]/.test(next.char);
}

function findNextNonWhitespace(source, startIndex) {
  const str = typeof source === 'string' ? source : '';
  for (let i = startIndex; i < str.length; i += 1) {
    const char = str[i];
    if (!isWhitespace(char)) {
      return { index: i, char };
    }
  }
  return null;
}

function isWhitespace(char) {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

function isDigit(char) {
  return char >= '0' && char <= '9';
}

function logToolArgumentParseFailure(stage, toolName, argsRaw, error) {
  const debug = process.env.MODEL_CLI_DEBUG_TOOL_ARGS === '1';
  if (!debug) return;
  try {
    console.error('[model-cli] tool args parse failed:', {
      stage,
      tool: toolName,
      error: error?.message || String(error),
      args: argsRaw,
    });
  } catch {
    // ignore
  }
}

export function formatToolResultText(result) {
  if (result === undefined || result === null) {
    return '';
  }
  if (typeof result === 'string') {
    return result;
  }
  if (typeof result === 'number' || typeof result === 'boolean') {
    return String(result);
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

export function sanitizeToolResultForSession(text, { tool } = {}) {
  const value = typeof text === 'string' ? text : text == null ? '' : String(text);
  const limit = getToolResultCharLimit();
  if (!value) return '';
  if (value.length <= limit) return value;

  const normalizedTool = typeof tool === 'string' ? tool.trim() : '';
  const note = normalizedTool ? `\n\n[truncated] (${normalizedTool})` : '\n\n[truncated]';

  const sliceLimit = Math.max(0, limit - note.length);
  return `${value.slice(0, sliceLimit)}${note}`;
}

export function getToolResultCharLimit() {
  const raw = typeof process.env.MODEL_CLI_TOOL_RESULT_CHAR_LIMIT === 'string' ? process.env.MODEL_CLI_TOOL_RESULT_CHAR_LIMIT.trim() : '';
  if (!raw) return 120_000;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return 120_000;
  }
  return Math.floor(value);
}

function stripAnsi(input) {
  const text = typeof input === 'string' ? input : input == null ? '' : String(input);
  // CSI (Control Sequence Introducer) + OSC (Operating System Command)
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '');
}

function stripControlChars(input) {
  const text = typeof input === 'string' ? input : input == null ? '' : String(input);
  // Keep newlines/tabs/carriage returns; drop other ASCII control chars (incl. NUL).
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

export function maybeAttachSessionIdForTaskTool(toolName, args, session) {
  if (!toolName || !toolName.includes('task_manager')) {
    return args;
  }
  const payload = { ...(args || {}) };
  const runId = typeof process.env.MODEL_CLI_RUN_ID === 'string' ? process.env.MODEL_CLI_RUN_ID.trim() : '';
  const sessionId = session?.sessionId;
  const match = typeof toolName === 'string' ? toolName.match(/task_manager_(.+)$/) : null;
  const action = (match && match[1]) || '';

  if (runId) {
    if (Array.isArray(payload.tasks) && payload.tasks.length > 0) {
      payload.tasks = payload.tasks.map((task) => ({
        ...(task || {}),
        runId: task?.runId || runId,
      }));
    } else if (!payload.runId) {
      payload.runId = runId;
    }
  }

  if (!sessionId) return payload;

  if (action === 'add_task') {
    if (Array.isArray(payload.tasks) && payload.tasks.length > 0) {
      payload.tasks = payload.tasks.map((task) => ({
        ...(task || {}),
        runId: task?.runId || runId,
        sessionId: task?.sessionId || sessionId,
      }));
    } else if (!payload.sessionId) {
      payload.sessionId = sessionId;
    }
  } else if (action === 'list_tasks') {
    if (!payload.allSessions && !payload.sessionId) {
      payload.sessionId = sessionId;
    }
  } else {
    if (!payload.allSessions && !payload.sessionId) {
      payload.sessionId = sessionId;
    }
  }

  return payload;
}

export function ensureTaskAddPayload(toolName, args, session) {
  if (!toolName || !toolName.includes('task_manager_add_task')) {
    return args;
  }
  const payload = { ...(args || {}) };
  if (Array.isArray(payload.tasks)) {
    const nonEmptyTasks = payload.tasks.filter(Boolean);
    if (nonEmptyTasks.length === 0) {
      delete payload.tasks;
    } else {
      const fallbackTitle = buildFallbackTaskTitle(session);
      payload.tasks = nonEmptyTasks.map((task) => normalizeTaskEntry(task, fallbackTitle));
      return payload;
    }
  }
  if (!payload.title) {
    payload.title = buildFallbackTaskTitle(session);
  }
  return payload;
}

function buildFallbackTaskTitle(session) {
  const raw = typeof session?.getLastUserMessage === 'function' ? session.getLastUserMessage() : '';
  const normalized = String(raw || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!normalized) {
    return 'New task';
  }
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function normalizeTaskEntry(task, fallbackTitle) {
  if (!task || typeof task !== 'object') {
    return { title: fallbackTitle };
  }
  if (task.title && String(task.title).trim()) {
    return task;
  }
  return { ...task, title: fallbackTitle };
}

export const _internal = {
  parseToolArguments,
  repairJsonString,
};

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
  const suffix = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  return `call_${suffix}`;
}

export function normalizeToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return [];
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
    const fn = next.function && typeof next.function === 'object' ? { ...next.function } : { name: '', arguments: '' };
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
  return normalized;
}
