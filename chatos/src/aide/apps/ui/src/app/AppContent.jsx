import React from 'react';

import {
  McpServersManager,
  ModelsManager,
  SecretsManager,
  PromptsManager,
  SettingsManager,
  SubagentsManager,
} from '../features/admin/AdminManagers.jsx';
import { AppsPluginView } from '../features/apps/AppsPluginView.jsx';

const BUILTIN_CLI_PLUGIN_ID = 'com.leeoohoo.aideui.builtin';
const BUILTIN_CLI_APP_ID = 'cli';

export function AppContent({
  menu,
  admin,
  loading,
  modelActions,
  secretsActions,
  mcpActions,
  subagentActions,
  onSetSubagentModel,
  promptActions,
  onSaveSettings,
  developerMode = false,
  onNavigate,
}) {
  const rawMenu = typeof menu === 'string' ? menu : 'cli';
  const normalizedMenu = rawMenu === 'chat' || rawMenu === 'apps' ? 'cli' : rawMenu;
  const currentMenu = normalizedMenu;
  const navigate = typeof onNavigate === 'function' ? onNavigate : () => {};

  if (normalizedMenu.startsWith('admin')) {
    if (currentMenu === 'admin/models') {
      return (
        <ModelsManager
          data={admin?.models}
          onCreate={modelActions?.create}
          onUpdate={modelActions?.update}
          onDelete={modelActions?.delete}
          onSetDefault={modelActions?.setDefault}
          onSetSubagentModel={onSetSubagentModel}
          loading={loading}
          developerMode={developerMode}
        />
      );
    }
    if (currentMenu === 'admin/secrets') {
      return (
        <SecretsManager
          data={admin?.secrets}
          onCreate={secretsActions?.create}
          onUpdate={secretsActions?.update}
          onDelete={secretsActions?.delete}
          loading={loading}
        />
      );
    }
    if (currentMenu === 'admin/mcp') {
      return (
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
      );
    }
    if (currentMenu === 'admin/subagents') {
      return (
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
      );
    }
    if (currentMenu === 'admin/prompts') {
      return (
        <PromptsManager
          data={admin?.prompts}
          mcpServers={admin?.mcpServers}
          onCreate={promptActions?.create}
          onUpdate={promptActions?.update}
          onDelete={promptActions?.delete}
          loading={loading}
          developerMode={developerMode}
        />
      );
    }
    if (currentMenu === 'admin/settings') {
      return <SettingsManager data={admin?.settings} onSave={onSaveSettings} loading={loading} />;
    }
  }

  return (
    <div style={{ flex: 1, minHeight: 0 }}>
      <AppsPluginView pluginId={BUILTIN_CLI_PLUGIN_ID} appId={BUILTIN_CLI_APP_ID} onNavigate={navigate} />
    </div>
  );
}
