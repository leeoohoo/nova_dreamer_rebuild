import { useEffect, useMemo, useRef, useState } from 'react';
import { message as toast } from 'antd';

import { api, hasApi } from '../../../lib/api.js';

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function useChatRooms() {
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState([]);
  const [messages, setMessages] = useState([]);
  const [messagesHasMore, setMessagesHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [composerText, setComposerText] = useState('');
  const [composerAttachments, setComposerAttachments] = useState([]);
  const [streamStates, setStreamStates] = useState({});
  const [streamBuffers, setStreamBuffers] = useState({});

  const selectedRoomIdRef = useRef('');
  const streamStatesRef = useRef({});
  const streamBuffersRef = useRef({});

  const currentRoom = useMemo(
    () => rooms.find((room) => normalizeId(room?.id) === normalizeId(selectedRoomId)) || null,
    [rooms, selectedRoomId]
  );

  useEffect(() => {
    selectedRoomIdRef.current = normalizeId(selectedRoomId);
  }, [selectedRoomId]);

  useEffect(() => {
    streamStatesRef.current = streamStates;
  }, [streamStates]);

  useEffect(() => {
    streamBuffersRef.current = streamBuffers;
  }, [streamBuffers]);

  const currentStreamState = useMemo(() => {
    const rid = normalizeId(selectedRoomId);
    if (!rid) return null;
    return streamStates[rid] || null;
  }, [selectedRoomId, streamStates]);

  const mergeStreamBuffer = (roomId, list) => {
    const rid = normalizeId(roomId);
    if (!rid) return Array.isArray(list) ? list : [];
    const buffer = streamBuffersRef.current[rid];
    if (!buffer || typeof buffer !== 'object') return Array.isArray(list) ? list : [];
    const mid = normalizeId(buffer.messageId);
    if (!mid) return Array.isArray(list) ? list : [];
    const content = typeof buffer.content === 'string' ? buffer.content : '';
    const reasoning = typeof buffer.reasoning === 'string' ? buffer.reasoning : '';
    const messagesList = Array.isArray(list) ? list : [];
    const idx = messagesList.findIndex((msg) => normalizeId(msg?.id) === mid);
    if (idx < 0) {
      return [
        ...messagesList,
        { id: mid, sessionId: rid, role: 'assistant', content, reasoning },
      ];
    }
    const existing = messagesList[idx] || {};
    const next = messagesList.slice();
    const patch = { ...existing };
    const existingContent = typeof existing?.content === 'string' ? existing.content : '';
    const existingReasoning = typeof existing?.reasoning === 'string' ? existing.reasoning : '';
    if (content && content.length >= existingContent.length) {
      patch.content = content;
    }
    if (reasoning && reasoning.length >= existingReasoning.length) {
      patch.reasoning = reasoning;
    }
    next[idx] = patch;
    return next;
  };

  const updateStreamBuffer = (roomId, messageId, updater) => {
    const rid = normalizeId(roomId);
    if (!rid) return;
    const mid = normalizeId(messageId);
    if (!mid) return;
    setStreamBuffers((prev) => {
      const next = { ...(prev || {}) };
      const current =
        next[rid] && typeof next[rid] === 'object'
          ? next[rid]
          : { sessionId: rid, messageId: mid, content: '', reasoning: '' };
      const reset = normalizeId(current.messageId) !== mid;
      const base = reset
        ? { sessionId: rid, messageId: mid, content: '', reasoning: '' }
        : { ...current, sessionId: rid, messageId: mid };
      const updated = typeof updater === 'function' ? updater(base) : base;
      next[rid] = updated;
      streamBuffersRef.current = next;
      return next;
    });
  };

  const refreshRooms = async () => {
    const res = await api.invoke('chat:rooms:list');
    if (res?.ok === false) throw new Error(res?.message || '加载聊天室失败');
    setRooms(Array.isArray(res?.rooms) ? res.rooms : []);
  };

  const PAGE_SIZE = 50;

  const refreshMessages = async (roomId, options = {}) => {
    const rid = normalizeId(roomId);
    if (!rid) {
      setMessages([]);
      setMessagesHasMore(false);
      return;
    }
    const limit = Number.isFinite(options?.limit) ? options.limit : PAGE_SIZE;
    const res = await api.invoke('chat:messages:list', { sessionId: rid, limit });
    if (res?.ok === false) throw new Error(res?.message || '加载消息失败');
    const list = Array.isArray(res?.messages) ? res.messages : [];
    setMessages(mergeStreamBuffer(rid, list));
    setMessagesHasMore(Boolean(res?.hasMore));
  };

  const refreshAll = async () => {
    setLoading(true);
    try {
      await refreshRooms();
      await refreshMessages(selectedRoomIdRef.current);
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
        const roomsRes = await api.invoke('chat:rooms:list');
        const nextRooms = Array.isArray(roomsRes?.rooms) ? roomsRes.rooms : [];
        setRooms(nextRooms);

        const preferredRoomId = normalizeId(nextRooms?.[0]?.id);
        if (preferredRoomId) {
          setSelectedRoomId(preferredRoomId);
          await refreshMessages(preferredRoomId);
          return;
        }
      } catch (err) {
        toast.error(err?.message || '初始化聊天室失败');
      } finally {
        setLoading(false);
      }
    })();

    const unsub = api.on('chat:event', (payload) => {
      if (!payload || typeof payload !== 'object') return;
      if (payload.scope !== 'room') return;
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
        const rid = normalizeId(record?.sessionId);
        if (!mid || !rid) return;
        setStreamStates((prev) => ({ ...prev, [rid]: { sessionId: rid, messageId: mid } }));
        updateStreamBuffer(rid, mid, (base) => ({
          ...base,
          content: typeof record?.content === 'string' ? record.content : '',
          reasoning: typeof record?.reasoning === 'string' ? record.reasoning : '',
        }));
        if (normalizeId(selectedRoomIdRef.current) === rid) {
          setMessages((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            if (list.some((m) => normalizeId(m?.id) === mid)) return list;
            return [...list, record];
          });
        }
        return;
      }
      if (type === 'assistant_delta') {
        const mid = normalizeId(payload.messageId);
        const delta = typeof payload.delta === 'string' ? payload.delta : '';
        const rid = normalizeId(payload.sessionId);
        if (!mid || !delta || !rid) return;
        updateStreamBuffer(rid, mid, (base) => ({
          ...base,
          content: `${base.content || ''}${delta}`,
        }));
        if (normalizeId(selectedRoomIdRef.current) !== rid) return;
        setMessages((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          const idx = list.findIndex((m) => normalizeId(m?.id) === mid);
          if (idx < 0) {
            return [...list, { id: mid, sessionId: rid, role: 'assistant', content: delta }];
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
        const rid = normalizeId(payload.sessionId);
        if (!mid || !delta || !rid) return;
        updateStreamBuffer(rid, mid, (base) => ({
          ...base,
          reasoning: `${base.reasoning || ''}${delta}`,
        }));
        if (normalizeId(selectedRoomIdRef.current) !== rid) return;
        setMessages((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          const idx = list.findIndex((m) => normalizeId(m?.id) === mid);
          if (idx < 0) {
            return [...list, { id: mid, sessionId: rid, role: 'assistant', content: '', reasoning: delta }];
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
        if (normalizeId(record?.sessionId) !== normalizeId(selectedRoomIdRef.current)) return;
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
        const rid = normalizeId(payload.sessionId);
        if (rid) {
          setStreamStates((prev) => {
            if (!prev || !prev[rid]) return prev;
            const next = { ...prev };
            delete next[rid];
            return next;
          });
          setStreamBuffers((prev) => {
            if (!prev || !prev[rid]) return prev;
            const next = { ...prev };
            delete next[rid];
            streamBuffersRef.current = next;
            return next;
          });
        }
        if (type === 'assistant_error') {
          const errorMessage = typeof payload.message === 'string' ? payload.message.trim() : '';
          toast.error(errorMessage || '请求失败');
          if (mid && (!rid || normalizeId(selectedRoomIdRef.current) === rid)) {
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
        void refreshRooms();
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

  const selectRoom = async (roomId) => {
    const rid = normalizeId(roomId);
    if (!rid) return;
    try {
      setSelectedRoomId(rid);
      await refreshMessages(rid);
    } catch (err) {
      toast.error(err?.message || '加载聊天室失败');
    }
  };

  const loadMoreMessages = async () => {
    const rid = normalizeId(selectedRoomIdRef.current);
    if (!rid || loadingMore || !messagesHasMore) return;
    const firstId = normalizeId(messages?.[0]?.id);
    setLoadingMore(true);
    try {
      const res = await api.invoke('chat:messages:list', { sessionId: rid, limit: PAGE_SIZE, beforeId: firstId });
      if (res?.ok === false) throw new Error(res?.message || '加载更多失败');
      const nextBatch = Array.isArray(res?.messages) ? res.messages : [];
      setMessages((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const seen = new Set(list.map((m) => normalizeId(m?.id)).filter(Boolean));
        const prefix = nextBatch.filter((m) => !seen.has(normalizeId(m?.id)));
        return mergeStreamBuffer(rid, [...prefix, ...list]);
      });
      setMessagesHasMore(Boolean(res?.hasMore));
    } catch (err) {
      toast.error(err?.message || '加载更多失败');
    } finally {
      setLoadingMore(false);
    }
  };

  const createRoom = async ({ title, hostAgentId, memberAgentIds } = {}) => {
    const hostId = normalizeId(hostAgentId);
    if (!hostId) {
      toast.error('请选择默认助手');
      return;
    }
    try {
      const res = await api.invoke('chat:rooms:create', {
        title: title || '新聊天室',
        hostAgentId: hostId,
        memberAgentIds: Array.isArray(memberAgentIds) ? memberAgentIds : [],
      });
      if (res?.ok === false) throw new Error(res?.message || '创建聊天室失败');
      const rid = normalizeId(res?.room?.id);
      await refreshRooms();
      if (rid) {
        setSelectedRoomId(rid);
        await refreshMessages(rid);
      }
    } catch (err) {
      toast.error(err?.message || '创建聊天室失败');
    }
  };

  const updateRoom = async (roomId, data = {}) => {
    const rid = normalizeId(roomId);
    if (!rid) return;
    try {
      const res = await api.invoke('chat:rooms:update', { id: rid, data });
      if (res?.ok === false) throw new Error(res?.message || '更新聊天室失败');
      await refreshRooms();
    } catch (err) {
      toast.error(err?.message || '更新聊天室失败');
    }
  };

  const deleteRoom = async (roomId) => {
    const rid = normalizeId(roomId);
    if (!rid) return;
    try {
      const res = await api.invoke('chat:rooms:delete', { id: rid });
      if (res?.ok === false) throw new Error(res?.message || '删除聊天室失败');
      const nextRooms = rooms.filter((room) => normalizeId(room?.id) !== rid);
      setRooms(nextRooms);
      if (normalizeId(selectedRoomIdRef.current) === rid) {
        const fallback = normalizeId(nextRooms?.[0]?.id);
        setSelectedRoomId(fallback);
        await refreshMessages(fallback);
      }
    } catch (err) {
      toast.error(err?.message || '删除聊天室失败');
    }
  };

  const renameRoom = async (roomId, title) => {
    const rid = normalizeId(roomId);
    const name = typeof title === 'string' ? title.trim() : '';
    if (!rid || !name) return;
    await updateRoom(rid, { title: name });
  };

  const sendMessage = async () => {
    const text = typeof composerText === 'string' ? composerText.trim() : '';
    const attachments = Array.isArray(composerAttachments) ? composerAttachments.filter(Boolean) : [];
    const currentRid = normalizeId(selectedRoomIdRef.current);
    if ((!text && attachments.length === 0) || (currentRid && streamStatesRef.current[currentRid])) return;
    const rid = normalizeId(selectedRoomIdRef.current);
    if (!rid) {
      toast.error('请先创建聊天室');
      return;
    }
    try {
      const res = await api.invoke('chat:rooms:send', { roomId: rid, text, attachments });
      if (res?.ok === false) throw new Error(res?.message || '发送失败');

      const userMessageId = normalizeId(res?.userMessageId);
      const assistantMessageId = normalizeId(res?.assistantMessageId);
      const now = new Date().toISOString();
      setComposerText('');
      setComposerAttachments([]);
      setMessages((prev) => [
        ...prev,
        { id: userMessageId || `user_${now}`, sessionId: rid, role: 'user', content: text, attachments, createdAt: now, updatedAt: now },
        { id: assistantMessageId || `assistant_${now}`, sessionId: rid, role: 'assistant', content: '', createdAt: now, updatedAt: now },
      ]);
      if (rid) {
        setStreamStates((prev) => ({ ...prev, [rid]: { sessionId: rid, messageId: assistantMessageId } }));
        if (assistantMessageId) {
          updateStreamBuffer(rid, assistantMessageId, (base) => ({ ...base, content: '', reasoning: '' }));
        }
      }
    } catch (err) {
      toast.error(err?.message || '发送失败');
    }
  };

  const stopStreaming = async () => {
    const rid = normalizeId(selectedRoomIdRef.current);
    if (!rid || !streamStatesRef.current[rid]) return;
    try {
      await api.invoke('chat:rooms:abort', { roomId: rid });
    } catch {
      // ignore
    }
  };

  return {
    loading,
    rooms,
    messages,
    messagesHasMore,
    loadingMore,
    selectedRoomId,
    composerText,
    composerAttachments,
    streamState: currentStreamState,
    currentRoom,
    setComposerText,
    setComposerAttachments,
    refreshRooms,
    refreshMessages,
    refreshAll,
    selectRoom,
    loadMoreMessages,
    createRoom,
    updateRoom,
    deleteRoom,
    renameRoom,
    sendMessage,
    stopStreaming,
  };
}
