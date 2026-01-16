function ensureId(value, entity) {
  if (!value) {
    throw new Error(`[${entity}] id is required`);
  }
  return value;
}

function maskSecretValue(value) {
  const raw = typeof value === 'string' ? value : String(value || '');
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const suffix = trimmed.slice(-4);
  return `${'*'.repeat(8)}${suffix}`;
}

function sanitizeSecretRecord(record) {
  if (!record || typeof record !== 'object') return record;
  const raw = record.value;
  const hasValue = typeof raw === 'string' ? raw.trim().length > 0 : Boolean(raw);
  return {
    ...record,
    value: hasValue ? maskSecretValue(raw) : '',
    hasValue,
  };
}

export function sanitizeAdminSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  if (!Array.isArray(snapshot.secrets)) return snapshot;
  return {
    ...snapshot,
    secrets: snapshot.secrets.map((item) => sanitizeSecretRecord(item)),
  };
}

function sanitizeSecretsCrudResult(result) {
  if (Array.isArray(result)) {
    return result.map((item) => sanitizeSecretRecord(item));
  }
  if (result && typeof result === 'object') {
    return sanitizeSecretRecord(result);
  }
  return result;
}

export function registerAdminApi(ipcMain, services, getWindow, options = {}) {
  const { onChange } = options;
  const exposeSubagents = options.exposeSubagents !== false;
  const uiFlags = options.uiFlags && typeof options.uiFlags === 'object' ? { ...options.uiFlags } : {};
  const sanitizeForUi = (snapshot) => {
    const sanitized = sanitizeAdminSnapshot(snapshot);
    if (exposeSubagents) return sanitized;
    if (!sanitized || typeof sanitized !== 'object') return sanitized;
    return { ...sanitized, subagents: [] };
  };
  const broadcast = () => {
    const win = typeof getWindow === 'function' ? getWindow() : null;
    if (!win) return;
    win.webContents.send('admin:update', {
      data: sanitizeForUi(services.snapshot()),
      dbPath: services.dbPath,
      uiFlags,
    });
  };

  const wrapMutation = (fn) => async (...args) => {
    const result = await fn(...args);
    if (typeof onChange === 'function') {
      await onChange();
    }
    broadcast();
    return result;
  };

  ipcMain.handle('admin:state', async () => ({
    data: sanitizeForUi(services.snapshot()),
    dbPath: services.dbPath,
    uiFlags,
  }));

  registerCrud(ipcMain, 'models', services.models, wrapMutation);
  registerCrud(ipcMain, 'secrets', services.secrets, wrapMutation, { transform: sanitizeSecretsCrudResult });
  registerCrud(ipcMain, 'mcpServers', services.mcpServers, wrapMutation);
  if (exposeSubagents) {
    registerCrud(ipcMain, 'subagents', services.subagents, wrapMutation);
  } else {
    ipcMain.handle('admin:subagents:list', async () => []);
    ['create', 'update', 'delete'].forEach((action) => {
      ipcMain.handle(`admin:subagents:${action}`, async () => ({
        ok: false,
        message: 'Sub-agents 管理仅在开发者模式下可用。',
      }));
    });
  }
  registerCrud(ipcMain, 'prompts', services.prompts, wrapMutation);
  registerCrud(ipcMain, 'landConfigs', services.landConfigs, wrapMutation);
  ipcMain.handle(
    'admin:settings:save',
    wrapMutation(async (_event, payload = {}) => services.settings.saveRuntime(payload))
  );

  ipcMain.handle(
    'admin:models:setDefault',
    wrapMutation(async (_event, payload = {}) => services.models.setDefault(ensureId(payload.id, 'models')))
  );
}

function registerCrud(ipcMain, entity, service, wrapMutation, options = {}) {
  const base = `admin:${entity}`;
  const transform = typeof options?.transform === 'function' ? options.transform : (result) => result;
  ipcMain.handle(`${base}:list`, async () => transform(service.list()));
  ipcMain.handle(
    `${base}:create`,
    wrapMutation(async (_event, payload = {}) => transform(service.create(payload)))
  );
  ipcMain.handle(
    `${base}:update`,
    wrapMutation(async (_event, payload = {}) =>
      transform(service.update(ensureId(payload.id, entity), payload.data || {}))
    )
  );
  ipcMain.handle(
    `${base}:delete`,
    wrapMutation(async (_event, payload = {}) => transform(service.remove(ensureId(payload.id, entity))))
  );
}
