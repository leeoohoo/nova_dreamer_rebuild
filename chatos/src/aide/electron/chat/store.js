import { ZodError } from 'zod';

import { chatAgentSchema, chatMessageSchema, chatSessionSchema } from './schemas.js';

function formatZodError(err) {
  if (!(err instanceof ZodError)) return err?.message || String(err);
  return err.errors.map((issue) => `${issue.path.join('.') || 'field'}: ${issue.message}`).join('; ');
}

function parse(schema, payload) {
  try {
    return schema.parse(payload);
  } catch (err) {
    throw new Error(formatZodError(err));
  }
}

function parsePartial(schema, payload) {
  try {
    return schema.partial().parse(payload);
  } catch (err) {
    throw new Error(formatZodError(err));
  }
}

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseMs(ts) {
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : 0;
}

function sortUpdatedDesc(entries) {
  return (Array.isArray(entries) ? entries : []).slice().sort((a, b) => parseMs(b?.updatedAt) - parseMs(a?.updatedAt));
}

function sortCreatedAsc(entries) {
  return (Array.isArray(entries) ? entries : []).slice().sort((a, b) => parseMs(a?.createdAt) - parseMs(b?.createdAt));
}

export function createChatStore(db) {
  if (!db) {
    throw new Error('db is required');
  }

  const listAgents = () => sortUpdatedDesc(db.list('chatAgents') || []);
  const getAgent = (id) => db.get('chatAgents', id);
  const createAgent = (payload) => db.insert('chatAgents', parse(chatAgentSchema, payload));
  const updateAgent = (id, patch) => db.update('chatAgents', id, parsePartial(chatAgentSchema, patch));
  const removeAgent = (id) => db.remove('chatAgents', id);

  const listSessions = () => sortUpdatedDesc(db.list('chatSessions') || []);
  const getSession = (id) => db.get('chatSessions', id);
  const createSession = (payload) => db.insert('chatSessions', parse(chatSessionSchema, payload));
  const updateSession = (id, patch) => db.update('chatSessions', id, parsePartial(chatSessionSchema, patch));
  const removeSession = (id) => db.remove('chatSessions', id);

  const listMessages = (sessionId) => {
    const sid = normalizeId(sessionId);
    if (!sid) return [];
    const all = db.list('chatMessages') || [];
    return sortCreatedAsc(all.filter((msg) => normalizeId(msg?.sessionId) === sid));
  };
  const pageMessages = (sessionId, options = {}) => {
    const sid = normalizeId(sessionId);
    if (!sid) return { messages: [], hasMore: false };
    const limit = Number.isFinite(options?.limit) ? Math.max(1, Math.floor(options.limit)) : 50;
    const beforeId = normalizeId(options?.beforeId);
    const sorted = listMessages(sid);
    if (sorted.length === 0) return { messages: [], hasMore: false };

    let endIndex = sorted.length;
    if (beforeId) {
      const idx = sorted.findIndex((msg) => normalizeId(msg?.id) === beforeId);
      if (idx >= 0) {
        endIndex = idx;
      }
    }
    const startIndex = Math.max(0, endIndex - limit);
    const slice = sorted.slice(startIndex, endIndex);
    return { messages: slice, hasMore: startIndex > 0 };
  };
  const createMessage = (payload) => db.insert('chatMessages', parse(chatMessageSchema, payload));
  const updateMessage = (id, patch) => db.update('chatMessages', id, parsePartial(chatMessageSchema, patch));
  const removeMessage = (id) => db.remove('chatMessages', id);
  const removeMessagesForSession = (sessionId) => {
    const sid = normalizeId(sessionId);
    if (!sid) return { removed: 0 };
    const all = db.list('chatMessages') || [];
    let removed = 0;
    all.forEach((msg) => {
      if (normalizeId(msg?.sessionId) !== sid) return;
      if (msg?.id && db.remove('chatMessages', msg.id)) {
        removed += 1;
      }
    });
    return { removed };
  };

  const ensureDefaultAgent = ({ modelId, name = '默认 Agent' } = {}) => {
    const existing = listAgents();
    if (existing.length > 0) {
      return existing[0];
    }
    const normalizedModelId = normalizeId(modelId);
    if (!normalizedModelId) {
      throw new Error('modelId is required for default agent');
    }
    return createAgent({
      name,
      description: 'UI Chat 默认 Agent',
      prompt: '',
      modelId: normalizedModelId,
      promptIds: [],
      subagentIds: [],
      skills: [],
      mcpServerIds: [],
    });
  };

  const ensureDefaultSession = ({ agentId, title = '新会话', workspaceRoot = '' } = {}) => {
    const sessions = listSessions();
    if (sessions.length > 0) {
      return sessions[0];
    }
    const normalizedAgentId = normalizeId(agentId);
    return createSession({
      title,
      agentId: normalizedAgentId,
      workspaceRoot,
    });
  };

  return {
    agents: { list: listAgents, get: getAgent, create: createAgent, update: updateAgent, remove: removeAgent, ensureDefault: ensureDefaultAgent },
    sessions: {
      list: listSessions,
      get: getSession,
      create: createSession,
      update: updateSession,
      remove: removeSession,
      ensureDefault: ensureDefaultSession,
    },
    messages: {
      list: listMessages,
      page: pageMessages,
      create: createMessage,
      update: updateMessage,
      remove: removeMessage,
      removeForSession: removeMessagesForSession,
    },
  };
}
