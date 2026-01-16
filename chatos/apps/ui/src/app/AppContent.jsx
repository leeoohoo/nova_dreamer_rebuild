import React from 'react';

import {
  LspServersManager,
  McpServersManager,
  ModelsManager,
  PromptsManager,
  SecretsManager,
  SubagentsManager,
} from '../features/admin/AdminManagers.jsx';
import { ChatView } from '../features/chat/ChatView.jsx';
import { ChatAgentsView } from '../features/chat/ChatAgentsView.jsx';
import { AppsHubView } from '../features/apps/AppsHubView.jsx';
import { AppsPluginView } from '../features/apps/AppsPluginView.jsx';
import { ConfigManagerPage } from '../features/configs/ConfigManagerPage.jsx';
import { LandConfigsManager } from '../features/land-configs/LandConfigsManager.jsx';

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

  if (currentMenu.startsWith('admin')) {
    if (currentMenu === 'admin/models' || currentMenu === 'admin/settings') {
      return (
        <ModelsManager
          data={admin?.models}
          onCreate={modelActions?.create}
          onUpdate={modelActions?.update}
          onDelete={modelActions?.delete}
          onSetDefault={modelActions?.setDefault}
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
    if (currentMenu === 'admin/lsp') {
      return <LspServersManager />;
    }
    if (currentMenu === 'admin/configs') {
      return <ConfigManagerPage admin={admin} />;
    }
    if (currentMenu === 'admin/land_configs') {
      return <LandConfigsManager admin={admin} />;
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
