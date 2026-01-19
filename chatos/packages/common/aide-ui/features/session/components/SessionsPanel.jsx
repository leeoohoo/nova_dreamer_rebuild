import React from 'react';
import { Alert, Badge, Button, Card, Empty, Popconfirm, Space, Table, Typography } from 'antd';

import { formatDateTime } from '../../../lib/format.js';

const { Text } = Typography;

function SessionsPanel({ data, loading, actionName, onRefresh, onKill, onRestart, onStop, onOpenLog, onKillAll }) {
  const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
  const sessionsDir = typeof data?.sessionsDir === 'string' ? data.sessionsDir : '';
  const formatPorts = (record) => {
    const ports = Array.isArray(record?.ports) ? record.ports : [];
    if (ports.length > 0) return ports.join(', ');
    const port = record?.port;
    if (port === undefined || port === null || port === '') return '-';
    return String(port);
  };
  return (
    <Card
      title="后台会话"
      extra={
        <Space>
          <Button size="small" onClick={onRefresh} loading={loading}>
            刷新
          </Button>
          <Popconfirm title="关闭全部会话？" onConfirm={onKillAll} okText="确认关闭" cancelText="取消">
            <Button size="small" danger loading={actionName === 'all'}>
              全部关闭
            </Button>
          </Popconfirm>
        </Space>
      }
    >
      {sessionsDir ? (
        <Alert
          type="info"
          showIcon={false}
          message={<span style={{ fontFamily: 'monospace' }}>{sessionsDir}</span>}
          style={{ marginBottom: 12 }}
        />
      ) : null}

      {sessions.length === 0 ? (
        <Empty description="暂无会话" />
      ) : (
        <Table
          size="small"
          rowKey={(row) => row.name}
          dataSource={sessions}
          loading={loading}
          pagination={false}
          columns={[
            { title: '名称', dataIndex: 'name', width: 200 },
            {
              title: '状态',
              dataIndex: 'running',
              width: 110,
              render: (v) => <Badge status={v ? 'processing' : 'default'} text={v ? '运行中' : '已停止'} />,
            },
            {
              title: 'PID',
              dataIndex: 'pid',
              width: 120,
              render: (_v, record) => {
                const pid = typeof record?.resolvedPid === 'number' ? record.resolvedPid : record?.pid;
                return typeof pid === 'number' ? String(pid) : '-';
              },
            },
            {
              title: '端口',
              dataIndex: 'port',
              width: 120,
              render: (_v, record) => (
                <Text type="secondary" style={{ fontFamily: 'monospace' }}>
                  {formatPorts(record)}
                </Text>
              ),
            },
            {
              title: '创建时间',
              dataIndex: 'startedAt',
              width: 200,
              render: (v) => formatDateTime(v),
            },
            {
              title: '命令',
              dataIndex: 'command',
              render: (v) => (
                <Text type="secondary" style={{ fontFamily: 'monospace' }}>
                  {String(v || '')}
                </Text>
              ),
            },
            {
              title: '操作',
              width: 320,
              render: (_text, record) => {
                const closing = actionName === record.name;
                const restarting = actionName === `restart:${record.name}`;
                const stopping = actionName === `stop:${record.name}`;
                const busy = closing || restarting || stopping;
                const hasCommand = Boolean(String(record?.command || '').trim());
                return (
                  <Space size={8} wrap>
                    <Button size="small" onClick={() => onOpenLog?.(record)} disabled={!record?.name || closing}>
                      日志
                    </Button>
                    <Popconfirm
                      title={`停止会话 ${record.name}?`}
                      onConfirm={() => onStop?.(record.name)}
                      okText="停止"
                      cancelText="取消"
                      disabled={!record?.name || busy}
                    >
                      <Button size="small" loading={stopping} disabled={busy}>
                        停止
                      </Button>
                    </Popconfirm>
                    <Popconfirm
                      title={`重启会话 ${record.name}?`}
                      onConfirm={() => onRestart?.(record.name)}
                      okText="重启"
                      cancelText="取消"
                      disabled={!record?.name || !hasCommand || busy}
                    >
                      <Button size="small" loading={restarting} disabled={busy}>
                        重启
                      </Button>
                    </Popconfirm>
                    <Popconfirm
                      title={`关闭并清理会话 ${record.name}?（会删除日志）`}
                      onConfirm={() => onKill(record.name)}
                      okText="关闭"
                      cancelText="取消"
                      disabled={restarting || stopping}
                    >
                      <Button size="small" danger loading={closing} disabled={restarting || stopping}>
                        关闭
                      </Button>
                    </Popconfirm>
                  </Space>
                );
              },
            },
          ]}
        />
      )}
    </Card>
  );
}

export { SessionsPanel };
