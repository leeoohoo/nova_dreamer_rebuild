import React, { useMemo, useState } from 'react';
import { Button, Space, Tag, Typography } from 'antd';

import { MarkdownBlock } from '../../../components/MarkdownBlock.jsx';

const { Text } = Typography;

function formatTime(ts) {
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString();
}

function formatLine(item) {
  if (!item) return '';
  const text = typeof item.text === 'string' ? item.text.trim() : String(item.text || '').trim();
  if (!text) return '';
  const time = item.ts ? formatTime(item.ts) : '';
  return time ? `[${time}] ${text}` : text;
}

export function McpStreamPanel({ stream, onClear }) {
  const [collapsed, setCollapsed] = useState(false);
  if (!stream || typeof stream !== 'object') return null;

  const items = useMemo(() => (Array.isArray(stream.items) ? stream.items : []), [stream.items]);
  const done = stream.done === true;
  const status = typeof stream.status === 'string' ? stream.status.trim() : '';
  const runId = typeof stream.runId === 'string' ? stream.runId.trim() : '';
  const server = typeof stream.server === 'string' ? stream.server.trim() : '';
  const finalText = typeof stream.finalText === 'string' ? stream.finalText.trim() : '';
  const lines = useMemo(() => items.map(formatLine).filter(Boolean), [items]);

  return (
    <div style={{ border: '1px solid var(--ds-panel-border)', borderRadius: 12, padding: 10, background: 'var(--ds-panel-bg)' }}>
      <Space size={8} align="center" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
        <Space size={8} align="center" wrap>
          <Tag color={done ? 'green' : 'gold'} style={{ marginRight: 0 }}>
            MCP Stream{done ? ' · done' : ''}
          </Tag>
          {server ? <Text type="secondary">{server}</Text> : null}
          {runId ? <Text type="secondary">runId: {runId}</Text> : null}
          {status ? <Tag color={done ? 'green' : 'blue'}>{status}</Tag> : null}
        </Space>
        <Space size={8} align="center" wrap>
          <Button size="small" type="text" onClick={() => setCollapsed((prev) => !prev)}>
            {collapsed ? '展开' : '收起'}
          </Button>
          {typeof onClear === 'function' ? (
            <Button size="small" type="text" onClick={onClear}>
              清空
            </Button>
          ) : null}
        </Space>
      </Space>

      {collapsed ? null : (
        <>
          <div style={{ marginTop: 8, maxHeight: 220, overflow: 'auto', fontSize: 12, lineHeight: 1.5 }}>
            {lines.length > 0 ? (
              lines.map((line, idx) => (
                <div key={`${idx}_${line}`} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {line}
                </div>
              ))
            ) : (
              <Text type="secondary">等待 MCP 流式输出…</Text>
            )}
          </div>
          {finalText ? (
            <div style={{ marginTop: 10 }}>
              <Text type="secondary">最终结果</Text>
              <MarkdownBlock text={finalText} maxHeight={240} container={false} copyable />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
