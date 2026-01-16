import { useEffect, useMemo, useRef, useState } from 'react';
import { message as toast } from 'antd';

import { api, hasApi } from '../../../lib/api.js';

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function useChatSessions() {
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [messages, setMessages] = useState([]);
  const [messagesHasMore, setMessagesHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [composerText, setComposerText] = useState('');
  const [composerAttachments, setComposerAttachments] = useState([]);
  const [streamState, setStreamState] = useState(null);

  const selectedSessionIdRef = useRef('');
  const streamStateRef = useRef(null);

  const currentSession = useMemo(
    () => sessions.find((s) => normalizeId(s?.id) === normalizeId(selectedSessionId)) || null,
    [sessions, selectedSessionId]
  );

  useEffect(() => {
    selectedSessionIdRef.current = normalizeId(selectedSessionId);
  }, [selectedSessionId]);

  useEffect(() => {
    streamStateRef.current = streamState;
  }, [streamState]);

  const refreshSessions = async () => {
    const res = await api.invoke('chat:sessions:list');
    if (res?.ok === false) throw new Error(res?.message || '加载会话失败');
    setSessions(Array.isArray(res?.sessions) ? res.sessions : []);
  };

  const PAGE_SIZE = 50;

  const refreshMessages = async (sessionId, options = {}) => {
    const sid = normalizeId(sessionId);
    if (!sid) {
      setMessages([]);
      setMessagesHasMore(false);
      return;
    }
    const limit = Number.isFinite(options?.limit) ? options.limit : PAGE_SIZE;
    const res = await api.invoke('chat:messages:list', { sessionId: sid, limit });
    if (res?.ok === false) throw new Error(res?.message || '加载消息失败');
    setMessages(Array.isArray(res?.messages) ? res.messages : []);
    setMessagesHasMore(Boolean(res?.hasMore));
  };

  const refreshAll = async () => {
    setLoading(true);
    try {
      await refreshSessions();
      await refreshMessages(selectedSessionIdRef.current);
    } catch (err) {
      toast.error(err?.message || '刷新失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hasApi) {
      setLoading(false);
      return undefined;
    }
    (async () => {
      setLoading(true);
      try {
        const ensured = await api.invoke('chat:agents:ensureDefault');
        const ensuredAgentId = normalizeId(ensured?.agent?.id);
        const sessionsRes = await api.invoke('chat:sessions:list');
        const nextSessions = Array.isArray(sessionsRes?.sessions) ? sessionsRes.sessions : [];
        setSessions(nextSessions);

        const preferredSessionId = normalizeId(nextSessions?.[0]?.id);
        if (preferredSessionId) {
          setSelectedSessionId(preferredSessionId);
          setSelectedAgentId(normalizeId(nextSessions?.[0]?.agentId));
          await refreshMessages(preferredSessionId);
          return;
        }

        const created = await api.invoke('chat:sessions:ensureDefault', { agentId: ensuredAgentId });
        const sid = normalizeId(created?.session?.id);
        await refreshSessions();
        if (sid) {
          setSelectedSessionId(sid);
          setSelectedAgentId(normalizeId(created?.session?.agentId));
          await refreshMessages(sid);
        }
      } catch (err) {
        toast.error(err?.message || '初始化 Chat 失败');
      } finally {
        setLoading(false);
      }
    })();

    const unsub = api.on('chat:event', (payload) => {
      if (!payload || typeof payload !== 'object') return;
      const type = String(payload.type || '');
      if (type === 'notice') {
        const text = typeof payload.message === 'string' ? payload.message : '';
        if (text) toast.info(text);
        return;
      }
      if (type === 'assistant_start') {
        const record = payload.message;
        if (!record || typeof record !== 'object') return;
        const mid = normalizeId(record?.id);
        const sid = normalizeId(record?.sessionId);
        if (!mid || !sid) return;
        if (normalizeId(selectedSessionIdRef.current) === sid) {
          setMessages((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            if (list.some((m) => normalizeId(m?.id) === mid)) return list;
            return [...list, record];
          });
        }
        setStreamState({ sessionId: sid, messageId: mid });
        return;
      }
      if (type === 'assistant_delta') {
        const mid = normalizeId(payload.messageId);
        const delta = typeof payload.delta === 'string' ? payload.delta : '';
        if (!mid || !delta) return;
        setMessages((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          const idx = list.findIndex((m) => normalizeId(m?.id) === mid);
          if (idx < 0) {
            const sid = normalizeId(payload.sessionId) || normalizeId(selectedSessionIdRef.current);
            return [...list, { id: mid, sessionId: sid, role: 'assistant', content: delta }];
          }
          const next = list.slice();
          const existing = next[idx];
          next[idx] = { ...existing, content: `${existing?.content || ''}${delta}` };
          return next;
        });
        return;
      }
      if (type === 'assistant_reasoning_delta') {
        const mid = normalizeId(payload.messageId);
        const delta = typeof payload.delta === 'string' ? payload.delta : '';
        if (!mid || !delta) return;
        setMessages((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          const idx = list.findIndex((m) => normalizeId(m?.id) === mid);
          if (idx < 0) {
            const sid = normalizeId(payload.sessionId) || normalizeId(selectedSessionIdRef.current);
            return [...list, { id: mid, sessionId: sid, role: 'assistant', content: '', reasoning: delta }];
          }
          const next = list.slice();
          const existing = next[idx];
          next[idx] = { ...existing, reasoning: `${existing?.reasoning || ''}${delta}` };
          return next;
        });
        return;
      }
      if (type === 'tool_result') {
        const record = payload.message;
        if (!record || typeof record !== 'object') return;
        if (normalizeId(record?.sessionId) !== normalizeId(selectedSessionIdRef.current)) return;
        setMessages((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          const rid = normalizeId(record?.id);
          if (rid && list.some((m) => normalizeId(m?.id) === rid)) return list;
          return [...list, record];
        });
        return;
      }
      if (type === 'assistant_done' || type === 'assistant_error' || type === 'assistant_aborted') {
        const mid = normalizeId(payload.messageId);
        if (type === 'assistant_error') {
          const errorMessage = typeof payload.message === 'string' ? payload.message.trim() : '';
          toast.error(errorMessage || '请求失败');
          if (mid) {
            setMessages((prev) =>
              prev.map((m) => {
                if (normalizeId(m?.id) !== mid) return m;
                const existing = typeof m?.content === 'string' ? m.content.trim() : '';
                if (existing) return m;
                return { ...m, content: `[error] ${errorMessage || '请求失败'}` };
              })
            );
          }
        }
        if (type === 'assistant_aborted') {
          toast.info('已停止');
        }
        const currentStream = streamStateRef.current;
        if (currentStream && normalizeId(currentStream.messageId) === mid) {
          setStreamState(null);
        }
        void refreshSessions();
      }
    });

    return () => {
      try {
        unsub?.();
      } catch {
        // ignore
      }
    };
  }, []);

  const selectSession = async (sessionId) => {
    const sid = normalizeId(sessionId);
    if (!sid) return;
    try {
      setSelectedSessionId(sid);
      const session = sessions.find((s) => normalizeId(s?.id) === sid) || null;
      setSelectedAgentId(normalizeId(session?.agentId));
      await refreshMessages(sid);
    } catch (err) {
      toast.error(err?.message || '加载会话失败');
    }
  };

  const loadMoreMessages = async () => {
    const sid = normalizeId(selectedSessionIdRef.current);
    if (!sid || loadingMore || !messagesHasMore) return;
    const firstId = normalizeId(messages?.[0]?.id);
    setLoadingMore(true);
    try {
      const res = await api.invoke('chat:messages:list', { sessionId: sid, limit: PAGE_SIZE, beforeId: firstId });
      if (res?.ok === false) throw new Error(res?.message || '加载更多失败');
      const nextBatch = Array.isArray(res?.messages) ? res.messages : [];
      setMessages((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const seen = new Set(list.map((m) => normalizeId(m?.id)).filter(Boolean));
        const prefix = nextBatch.filter((m) => !seen.has(normalizeId(m?.id)));
        return [...prefix, ...list];
      });
      setMessagesHasMore(Boolean(res?.hasMore));
    } catch (err) {
      toast.error(err?.message || '加载更多失败');
    } finally {
      setLoadingMore(false);
    }
  };

  const createSession = async ({ agentId } = {}) => {
    const aid = normalizeId(agentId) || normalizeId(selectedAgentId);
    if (!aid) {
      toast.error('请先创建/选择一个 Agent');
      return;
    }
    try {
      const inheritedWorkspaceRoot = typeof currentSession?.workspaceRoot === 'string' ? currentSession.workspaceRoot.trim() : '';
      const res = await api.invoke('chat:sessions:create', {
        title: '新会话',
        agentId: aid,
        ...(inheritedWorkspaceRoot ? { workspaceRoot: inheritedWorkspaceRoot } : {}),
      });
      if (res?.ok === false) throw new Error(res?.message || '创建会话失败');
      const sid = normalizeId(res?.session?.id);
      await refreshSessions();
      if (sid) {
        setSelectedSessionId(sid);
        setSelectedAgentId(aid);
        await refreshMessages(sid);
      }
    } catch (err) {
      toast.error(err?.message || '创建会话失败');
    }
  };

  const deleteSession = async (sessionId) => {
    const sid = normalizeId(sessionId);
    if (!sid) return;
    try {
      const res = await api.invoke('chat:sessions:delete', { id: sid });
      if (res?.ok === false) throw new Error(res?.message || '删除会话失败');
      const nextSessions = sessions.filter((s) => normalizeId(s?.id) !== sid);
      setSessions(nextSessions);
      if (normalizeId(selectedSessionIdRef.current) === sid) {
        const fallback = normalizeId(nextSessions?.[0]?.id);
        setSelectedSessionId(fallback);
        setSelectedAgentId(normalizeId(nextSessions?.[0]?.agentId));
        await refreshMessages(fallback);
      }
    } catch (err) {
      toast.error(err?.message || '删除会话失败');
    }
  };

  const renameSession = async (sessionId, title) => {
    const sid = normalizeId(sessionId);
    const name = typeof title === 'string' ? title.trim() : '';
    if (!sid || !name) return;
    try {
      const res = await api.invoke('chat:sessions:update', { id: sid, data: { title: name } });
      if (res?.ok === false) throw new Error(res?.message || '重命名失败');
      await refreshSessions();
    } catch (err) {
      toast.error(err?.message || '重命名失败');
    }
  };

  const changeAgent = async (agentId) => {
    const aid = normalizeId(agentId);
    if (!aid) return;
    const sid = normalizeId(selectedSessionIdRef.current);
    if (!sid) return;
    const previous = selectedAgentId;
    setSelectedAgentId(aid);
    try {
      const res = await api.invoke('chat:sessions:update', { id: sid, data: { agentId: aid } });
      if (res?.ok === false) throw new Error(res?.message || '更新会话 Agent 失败');
      await refreshSessions();
    } catch (err) {
      setSelectedAgentId(previous);
      toast.error(err?.message || '更新会话 Agent 失败');
    }
  };

  const setWorkspaceRoot = async (workspaceRoot) => {
    const sid = normalizeId(selectedSessionIdRef.current);
    if (!sid) return;
    const next = typeof workspaceRoot === 'string' ? workspaceRoot.trim() : '';
    try {
      const res = await api.invoke('chat:sessions:update', { id: sid, data: { workspaceRoot: next } });
      if (res?.ok === false) throw new Error(res?.message || '更新工作目录失败');
      toast.success('已更新工作目录');
      await refreshSessions();
    } catch (err) {
      toast.error(err?.message || '更新工作目录失败');
    }
  };

  const pickWorkspaceRoot = async () => {
    const current = sessions.find((s) => normalizeId(s?.id) === normalizeId(selectedSessionIdRef.current)) || null;
    const preferred = typeof current?.workspaceRoot === 'string' ? current.workspaceRoot.trim() : '';
    try {
      const result = await api.invoke('dialog:selectDirectory', { defaultPath: preferred || undefined });
      if (result?.ok && typeof result?.path === 'string' && result.path.trim()) {
        const picked = result.path.trim();
        await setWorkspaceRoot(picked);
        return picked;
      }
    } catch (err) {
      toast.error(err?.message || '选择目录失败');
    }
    return '';
  };

  const clearWorkspaceRoot = async () => {
    await setWorkspaceRoot('');
  };

  const sendMessage = async () => {
    const text = typeof composerText === 'string' ? composerText.trim() : '';
    const attachments = Array.isArray(composerAttachments) ? composerAttachments.filter(Boolean) : [];
    if ((!text && attachments.length === 0) || streamStateRef.current) return;
    const sid = normalizeId(selectedSessionIdRef.current);
    if (!sid) {
      toast.error('请先创建会话');
      return;
    }
    try {
      const res = await api.invoke('chat:send', { sessionId: sid, text, attachments });
      if (res?.ok === false) throw new Error(res?.message || '发送失败');

      const userMessageId = normalizeId(res?.userMessageId);
      const assistantMessageId = normalizeId(res?.assistantMessageId);
      const now = new Date().toISOString();
      setComposerText('');
      setComposerAttachments([]);
      setMessages((prev) => [
        ...prev,
        { id: userMessageId || `user_${now}`, sessionId: sid, role: 'user', content: text, attachments, createdAt: now, updatedAt: now },
        { id: assistantMessageId || `assistant_${now}`, sessionId: sid, role: 'assistant', content: '', createdAt: now, updatedAt: now },
      ]);
      setStreamState({ sessionId: sid, messageId: assistantMessageId });
    } catch (err) {
      toast.error(err?.message || '发送失败');
    }
  };

  const stopStreaming = async () => {
    const currentStream = streamStateRef.current;
    const sid = normalizeId(currentStream?.sessionId) || normalizeId(selectedSessionIdRef.current);
    if (!sid) return;
    try {
      await api.invoke('chat:abort', { sessionId: sid });
    } catch {
      // ignore
    }
  };

  return {
    loading,
    sessions,
    messages,
    messagesHasMore,
    loadingMore,
    selectedSessionId,
    selectedAgentId,
    composerText,
    composerAttachments,
    streamState,
    currentSession,
    setComposerText,
    setComposerAttachments,
    refreshSessions,
    refreshMessages,
    refreshAll,
    selectSession,
    loadMoreMessages,
    createSession,
    deleteSession,
    renameSession,
    changeAgent,
    setWorkspaceRoot,
    pickWorkspaceRoot,
    clearWorkspaceRoot,
    sendMessage,
    stopStreaming,
  };
}
