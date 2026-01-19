const { contextBridge, ipcRenderer } = require('electron');

const INVOKE_CHANNELS = new Set([
  'admin:landConfigs:create',
  'admin:landConfigs:delete',
  'admin:landConfigs:list',
  'admin:landConfigs:update',
  'admin:mcpServers:create',
  'admin:mcpServers:delete',
  'admin:mcpServers:update',
  'admin:models:create',
  'admin:models:delete',
  'admin:models:list',
  'admin:models:setDefault',
  'admin:models:update',
  'admin:prompts:create',
  'admin:prompts:delete',
  'admin:prompts:update',
  'admin:secrets:create',
  'admin:secrets:delete',
  'admin:secrets:list',
  'admin:secrets:update',
  'admin:settings:save',
  'admin:state',
  'admin:subagents:create',
  'admin:subagents:delete',
  'admin:subagents:get',
  'admin:subagents:list',
  'admin:subagents:update',
  'chat:abort',
  'chat:agents:create',
  'chat:agents:delete',
  'chat:agents:ensureDefault',
  'chat:agents:list',
  'chat:agents:update',
  'chat:messages:list',
  'chat:send',
  'chat:sessions:create',
  'chat:sessions:delete',
  'chat:sessions:ensureDefault',
  'chat:sessions:list',
  'chat:sessions:update',
  'cli:install',
  'cli:status',
  'cli:uninstall',
  'config:read',
  'configs:activate',
  'configs:cancelApply',
  'configs:create',
  'configs:currentStatus',
  'configs:delete',
  'configs:export',
  'configs:get',
  'configs:getActive',
  'configs:import',
  'configs:items:add',
  'configs:items:list',
  'configs:items:remove',
  'configs:list',
  'configs:quickSwitch',
  'configs:update',
  'dialog:selectDirectory',
  'dir:list',
  'events:read',
  'file:read',
  'fileChanges:read',
  'lsp:catalog',
  'lsp:install',
  'runs:read',
  'runtimeLog:read',
  'session:clearCache',
  'session:read',
  'sessions:kill',
  'sessions:killAll',
  'sessions:list',
  'sessions:readLog',
  'sessions:restart',
  'sessions:stop',
  'subagents:marketplace:addSource',
  'subagents:marketplace:list',
  'subagents:plugins:install',
  'subagents:plugins:uninstall',
  'subagents:setModel',
  'terminal:action',
  'terminal:close',
  'terminal:dispatch',
  'terminal:intervene',
  'terminal:stop',
  'terminalStatus:list',
  'uiApps:ai:get',
  'uiApps:invoke',
  'uiApps:list',
  'uiApps:plugins:install',
  'uiApps:plugins:trust',
  'uiPrompts:read',
  'uiPrompts:request',
  'uiPrompts:respond',
]);

const EVENT_CHANNELS = new Set([
  'admin:update',
  'chat:event',
  'config:switched',
  'config:update',
  'config:updated',
  'events:update',
  'fileChanges:update',
  'runs:update',
  'session:update',
  'terminalStatus:update',
  'uiPrompts:update',
]);

const isMainFrame = () => {
  if (typeof process?.isMainFrame === 'boolean') return process.isMainFrame;
  try {
    return window.top === window;
  } catch {
    return false;
  }
};

const ensureInvokeAllowed = (channel) => {
  if (!INVOKE_CHANNELS.has(channel)) {
    throw new Error(`IPC channel not allowed: ${channel}`);
  }
};

const ensureEventAllowed = (channel) => {
  if (!EVENT_CHANNELS.has(channel)) {
    throw new Error(`IPC event not allowed: ${channel}`);
  }
};

if (isMainFrame()) {
  contextBridge.exposeInMainWorld('api', {
    invoke: (channel, args) => {
      const name = typeof channel === 'string' ? channel.trim() : '';
      ensureInvokeAllowed(name);
      return ipcRenderer.invoke(name, args);
    },
    on: (channel, listener) => {
      const name = typeof channel === 'string' ? channel.trim() : '';
      ensureEventAllowed(name);
      if (typeof listener !== 'function') {
        throw new Error('listener must be a function');
      }
      const subscription = (_event, data) => {
        if (listener.length >= 2) {
          return listener(_event, data);
        }
        return listener(data);
      };
      ipcRenderer.on(name, subscription);
      return () => ipcRenderer.removeListener(name, subscription);
    },
  });
}
