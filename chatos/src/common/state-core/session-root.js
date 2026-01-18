import fs from 'fs';
import path from 'path';
import { COMPAT_STATE_ROOT_DIRNAME, STATE_ROOT_DIRNAME } from './state-paths.js';
import { ensureDir, getHomeDir, resolveHostApp } from './utils.js';

function getMarkerPath(homeDir, hostApp, baseDir = STATE_ROOT_DIRNAME) {
  const home = typeof homeDir === 'string' ? homeDir.trim() : '';
  const host = typeof hostApp === 'string' ? hostApp.trim() : '';
  if (!home || !host) return '';
  return path.join(home, baseDir, host, 'last-session-root.txt');
}

function getLegacyMarkerPath(homeDir, baseDir = STATE_ROOT_DIRNAME) {
  const home = typeof homeDir === 'string' ? homeDir.trim() : '';
  if (!home) return '';
  return path.join(home, baseDir, 'last-session-root.txt');
}

export function resolveSessionRoot(options = {}) {
  const env = options?.env && typeof options.env === 'object' ? options.env : process.env;
  const explicit = typeof env.MODEL_CLI_SESSION_ROOT === 'string' ? env.MODEL_CLI_SESSION_ROOT.trim() : '';
  if (explicit) {
    return path.resolve(explicit);
  }

  const home = getHomeDir(env);
  const hostApp = resolveHostApp({ env, hostApp: options.hostApp, fallbackHostApp: options.fallbackHostApp });
  const markerPath = getMarkerPath(home, hostApp);
  const compatMarkerPath = getMarkerPath(home, hostApp, COMPAT_STATE_ROOT_DIRNAME);
  const legacyMarkerPath = getLegacyMarkerPath(home);
  const legacyCompatMarkerPath = getLegacyMarkerPath(home, COMPAT_STATE_ROOT_DIRNAME);

  const readMarker = (filePath) => {
    if (!filePath) return '';
    try {
      if (!fs.existsSync(filePath)) return '';
      return fs.readFileSync(filePath, 'utf8').trim();
    } catch {
      return '';
    }
  };

  const raw =
    readMarker(markerPath) ||
    readMarker(compatMarkerPath) ||
    readMarker(legacyMarkerPath) ||
    readMarker(legacyCompatMarkerPath);
  if (raw) {
    const resolved = path.resolve(raw);
    let valid = true;
    try {
      if (fs.existsSync(resolved)) {
        valid = fs.statSync(resolved).isDirectory();
      }
    } catch {
      valid = false;
    }
    if (valid) {
      try {
        if (markerPath && !fs.existsSync(markerPath)) {
          ensureDir(path.dirname(markerPath));
          fs.writeFileSync(markerPath, raw, 'utf8');
        }
      } catch {
        // ignore migration errors
      }
      return resolved;
    }
  }

  if (home) return path.resolve(home);
  return process.cwd();
}

export function persistSessionRoot(sessionRoot, options = {}) {
  const root = typeof sessionRoot === 'string' ? sessionRoot.trim() : '';
  if (!root) return;
  const env = options?.env && typeof options.env === 'object' ? options.env : process.env;
  const home = getHomeDir(env);
  const hostApp = resolveHostApp({ env, hostApp: options.hostApp, fallbackHostApp: options.fallbackHostApp });
  const markerPath = getMarkerPath(home, hostApp);
  if (!markerPath) return;
  try {
    ensureDir(path.dirname(markerPath));
    fs.writeFileSync(markerPath, root, 'utf8');
  } catch {
    // ignore marker write errors
  }
}

