import React, { useMemo } from 'react';
import { Button, List, Select, Space, Tag, Typography } from 'antd';

const { Text } = Typography;

export function PromptConfig({ availablePrompts = [], items = [], onAdd, onRemove }) {
  const selectedIds = useMemo(() => new Set(items.map((item) => item.itemId)), [items]);
  const options = availablePrompts
    .filter((prompt) => prompt?.id && !selectedIds.has(prompt.id))
    .map((prompt) => ({
      label: prompt.title ? `${prompt.title} (${prompt.name})` : prompt.name,
      value: prompt.id,
    }));

  const handleAdd = (promptId) => {
    const prompt = availablePrompts.find((p) => p.id === promptId);
    if (prompt && typeof onAdd === 'function') {
      onAdd('prompt', prompt.id, prompt);
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Select
        placeholder="选择提示词"
        options={options}
        onSelect={handleAdd}
        disabled={options.length === 0}
        style={{ maxWidth: 420 }}
      />
      <List
        bordered
        dataSource={items}
        locale={{ emptyText: '暂无已选提示词' }}
        renderItem={(item) => (
          <List.Item
            actions={[
              <Button key="remove" size="small" onClick={() => onRemove?.('prompt', item.itemId)}>
                移除
              </Button>,
            ]}
          >
            <Space direction="vertical" size={2}>
              <Text strong>{item?.itemData?.title || item?.itemData?.name || item.itemId}</Text>
              <Space size={8}>
                <Text type="secondary">{item?.itemData?.name || item.itemId}</Text>
                {item?.itemData?.type ? <Tag>{item.itemData.type}</Tag> : null}
              </Space>
            </Space>
          </List.Item>
        )}
      />
    </Space>
  );
}
