import {
  ensureAppStateDir as ensureAppStateDirCore,
  ensureAppDbPath as ensureAppDbPathCore,
  maybeMigrateLegacyDbFiles as maybeMigrateLegacyDbFilesCore,
  maybeMigrateLegacyStateDir as maybeMigrateLegacyStateDirCore,
  resolveAppDbFileName as resolveAppDbFileNameCore,
  resolveAppDbJsonFileName as resolveAppDbJsonFileNameCore,
  resolveAppStateDir as resolveAppStateDirCore,
  resolveLegacyStateDir as resolveLegacyStateDirCore,
} from '../../common/state-core/state-paths.js';

export function resolveLegacyStateDir(sessionRoot) {
  return resolveLegacyStateDirCore(sessionRoot);
}

export function resolveAppStateDir(sessionRoot, options = {}) {
  return resolveAppStateDirCore(sessionRoot, { ...options, fallbackHostApp: 'chatos' });
}

export function maybeMigrateLegacyStateDir(sessionRoot, options = {}) {
  return maybeMigrateLegacyStateDirCore(sessionRoot, { ...options, fallbackHostApp: 'chatos' });
}

export function ensureAppStateDir(sessionRoot, options = {}) {
  return ensureAppStateDirCore(sessionRoot, { ...options, fallbackHostApp: 'chatos' });
}

export function resolveAppDbFileName(hostApp) {
  return resolveAppDbFileNameCore(hostApp);
}

export function resolveAppDbJsonFileName(hostApp) {
  return resolveAppDbJsonFileNameCore(hostApp);
}

export function maybeMigrateLegacyDbFiles(stateDir, options = {}) {
  return maybeMigrateLegacyDbFilesCore(stateDir, { ...options, fallbackHostApp: 'chatos' });
}

export function ensureAppDbPath(sessionRoot, options = {}) {
  return ensureAppDbPathCore(sessionRoot, { ...options, fallbackHostApp: 'chatos' });
}
