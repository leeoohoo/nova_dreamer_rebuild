import React from 'react';

import {
  AdvancedSettingsManager,
  ModelsManager,
  SecretsManager,
} from '../features/admin/AdminManagers.jsx';
import { ChatView } from '../features/chat/ChatView.jsx';
import { ChatAgentsView } from '../features/chat/ChatAgentsView.jsx';
import { ChatRoomsView } from '../features/chat/ChatRoomsView.jsx';
import { AppsHubView } from '../features/apps/AppsHubView.jsx';
import { AppsPluginView } from '../features/apps/AppsPluginView.jsx';

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
  developerMode = false,
  onNavigate,
}) {
  const rawMenu = typeof menu === 'string' ? menu : 'chat/session';
  const normalizedMenu = rawMenu === 'chat' ? 'chat/session' : rawMenu === 'apps' ? 'apps/home' : rawMenu;
  const legacyCliMenu =
    normalizedMenu === 'cli' ||
    normalizedMenu === 'session' ||
    normalizedMenu === 'workspace' ||
    normalizedMenu === 'events' ||
    normalizedMenu.startsWith('cli/');
  const currentMenu = legacyCliMenu ? 'chat/session' : normalizedMenu;
  const navigate = typeof onNavigate === 'function' ? onNavigate : () => {};
  const advancedTabMap = {
    'admin/land_configs': 'land_configs',
    'admin/mcp': 'mcp',
    'admin/prompts': 'prompts',
    'admin/subagents': 'subagents',
    'admin/lsp': 'lsp',
  };

  if (currentMenu.startsWith('admin')) {
    if (currentMenu === 'admin/models' || currentMenu === 'admin/settings') {
      return (
        <div className="ds-admin-page">
          <ModelsManager
            data={admin?.models}
            onCreate={modelActions?.create}
            onUpdate={modelActions?.update}
            onDelete={modelActions?.delete}
            onSetDefault={modelActions?.setDefault}
            loading={loading}
            developerMode={developerMode}
          />
        </div>
      );
    }
    if (currentMenu === 'admin/secrets') {
      return (
        <div className="ds-admin-page">
          <SecretsManager
            data={admin?.secrets}
            onCreate={secretsActions?.create}
            onUpdate={secretsActions?.update}
            onDelete={secretsActions?.delete}
            loading={loading}
          />
        </div>
      );
    }
    if (currentMenu === 'admin/advanced') {
      return (
        <div className="ds-admin-page">
          <AdvancedSettingsManager
            admin={admin}
            loading={loading}
            mcpActions={mcpActions}
            promptActions={promptActions}
            subagentActions={subagentActions}
            onSetSubagentModel={onSetSubagentModel}
            developerMode={developerMode}
          />
        </div>
      );
    }
    if (advancedTabMap[currentMenu]) {
      return (
        <div className="ds-admin-page">
          <AdvancedSettingsManager
            activeTab={advancedTabMap[currentMenu]}
            admin={admin}
            loading={loading}
            mcpActions={mcpActions}
            promptActions={promptActions}
            subagentActions={subagentActions}
            onSetSubagentModel={onSetSubagentModel}
            developerMode={developerMode}
          />
        </div>
      );
    }
  }

  if (currentMenu === 'chat/session') {
    return (
      <div style={{ flex: 1, minHeight: 0 }}>
        <ChatView admin={admin} onNavigate={navigate} />
      </div>
    );
  }

  if (currentMenu === 'chat/agents') {
    return (
      <div style={{ flex: 1, minHeight: 0 }}>
        <ChatAgentsView admin={admin} />
      </div>
    );
  }

  if (currentMenu === 'chat/rooms') {
    return (
      <div style={{ flex: 1, minHeight: 0 }}>
        <ChatRoomsView admin={admin} />
      </div>
    );
  }

  if (currentMenu === 'apps/home' || currentMenu === 'apps') {
    return (
      <div style={{ flex: 1, minHeight: 0 }}>
        <AppsHubView onNavigate={navigate} />
      </div>
    );
  }

  if (currentMenu.startsWith('apps/plugin/')) {
    const parts = currentMenu.split('/');
    const encodedPluginId = parts[2] || '';
    const encodedAppId = parts[3] || '';
    let pluginId = '';
    let appId = '';
    try {
      pluginId = decodeURIComponent(encodedPluginId);
    } catch {
      pluginId = encodedPluginId;
    }
    try {
      appId = decodeURIComponent(encodedAppId);
    } catch {
      appId = encodedAppId;
    }
    return (
      <div style={{ flex: 1, minHeight: 0 }}>
        <AppsPluginView pluginId={pluginId} appId={appId} onNavigate={navigate} />
      </div>
    );
  }
  return null;
}
