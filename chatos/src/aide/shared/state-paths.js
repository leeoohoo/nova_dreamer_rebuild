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

export function resolveAppStateDir(sessionRoot) {
  return resolveAppStateDirCore(sessionRoot, { fallbackHostApp: 'aide' });
}

export function maybeMigrateLegacyStateDir(sessionRoot) {
  return maybeMigrateLegacyStateDirCore(sessionRoot, { fallbackHostApp: 'aide' });
}

export function ensureAppStateDir(sessionRoot) {
  return ensureAppStateDirCore(sessionRoot, { fallbackHostApp: 'aide' });
}

export function resolveAppDbFileName(hostApp) {
  return resolveAppDbFileNameCore(hostApp);
}

export function resolveAppDbJsonFileName(hostApp) {
  return resolveAppDbJsonFileNameCore(hostApp);
}

export function maybeMigrateLegacyDbFiles(stateDir) {
  return maybeMigrateLegacyDbFilesCore(stateDir, { fallbackHostApp: 'aide' });
}

export function ensureAppDbPath(sessionRoot) {
  return ensureAppDbPathCore(sessionRoot, { fallbackHostApp: 'aide' });
}
