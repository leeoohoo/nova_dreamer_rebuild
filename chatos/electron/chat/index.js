import fs from 'fs';
import path from 'path';

import { createChatRunner } from './runner.js';
import { createChatStore } from './store.js';

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSessionMode(value) {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (mode === 'room') return 'room';
  if (mode === 'all') return 'all';
  return 'session';
}

function uniqueIds(list) {
  const out = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((item) => {
    const value = normalizeId(item);
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  });
  return out;
}

function resolveWorkspaceRoot(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return '';
  return path.resolve(trimmed);
}

function validateWorkspaceRoot(value) {
  const resolved = resolveWorkspaceRoot(value);
  if (!resolved) return '';
  let stats = null;
  try {
    stats = fs.statSync(resolved);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new Error('workspaceRoot 不存在，请选择一个有效目录。');
    }
    throw new Error(`无法访问 workspaceRoot：${err?.message || String(err)}`);
  }
  if (!stats.isDirectory()) {
    throw new Error('workspaceRoot 必须是一个目录。');
  }
  return resolved;
}

function normalizeWorkspaceRootInput(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAgentPayload(payload) {
  const next = payload && typeof payload === 'object' ? { ...payload } : {};
  if (Object.prototype.hasOwnProperty.call(next, 'workspaceRoot')) {
    const root = normalizeWorkspaceRootInput(next.workspaceRoot);
    next.workspaceRoot = root ? validateWorkspaceRoot(root) : '';
  }
  return next;
}

function extractMimeTypeFromDataUrl(dataUrl) {
  const raw = typeof dataUrl === 'string' ? dataUrl : '';
  const match = raw.match(/^data:([^;]+);base64,/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  return '';
}

function normalizeImageAttachments(input) {
  const list = Array.isArray(input) ? input : [];
  const out = [];
  const MAX_IMAGES = 4;
  for (const entry of list) {
    if (out.length >= MAX_IMAGES) break;
    let dataUrl = '';
    let id = '';
    let name = '';
    let mimeType = '';
    if (typeof entry === 'string') {
      dataUrl = entry.trim();
    } else if (entry && typeof entry === 'object') {
      id = normalizeId(entry.id);
      name = typeof entry.name === 'string' ? entry.name.trim() : '';
      mimeType = typeof entry.mimeType === 'string' ? entry.mimeType.trim() : '';
      dataUrl = typeof entry.dataUrl === 'string' ? entry.dataUrl.trim() : typeof entry.url === 'string' ? entry.url.trim() : '';
    }
    if (!dataUrl || !dataUrl.startsWith('data:image/')) continue;
    if (!mimeType) {
      mimeType = extractMimeTypeFromDataUrl(dataUrl);
    }
    out.push({
      id: id || `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'image',
      name,
      mimeType,
      dataUrl,
    });
  }
  return out;
}

function buildRoomPrompt({ hostAgent, memberAgents } = {}) {
  const hostName = typeof hostAgent?.name === 'string' && hostAgent.name.trim() ? hostAgent.name.trim() : normalizeId(hostAgent?.id) || '默认助手';
  const allAgents = Array.isArray(memberAgents) ? memberAgents.filter(Boolean) : [];
  const agentLines = [];
  const pushAgentLine = (agent) => {
    if (!agent) return;
    const name = typeof agent?.name === 'string' && agent.name.trim() ? agent.name.trim() : normalizeId(agent?.id) || '未命名';
    const desc = typeof agent?.description === 'string' ? agent.description.trim() : '';
    agentLines.push(`- @${name}${desc ? `：${desc}` : ''}`);
  };
  pushAgentLine(hostAgent);
  allAgents.forEach((agent) => {
    if (normalizeId(agent?.id) === normalizeId(hostAgent?.id)) return;
    pushAgentLine(agent);
  });
  const rules = [
    '【聊天室规则】',
    `你是该聊天室的默认助手（主持人：${hostName}）。`,
    '当用户没有 @ 任何 Agent 时，由你直接回答用户问题。',
    '当用户 @ 某个 Agent 时，你需要调用 invoke_chat_agent 让该 Agent 回答。',
    '只有你可以 @ 其他 Agent；其他 Agent 不允许 @ 或调度其他 Agent。',
    '当被调用的 Agent 输出后，你需要汇总并回复给用户；如需补充可继续调用其他 Agent。',
    '调用方式：使用工具 invoke_chat_agent，参数包含 agent_id 或 agent_name 以及 task。',
  ];
  const directory = ['【可用 Agent】', ...(agentLines.length > 0 ? agentLines : ['- 暂无可用 Agent'])];
  return [...rules, '', ...directory].join('\n').trim();
}

export function registerChatApi(ipcMain, options = {}) {
  const {
    adminDb,
    adminServices,
    defaultPaths,
    sessionRoot,
    workspaceRoot,
    subAgentManager,
    uiApps,
    mainWindowGetter,
  } = options;
  if (!ipcMain) throw new Error('ipcMain is required');
  if (!adminDb) throw new Error('adminDb is required');
  if (!adminServices) throw new Error('adminServices is required');
  if (!defaultPaths) throw new Error('defaultPaths is required');

  const getMainWindow = typeof mainWindowGetter === 'function' ? mainWindowGetter : () => null;
  const store = createChatStore(adminDb);
  const defaultWorkspaceRoot = (() => {
    try {
      return validateWorkspaceRoot(workspaceRoot) || process.cwd();
    } catch {
      return process.cwd();
    }
  })();
  const sendEvent = (payload) => {
    const win = getMainWindow();
    if (!win) return;
    win.webContents.send('chat:event', payload);
  };
  const runner = createChatRunner({
    adminServices,
    defaultPaths,
    sessionRoot,
    workspaceRoot,
    subAgentManager,
    uiApps,
    store,
    sendEvent,
  });

  ipcMain.handle('chat:agents:ensureDefault', async () => {
    const models = adminServices.models.list();
    const defaultModel = models.find((m) => m?.isDefault) || models[0];
    if (!defaultModel?.id) {
      throw new Error('No models configured');
    }
    const agent = store.agents.ensureDefault({ modelId: defaultModel.id });
    return { ok: true, agent };
  });

  ipcMain.handle('chat:agents:list', async () => ({ ok: true, agents: store.agents.list() }));
  ipcMain.handle('chat:agents:create', async (_event, payload = {}) => ({
    ok: true,
    agent: store.agents.create(normalizeAgentPayload(payload)),
  }));
  ipcMain.handle('chat:agents:update', async (_event, payload = {}) => {
    const id = normalizeId(payload?.id);
    if (!id) throw new Error('id is required');
    const agent = store.agents.update(id, normalizeAgentPayload(payload?.data || {}));
    if (!agent) throw new Error('agent not found');
    return { ok: true, agent };
  });
  ipcMain.handle('chat:agents:delete', async (_event, payload = {}) => {
    const id = normalizeId(payload?.id);
    if (!id) throw new Error('id is required');
    const sessions = store.sessions.list({ mode: 'session' }).filter((s) => normalizeId(s?.agentId) === id);
    const rooms = store.rooms.list().filter((room) => {
      const hostId = normalizeId(room?.hostAgentId) || normalizeId(room?.agentId);
      if (hostId === id) return true;
      return Array.isArray(room?.memberAgentIds) && room.memberAgentIds.some((memberId) => normalizeId(memberId) === id);
    });
    if (sessions.length > 0 || rooms.length > 0) {
      return { ok: false, message: '该 agent 仍有会话在使用，无法删除。' };
    }
    return { ok: true, removed: store.agents.remove(id) };
  });

  ipcMain.handle('chat:sessions:ensureDefault', async (_event, payload = {}) => {
    const agentId = normalizeId(payload?.agentId);
    const desiredWorkspaceRoot = normalizeId(payload?.workspaceRoot) ? validateWorkspaceRoot(payload.workspaceRoot) : defaultWorkspaceRoot;
    const session = store.sessions.ensureDefault({ agentId, workspaceRoot: desiredWorkspaceRoot });
    if (session?.id && !normalizeId(session?.workspaceRoot) && desiredWorkspaceRoot) {
      try {
        store.sessions.update(session.id, { workspaceRoot: desiredWorkspaceRoot });
      } catch {
        // ignore
      }
    }
    return { ok: true, session };
  });

  ipcMain.handle('chat:sessions:list', async (_event, payload = {}) => {
    const mode = normalizeSessionMode(payload?.mode);
    const sessions = store.sessions.list({ mode });
    return { ok: true, sessions };
  });
  ipcMain.handle('chat:sessions:create', async (_event, payload = {}) => {
    if (normalizeSessionMode(payload?.mode) === 'room') {
      throw new Error('room mode not allowed in chat:sessions:create');
    }
    const desiredWorkspaceRoot = normalizeId(payload?.workspaceRoot) ? validateWorkspaceRoot(payload.workspaceRoot) : defaultWorkspaceRoot;
    return { ok: true, session: store.sessions.create({ ...payload, mode: 'session', workspaceRoot: desiredWorkspaceRoot }) };
  });
  ipcMain.handle('chat:sessions:update', async (_event, payload = {}) => {
    const id = normalizeId(payload?.id);
    if (!id) throw new Error('id is required');
    const existing = store.sessions.get(id);
    if (!existing) throw new Error('session not found');
    if (normalizeSessionMode(existing?.mode) === 'room') {
      throw new Error('room session cannot be updated via chat:sessions:update');
    }
    const patch = payload?.data && typeof payload.data === 'object' ? { ...payload.data } : {};
    if (normalizeSessionMode(patch?.mode) === 'room') {
      throw new Error('room mode not allowed in chat:sessions:update');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'workspaceRoot')) {
      patch.workspaceRoot = normalizeId(patch.workspaceRoot) ? validateWorkspaceRoot(patch.workspaceRoot) : '';
    }
    const session = store.sessions.update(id, patch);
    if (!session) throw new Error('session not found');
    return { ok: true, session };
  });
  ipcMain.handle('chat:sessions:delete', async (_event, payload = {}) => {
    const id = normalizeId(payload?.id);
    if (!id) throw new Error('id is required');
    const existing = store.sessions.get(id);
    if (!existing) throw new Error('session not found');
    if (normalizeSessionMode(existing?.mode) === 'room') {
      throw new Error('room session cannot be deleted via chat:sessions:delete');
    }
    store.messages.removeForSession(id);
    return { ok: true, removed: store.sessions.remove(id) };
  });

  ipcMain.handle('chat:rooms:list', async () => ({ ok: true, rooms: store.rooms.list() }));
  ipcMain.handle('chat:rooms:create', async (_event, payload = {}) => {
    const title = typeof payload?.title === 'string' ? payload.title.trim() : '新聊天室';
    const hostAgentId = normalizeId(payload?.hostAgentId || payload?.agentId);
    if (!hostAgentId) throw new Error('hostAgentId is required');
    const hostAgent = store.agents.get(hostAgentId);
    if (!hostAgent) throw new Error('host agent not found');
    const memberAgentIds = uniqueIds(payload?.memberAgentIds).filter((id) => id && id !== hostAgentId);
    const memberAgents = memberAgentIds.map((id) => store.agents.get(id)).filter(Boolean);
    const desiredWorkspaceRoot = normalizeId(payload?.workspaceRoot)
      ? validateWorkspaceRoot(payload.workspaceRoot)
      : defaultWorkspaceRoot;
    const roomPrompt = buildRoomPrompt({ hostAgent, memberAgents });
    const room = store.rooms.create({
      title: title || '新聊天室',
      hostAgentId,
      memberAgentIds,
      agentId: hostAgentId,
      roomPrompt,
      workspaceRoot: desiredWorkspaceRoot,
    });
    return { ok: true, room };
  });
  ipcMain.handle('chat:rooms:update', async (_event, payload = {}) => {
    const id = normalizeId(payload?.id);
    if (!id) throw new Error('id is required');
    const existing = store.rooms.get(id);
    if (!existing) throw new Error('room not found');
    const patch = payload?.data && typeof payload.data === 'object' ? { ...payload.data } : {};
    const next = { ...patch };
    const hostUpdated = Object.prototype.hasOwnProperty.call(patch, 'hostAgentId');
    const membersUpdated = Object.prototype.hasOwnProperty.call(patch, 'memberAgentIds');

    if (Object.prototype.hasOwnProperty.call(next, 'workspaceRoot')) {
      next.workspaceRoot = normalizeId(next.workspaceRoot) ? validateWorkspaceRoot(next.workspaceRoot) : '';
    }

    const nextHostId = normalizeId(next?.hostAgentId || existing?.hostAgentId || existing?.agentId);
    if (hostUpdated && !nextHostId) {
      throw new Error('hostAgentId is required');
    }
    if (nextHostId) {
      const hostAgent = store.agents.get(nextHostId);
      if (!hostAgent) throw new Error('host agent not found');
    }

    const nextMembers = membersUpdated
      ? uniqueIds(next.memberAgentIds).filter((mid) => mid && mid !== nextHostId)
      : Array.isArray(existing?.memberAgentIds)
        ? existing.memberAgentIds
        : [];
    next.memberAgentIds = nextMembers;
    next.hostAgentId = nextHostId || '';
    next.agentId = nextHostId || existing?.agentId || '';

    const shouldRebuildPrompt = hostUpdated || membersUpdated;
    if (shouldRebuildPrompt) {
      const hostAgent = nextHostId ? store.agents.get(nextHostId) : null;
      const memberAgents = nextMembers.map((memberId) => store.agents.get(memberId)).filter(Boolean);
      next.roomPrompt = buildRoomPrompt({ hostAgent, memberAgents });
    }

    const room = store.rooms.update(id, next);
    if (!room) throw new Error('room not found');
    return { ok: true, room };
  });
  ipcMain.handle('chat:rooms:delete', async (_event, payload = {}) => {
    const id = normalizeId(payload?.id);
    if (!id) throw new Error('id is required');
    const existing = store.rooms.get(id);
    if (!existing) throw new Error('room not found');
    store.messages.removeForSession(id);
    return { ok: true, removed: store.rooms.remove(id) };
  });
  ipcMain.handle('chat:rooms:send', async (_event, payload = {}) => {
    const roomId = normalizeId(payload?.roomId || payload?.sessionId);
    const text = typeof payload?.text === 'string' ? payload.text : typeof payload?.content === 'string' ? payload.content : '';
    const attachmentPayload = Array.isArray(payload?.attachments)
      ? payload.attachments
      : Array.isArray(payload?.images)
        ? payload.images
        : [];
    const attachments = normalizeImageAttachments(attachmentPayload);
    if (!roomId) throw new Error('roomId is required');
    if (!text.trim() && attachments.length === 0) {
      throw new Error('text is required');
    }

    const room = store.rooms.get(roomId);
    if (!room) throw new Error('room not found');
    const hostAgentId = normalizeId(room?.hostAgentId) || normalizeId(room?.agentId);
    if (!hostAgentId) throw new Error('hostAgentId is required');
    const agent = store.agents.get(hostAgentId);
    if (!agent) throw new Error('agent not found');

    if (attachments.length > 0) {
      const models = adminServices.models.list();
      const modelRecord = models.find((m) => m?.id === agent.modelId);
      if (!modelRecord) throw new Error('model not found for agent');
      if (modelRecord.supportsVision !== true) {
        throw new Error('当前模型未启用图片理解：请在 Admin → Models 中开启“支持图片理解”。');
      }
    }

    const userMessage = store.messages.create({ sessionId: roomId, role: 'user', content: text, attachments });
    const assistantMessage = store.messages.create({ sessionId: roomId, role: 'assistant', content: '' });
    store.sessions.update(roomId, { updatedAt: new Date().toISOString() });

    void Promise.resolve()
      .then(() =>
        runner.start({
          sessionId: roomId,
          agentId: hostAgentId,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          text,
          attachments,
        })
      )
      .catch((err) => {
        const message = err?.message || String(err);
        const errorText = `[error] ${message}`;
        try {
          store.messages.update(assistantMessage.id, { content: errorText });
        } catch {
          // ignore
        }
        try {
          store.sessions.update(roomId, { updatedAt: new Date().toISOString() });
        } catch {
          // ignore
        }
        try {
          sendEvent({ type: 'assistant_delta', scope: 'room', sessionId: roomId, messageId: assistantMessage.id, delta: errorText });
        } catch {
          // ignore
        }
        try {
          sendEvent({ type: 'assistant_error', scope: 'room', sessionId: roomId, messageId: assistantMessage.id, message });
        } catch {
          // ignore
        }
      });
    return { ok: true, userMessageId: userMessage.id, assistantMessageId: assistantMessage.id };
  });
  ipcMain.handle('chat:rooms:abort', async (_event, payload = {}) => runner.abort(payload?.roomId || payload?.sessionId));

  ipcMain.handle('chat:messages:list', async (_event, payload = {}) => {
    const sessionId = normalizeId(payload?.sessionId);
    if (!sessionId) throw new Error('sessionId is required');
    const rawLimit = payload?.limit;
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.floor(rawLimit)) : null;
    const beforeId = normalizeId(payload?.beforeId);
    if (limit) {
      const page = store.messages.page(sessionId, { limit, beforeId });
      return { ok: true, messages: page.messages, hasMore: page.hasMore };
    }
    return { ok: true, messages: store.messages.list(sessionId), hasMore: false };
  });

  ipcMain.handle('chat:send', async (_event, payload = {}) => {
    const sessionId = normalizeId(payload?.sessionId);
    const text = typeof payload?.text === 'string' ? payload.text : typeof payload?.content === 'string' ? payload.content : '';
    const attachmentPayload = Array.isArray(payload?.attachments)
      ? payload.attachments
      : Array.isArray(payload?.images)
        ? payload.images
        : [];
    const attachments = normalizeImageAttachments(attachmentPayload);
    if (!sessionId) throw new Error('sessionId is required');
    if (!text.trim() && attachments.length === 0) {
      throw new Error('text is required');
    }

    const session = store.sessions.get(sessionId);
    if (!session) throw new Error('session not found');
    if (normalizeSessionMode(session?.mode) === 'room') {
      throw new Error('room session should use chat:rooms:send');
    }
    const agentId = normalizeId(payload?.agentId) || normalizeId(session?.agentId);
    if (!agentId) throw new Error('agentId is required');

    const agent = store.agents.get(agentId);
    if (!agent) throw new Error('agent not found');

    if (attachments.length > 0) {
      const models = adminServices.models.list();
      const modelRecord = models.find((m) => m?.id === agent.modelId);
      if (!modelRecord) throw new Error('model not found for agent');
      if (modelRecord.supportsVision !== true) {
        throw new Error('当前模型未启用图片理解：请在 Admin → Models 中开启“支持图片理解”。');
      }
    }

    const userMessage = store.messages.create({ sessionId, role: 'user', content: text, attachments });
    const assistantMessage = store.messages.create({ sessionId, role: 'assistant', content: '' });
    store.sessions.update(sessionId, { updatedAt: new Date().toISOString() });

    void Promise.resolve()
      .then(() =>
        runner.start({
          sessionId,
          agentId,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          text,
          attachments,
        })
      )
      .catch((err) => {
        const message = err?.message || String(err);
        const errorText = `[error] ${message}`;
        try {
          store.messages.update(assistantMessage.id, { content: errorText });
        } catch {
          // ignore
        }
        try {
          store.sessions.update(sessionId, { updatedAt: new Date().toISOString() });
        } catch {
          // ignore
        }
        try {
          sendEvent({ type: 'assistant_delta', sessionId, messageId: assistantMessage.id, delta: errorText });
        } catch {
          // ignore
        }
        try {
          sendEvent({ type: 'assistant_error', sessionId, messageId: assistantMessage.id, message });
        } catch {
          // ignore
        }
      });
    return { ok: true, userMessageId: userMessage.id, assistantMessageId: assistantMessage.id };
  });

  ipcMain.handle('chat:abort', async (_event, payload = {}) => runner.abort(payload?.sessionId));

  return { dispose: runner.dispose };
}
