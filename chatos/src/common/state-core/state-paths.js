import fs from 'fs';
import path from 'path';
import { COMPAT_STATE_ROOT_DIRNAME, STATE_ROOT_DIRNAME } from './state-constants.js';
import { copyTree, ensureDir, getHomeDir, isDirectory, isFile, normalizeHostApp, resolveHostApp } from './utils.js';

export const STATE_FILE_NAMES = Object.freeze({
  events: 'events.jsonl',
  runs: 'runs.jsonl',
  uiPrompts: 'ui-prompts.jsonl',
  fileChanges: 'file-changes.jsonl',
  projectExecLog: 'project-exec-log.jsonl',
  projectInfo: 'project-info.json',
});

export const STATE_DIR_NAMES = Object.freeze({
  auth: 'auth',
  terminals: 'terminals',
  sessions: 'sessions',
  uiApps: 'ui_apps',
  subagents: 'subagents',
});

const {
  events: EVENTS_FILE,
  runs: RUNS_FILE,
  uiPrompts: UI_PROMPTS_FILE,
  fileChanges: FILE_CHANGES_FILE,
  projectExecLog: PROJECT_EXEC_LOG_FILE,
  projectInfo: PROJECT_INFO_FILE,
} = STATE_FILE_NAMES;

const {
  auth: AUTH_DIR,
  terminals: TERMINALS_DIR,
  sessions: SESSIONS_DIR,
  uiApps: UI_APPS_DIR,
  subagents: SUBAGENTS_DIR,
} = STATE_DIR_NAMES;

const DEFAULT_SIGNAL_FILES = [
  'admin.db.sqlite',
  'subagents.json',
  EVENTS_FILE,
  RUNS_FILE,
  UI_PROMPTS_FILE,
  FILE_CHANGES_FILE,
  PROJECT_EXEC_LOG_FILE,
  PROJECT_INFO_FILE,
  'auth',
  'terminals',
  'sessions',
  'ui_apps',
  'subagents',
];

const DEFAULT_MIGRATION_CANDIDATES = [
  'auth',
  'sessions',
  'terminals',
  'ui_apps',
  'subagents',
  'subagents.json',
  EVENTS_FILE,
  FILE_CHANGES_FILE,
  UI_PROMPTS_FILE,
  RUNS_FILE,
  PROJECT_EXEC_LOG_FILE,
  PROJECT_INFO_FILE,
  'admin.db.sqlite',
  'admin.db.json',
];

const LEGACY_DB_BASENAME = 'admin.db.sqlite';
const LEGACY_DB_JSON_BASENAME = 'admin.db.json';
export { STATE_ROOT_DIRNAME, COMPAT_STATE_ROOT_DIRNAME };

export function resolveStateRootDir(options = {}) {
  const env = options?.env && typeof options.env === 'object' ? options.env : process.env;
  const homeRaw = typeof options.homeDir === 'string' ? options.homeDir.trim() : '';
  const home = homeRaw || getHomeDir(env);
  if (!home) return '';
  return path.join(home, STATE_ROOT_DIRNAME);
}

export function resolveCompatStateRootDir(options = {}) {
  const env = options?.env && typeof options.env === 'object' ? options.env : process.env;
  const homeRaw = typeof options.homeDir === 'string' ? options.homeDir.trim() : '';
  const home = homeRaw || getHomeDir(env);
  if (!home) return '';
  return path.join(home, COMPAT_STATE_ROOT_DIRNAME);
}

export function resolveStateDirPath(stateDir, ...parts) {
  const dir = typeof stateDir === 'string' ? stateDir.trim() : '';
  if (!dir) return '';
  const segments = [];
  parts.forEach((part) => {
    if (Array.isArray(part)) {
      part.forEach((entry) => segments.push(entry));
      return;
    }
    segments.push(part);
  });
  const normalized = segments
    .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry ?? '').trim()))
    .filter(Boolean);
  if (normalized.length === 0) return dir;
  return path.join(dir, ...normalized);
}

export function resolveAppStatePath(sessionRoot, parts, options = {}) {
  const appDir = resolveAppStateDir(sessionRoot, options);
  return resolveStateDirPath(appDir, parts);
}

export function resolveStateDirFile(stateDir, filename) {
  return resolveStateDirPath(stateDir, filename);
}

export function resolveAppStateFile(sessionRoot, filename, options = {}) {
  return resolveAppStatePath(sessionRoot, filename, options);
}

export function resolveEventsPath(sessionRoot, options = {}) {
  return resolveAppStateFile(sessionRoot, EVENTS_FILE, options);
}

export function resolveRunsPath(sessionRoot, options = {}) {
  return resolveAppStateFile(sessionRoot, RUNS_FILE, options);
}

export function resolveUiPromptsPath(sessionRoot, options = {}) {
  return resolveAppStateFile(sessionRoot, UI_PROMPTS_FILE, options);
}

export function resolveFileChangesPath(sessionRoot, options = {}) {
  return resolveAppStateFile(sessionRoot, FILE_CHANGES_FILE, options);
}

export function resolveProjectExecLogPath(sessionRoot, options = {}) {
  return resolveAppStateFile(sessionRoot, PROJECT_EXEC_LOG_FILE, options);
}

export function resolveProjectInfoPath(sessionRoot, options = {}) {
  return resolveAppStateFile(sessionRoot, PROJECT_INFO_FILE, options);
}

export function resolveAuthDir(sessionRoot, options = {}) {
  return resolveAppStatePath(sessionRoot, AUTH_DIR, options);
}

export function resolveTerminalsDir(sessionRoot, options = {}) {
  return resolveAppStatePath(sessionRoot, TERMINALS_DIR, options);
}

export function resolveSessionsDir(sessionRoot, options = {}) {
  return resolveAppStatePath(sessionRoot, SESSIONS_DIR, options);
}

export function resolveUiAppsDir(sessionRoot, options = {}) {
  return resolveAppStatePath(sessionRoot, UI_APPS_DIR, options);
}

export function resolveSubagentsDir(sessionRoot, options = {}) {
  return resolveAppStatePath(sessionRoot, SUBAGENTS_DIR, options);
}

export function resolveLegacyStateDir(sessionRoot) {
  const base =
    typeof sessionRoot === 'string' && sessionRoot.trim()
      ? sessionRoot.trim()
      : process.cwd();
  return path.join(path.resolve(base), STATE_ROOT_DIRNAME);
}

export function resolveAppDbFileName(hostApp) {
  const normalized = normalizeHostApp(hostApp);
  if (!normalized) return LEGACY_DB_BASENAME;
  return `${normalized}.db.sqlite`;
}

export function resolveAppDbJsonFileName(hostApp) {
  const normalized = normalizeHostApp(hostApp);
  if (!normalized) return LEGACY_DB_JSON_BASENAME;
  return `${normalized}.db.json`;
}

export function resolveAppStateDir(sessionRoot, options = {}) {
  const env = options?.env && typeof options.env === 'object' ? options.env : process.env;
  const hostApp = resolveHostApp({ env, hostApp: options.hostApp, fallbackHostApp: options.fallbackHostApp });
  const homeRaw = typeof options.homeDir === 'string' ? options.homeDir.trim() : '';
  const home = homeRaw || getHomeDir(env);
  const envSessionRoot = typeof env.MODEL_CLI_SESSION_ROOT === 'string' ? env.MODEL_CLI_SESSION_ROOT.trim() : '';
  const sessionRootRaw = typeof sessionRoot === 'string' ? sessionRoot.trim() : '';
  const preferSessionRoot = options?.preferSessionRoot === true || Boolean(envSessionRoot);
  const baseRoot = envSessionRoot || sessionRootRaw;

  if (preferSessionRoot && baseRoot) {
    const legacy = resolveLegacyStateDir(baseRoot);
    if (hostApp) {
      return path.join(legacy, hostApp);
    }
    return legacy;
  }

  if (home && hostApp) {
    return path.join(home, STATE_ROOT_DIRNAME, hostApp);
  }
  const legacy = resolveLegacyStateDir(sessionRootRaw);
  if (hostApp) {
    return path.join(legacy, hostApp);
  }
  return legacy;
}

function isAppStatePopulated(appDir, options = {}) {
  if (!isDirectory(appDir)) return false;
  const marker = path.join(appDir, '.migrated-from-legacy.json');
  if (isFile(marker)) return true;

  try {
    const entries = fs.readdirSync(appDir, { withFileTypes: true });
    if (entries.some((entry) => entry?.isFile?.() && String(entry.name || '').toLowerCase().endsWith('.db.sqlite'))) {
      return true;
    }
  } catch {
    // ignore
  }

  const signals = Array.isArray(options.signals) ? options.signals : DEFAULT_SIGNAL_FILES;
  return signals.some((name) => {
    if (!name) return false;
    try {
      return fs.existsSync(path.join(appDir, name));
    } catch {
      return false;
    }
  });
}

function maybeMigrateCompatStateDir(sessionRoot, options = {}) {
  const env = options?.env && typeof options.env === 'object' ? options.env : process.env;
  const hostApp = resolveHostApp({ env, hostApp: options.hostApp, fallbackHostApp: options.fallbackHostApp });
  const home = getHomeDir(env);
  const appDir = typeof options.appDir === 'string' && options.appDir.trim()
    ? options.appDir.trim()
    : resolveAppStateDir(sessionRoot, { ...options, env, hostApp });

  if (!home || !hostApp || !appDir) {
    return { migrated: false, legacyDir: '', legacyAppDir: '', appDir };
  }

  const desiredRoot = path.join(home, STATE_ROOT_DIRNAME);
  const resolvedAppDir = path.resolve(appDir);
  const resolvedDesiredRoot = path.resolve(desiredRoot);
  if (
    resolvedAppDir !== resolvedDesiredRoot &&
    !resolvedAppDir.startsWith(`${resolvedDesiredRoot}${path.sep}`)
  ) {
    return { migrated: false, legacyDir: '', legacyAppDir: '', appDir };
  }

  if (isAppStatePopulated(appDir, options)) {
    return { migrated: false, legacyDir: '', legacyAppDir: '', appDir };
  }

  const legacyDir = path.join(home, COMPAT_STATE_ROOT_DIRNAME);
  const legacyAppDir = path.join(legacyDir, hostApp);
  if (!isDirectory(legacyAppDir)) {
    return { migrated: false, legacyDir, legacyAppDir, appDir };
  }

  ensureDir(appDir);
  copyTree({ src: legacyAppDir, dest: appDir });
  try {
    const markerPath = path.join(appDir, '.migrated-from-chatos.json');
    if (!fs.existsSync(markerPath)) {
      ensureDir(path.dirname(markerPath));
      fs.writeFileSync(
        markerPath,
        JSON.stringify(
          {
            version: 1,
            migratedAt: new Date().toISOString(),
            legacyDir,
            legacyAppDir,
          },
          null,
          2
        ),
        'utf8'
      );
    }
  } catch {
    // ignore marker write errors
  }

  return { migrated: true, legacyDir, legacyAppDir, appDir };
}

export function maybeMigrateLegacyDbFiles(stateDir, options = {}) {
  const appDir = typeof stateDir === 'string' ? stateDir.trim() : '';
  if (!appDir) {
    return {
      migrated: false,
      migratedDb: false,
      migratedJson: false,
      hostApp: '',
      desiredDbPath: '',
      desiredJsonPath: '',
      legacyDbPath: '',
      legacyJsonPath: '',
    };
  }

  const env = options?.env && typeof options.env === 'object' ? options.env : process.env;
  const hostApp = resolveHostApp({ env, hostApp: options.hostApp, fallbackHostApp: options.fallbackHostApp });
  const normalizedHost = normalizeHostApp(hostApp);
  if (!normalizedHost) {
    return {
      migrated: false,
      migratedDb: false,
      migratedJson: false,
      hostApp: '',
      desiredDbPath: '',
      desiredJsonPath: '',
      legacyDbPath: path.join(appDir, LEGACY_DB_BASENAME),
      legacyJsonPath: path.join(appDir, LEGACY_DB_JSON_BASENAME),
    };
  }

  const desiredDbPath = path.join(appDir, resolveAppDbFileName(normalizedHost));
  const desiredJsonPath = path.join(appDir, resolveAppDbJsonFileName(normalizedHost));
  const legacyDbPath = path.join(appDir, LEGACY_DB_BASENAME);
  const legacyJsonPath = path.join(appDir, LEGACY_DB_JSON_BASENAME);

  const migrateFile = (fromPath, toPath) => {
    if (!fromPath || !toPath) return false;
    if (fs.existsSync(toPath)) return false;
    if (!fs.existsSync(fromPath)) return false;
    ensureDir(path.dirname(toPath));
    try {
      fs.renameSync(fromPath, toPath);
      return true;
    } catch {
      try {
        fs.copyFileSync(fromPath, toPath);
        return true;
      } catch {
        return false;
      }
    }
  };

  let migratedDb = false;
  let migratedJson = false;
  try {
    migratedDb = migrateFile(legacyDbPath, desiredDbPath);
  } catch {
    migratedDb = false;
  }
  try {
    migratedJson = migrateFile(legacyJsonPath, desiredJsonPath);
  } catch {
    migratedJson = false;
  }

  return {
    migrated: migratedDb || migratedJson,
    migratedDb,
    migratedJson,
    hostApp: normalizedHost,
    desiredDbPath,
    desiredJsonPath,
    legacyDbPath,
    legacyJsonPath,
  };
}

export function ensureAppDbPath(sessionRoot, options = {}) {
  const env = options?.env && typeof options.env === 'object' ? options.env : process.env;
  const hostApp = resolveHostApp({ env, hostApp: options.hostApp, fallbackHostApp: options.fallbackHostApp });
  const appDir = ensureAppStateDir(sessionRoot, { ...options, env, hostApp });
  try {
    maybeMigrateLegacyDbFiles(appDir, { ...options, env, hostApp });
  } catch {
    // ignore migration errors
  }
  return path.join(appDir, resolveAppDbFileName(hostApp));
}

export function maybeMigrateLegacyStateDir(sessionRoot, options = {}) {
  const env = options?.env && typeof options.env === 'object' ? options.env : process.env;
  const hostApp = resolveHostApp({ env, hostApp: options.hostApp, fallbackHostApp: options.fallbackHostApp });
  const legacyDir = typeof options.legacyDir === 'string' && options.legacyDir.trim()
    ? options.legacyDir.trim()
    : resolveLegacyStateDir(sessionRoot);
  const appDir = typeof options.appDir === 'string' && options.appDir.trim()
    ? options.appDir.trim()
    : resolveAppStateDir(sessionRoot, { ...options, env, hostApp });

  if (!hostApp) return { migrated: false, legacyDir, appDir };
  if (isAppStatePopulated(appDir, options)) return { migrated: false, legacyDir, appDir };
  if (!isDirectory(legacyDir)) return { migrated: false, legacyDir, appDir };

  const legacyAppDir = path.join(legacyDir, hostApp);
  if (
    isDirectory(legacyAppDir) &&
    path.resolve(legacyAppDir) !== path.resolve(appDir) &&
    isAppStatePopulated(legacyAppDir, options)
  ) {
    ensureDir(appDir);
    copyTree({ src: legacyAppDir, dest: appDir });
    try {
      const markerPath = path.join(appDir, '.migrated-from-legacy.json');
      if (!fs.existsSync(markerPath)) {
        ensureDir(path.dirname(markerPath));
        fs.writeFileSync(
          markerPath,
          JSON.stringify(
            {
              version: 2,
              migratedAt: new Date().toISOString(),
              legacyDir,
              legacyAppDir,
            },
            null,
            2
          ),
          'utf8'
        );
      }
    } catch {
      // ignore marker write errors
    }
    return { migrated: true, legacyDir, legacyAppDir, appDir };
  }

  const candidates = Array.isArray(options.candidates) ? options.candidates : DEFAULT_MIGRATION_CANDIDATES;
  const normalizedCandidates = candidates.filter((name) => typeof name === 'string' && name.trim());
  if (hostApp === 'chatos' && !normalizedCandidates.includes('aide')) {
    normalizedCandidates.push('aide');
  }

  const hasLegacy = normalizedCandidates.some((name) => {
    try {
      return fs.existsSync(path.join(legacyDir, name));
    } catch {
      return false;
    }
  });
  if (!hasLegacy) return { migrated: false, legacyDir, appDir };

  ensureDir(appDir);
  normalizedCandidates.forEach((name) => {
    copyTree({ src: path.join(legacyDir, name), dest: path.join(appDir, name) });
  });

  try {
    const markerPath = path.join(appDir, '.migrated-from-legacy.json');
    if (!fs.existsSync(markerPath)) {
      ensureDir(path.dirname(markerPath));
      fs.writeFileSync(
        markerPath,
        JSON.stringify(
          {
            version: 1,
            migratedAt: new Date().toISOString(),
            legacyDir,
          },
          null,
          2
        ),
        'utf8'
      );
    }
  } catch {
    // ignore marker write errors
  }

  return { migrated: true, legacyDir, appDir };
}

export function ensureAppStateDir(sessionRoot, options = {}) {
  const appDir = resolveAppStateDir(sessionRoot, options);
  try {
    maybeMigrateCompatStateDir(sessionRoot, { ...options, appDir });
  } catch {
    // ignore compat migration errors
  }
  try {
    maybeMigrateLegacyStateDir(sessionRoot, { ...options, appDir });
  } catch {
    // ignore migration errors
  }
  try {
    maybeMigrateLegacyDbFiles(appDir, options);
  } catch {
    // ignore DB filename migration errors
  }
  ensureDir(appDir);
  return appDir;
}
