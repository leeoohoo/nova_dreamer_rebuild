import fs from 'fs';
import path from 'path';

const TRUST_FILE_NAME = 'trust.json';

function resolveBoolEnv(value, fallback = false) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(raw)) return false;
  return fallback;
}

export function resolveUiAppsTrustPath(stateDir) {
  const base = typeof stateDir === 'string' ? stateDir.trim() : '';
  if (!base) return '';
  return path.join(base, 'ui_apps', TRUST_FILE_NAME);
}

export function loadUiAppsTrustStore(stateDir) {
  const filePath = resolveUiAppsTrustPath(stateDir);
  if (!filePath) return { version: 1, plugins: {} };
  try {
    if (!fs.existsSync(filePath)) return { version: 1, plugins: {} };
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const plugins = parsed?.plugins && typeof parsed.plugins === 'object' ? parsed.plugins : {};
    return { version: 1, plugins };
  } catch {
    return { version: 1, plugins: {} };
  }
}

export function saveUiAppsTrustStore(stateDir, store) {
  const filePath = resolveUiAppsTrustPath(stateDir);
  if (!filePath) return false;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const payload = JSON.stringify(store || { version: 1, plugins: {} }, null, 2);
    fs.writeFileSync(filePath, payload, 'utf8');
    return true;
  } catch {
    return false;
  }
}

export function setUiAppsPluginTrust({ pluginId, stateDir, trusted }) {
  const id = typeof pluginId === 'string' ? pluginId.trim() : '';
  if (!id) return null;
  const store = loadUiAppsTrustStore(stateDir);
  if (!store.plugins || typeof store.plugins !== 'object') {
    store.plugins = {};
  }
  store.plugins[id] = {
    trusted: Boolean(trusted),
    updatedAt: new Date().toISOString(),
  };
  saveUiAppsTrustStore(stateDir, store);
  return store;
}

export function ensureUiAppsPluginTrustRecord({ pluginId, stateDir }) {
  const id = typeof pluginId === 'string' ? pluginId.trim() : '';
  if (!id) return null;
  const store = loadUiAppsTrustStore(stateDir);
  if (!store.plugins || typeof store.plugins !== 'object') {
    store.plugins = {};
  }
  if (!store.plugins[id]) {
    store.plugins[id] = { trusted: false, updatedAt: new Date().toISOString() };
    saveUiAppsTrustStore(stateDir, store);
  }
  return store;
}

export function isUiAppsPluginTrusted({ pluginId, source, stateDir, env = process.env } = {}) {
  const id = typeof pluginId === 'string' ? pluginId.trim() : '';
  if (!id) return false;
  if (source === 'builtin') return true;
  const trustAll = resolveBoolEnv(env?.MODEL_CLI_UIAPPS_TRUST_ALL, false);
  if (trustAll) return true;
  const store = loadUiAppsTrustStore(stateDir);
  const record = store?.plugins && store.plugins[id] ? store.plugins[id] : null;
  return record?.trusted === true;
}

