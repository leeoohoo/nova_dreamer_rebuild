import React, { useEffect, useMemo, useState } from 'react';
import { Tabs } from 'antd';

import { McpServersManager } from './McpServersManager.jsx';
import { PromptsManager } from './PromptsManager.jsx';
import { SettingsManager } from './SettingsManager.jsx';
import { SubagentsManager } from './SubagentsManager.jsx';

const TAB_KEYS = ['settings', 'mcp', 'subagents', 'prompts'];

const normalizeTab = (value) => (TAB_KEYS.includes(value) ? value : 'settings');

function AdvancedSettingsManager({
  activeTab,
  admin,
  loading,
  mcpActions,
  promptActions,
  subagentActions,
  onSetSubagentModel,
  onSaveSettings,
  developerMode = false,
}) {
  const [currentTab, setCurrentTab] = useState(() => normalizeTab(activeTab));

  useEffect(() => {
    setCurrentTab(normalizeTab(activeTab));
  }, [activeTab]);

  const tabs = useMemo(
    () => [
      {
        key: 'settings',
        label: '运行配置',
        children: <SettingsManager data={admin?.settings} onSave={onSaveSettings} loading={loading} />,
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
        key: 'subagents',
        label: 'Sub-agents',
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
        key: 'prompts',
        label: 'Prompts',
        children: (
          <PromptsManager
            data={admin?.prompts}
            onCreate={promptActions?.create}
            onUpdate={promptActions?.update}
            onDelete={promptActions?.delete}
            loading={loading}
            developerMode={developerMode}
          />
        ),
      },
    ],
    [
      admin?.models,
      admin?.mcpServers,
      admin?.prompts,
      admin?.settings,
      admin?.subagents,
      developerMode,
      loading,
      mcpActions,
      onSaveSettings,
      onSetSubagentModel,
      promptActions,
      subagentActions,
    ]
  );

  return <Tabs activeKey={currentTab} items={tabs} onChange={setCurrentTab} />;
}

export { AdvancedSettingsManager };
