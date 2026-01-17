import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { createDb as createDbCore } from '../state-core/db.js';
import { getHomeDir, resolveHostApp } from '../state-core/utils.js';

const LEGACY_DEFAULT_DB_PATH = path.join(os.homedir(), '.deepseek_cli', 'admin.db.sqlite');

const require = createRequire(import.meta.url);

function normalizeDriverName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function loadBetterSqlite3() {
  try {
    return require('better-sqlite3');
  } catch {
    return null;
  }
}

const driverHint = normalizeDriverName(process.env.MODEL_CLI_DB_DRIVER);
const forceSqlJs = driverHint === 'sqljs' || driverHint === 'sql.js';
const forceBetterSqlite =
  driverHint === 'better-sqlite3' || driverHint === 'better-sqlite' || driverHint === 'sqlite';

let driver = null;
if (!forceSqlJs) {
  const Database = loadBetterSqlite3();
  if (Database) {
    driver = { type: 'better-sqlite3', Database };
  } else if (forceBetterSqlite) {
    throw new Error('MODEL_CLI_DB_DRIVER requested better-sqlite3 but the module is not available.');
  }
}

if (!driver) {
  const initSqlJsPkg = require('sql.js');
  const initSqlJs =
    initSqlJsPkg && typeof initSqlJsPkg === 'object' && 'default' in initSqlJsPkg ? initSqlJsPkg.default : initSqlJsPkg;
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
  const wasmBinary = fs.readFileSync(wasmPath);
  const SQL = await initSqlJs({ wasmBinary });
  driver = { type: 'sql.js', SQL };
}

export function getDefaultDbPath(env = process.env) {
  const home = getHomeDir(env) || os.homedir();
  const hostApp = resolveHostApp({ env, fallbackHostApp: 'aide' }) || 'aide';
  if (home && hostApp) {
    const dir = path.join(home, '.deepseek_cli', hostApp);
    const desired = path.join(dir, `${hostApp}.db.sqlite`);
    const legacy = path.join(dir, 'admin.db.sqlite');
    const desiredJson = path.join(dir, `${hostApp}.db.json`);
    const legacyJson = path.join(dir, 'admin.db.json');

    if (!fs.existsSync(desired) && fs.existsSync(legacy)) {
      try {
        fs.renameSync(legacy, desired);
      } catch {
        try {
          fs.copyFileSync(legacy, desired);
        } catch {
          // ignore
        }
      }
    }

    if (!fs.existsSync(desiredJson) && fs.existsSync(legacyJson)) {
      try {
        fs.renameSync(legacyJson, desiredJson);
      } catch {
        try {
          fs.copyFileSync(legacyJson, desiredJson);
        } catch {
          // ignore
        }
      }
    }

    return desired;
  }
  return LEGACY_DEFAULT_DB_PATH;
}

export function createDb({ driver: overrideDriver, dbPath = getDefaultDbPath(), seed = {}, ...rest } = {}) {
  return createDbCore({ driver: overrideDriver || driver, dbPath, seed, ...rest });
}
