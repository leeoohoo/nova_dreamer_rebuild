import React, { useEffect, useState } from 'react';
import { Empty, Tabs, Typography, message } from 'antd';

import { api, hasApi } from '../../lib/api.js';
import { ModelConfig } from './components/ModelConfig.jsx';
import { McpConfig } from './components/McpConfig.jsx';
import { PromptConfig } from './components/PromptConfig.jsx';
import { SubagentConfig } from './components/SubagentConfig.jsx';
import { ConfigSettings } from './components/ConfigSettings.jsx';

const { Title, Paragraph } = Typography;

export function ConfigDetail({
  configId,
  availableModels = [],
  availableMcpServers = [],
  availablePrompts = [],
  availableSubagents = [],
  onConfigUpdated,
}) {
  const [config, setConfig] = useState(null);
  const [items, setItems] = useState({
    model: [],
    mcp_server: [],
    prompt: [],
    subagent: [],
  });
  const [loading, setLoading] = useState(false);

  const loadDetail = async () => {
    if (!hasApi || !configId) return;
    setLoading(true);
    try {
      const [configRes, itemsRes] = await Promise.all([
        api.invoke('configs:get', { id: configId }),
        api.invoke('configs:items:list', { configId }),
      ]);
      if (!configRes?.ok) {
        message.error(configRes?.message || '加载配置失败');
        return;
      }
      setConfig(configRes.data || null);
      const grouped = { model: [], mcp_server: [], prompt: [], subagent: [] };
      const list = Array.isArray(itemsRes?.data) ? itemsRes.data : [];
      list.forEach((item) => {
        if (grouped[item.itemType]) grouped[item.itemType].push(item);
      });
      setItems(grouped);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDetail();
  }, [configId]);

  const addItem = async (itemType, itemId, itemData) => {
    if (!hasApi) return;
    const res = await api.invoke('configs:items:add', { configId, itemType, itemId, itemData });
    if (!res?.ok) {
      message.error(res?.message || '添加失败');
      return;
    }
    await loadDetail();
    onConfigUpdated?.();
  };

  const removeItem = async (itemType, itemId) => {
    if (!hasApi) return;
    const res = await api.invoke('configs:items:remove', { configId, itemType, itemId });
    if (!res?.ok) {
      message.error(res?.message || '移除失败');
      return;
    }
    await loadDetail();
    onConfigUpdated?.();
  };

  if (!configId) {
    return <Empty description="请选择一个配置" />;
  }

  return (
    <div style={{ padding: 16, width: '100%' }}>
      <Title level={3} style={{ marginTop: 0 }}>
        {config?.name || '配置详情'}
      </Title>
      {config?.description ? <Paragraph type="secondary">{config.description}</Paragraph> : null}

      <Tabs
        items={[
          {
            key: 'models',
            label: '模型',
            children: (
              <ModelConfig
                availableModels={availableModels}
                items={items.model}
                onAdd={addItem}
                onRemove={removeItem}
              />
            ),
          },
          {
            key: 'mcp',
            label: 'MCP 服务器',
            children: (
              <McpConfig
                availableServers={availableMcpServers}
                items={items.mcp_server}
                onAdd={addItem}
                onRemove={removeItem}
              />
            ),
          },
          {
            key: 'prompts',
            label: '提示词',
            children: (
              <PromptConfig
                availablePrompts={availablePrompts}
                items={items.prompt}
                onAdd={addItem}
                onRemove={removeItem}
              />
            ),
          },
          {
            key: 'subagents',
            label: '子代理',
            children: (
              <SubagentConfig
                availableSubagents={availableSubagents}
                items={items.subagent}
                onAdd={addItem}
                onRemove={removeItem}
              />
            ),
          },
          {
            key: 'settings',
            label: '设置',
            children: <ConfigSettings config={config} onUpdated={loadDetail} />,
          },
        ]}
      />

      {loading ? <div style={{ color: '#999' }}>加载中...</div> : null}
    </div>
  );
}
