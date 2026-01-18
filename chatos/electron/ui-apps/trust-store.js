import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const TRUST_FILE_NAME = 'trust.json';
const FINGERPRINT_VERSION = 1;
const IGNORED_DIRS = new Set(['node_modules', '.git']);
const IGNORED_FILES = new Set(['.DS_Store']);

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

function shouldIgnoreEntry(entry) {
  const name = typeof entry?.name === 'string' ? entry.name : '';
  if (!name) return true;
  if (entry.isDirectory() && IGNORED_DIRS.has(name)) return true;
  if (entry.isFile() && (IGNORED_FILES.has(name) || name.endsWith('.map'))) return true;
  return false;
}

function computePluginFingerprint(pluginDir) {
  const root = typeof pluginDir === 'string' ? pluginDir.trim() : '';
  if (!root) return '';
  let stat;
  try {
    stat = fs.statSync(root);
  } catch {
    return '';
  }
  if (!stat.isDirectory()) return '';

  const hash = crypto.createHash('sha256');

  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    entries.forEach((entry) => {
      if (!entry) return;
      if (entry.isSymbolicLink && entry.isSymbolicLink()) return;
      if (shouldIgnoreEntry(entry)) return;
      const fullPath = path.join(dir, entry.name);
      const relative = path.relative(root, fullPath).replace(/\\/g, '/');
      if (!relative) return;
      if (entry.isDirectory()) {
        hash.update(`dir:${relative}\n`);
        walk(fullPath);
        return;
      }
      if (entry.isFile()) {
        let fileStat;
        try {
          fileStat = fs.statSync(fullPath);
        } catch {
          return;
        }
        hash.update(`file:${relative}:${fileStat.size}:${fileStat.mtimeMs}\n`);
      }
    });
  };

  walk(root);
  return `${FINGERPRINT_VERSION}:${hash.digest('hex')}`;
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

export function setUiAppsPluginTrust({ pluginId, stateDir, trusted, pluginDir }) {
  const id = typeof pluginId === 'string' ? pluginId.trim() : '';
  if (!id) return null;
  const store = loadUiAppsTrustStore(stateDir);
  if (!store.plugins || typeof store.plugins !== 'object') {
    store.plugins = {};
  }
  const fingerprint = trusted && pluginDir ? computePluginFingerprint(pluginDir) : '';
  store.plugins[id] = {
    trusted: Boolean(trusted),
    fingerprint: fingerprint || undefined,
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
    store.plugins[id] = { trusted: false, fingerprint: undefined, updatedAt: new Date().toISOString() };
    saveUiAppsTrustStore(stateDir, store);
  }
  return store;
}

export function isUiAppsPluginTrusted({ pluginId, source, stateDir, pluginDir, env = process.env } = {}) {
  const id = typeof pluginId === 'string' ? pluginId.trim() : '';
  if (!id) return false;
  if (source === 'builtin') return true;
  const trustAll = resolveBoolEnv(env?.MODEL_CLI_UIAPPS_TRUST_ALL, false);
  if (trustAll) return true;
  const store = loadUiAppsTrustStore(stateDir);
  const record = store?.plugins && store.plugins[id] ? store.plugins[id] : null;
  if (record?.trusted !== true) return false;
  const expected = typeof record?.fingerprint === 'string' ? record.fingerprint.trim() : '';
  if (!expected) return true;
  const current = pluginDir ? computePluginFingerprint(pluginDir) : '';
  if (!current) return false;
  return current === expected;
}
