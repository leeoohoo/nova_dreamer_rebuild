import React, { useMemo } from 'react';
import { Button, Table, Tag } from 'antd';

export function McpConfig({ availableServers = [], items = [], onAdd, onRemove }) {
  const selectedIds = useMemo(() => new Set(items.map((item) => item.itemId)), [items]);

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '描述', dataIndex: 'description', key: 'description', render: (value) => value || '-' },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (value) => (value === false ? <Tag color="red">禁用</Tag> : <Tag color="green">启用</Tag>),
    },
    {
      title: '操作',
      key: 'action',
      render: (_value, record) => {
        const isSelected = selectedIds.has(record.id);
        return isSelected ? (
          <Button size="small" onClick={() => onRemove?.('mcp_server', record.id)}>
            移除
          </Button>
        ) : (
          <Button type="primary" size="small" onClick={() => onAdd?.('mcp_server', record.id, record)}>
            选择
          </Button>
        );
      },
    },
  ];

  const dataSource = (availableServers || []).map((server) => ({ ...server, key: server.id }));

  return (
    <Table
      size="small"
      columns={columns}
      dataSource={dataSource}
      pagination={{ pageSize: 6 }}
      locale={{ emptyText: '暂无 MCP 服务器' }}
    />
  );
}
