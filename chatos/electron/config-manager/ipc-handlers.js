function toMessage(err) {
  return err?.message || String(err);
}

export function registerConfigIpcHandlers(ipcMain, configManager, options = {}) {
  if (!ipcMain || !configManager) {
    throw new Error('registerConfigIpcHandlers requires ipcMain and configManager');
  }
  const getWindow = typeof options.getWindow === 'function' ? options.getWindow : null;
  const onChange = typeof options.onChange === 'function' ? options.onChange : null;

  const broadcast = (payload) => {
    if (!getWindow) return;
    const win = getWindow();
    if (!win) return;
    win.webContents.send('config:updated', payload);
  };

  const wrap = (fn, { mutate = false } = {}) => async (_event, payload = {}) => {
    try {
      const data = await fn(payload);
      if (mutate) {
        if (onChange) await onChange(data);
        broadcast({ timestamp: new Date().toISOString() });
      }
      return { ok: true, data };
    } catch (err) {
      return { ok: false, message: toMessage(err) };
    }
  };

  ipcMain.handle('configs:list', wrap(() => configManager.listConfigs()));
  ipcMain.handle('configs:get', wrap((payload) => configManager.getConfig(payload.id)));
  ipcMain.handle('configs:create', wrap((payload) => configManager.createConfig(payload), { mutate: true }));
  ipcMain.handle('configs:update', wrap((payload) => configManager.updateConfig(payload.id, payload.updates), { mutate: true }));
  ipcMain.handle('configs:delete', wrap((payload) => configManager.deleteConfig(payload.id), { mutate: true }));
  ipcMain.handle('configs:activate', wrap((payload) => configManager.activateConfig(payload.id), { mutate: true }));
  ipcMain.handle('configs:getActive', wrap(() => configManager.getActiveConfig()));

  ipcMain.handle(
    'configs:items:list',
    wrap((payload) => configManager.listConfigItems(payload.configId, payload.itemType))
  );
  ipcMain.handle(
    'configs:items:add',
    wrap(
      (payload) =>
        configManager.addConfigItem(payload.configId, payload.itemType, payload.itemId, payload.itemData, {
          enabled: payload.enabled,
          orderIndex: payload.orderIndex,
        }),
      { mutate: true }
    )
  );
  ipcMain.handle(
    'configs:items:update',
    wrap(
      (payload) =>
        configManager.updateConfigItem(payload.configId, payload.itemType, payload.itemId, {
          itemData: payload.itemData,
          enabled: payload.enabled,
          orderIndex: payload.orderIndex,
        }),
      { mutate: true }
    )
  );
  ipcMain.handle(
    'configs:items:remove',
    wrap((payload) => configManager.removeConfigItem(payload.configId, payload.itemType, payload.itemId), { mutate: true })
  );

  ipcMain.handle('configs:export', wrap((payload) => configManager.exportConfig(payload.id, payload.format)));
  ipcMain.handle('configs:import', wrap((payload) => configManager.importConfig(payload.configData), { mutate: true }));
}
