import React, { useEffect, useMemo, useRef } from 'react';
import { Button, Space } from 'antd';

import { UserMessageCard } from './UserMessageCard.jsx';
import { AssistantTurnCard } from './AssistantTurnCard.jsx';
import { SystemMessageCard } from './SystemMessageCard.jsx';

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const SUMMARY_MESSAGE_NAME = 'conversation_summary';

function isSummaryMessage(message) {
  if (!message || message.role !== 'system') return false;
  const name = typeof message?.name === 'string' ? message.name.trim() : '';
  return name === SUMMARY_MESSAGE_NAME;
}

function pickLatestSummary(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (isSummaryMessage(list[i])) return list[i];
  }
  return null;
}

function shouldAutoScroll(el) {
  if (!el) return true;
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  return distance < 80;
}

export function ChatMessages({ messages, streaming, hasMore, loadingMore, onLoadMore }) {
  const allMessages = useMemo(() => (Array.isArray(messages) ? messages.filter(Boolean) : []), [messages]);
  const summaryMessage = useMemo(() => pickLatestSummary(allMessages), [allMessages]);
  const summaryId = normalizeId(summaryMessage?.id);
  const list = useMemo(() => {
    return allMessages.filter((msg) => {
      if (!msg) return false;
      if (normalizeId(msg?.id) === summaryId) return false;
      if (msg?.hidden === true) return false;
      if (msg?.role === 'system') return false;
      return true;
    });
  }, [allMessages, summaryId]);
  const turns = useMemo(() => {
    const blocks = [];
    let buffer = [];
    const flush = () => {
      if (buffer.length === 0) return;
      blocks.push({ type: 'assistant', key: normalizeId(buffer?.[0]?.id) || `assistant_${blocks.length}`, messages: buffer });
      buffer = [];
    };
    list.forEach((msg) => {
      if (!msg) return;
      if (msg.role === 'user') {
        flush();
        blocks.push({ type: 'user', key: normalizeId(msg?.id) || `user_${blocks.length}`, message: msg });
        return;
      }
      buffer.push(msg);
    });
    flush();
    return blocks;
  }, [list]);
  const summaryContent =
    summaryMessage && typeof summaryMessage?.content === 'string' ? summaryMessage.content.trim() : '';
  const containerRef = useRef(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      stickToBottomRef.current = shouldAutoScroll(el);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      try {
        el.removeEventListener('scroll', onScroll);
      } catch {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [list, streaming?.messageId]);

  return (
    <div ref={containerRef} style={{ height: '100%', overflow: 'auto', paddingRight: 6 }}>
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {hasMore ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0' }}>
            <Button size="small" onClick={() => onLoadMore?.()} loading={loadingMore}>
              加载更多
            </Button>
          </div>
        ) : null}
        {turns.map((turn) => {
          if (turn.type === 'user') {
            return <UserMessageCard key={turn.key} message={turn.message} />;
          }
          return <AssistantTurnCard key={turn.key} messages={turn.messages} streaming={streaming} />;
        })}
        {summaryContent ? <SystemMessageCard message={summaryMessage} /> : null}
      </Space>
    </div>
  );
}
