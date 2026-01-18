import {
  ensureAppStateDir as ensureAppStateDirCore,
  ensureAppDbPath as ensureAppDbPathCore,
  maybeMigrateLegacyDbFiles as maybeMigrateLegacyDbFilesCore,
  maybeMigrateLegacyStateDir as maybeMigrateLegacyStateDirCore,
  COMPAT_STATE_ROOT_DIRNAME as COMPAT_STATE_ROOT_DIRNAME_CORE,
  STATE_ROOT_DIRNAME as STATE_ROOT_DIRNAME_CORE,
  STATE_FILE_NAMES as STATE_FILE_NAMES_CORE,
  STATE_DIR_NAMES as STATE_DIR_NAMES_CORE,
  resolveAppDbFileName as resolveAppDbFileNameCore,
  resolveAppDbJsonFileName as resolveAppDbJsonFileNameCore,
  resolveAppStateDir as resolveAppStateDirCore,
  resolveAppStateFile as resolveAppStateFileCore,
  resolveAppStatePath as resolveAppStatePathCore,
  resolveStateDirFile as resolveStateDirFileCore,
  resolveStateDirPath as resolveStateDirPathCore,
  resolveEventsPath as resolveEventsPathCore,
  resolveRunsPath as resolveRunsPathCore,
  resolveUiPromptsPath as resolveUiPromptsPathCore,
  resolveFileChangesPath as resolveFileChangesPathCore,
  resolveProjectExecLogPath as resolveProjectExecLogPathCore,
  resolveProjectInfoPath as resolveProjectInfoPathCore,
  resolveAuthDir as resolveAuthDirCore,
  resolveTerminalsDir as resolveTerminalsDirCore,
  resolveSessionsDir as resolveSessionsDirCore,
  resolveUiAppsDir as resolveUiAppsDirCore,
  resolveSubagentsDir as resolveSubagentsDirCore,
  resolveLegacyStateDir as resolveLegacyStateDirCore,
} from '../../common/state-core/state-paths.js';

export const STATE_ROOT_DIRNAME = STATE_ROOT_DIRNAME_CORE;
export const COMPAT_STATE_ROOT_DIRNAME = COMPAT_STATE_ROOT_DIRNAME_CORE;
export const STATE_FILE_NAMES = STATE_FILE_NAMES_CORE;
export const STATE_DIR_NAMES = STATE_DIR_NAMES_CORE;

export function resolveLegacyStateDir(sessionRoot) {
  return resolveLegacyStateDirCore(sessionRoot);
}

export function resolveAppStateDir(sessionRoot, options = {}) {
  return resolveAppStateDirCore(sessionRoot, { ...options, fallbackHostApp: 'chatos' });
}

export function resolveAppStateFile(sessionRoot, filename, options = {}) {
  return resolveAppStateFileCore(sessionRoot, filename, { ...options, fallbackHostApp: 'chatos' });
}

export function resolveAppStatePath(sessionRoot, parts, options = {}) {
  return resolveAppStatePathCore(sessionRoot, parts, { ...options, fallbackHostApp: 'chatos' });
}

export function resolveStateDirFile(stateDir, filename) {
  return resolveStateDirFileCore(stateDir, filename);
}

export function resolveStateDirPath(stateDir, ...parts) {
  return resolveStateDirPathCore(stateDir, ...parts);
}

export function resolveEventsPath(sessionRoot, options = {}) {
  return resolveEventsPathCore(sessionRoot, { ...options, fallbackHostApp: 'chatos' });
}

export function resolveRunsPath(sessionRoot, options = {}) {
  return resolveRunsPathCore(sessionRoot, { ...options, fallbackHostApp: 'chatos' });
}

export function resolveUiPromptsPath(sessionRoot, options = {}) {
  return resolveUiPromptsPathCore(sessionRoot, { ...options, fallbackHostApp: 'chatos' });
}

export function resolveFileChangesPath(sessionRoot, options = {}) {
  return resolveFileChangesPathCore(sessionRoot, { ...options, fallbackHostApp: 'chatos' });
}

export function resolveProjectExecLogPath(sessionRoot, options = {}) {
  return resolveProjectExecLogPathCore(sessionRoot, { ...options, fallbackHostApp: 'chatos' });
}

export function resolveProjectInfoPath(sessionRoot, options = {}) {
  return resolveProjectInfoPathCore(sessionRoot, { ...options, fallbackHostApp: 'chatos' });
}

export function resolveAuthDir(sessionRoot, options = {}) {
  return resolveAuthDirCore(sessionRoot, { ...options, fallbackHostApp: 'chatos' });
}

export function resolveTerminalsDir(sessionRoot, options = {}) {
  return resolveTerminalsDirCore(sessionRoot, { ...options, fallbackHostApp: 'chatos' });
}

export function resolveSessionsDir(sessionRoot, options = {}) {
  return resolveSessionsDirCore(sessionRoot, { ...options, fallbackHostApp: 'chatos' });
}

export function resolveUiAppsDir(sessionRoot, options = {}) {
  return resolveUiAppsDirCore(sessionRoot, { ...options, fallbackHostApp: 'chatos' });
}

export function resolveSubagentsDir(sessionRoot, options = {}) {
  return resolveSubagentsDirCore(sessionRoot, { ...options, fallbackHostApp: 'chatos' });
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
