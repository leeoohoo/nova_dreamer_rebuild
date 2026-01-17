import fs from 'fs';
import path from 'path';

import { createChatRunner } from './runner.js';
import { createChatStore } from './store.js';

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
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
    const sessions = store.sessions.list().filter((s) => normalizeId(s?.agentId) === id);
    if (sessions.length > 0) {
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

  ipcMain.handle('chat:sessions:list', async () => ({ ok: true, sessions: store.sessions.list() }));
  ipcMain.handle('chat:sessions:create', async (_event, payload = {}) => {
    const desiredWorkspaceRoot = normalizeId(payload?.workspaceRoot) ? validateWorkspaceRoot(payload.workspaceRoot) : defaultWorkspaceRoot;
    return { ok: true, session: store.sessions.create({ ...payload, workspaceRoot: desiredWorkspaceRoot }) };
  });
  ipcMain.handle('chat:sessions:update', async (_event, payload = {}) => {
    const id = normalizeId(payload?.id);
    if (!id) throw new Error('id is required');
    const patch = payload?.data && typeof payload.data === 'object' ? { ...payload.data } : {};
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
    store.messages.removeForSession(id);
    return { ok: true, removed: store.sessions.remove(id) };
  });

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
