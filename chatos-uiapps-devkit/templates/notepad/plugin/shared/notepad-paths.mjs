import fs from 'fs';
import os from 'os';
import path from 'path';

const STATE_ROOT_DIRNAME = '.deepseek_cli';
const COMPAT_STATE_ROOT_DIRNAME = '.chatos';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveHostApp(env) {
  const hostApp = normalizeString(env?.MODEL_CLI_HOST_APP);
  return hostApp || 'chatos';
}

function resolveHomeDir(env) {
  const homeEnv = normalizeString(env?.HOME) || normalizeString(env?.USERPROFILE);
  if (homeEnv) return homeEnv;
  try {
    return os.homedir();
  } catch {
    return '';
  }
}

function resolveSessionRoot(env) {
  return normalizeString(env?.MODEL_CLI_SESSION_ROOT);
}

function tryEnsureWritableDir(dirPath) {
  const target = normalizeString(dirPath);
  if (!target) return false;
  try {
    fs.mkdirSync(target, { recursive: true });
  } catch {
    return false;
  }
  try {
    fs.accessSync(target, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function pushDataDir(list, baseDir, rootDirName, hostApp, pluginId) {
  const base = normalizeString(baseDir);
  if (!base) return;
  list.push(path.join(base, rootDirName, hostApp, 'ui_apps', 'data', pluginId));
}

export function resolveUiAppDataDir({ pluginId, env } = {}) {
  const id = normalizeString(pluginId);
  if (!id) throw new Error('pluginId is required');
  const resolvedEnv = env && typeof env === 'object' ? env : process.env;
  const hostApp = resolveHostApp(resolvedEnv);
  const home = resolveHomeDir(resolvedEnv);
  const sessionRoot = resolveSessionRoot(resolvedEnv);

  const candidates = [];
  if (home) {
    pushDataDir(candidates, home, STATE_ROOT_DIRNAME, hostApp, id);
    pushDataDir(candidates, home, COMPAT_STATE_ROOT_DIRNAME, hostApp, id);
  }
  if (sessionRoot) {
    const root = path.resolve(sessionRoot);
    pushDataDir(candidates, root, STATE_ROOT_DIRNAME, hostApp, id);
    pushDataDir(candidates, root, COMPAT_STATE_ROOT_DIRNAME, hostApp, id);
  }
  const cwd = path.resolve(process.cwd());
  pushDataDir(candidates, cwd, STATE_ROOT_DIRNAME, hostApp, id);
  pushDataDir(candidates, cwd, COMPAT_STATE_ROOT_DIRNAME, hostApp, id);

  for (const candidate of candidates) {
    if (tryEnsureWritableDir(candidate)) return candidate;
  }
  return candidates[0];
}

