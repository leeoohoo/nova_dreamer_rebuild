export function createAdminActions({ api, hasApi }) {
  const callAdmin = (channel, payload) => {
    if (!hasApi) throw new Error('IPC bridge not available');
    return api.invoke(channel, payload);
  };

  const modelActions = {
    create: (values) => callAdmin('admin:models:create', values),
    update: (id, data) => callAdmin('admin:models:update', { id, data }),
    delete: (id) => callAdmin('admin:models:delete', { id }),
    setDefault: (id) => callAdmin('admin:models:setDefault', { id }),
  };

  const secretsActions = {
    create: (values) => callAdmin('admin:secrets:create', values),
    update: (id, data) => callAdmin('admin:secrets:update', { id, data }),
    delete: (id) => callAdmin('admin:secrets:delete', { id }),
  };

  const mcpActions = {
    create: (values) => callAdmin('admin:mcpServers:create', values),
    update: (id, data) => callAdmin('admin:mcpServers:update', { id, data }),
    delete: (id) => callAdmin('admin:mcpServers:delete', { id }),
  };

  const subagentActions = {
    updateStatus: (id, data) => callAdmin('admin:subagents:update', { id, data }),
    listMarketplace: () => callAdmin('subagents:marketplace:list'),
    addMarketplaceSource: (source) => callAdmin('subagents:marketplace:addSource', { source }),
    installPlugin: (pluginId) => callAdmin('subagents:plugins:install', { pluginId }),
    uninstallPlugin: (pluginId) => callAdmin('subagents:plugins:uninstall', { pluginId }),
  };

  const setSubagentModel = (payload) => api.invoke('subagents:setModel', payload);

  const promptActions = {
    create: (values) => callAdmin('admin:prompts:create', values),
    update: (id, data) => callAdmin('admin:prompts:update', { id, data }),
    delete: (id) => callAdmin('admin:prompts:delete', { id }),
  };

  const saveSettings = (values) => callAdmin('admin:settings:save', values);

  return {
    modelActions,
    secretsActions,
    mcpActions,
    subagentActions,
    setSubagentModel,
    promptActions,
    saveSettings,
  };
}
