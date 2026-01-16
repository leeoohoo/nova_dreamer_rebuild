import React, { useMemo } from 'react';
import { Button, List, Select, Space, Typography } from 'antd';

const { Text } = Typography;

export function ModelConfig({ availableModels = [], items = [], onAdd, onRemove }) {
  const selectedIds = useMemo(() => new Set(items.map((item) => item.itemId)), [items]);
  const options = availableModels
    .filter((model) => model?.id && !selectedIds.has(model.id))
    .map((model) => ({
      label: `${model.name || model.id} (${model.provider || 'unknown'})`,
      value: model.id,
    }));

  const handleAdd = (modelId) => {
    const model = availableModels.find((m) => m.id === modelId);
    if (model && typeof onAdd === 'function') {
      onAdd('model', model.id, model);
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Select
        placeholder="选择模型"
        options={options}
        onSelect={handleAdd}
        disabled={options.length === 0}
        style={{ maxWidth: 420 }}
      />
      <List
        bordered
        dataSource={items}
        locale={{ emptyText: '暂无已选模型' }}
        renderItem={(item) => (
          <List.Item
            actions={[
              <Button key="remove" size="small" onClick={() => onRemove?.('model', item.itemId)}>
                移除
              </Button>,
            ]}
          >
            <Space direction="vertical" size={2}>
              <Text strong>{item?.itemData?.name || item.itemId}</Text>
              <Text type="secondary">{item?.itemData?.provider || 'unknown'}</Text>
            </Space>
          </List.Item>
        )}
      />
    </Space>
  );
}
