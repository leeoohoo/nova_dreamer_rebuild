function toMessage(err) {
  return err?.message || String(err);
}

export function registerQuickSwitchHandlers(ipcMain, configApplier) {
  if (!ipcMain || !configApplier) {
    throw new Error('registerQuickSwitchHandlers requires ipcMain and configApplier');
  }

  ipcMain.handle('configs:quickSwitch', async (event, payload = {}) => {
    const configId = payload?.configId;
    try {
      const result = await configApplier.applyConfig(configId);
      event.sender.send('config:switched', {
        configId,
        success: true,
        timestamp: new Date().toISOString(),
      });
      return result;
    } catch (err) {
      event.sender.send('config:switched', {
        configId,
        success: false,
        error: toMessage(err),
        timestamp: new Date().toISOString(),
      });
      return { ok: false, error: toMessage(err) };
    }
  });

  ipcMain.handle('configs:currentStatus', async () => ({
    currentConfigId: configApplier.currentConfigId,
    isApplying: configApplier.isApplying,
    lastApplied: configApplier.lastApplied,
  }));

  ipcMain.handle('configs:cancelApply', async () => configApplier.cancelApply());
}
