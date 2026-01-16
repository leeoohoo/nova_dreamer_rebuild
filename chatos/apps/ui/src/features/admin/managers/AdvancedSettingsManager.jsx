import React, { useEffect, useMemo, useState } from 'react';
import { Tabs } from 'antd';

import { LspServersManager } from './LspServersManager.jsx';
import { McpServersManager } from './McpServersManager.jsx';
import { PromptsManager } from './PromptsManager.jsx';
import { SubagentsManager } from './SubagentsManager.jsx';
import { LandConfigsManager } from '../../land-configs/LandConfigsManager.jsx';

const TAB_KEYS = ['land_configs', 'mcp', 'prompts', 'subagents', 'lsp'];

const normalizeTab = (value) => (TAB_KEYS.includes(value) ? value : 'mcp');

function AdvancedSettingsManager({
  activeTab,
  admin,
  loading,
  mcpActions,
  promptActions,
  subagentActions,
  onSetSubagentModel,
  developerMode = false,
}) {
  const [currentTab, setCurrentTab] = useState(() => normalizeTab(activeTab));

  useEffect(() => {
    setCurrentTab(normalizeTab(activeTab));
  }, [activeTab]);

  const tabs = useMemo(
    () => [
      {
        key: 'land_configs',
        label: 'Land 配置',
        children: <LandConfigsManager admin={admin} />,
      },
      {
        key: 'mcp',
        label: 'MCP Servers',
        children: (
          <McpServersManager
            data={admin?.mcpServers}
            prompts={admin?.prompts}
            onCreate={mcpActions?.create}
            onUpdate={mcpActions?.update}
            onDelete={mcpActions?.delete}
            promptActions={promptActions}
            loading={loading}
            developerMode={developerMode}
          />
        ),
      },
      {
        key: 'prompts',
        label: 'Prompts',
        children: (
          <PromptsManager
            data={admin?.prompts}
            mcpServers={admin?.mcpServers}
            onCreate={promptActions?.create}
            onUpdate={promptActions?.update}
            onDelete={promptActions?.delete}
            loading={loading}
            developerMode={developerMode}
          />
        ),
      },
      {
        key: 'subagents',
        label: 'Subagents',
        children: (
          <SubagentsManager
            data={admin?.subagents}
            models={admin?.models}
            onUpdateStatus={subagentActions?.updateStatus}
            onListMarketplace={subagentActions?.listMarketplace}
            onAddMarketplaceSource={subagentActions?.addMarketplaceSource}
            onInstallPlugin={subagentActions?.installPlugin}
            onUninstallPlugin={subagentActions?.uninstallPlugin}
            onSetModel={onSetSubagentModel}
            loading={loading}
            developerMode={developerMode}
          />
        ),
      },
      {
        key: 'lsp',
        label: '语言服务 (LSP)',
        children: <LspServersManager />,
      },
    ],
    [
      admin?.mcpServers,
      admin?.models,
      admin?.prompts,
      admin?.subagents,
      developerMode,
      loading,
      mcpActions,
      onSetSubagentModel,
      promptActions,
      subagentActions,
    ]
  );

  return <Tabs activeKey={currentTab} items={tabs} onChange={setCurrentTab} />;
}

export { AdvancedSettingsManager };
