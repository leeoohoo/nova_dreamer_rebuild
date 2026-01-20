import React, { useMemo } from 'react';
import { Space, Tag, Typography } from 'antd';

import { MarkdownBlock } from '../../../components/MarkdownBlock.jsx';

const { Text } = Typography;

const SUMMARY_MESSAGE_NAME = 'conversation_summary';

function formatTime(ts) {
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString();
}

function getSystemLabel(message) {
  const name = typeof message?.name === 'string' ? message.name.trim() : '';
  if (name === SUMMARY_MESSAGE_NAME) return '会话总结';
  return '系统';
}

function getSystemTagColor(message) {
  const name = typeof message?.name === 'string' ? message.name.trim() : '';
  if (name === SUMMARY_MESSAGE_NAME) return 'purple';
  return 'default';
}

export function SystemMessageCard({ message }) {
  const createdAt = message?.createdAt;
  const timeText = useMemo(() => (createdAt ? formatTime(createdAt) : ''), [createdAt]);
  const content = typeof message?.content === 'string' ? message.content : String(message?.content || '');
  const label = getSystemLabel(message);
  const tagColor = getSystemTagColor(message);

  return (
    <div style={{ width: '100%', padding: '4px 0' }}>
      <Space size={8} wrap>
        <Tag color={tagColor} style={{ marginRight: 0 }}>
          {label}
        </Tag>
        {timeText ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {timeText}
          </Text>
        ) : null}
      </Space>

      <div style={{ marginTop: 6 }}>
        {content.trim() ? (
          <MarkdownBlock text={content} maxHeight={260} copyable />
        ) : (
          <Text type="secondary">（无内容）</Text>
        )}
      </div>
    </div>
  );
}
