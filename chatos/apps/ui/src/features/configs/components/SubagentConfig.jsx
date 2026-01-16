import React, { useMemo } from 'react';
import { Button, List, Select, Space, Tag, Typography } from 'antd';

const { Text } = Typography;

export function SubagentConfig({ availableSubagents = [], items = [], onAdd, onRemove }) {
  const selectedIds = useMemo(() => new Set(items.map((item) => item.itemId)), [items]);
  const options = availableSubagents
    .filter((agent) => agent?.id && !selectedIds.has(agent.id))
    .map((agent) => ({
      label: agent.name || agent.id,
      value: agent.id,
    }));

  const handleAdd = (agentId) => {
    const agent = availableSubagents.find((a) => a.id === agentId);
    if (agent && typeof onAdd === 'function') {
      onAdd('subagent', agent.id, agent);
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Select
        placeholder="选择子代理"
        options={options}
        onSelect={handleAdd}
        disabled={options.length === 0}
        style={{ maxWidth: 420 }}
      />
      <List
        bordered
        dataSource={items}
        locale={{ emptyText: '暂无已选子代理' }}
        renderItem={(item) => (
          <List.Item
            actions={[
              <Button key="remove" size="small" onClick={() => onRemove?.('subagent', item.itemId)}>
                移除
              </Button>,
            ]}
          >
            <Space direction="vertical" size={2}>
              <Text strong>{item?.itemData?.name || item.itemId}</Text>
              <Space size={8}>
                <Text type="secondary">{item?.itemData?.description || '—'}</Text>
                {item?.itemData?.enabled === false ? <Tag color="red">禁用</Tag> : null}
              </Space>
            </Space>
          </List.Item>
        )}
      />
    </Space>
  );
}
