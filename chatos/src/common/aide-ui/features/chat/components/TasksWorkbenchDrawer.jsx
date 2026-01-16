import React, { useEffect, useMemo, useState } from 'react';
import { Divider, Drawer, Empty, List, Space, Tag, Typography } from 'antd';

import { formatDateTime } from '../../../lib/format.js';

const { Title, Text, Paragraph } = Typography;

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStatus(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'todo' || raw === 'doing' || raw === 'blocked' || raw === 'done') return raw;
  return raw;
}

function TaskDetailsDrawer({ open, onClose, task }) {
  const detailsText = typeof task?.details === 'string' ? task.details : '';
  const statusColorMap = { done: 'green', doing: 'blue', blocked: 'red', todo: 'default' };
  const priorityColorMap = { high: 'volcano', medium: 'blue', low: 'default' };

  return (
    <Drawer title="任务详情" open={open} onClose={onClose} width={720} destroyOnClose>
      {!task ? (
        <Empty description="未选择任务" />
      ) : (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space align="center" wrap>
            <Title level={5} style={{ margin: 0 }}>
              {task.title || '未命名任务'}
            </Title>
            {task.status ? <Tag color={statusColorMap[task.status] || 'default'}>{task.status}</Tag> : null}
            {task.priority ? <Tag color={priorityColorMap[task.priority] || 'default'}>{task.priority}</Tag> : null}
            {Array.isArray(task.tags) && task.tags.length > 0 ? task.tags.map((tag) => <Tag key={tag}>{tag}</Tag>) : null}
          </Space>

          <Space size="small" wrap>
            <Tag>任务 ID: {task.id || '-'}</Tag>
            {task.sessionId ? <Tag color="blue">session: {task.sessionId}</Tag> : null}
            {task.runId ? <Tag color="geekblue">run: {task.runId}</Tag> : null}
          </Space>

          <Space size="small" wrap>
            <Tag>创建: {formatDateTime(task.createdAt)}</Tag>
            <Tag>更新: {formatDateTime(task.updatedAt)}</Tag>
          </Space>

          <Divider />

          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Text strong>任务详情</Text>
            <Paragraph
              style={{
                whiteSpace: 'pre-wrap',
                background: 'var(--ds-subtle-bg)',
                padding: 12,
                border: '1px solid var(--ds-panel-border)',
                borderRadius: 4,
                margin: 0,
              }}
            >
              {detailsText || '暂无详情'}
            </Paragraph>
          </Space>
        </Space>
      )}
    </Drawer>
  );
}

export function TasksWorkbenchDrawer({ open, onClose, tasks }) {
  const [activeTask, setActiveTask] = useState(null);

  const rows = useMemo(() => {
    const list = Array.isArray(tasks) ? tasks.filter(Boolean) : [];
    const parseMs = (ts) => {
      const ms = Date.parse(ts);
      return Number.isFinite(ms) ? ms : 0;
    };
    return [...list].sort((a, b) => {
      const aMs = parseMs(a?.updatedAt || a?.createdAt || '');
      const bMs = parseMs(b?.updatedAt || b?.createdAt || '');
      return bMs - aMs;
    });
  }, [tasks]);

  useEffect(() => {
    if (!open) setActiveTask(null);
  }, [open]);

  const statusColorMap = { done: 'green', doing: 'blue', blocked: 'red', todo: 'default' };

  return (
    <>
      <Drawer
        title="任务工作台"
        open={open}
        onClose={onClose}
        width={420}
        destroyOnClose
        styles={{ body: { padding: 12 } }}
        extra={<Tag style={{ marginRight: 0 }}>{rows.length}</Tag>}
      >
        {rows.length === 0 ? (
          <Empty description="暂无任务" />
        ) : (
          <List
            dataSource={rows}
            renderItem={(task, idx) => {
              const title = typeof task?.title === 'string' ? task.title.trim() : '';
              const status = normalizeStatus(task?.status);
              const statusColor = statusColorMap[status] || 'default';
              const key = normalizeId(task?.id) || `${idx}`;
              return (
                <List.Item
                  key={key}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setActiveTask(task)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                    <Text
                      ellipsis={{ tooltip: title || '未命名任务' }}
                      style={{ flex: 1, minWidth: 0, fontWeight: 550 }}
                    >
                      {title || '未命名任务'}
                    </Text>
                    {status ? <Tag color={statusColor}>{status}</Tag> : <Text type="secondary">-</Text>}
                  </div>
                </List.Item>
              );
            }}
          />
        )}
      </Drawer>
      <TaskDetailsDrawer open={!!activeTask} onClose={() => setActiveTask(null)} task={activeTask} />
    </>
  );
}

