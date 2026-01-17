import fs from 'fs';
import path from 'path';
import { copyTree, ensureDir, getHomeDir, isDirectory, isFile, normalizeHostApp, resolveHostApp } from './utils.js';

const DEFAULT_SIGNAL_FILES = [
  'admin.db.sqlite',
  'subagents.json',
  'events.jsonl',
  'runs.jsonl',
  'ui-prompts.jsonl',
  'file-changes.jsonl',
  'project-exec-log.jsonl',
  'project-info.json',
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
  'events.jsonl',
  'file-changes.jsonl',
  'ui-prompts.jsonl',
  'runs.jsonl',
  'project-exec-log.jsonl',
  'project-info.json',
  'admin.db.sqlite',
  'admin.db.json',
];

const LEGACY_DB_BASENAME = 'admin.db.sqlite';
const LEGACY_DB_JSON_BASENAME = 'admin.db.json';

export function resolveLegacyStateDir(sessionRoot) {
  const base =
    typeof sessionRoot === 'string' && sessionRoot.trim()
      ? sessionRoot.trim()
      : process.cwd();
  return path.join(path.resolve(base), '.deepseek_cli');
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
    return path.join(home, '.deepseek_cli', hostApp);
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
