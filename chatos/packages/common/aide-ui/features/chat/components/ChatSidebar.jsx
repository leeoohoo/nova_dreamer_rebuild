import React, { useState } from 'react';
import { Badge, Button, Dropdown, Input, List, Modal, Space, Tooltip, Typography } from 'antd';
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

const STATUS_META = {
  running: { badge: 'processing', label: '执行中' },
  error: { badge: 'error', label: '错误' },
  idle: { badge: 'default', label: '空闲' },
};

function resolveStatusMeta(status) {
  if (status && STATUS_META[status]) return STATUS_META[status];
  return STATUS_META.idle;
}

export function ChatSidebar({
  sessions,
  selectedSessionId,
  sessionStatusById,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  onRenameSession,
  onRefresh,
  onCollapse,
  headerLabel = '会话',
  renameTitle = '重命名会话',
  emptyLabel = '未命名会话',
  namePlaceholder = '会话名称',
}) {
  const [renameState, setRenameState] = useState(null);

  const confirmForceDelete = (session) => {
    Modal.confirm({
      title: '强制删除会话？',
      content: '会话正在执行中，强制删除会终止当前任务，且无法恢复。',
      okText: '强制删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => onDeleteSession?.(session.id, { force: true }),
    });
  };

  const sessionMenu = (session) => {
    const sid = normalizeId(session?.id);
    const statusValue = sessionStatusById?.[sid] || 'idle';
    const running = statusValue === 'running';
    const deleteLabel = running ? (
      <Tooltip title="会话正在执行中，无法删除">
        <Space size={6}>
          <span>删除</span>
          <Text type="secondary" style={{ fontSize: 12 }}>会话正在执行中，无法删除</Text>
        </Space>
      </Tooltip>
    ) : (
      '删除'
    );
    const items = [
      { key: 'rename', label: '重命名', icon: <EditOutlined /> },
      { key: 'delete', label: deleteLabel, icon: <DeleteOutlined />, danger: true, disabled: running },
    ];
    if (running) {
      items.push({ key: 'force_delete', label: '强制删除', icon: <DeleteOutlined />, danger: true });
    }
    return {
      items,
      onClick: ({ key }) => {
        if (key === 'delete') {
          onDeleteSession?.(session.id);
        }
        if (key === 'force_delete') {
          confirmForceDelete(session);
        }
        if (key === 'rename') {
          setRenameState({ id: session.id, title: session.title || '' });
        }
      },
    };
  };

  return (
    <div style={{ padding: 14, height: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Text type="secondary" style={{ flex: 1 }}>
          {headerLabel}
        </Text>
        {onCollapse ? <Button size="small" icon={<MenuFoldOutlined />} onClick={() => onCollapse?.()} /> : null}
        <Button size="small" icon={<ReloadOutlined />} onClick={() => onRefresh?.()} />
        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => onCreateSession?.()} />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <List
          size="small"
          dataSource={Array.isArray(sessions) ? sessions : []}
          renderItem={(item) => {
            const selected = normalizeId(item?.id) === normalizeId(selectedSessionId);
            const statusValue = sessionStatusById?.[normalizeId(item?.id)] || 'idle';
            const statusMeta = resolveStatusMeta(statusValue);
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
                  title={<span style={{ fontWeight: selected ? 600 : 500 }}>{item.title || emptyLabel}</span>}
                  description={(
                    <Space size={8} align="center" wrap>
                      <Text type="secondary">{formatTime(item.updatedAt || item.createdAt)}</Text>
                      <Badge status={statusMeta.badge} text={statusMeta.label} />
                    </Space>
                  )}
                />
              </List.Item>
            );
          }}
        />
      </div>

      <Modal
        open={Boolean(renameState)}
        title={renameTitle}
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
          placeholder={namePlaceholder}
        />
      </Modal>
    </div>
  );
}
