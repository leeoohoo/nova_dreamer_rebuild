import React, { useState } from 'react';
import { Button, Dropdown, Input, List, Modal, Space, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, MenuFoldOutlined, MoreOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';

const { Text } = Typography;

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatTime(ts) {
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleString();
}

export function ChatSidebar({
  sessions,
  selectedSessionId,
  streaming,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  onRenameSession,
  onRefresh,
  onCollapse,
}) {
  const [renameState, setRenameState] = useState(null);

  const sessionMenu = (session) => ({
    items: [
      { key: 'rename', label: '重命名', icon: <EditOutlined /> },
      { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true },
    ],
    onClick: ({ key }) => {
      if (key === 'delete') {
        onDeleteSession?.(session.id);
      }
      if (key === 'rename') {
        setRenameState({ id: session.id, title: session.title || '' });
      }
    },
  });

  return (
    <div style={{ padding: 14, height: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Text type="secondary" style={{ flex: 1 }}>
          会话
        </Text>
        {onCollapse ? <Button size="small" icon={<MenuFoldOutlined />} onClick={() => onCollapse?.()} /> : null}
        <Button size="small" icon={<ReloadOutlined />} onClick={() => onRefresh?.()} />
        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => onCreateSession?.()} disabled={streaming} />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <List
          size="small"
          dataSource={Array.isArray(sessions) ? sessions : []}
          renderItem={(item) => {
            const selected = normalizeId(item?.id) === normalizeId(selectedSessionId);
            return (
              <List.Item
                style={{
                  cursor: 'pointer',
                  padding: '10px 8px',
                  borderRadius: 8,
                  background: selected ? 'var(--ds-selected-bg)' : 'transparent',
                }}
                onClick={() => onSelectSession?.(item.id)}
                actions={[
                  <Dropdown key="actions" trigger={['click']} menu={sessionMenu(item)}>
                    <Button size="small" type="text" icon={<MoreOutlined />} />
                  </Dropdown>,
                ]}
              >
                <List.Item.Meta
                  title={<span style={{ fontWeight: selected ? 600 : 500 }}>{item.title || '未命名会话'}</span>}
                  description={<Text type="secondary">{formatTime(item.updatedAt || item.createdAt)}</Text>}
                />
              </List.Item>
            );
          }}
        />
      </div>

      <Modal
        open={Boolean(renameState)}
        title="重命名会话"
        okText="保存"
        cancelText="取消"
        onCancel={() => setRenameState(null)}
        onOk={() => {
          const title = typeof renameState?.title === 'string' ? renameState.title.trim() : '';
          if (title) {
            onRenameSession?.(renameState.id, title);
          }
          setRenameState(null);
        }}
      >
        <Input
          value={renameState?.title || ''}
          onChange={(e) => setRenameState((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
          placeholder="会话名称"
        />
      </Modal>
    </div>
  );
}
