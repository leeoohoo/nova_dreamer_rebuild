import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import initSqlJs from 'sql.js';
import { getHomeDir, normalizeHostApp } from '../../src/common/state-core/utils.js';
import { maybeMigrateLegacyDbFiles, resolveAppDbFileName, resolveAppStateDir } from '../../src/common/state-core/state-paths.js';

const require = createRequire(import.meta.url);

let SQL_PROMISE = null;

function resolveSqlWasmPath() {
  try {
    return require.resolve('sql.js/dist/sql-wasm.wasm');
  } catch {
    const sqlMain = require.resolve('sql.js');
    return path.join(path.dirname(sqlMain), 'sql-wasm.wasm');
  }
}

async function getSql() {
  if (!SQL_PROMISE) {
    SQL_PROMISE = (async () => {
      const wasmPath = resolveSqlWasmPath();
      const wasmBinary = fs.readFileSync(wasmPath);
      return await initSqlJs({ wasmBinary });
    })();
  }
  return await SQL_PROMISE;
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function listAppIds({ knownApps = [], env = process.env } = {}) {
  const out = [];
  const seen = new Set();
  const register = (id) => {
    const normalized = normalizeHostApp(id);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  (Array.isArray(knownApps) ? knownApps : []).forEach(register);

  const home = getHomeDir(env);
  if (home) {
    const baseDir = path.join(home, '.deepseek_cli');
    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      entries.forEach((entry) => {
        if (!entry?.isDirectory?.()) return;
        register(entry.name);
      });
    } catch {
      // ignore
    }
  }

  return out;
}

function resolveDbPath({ sessionRoot, hostApp }) {
  const normalizedHost = normalizeHostApp(hostApp);
  const stateDir = resolveAppStateDir(sessionRoot, { hostApp: normalizedHost });
  if (stateDir && fs.existsSync(stateDir)) {
    try {
      const stat = fs.statSync(stateDir);
      if (stat?.isDirectory?.()) {
        maybeMigrateLegacyDbFiles(stateDir, { hostApp: normalizedHost });
      }
    } catch {
      // ignore migration fs errors
    }
  }
  const desiredDbPath = stateDir ? path.join(stateDir, resolveAppDbFileName(normalizedHost)) : '';
  const legacyDbPath = stateDir ? path.join(stateDir, 'admin.db.sqlite') : '';
  const desiredExists = Boolean(desiredDbPath && fs.existsSync(desiredDbPath));
  const legacyExists = Boolean(legacyDbPath && fs.existsSync(legacyDbPath));
  const dbPath = desiredExists ? desiredDbPath : legacyExists ? legacyDbPath : desiredDbPath;
  return {
    hostApp: normalizedHost,
    stateDir,
    dbPath: dbPath || desiredDbPath,
  };
}

function readDbTable({ SQL, dbPath, tableName }) {
  const rawDbPath = typeof dbPath === 'string' ? dbPath.trim() : '';
  if (!rawDbPath) return [];
  if (!fs.existsSync(rawDbPath)) return [];
  const table = typeof tableName === 'string' ? tableName.trim() : '';
  if (!table) return [];

  const binary = fs.readFileSync(rawDbPath);
  if (!binary || binary.length === 0) return [];

  const db = new SQL.Database(new Uint8Array(binary));
  try {
    const stmt = db.prepare('SELECT payload FROM records WHERE table_name = ?');
    stmt.bind([table]);
    const rows = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const parsed = parseJsonSafe(row?.payload);
      if (parsed) rows.push(parsed);
    }
    stmt.free();
    return rows;
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

function readDbRecord({ SQL, dbPath, tableName, id }) {
  const rawDbPath = typeof dbPath === 'string' ? dbPath.trim() : '';
  if (!rawDbPath) return null;
  if (!fs.existsSync(rawDbPath)) return null;
  const table = typeof tableName === 'string' ? tableName.trim() : '';
  if (!table) return null;
  const recordId = typeof id === 'string' ? id.trim() : '';
  if (!recordId) return null;

  const binary = fs.readFileSync(rawDbPath);
  if (!binary || binary.length === 0) return null;

  const db = new SQL.Database(new Uint8Array(binary));
  try {
    const stmt = db.prepare('SELECT payload FROM records WHERE table_name = ? AND id = ?');
    stmt.bind([table, recordId]);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return row?.payload ? parseJsonSafe(row.payload) : null;
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

function summarizePrompt(prompt) {
  const id = typeof prompt?.id === 'string' ? prompt.id : '';
  const name = typeof prompt?.name === 'string' ? prompt.name : '';
  const title = typeof prompt?.title === 'string' ? prompt.title : '';
  const allowMain = Boolean(prompt?.allowMain);
  const allowSub = Boolean(prompt?.allowSub);
  const builtin = Boolean(prompt?.builtin);
  const locked = Boolean(prompt?.locked);
  const updatedAt = typeof prompt?.updatedAt === 'string' ? prompt.updatedAt : '';
  const content = typeof prompt?.content === 'string' ? prompt.content : '';
  const preview = content.length > 240 ? `${content.slice(0, 240)}…` : content;
  return { id, name, title, allowMain, allowSub, builtin, locked, updatedAt, preview, length: content.length };
}

export function registerRegistryApi(ipcMain, options = {}) {
  const sessionRoot = typeof options.sessionRoot === 'string' && options.sessionRoot.trim()
    ? options.sessionRoot.trim()
    : process.env.MODEL_CLI_SESSION_ROOT || process.cwd();
  const knownApps = Array.isArray(options.knownApps) ? options.knownApps : ['chatos'];

  ipcMain.handle('registry:apps:list', async () => {
    const appIds = listAppIds({ knownApps });
    const apps = appIds.map((appId) => {
      const { stateDir, dbPath } = resolveDbPath({ sessionRoot, hostApp: appId });
      const dbExists = Boolean(dbPath && fs.existsSync(dbPath));
      return { appId, stateDir, dbPath, dbExists };
    });
    return { ok: true, apps };
  });

  ipcMain.handle('registry:mcpServers:list', async () => {
    try {
      const SQL = await getSql();
      const appIds = listAppIds({ knownApps });
      const apps = appIds.map((appId) => {
        const { stateDir, dbPath } = resolveDbPath({ sessionRoot, hostApp: appId });
        const dbExists = Boolean(dbPath && fs.existsSync(dbPath));
        const mcpServers = dbExists ? readDbTable({ SQL, dbPath, tableName: 'mcpServers' }) : [];
        return { appId, stateDir, dbPath, dbExists, mcpServers };
      });
      return { ok: true, apps };
    } catch (err) {
      return { ok: false, message: err?.message || String(err) };
    }
  });

  ipcMain.handle('registry:prompts:list', async () => {
    try {
      const SQL = await getSql();
      const appIds = listAppIds({ knownApps });
      const apps = appIds.map((appId) => {
        const { stateDir, dbPath } = resolveDbPath({ sessionRoot, hostApp: appId });
        const dbExists = Boolean(dbPath && fs.existsSync(dbPath));
        const raw = dbExists ? readDbTable({ SQL, dbPath, tableName: 'prompts' }) : [];
        const prompts = (Array.isArray(raw) ? raw : []).map((p) => summarizePrompt(p));
        return { appId, stateDir, dbPath, dbExists, prompts };
      });
      return { ok: true, apps };
    } catch (err) {
      return { ok: false, message: err?.message || String(err) };
    }
  });

  ipcMain.handle('registry:prompts:get', async (_event, payload = {}) => {
    try {
      const appId = normalizeHostApp(payload?.appId);
      const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
      if (!appId) return { ok: false, message: 'appId is required' };
      if (!id) return { ok: false, message: 'id is required' };

      const { stateDir, dbPath } = resolveDbPath({ sessionRoot, hostApp: appId });
      if (!dbPath || !fs.existsSync(dbPath)) {
        return { ok: false, message: `DB not found for app: ${appId}` };
      }

      const SQL = await getSql();
      const record = readDbRecord({ SQL, dbPath, tableName: 'prompts', id });
      return { ok: true, appId, stateDir, dbPath, record };
    } catch (err) {
      return { ok: false, message: err?.message || String(err) };
    }
  });
}
