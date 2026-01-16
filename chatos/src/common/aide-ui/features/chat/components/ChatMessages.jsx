import React, { useEffect, useMemo, useRef } from 'react';
import { Button, Space } from 'antd';

import { UserMessageCard } from './UserMessageCard.jsx';
import { AssistantTurnCard } from './AssistantTurnCard.jsx';

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function shouldAutoScroll(el) {
  if (!el) return true;
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  return distance < 80;
}

export function ChatMessages({ messages, streaming, hasMore, loadingMore, onLoadMore }) {
  const list = useMemo(() => (Array.isArray(messages) ? messages : []), [messages]);
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
      </Space>
    </div>
  );
}
