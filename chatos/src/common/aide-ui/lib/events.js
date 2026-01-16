import { parseEvents } from './parse.js';
import { formatDateTime, formatJson, truncateText } from './format.js';
import { normalizeRunId } from './runs.js';

const EVENT_META = {
  user: { label: '用户输入', color: 'blue' },
  assistant: { label: '助手回复', color: 'green' },
  assistant_thinking: { label: '助手思考', color: 'gold' },
  system: { label: '系统', color: 'default' },
  tool_call: { label: '工具调用', color: 'purple' },
  tool_result: { label: '工具结果', color: 'geekblue' },
  tool: { label: '工具', color: 'purple' },
  subagent_start: { label: '子代理开始', color: 'volcano' },
  subagent_done: { label: '子代理完成', color: 'magenta' },
  subagent_thinking: { label: '子代理思考', color: 'volcano' },
  subagent_assistant: { label: '子代理回复', color: 'green' },
  subagent_tool_call: { label: '子代理工具', color: 'volcano' },
  subagent_tool_result: { label: '子代理结果', color: 'geekblue' },
  subagent_tool: { label: '子代理工具', color: 'volcano' },
};

export function getEventMeta(type) {
  if (!type) return { label: '事件', color: 'default' };
  if (EVENT_META[type]) return EVENT_META[type];
  const normalized = String(type);
  if (normalized.includes('subagent')) return { label: '子代理', color: 'volcano' };
  if (normalized.includes('tool')) return { label: '工具', color: 'purple' };
  return { label: normalized, color: 'default' };
}

function buildEventPreview(payload, type) {
  if (!payload) return '';
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.content === 'string') return payload.content;
  if (typeof payload.responsePreview === 'string') return payload.responsePreview;
  if (typeof payload.task === 'string') return payload.task;
  if (typeof payload.tool === 'string' || typeof payload.agent === 'string') {
    const toPreviewText = (value) => {
      if (value === undefined || value === null) return '';
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    };
    const actor = payload.tool || payload.agent;
    const argsText = truncateText(toPreviewText(payload.args));
    const resultText = truncateText(toPreviewText(payload.result));
    const detail =
      argsText && resultText ? `${argsText} → ${resultText}` : argsText || resultText;
    const fallbackDetail = payload.data ? truncateText(toPreviewText(payload.data)) : '';
    const detailText = detail || fallbackDetail;
    return detailText ? `${actor}: ${detailText}` : actor;
  }
  if (Array.isArray(payload)) return truncateText(JSON.stringify(payload));
  if (typeof payload === 'object') return truncateText(JSON.stringify(payload));
  return String(payload);
}

function normalizeEvents(rawEvents = []) {
  return rawEvents.map((entry, idx) => {
    const meta = getEventMeta(entry.type);
    const preview = buildEventPreview(entry.payload, entry.type);
    const rawJson = formatJson(entry.payload);
    const rawEvent = formatJson(entry);
    return {
      ...entry,
      // Avoid React key collisions when multiple events share the same timestamp
      // (e.g., assistant_thinking + tool_call emitted within the same millisecond).
      key: entry.ts ? `${entry.ts}-${idx}` : String(idx),
      meta,
      preview: truncateText(preview, 220),
      rawJson,
      rawEvent,
      tsText: formatDateTime(entry.ts),
    };
  });
}

function mergeToolCallResultEvents(rawEvents = []) {
  const list = Array.isArray(rawEvents) ? rawEvents : [];
  const merged = [];
  const pendingToolCalls = new Map();
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    const type = String(entry?.type || '');
    const runId = normalizeRunId(entry?.runId);

    if (type === 'tool_call') {
      const callId = entry?.payload?.callId;
      const tool = entry?.payload?.tool;
      const next = list[i + 1];
      const nextRunId = normalizeRunId(next?.runId);
      if (
        !callId &&
        tool &&
        next?.type === 'tool_result' &&
        next?.payload?.tool === tool &&
        !next?.payload?.callId &&
        runId === nextRunId
      ) {
        merged.push({
          ...entry,
          type: 'tool',
          payload: {
            tool,
            args: entry?.payload?.args,
            result: next?.payload?.result,
          },
        });
        i += 1;
        continue;
      }
      if (callId) {
        const key = runId ? `${runId}:${callId}` : callId;
        pendingToolCalls.set(key, { index: merged.length, entry });
      }
      merged.push(entry);
      continue;
    }

    if (type === 'tool_result') {
      const callId = entry?.payload?.callId;
      if (callId) {
        const key = runId ? `${runId}:${callId}` : callId;
        if (!pendingToolCalls.has(key)) {
          merged.push(entry);
          continue;
        }
        const pending = pendingToolCalls.get(key);
        const callEntry = pending?.entry;
        const callPayload = callEntry?.payload || {};
        const resultPayload = entry?.payload || {};
        merged[pending.index] = {
          ...callEntry,
          type: 'tool',
          payload: {
            tool: callPayload.tool || resultPayload.tool,
            callId,
            args: callPayload.args,
            result: resultPayload.result,
          },
        };
        pendingToolCalls.delete(key);
        continue;
      }
      merged.push(entry);
      continue;
    }

    if (type === 'subagent_tool_call') {
      const next = list[i + 1];
      const agent = entry?.payload?.agent;
      const tool = entry?.payload?.tool;
      if (
        next?.type === 'subagent_tool_result' &&
        runId === normalizeRunId(next?.runId) &&
        agent &&
        tool &&
        next?.payload?.agent === agent &&
        next?.payload?.tool === tool
      ) {
        merged.push({
          ...entry,
          type: 'subagent_tool',
          payload: {
            agent,
            tool,
            args: entry?.payload?.args,
            result: next?.payload?.result,
          },
        });
        i += 1;
        continue;
      }
      merged.push(entry);
      continue;
    }

    merged.push(entry);
  }
  return merged;
}

export function readRawEventList(events) {
  return Array.isArray(events?.eventsList) ? events.eventsList : parseEvents(events?.content || '');
}

export function buildEventList(rawEvents = []) {
  return normalizeEvents(mergeToolCallResultEvents(Array.isArray(rawEvents) ? rawEvents : []));
}

export function buildSessionStats(eventList = [], tasks = []) {
  const stats = {
    total: eventList.length,
    user: 0,
    assistant: 0,
    tool: 0,
    subagent: 0,
    tasks: Array.isArray(tasks) ? tasks.length : 0,
    lastEvent: null,
  };
  eventList.forEach((event) => {
    const type = event.type || '';
    if (type === 'user') stats.user += 1;
    if (type === 'assistant') stats.assistant += 1;
    if (type.startsWith('subagent')) {
      stats.subagent += 1;
    } else if (type.includes('tool')) {
      stats.tool += 1;
    }
    stats.lastEvent = event;
  });
  return stats;
}

export function pickRecentConversation(eventList = [], limit = 4) {
  const conversation = eventList.filter((e) =>
    ['user', 'assistant', 'assistant_thinking', 'system'].includes(e.type)
  );
  const reversed = conversation.slice().reverse();
  const size = Number(limit);
  if (!Number.isFinite(size) || size <= 0) return reversed;
  return reversed.slice(0, size);
}

