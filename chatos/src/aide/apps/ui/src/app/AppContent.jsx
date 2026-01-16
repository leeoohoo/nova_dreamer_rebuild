import React from 'react';

import {
  AdvancedSettingsManager,
  ModelsManager,
  SecretsManager,
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
  const advancedTabMap = {
    'admin/mcp': 'mcp',
    'admin/subagents': 'subagents',
    'admin/prompts': 'prompts',
    'admin/settings': 'settings',
  };

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
    if (currentMenu === 'admin/advanced') {
      return (
        <AdvancedSettingsManager
          admin={admin}
          loading={loading}
          mcpActions={mcpActions}
          promptActions={promptActions}
          subagentActions={subagentActions}
          onSetSubagentModel={onSetSubagentModel}
          onSaveSettings={onSaveSettings}
          developerMode={developerMode}
        />
      );
    }
    if (advancedTabMap[currentMenu]) {
      return (
        <AdvancedSettingsManager
          activeTab={advancedTabMap[currentMenu]}
          admin={admin}
          loading={loading}
          mcpActions={mcpActions}
          promptActions={promptActions}
          subagentActions={subagentActions}
          onSetSubagentModel={onSetSubagentModel}
          onSaveSettings={onSaveSettings}
          developerMode={developerMode}
        />
      );
    }
  }

  return (
    <div style={{ flex: 1, minHeight: 0 }}>
      <AppsPluginView pluginId={BUILTIN_CLI_PLUGIN_ID} appId={BUILTIN_CLI_APP_ID} onNavigate={navigate} />
    </div>
  );
}
