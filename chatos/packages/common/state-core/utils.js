import fs from 'fs';
import os from 'os';
import path from 'path';

export function normalizeHostApp(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function resolveHostApp({ env = process.env, hostApp = '', fallbackHostApp = '' } = {}) {
  const explicit = typeof hostApp === 'string' ? hostApp.trim() : '';
  const fromEnv = typeof env?.MODEL_CLI_HOST_APP === 'string' ? env.MODEL_CLI_HOST_APP.trim() : '';
  return normalizeHostApp(explicit || fromEnv || fallbackHostApp) || normalizeHostApp(fallbackHostApp);
}

export function getHomeDir(env = process.env) {
  const home = (env && (env.HOME || env.USERPROFILE)) || os.homedir();
  return typeof home === 'string' && home.trim() ? home.trim() : '';
}

export function isDirectory(targetPath) {
  if (!targetPath) return false;
  try {
    return fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(targetPath) {
  if (!targetPath) return false;
  try {
    return fs.existsSync(targetPath) && fs.statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

export function ensureDir(dirPath) {
  if (!dirPath) return;
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

export function copyTree({ src, dest }) {
  if (!src || !dest) return;
  let stat = null;
  try {
    stat = fs.statSync(src);
  } catch {
    return;
  }

  if (stat.isDirectory()) {
    ensureDir(dest);
    let entries = [];
    try {
      entries = fs.readdirSync(src, { withFileTypes: true });
    } catch {
      entries = [];
    }
    entries.forEach((entry) => {
      const name = entry?.name;
      if (!name) return;
      copyTree({ src: path.join(src, name), dest: path.join(dest, name) });
    });
    return;
  }

  if (!stat.isFile()) return;
  if (fs.existsSync(dest)) return;
  ensureDir(path.dirname(dest));
  try {
    fs.copyFileSync(src, dest);
  } catch {
    // ignore
  }
}

