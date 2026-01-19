import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Divider, Drawer, Empty, Space, Table, Tag, Typography } from 'antd';

import { useElementHeight } from '../../../hooks/useElementSize.js';
import { formatDateTime } from '../../../lib/format.js';

const { Title, Text, Paragraph } = Typography;

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
            {task.runId ? <Tag color="geekblue">run: {task.runId}</Tag> : null}
            {task.sessionId ? <Tag color="blue">session: {task.sessionId}</Tag> : null}
          </Space>
          <Space size="small" wrap>
            <Tag>任务 ID: {task.id || '-'}</Tag>
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

function TasksDrawer({ open, onClose, tasks }) {
  const [activeTask, setActiveTask] = useState(null);
  const tableViewportRef = useRef(null);
  const tableViewportHeight = useElementHeight(tableViewportRef, 520);
  const scrollY = Math.max(240, tableViewportHeight - 140);
  const rows = useMemo(
    () =>
      (tasks || []).map((t, idx) => ({
        key: t.id || idx,
        id: t.id || '',
        title: t.title || '',
        status: t.status || '',
        priority: t.priority || '',
        tags: Array.isArray(t.tags) ? t.tags.join(',') : '',
        details: typeof t.details === 'string' ? t.details : '',
        runId: t.runId || '',
        sessionId: t.sessionId || '',
        updatedAt: formatDateTime(t.updatedAt || t.createdAt || ''),
        raw: t,
      })),
    [tasks]
  );

  useEffect(() => {
    if (!open) {
      setActiveTask(null);
    }
  }, [open]);

  return (
    <>
      <Drawer
        title="任务列表"
        open={open}
        onClose={onClose}
        width={1200}
        styles={{
          content: { display: 'flex', flexDirection: 'column' },
          body: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' },
        }}
      >
        {rows.length === 0 ? (
          <Empty description="暂无任务" />
        ) : (
          <div ref={tableViewportRef} style={{ flex: 1, minHeight: 0 }}>
            <Table
              size="small"
              dataSource={rows}
              columns={[
                { title: 'ID', dataIndex: 'id', width: 200 },
                {
                  title: '标题',
                  dataIndex: 'title',
                  width: 260,
                  render: (text) => (
                    <Paragraph style={{ margin: 0 }} ellipsis={{ rows: 2, expandable: true }}>
                      {text || '-'}
                    </Paragraph>
                  ),
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 100,
                  render: (v) => (v ? <Tag color={v === 'done' ? 'green' : 'blue'}>{v}</Tag> : '-'),
                },
                {
                  title: '优先级',
                  dataIndex: 'priority',
                  width: 100,
                  render: (v) => (v ? <Tag color={v === 'high' ? 'volcano' : 'default'}>{v}</Tag> : '-'),
                },
                {
                  title: '标签',
                  dataIndex: 'tags',
                  width: 200,
                  render: (text) =>
                    text
                      ? text.split(',').map((tag) => <Tag key={tag.trim()}>{tag.trim()}</Tag>)
                      : '-',
                },
                {
                  title: '任务详情',
                  dataIndex: 'details',
                  width: 360,
                  render: (text) =>
                    text ? (
                      <Paragraph style={{ margin: 0 }} ellipsis={{ rows: 2, expandable: true }}>
                        {text}
                      </Paragraph>
                    ) : (
                      <Text type="secondary">-</Text>
                    ),
                },
                {
                  title: '会话 ID',
                  dataIndex: 'sessionId',
                  width: 220,
                  render: (text) =>
                    text ? (
                      <Paragraph style={{ margin: 0 }} ellipsis={{ rows: 2, expandable: true }}>
                        {text}
                      </Paragraph>
                    ) : (
                      <Text type="secondary">-</Text>
                    ),
                },
                {
                  title: 'Run ID',
                  dataIndex: 'runId',
                  width: 260,
                  render: (text) =>
                    text ? (
                      <Paragraph style={{ margin: 0 }} ellipsis={{ rows: 2, expandable: true }}>
                        {text}
                      </Paragraph>
                    ) : (
                      <Text type="secondary">-</Text>
                    ),
                },
                { title: '更新时间', dataIndex: 'updatedAt', width: 180 },
              ]}
              pagination={{
                defaultPageSize: 20,
                showSizeChanger: true,
                pageSizeOptions: ['10', '20', '50', '100'],
              }}
              scroll={{ x: 1680, y: scrollY }}
              onRow={(record) => ({
                onClick: () => setActiveTask(record.raw),
                style: { cursor: 'pointer' },
              })}
            />
          </div>
        )}
      </Drawer>
      <TaskDetailsDrawer open={!!activeTask} onClose={() => setActiveTask(null)} task={activeTask} />
    </>
  );
}

export { TasksDrawer };

