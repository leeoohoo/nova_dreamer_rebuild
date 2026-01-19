import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
const DEFAULT_LOCK_STALE_MS = 30_000;
const DEFAULT_LOCK_POLL_MS = 25;
const DEFAULT_SQLITE_BUSY_TIMEOUT_MS = 5_000;
const SLEEP_BUFFER = typeof SharedArrayBuffer === 'function' ? new Int32Array(new SharedArrayBuffer(4)) : null;

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sleepSync(ms) {
  if (!ms || ms <= 0) return;
  if (SLEEP_BUFFER) {
    try {
      Atomics.wait(SLEEP_BUFFER, 0, 0, ms);
      return;
    } catch {
      // fall through
    }
  }
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    // busy wait as a last resort
  }
}

function acquireFileLock(lockPath, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_LOCK_TIMEOUT_MS;
  const pollMs = Number.isFinite(options.pollMs) ? options.pollMs : DEFAULT_LOCK_POLL_MS;
  const staleMs = Number.isFinite(options.staleMs) ? options.staleMs : DEFAULT_LOCK_STALE_MS;
  const start = Date.now();
  ensureDirForFile(lockPath);
  while (true) {
    try {
      fs.writeFileSync(
        lockPath,
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
        { flag: 'wx', encoding: 'utf8' }
      );
      return;
    } catch (err) {
      if (err?.code !== 'EEXIST') {
        throw err;
      }
    }

    try {
      const stat = fs.statSync(lockPath);
      const mtimeMs = typeof stat.mtimeMs === 'number' ? stat.mtimeMs : 0;
      const ageMs = Date.now() - mtimeMs;
      if (ageMs > staleMs) {
        fs.unlinkSync(lockPath);
        continue;
      }
    } catch {
      // If lock disappeared or can't be read, retry acquiring.
      continue;
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for DB lock (${path.basename(lockPath)}).`);
    }
    sleepSync(pollMs);
  }
}

function releaseFileLock(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // ignore
  }
}

function atomicWriteFileSync(filePath, buffer) {
  ensureDirForFile(filePath);
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now().toString(36)}.tmp`);
  fs.writeFileSync(tmp, buffer);
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(filePath);
      fs.renameSync(tmp, filePath);
    } catch (err2) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // ignore
      }
      throw err2;
    }
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeTableSeed(seed = {}) {
  const out = {};
  Object.entries(seed || {}).forEach(([key, value]) => {
    if (!key) return;
    if (Array.isArray(value)) out[key] = value;
  });
  return out;
}

function parsePayload(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getLegacyJsonPath(dbPath) {
  if (typeof dbPath !== 'string') return null;
  if (dbPath.endsWith('.sqlite')) {
    const candidate = dbPath.replace(/\.sqlite$/, '.json');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function loadLegacyJson(jsonPath) {
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch {
    return null;
  }
}

function selectManySqlJs(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function selectOneSqlJs(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function execWithChangesSqlJs(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  const changes = db.getRowsModified();
  stmt.free();
  return changes;
}

function countRecordsSqlJs(db) {
  const stmt = db.prepare('SELECT COUNT(*) as c FROM records');
  const count = stmt.step() ? stmt.getAsObject().c : 0;
  stmt.free();
  return Number(count) || 0;
}

function bootstrapSeedSqlJs(db, seed) {
  const hasData = countRecordsSqlJs(db) > 0;
  if (hasData) return false;

  const tables = Object.keys(seed || {});
  if (tables.length === 0) return false;

  const insertSeed = db.prepare(
    'INSERT INTO records (table_name, id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  );
  const now = new Date().toISOString();
  tables.forEach((table) => {
    const list = Array.isArray(seed[table]) ? seed[table] : [];
    list.forEach((item) => {
      const payload = { ...(item && typeof item === 'object' ? item : {}) };
      payload.id = payload.id || crypto.randomUUID();
      payload.createdAt = payload.createdAt || now;
      payload.updatedAt = payload.updatedAt || now;
      insertSeed.run([table, payload.id, JSON.stringify(payload), payload.createdAt, payload.updatedAt]);
    });
  });
  insertSeed.free();
  return true;
}

function maybeMigrateFromJsonSqlJs(db, dbPath, options = {}) {
  const legacyPath = typeof options.legacyJsonPath === 'string' ? options.legacyJsonPath.trim() : '';
  const candidate = legacyPath || getLegacyJsonPath(dbPath);
  if (!candidate) return false;

  const hasData = countRecordsSqlJs(db) > 0;
  if (hasData) return false;

  const state = loadLegacyJson(candidate);
  if (!state || typeof state !== 'object') return false;

  const insert = db.prepare(
    'INSERT INTO records (table_name, id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  );
  const now = new Date().toISOString();
  Object.entries(state).forEach(([table, list]) => {
    if (!table || !Array.isArray(list)) return;
    list.forEach((item) => {
      const payload = { ...(item && typeof item === 'object' ? item : {}) };
      payload.id = payload.id || crypto.randomUUID();
      payload.createdAt = payload.createdAt || now;
      payload.updatedAt = payload.updatedAt || now;
      insert.run([table, payload.id, JSON.stringify(payload), payload.createdAt, payload.updatedAt]);
    });
  });
  insert.free();
  return true;
}

function selectManySqlite(db, sql, params = []) {
  return db.prepare(sql).all(params);
}

function selectOneSqlite(db, sql, params = []) {
  return db.prepare(sql).get(params) || null;
}

function execWithChangesSqlite(db, sql, params = []) {
  const result = db.prepare(sql).run(params);
  return result?.changes || 0;
}

function countRecordsSqlite(db) {
  const row = db.prepare('SELECT COUNT(*) as c FROM records').get();
  return Number(row?.c) || 0;
}

function bootstrapSeedSqlite(db, seed) {
  if (countRecordsSqlite(db) > 0) return false;
  const tables = Object.keys(seed || {});
  if (tables.length === 0) return false;
  const insertSeed = db.prepare(
    'INSERT INTO records (table_name, id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  );
  const now = new Date().toISOString();
  const runSeed = db.transaction(() => {
    tables.forEach((table) => {
      const list = Array.isArray(seed[table]) ? seed[table] : [];
      list.forEach((item) => {
        const payload = { ...(item && typeof item === 'object' ? item : {}) };
        payload.id = payload.id || crypto.randomUUID();
        payload.createdAt = payload.createdAt || now;
        payload.updatedAt = payload.updatedAt || now;
        insertSeed.run([table, payload.id, JSON.stringify(payload), payload.createdAt, payload.updatedAt]);
      });
    });
  });
  runSeed();
  return true;
}

function maybeMigrateFromJsonSqlite(db, dbPath, options = {}) {
  const legacyPath = typeof options.legacyJsonPath === 'string' ? options.legacyJsonPath.trim() : '';
  const candidate = legacyPath || getLegacyJsonPath(dbPath);
  if (!candidate) return false;
  if (countRecordsSqlite(db) > 0) return false;

  const state = loadLegacyJson(candidate);
  if (!state || typeof state !== 'object') return false;

  const insert = db.prepare(
    'INSERT INTO records (table_name, id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  );
  const now = new Date().toISOString();
  const runMigration = db.transaction(() => {
    Object.entries(state).forEach(([table, list]) => {
      if (!table || !Array.isArray(list)) return;
      list.forEach((item) => {
        const payload = { ...(item && typeof item === 'object' ? item : {}) };
        payload.id = payload.id || crypto.randomUUID();
        payload.createdAt = payload.createdAt || now;
        payload.updatedAt = payload.updatedAt || now;
        insert.run([table, payload.id, JSON.stringify(payload), payload.createdAt, payload.updatedAt]);
      });
    });
  });
  runMigration();
  return true;
}

function openSqliteDb(Database, dbPath, sqlite = {}) {
  ensureDirForFile(dbPath);
  const options = {};
  if (sqlite.readonly === true) options.readonly = true;
  if (sqlite.fileMustExist === true) options.fileMustExist = true;
  const db = new Database(dbPath, options);

  const busyTimeoutMs = Number.isFinite(sqlite.busyTimeoutMs) ? sqlite.busyTimeoutMs : DEFAULT_SQLITE_BUSY_TIMEOUT_MS;
  if (busyTimeoutMs > 0) {
    try {
      db.pragma(`busy_timeout = ${Math.floor(busyTimeoutMs)}`);
    } catch {
      // ignore pragma failures
    }
  }

  const journalMode = typeof sqlite.journalMode === 'string' ? sqlite.journalMode.trim() : '';
  if (journalMode) {
    try {
      db.pragma(`journal_mode = ${journalMode}`);
    } catch {
      // ignore pragma failures
    }
  } else {
    try {
      db.pragma('journal_mode = WAL');
    } catch {
      // ignore pragma failures
    }
  }

  db.exec(
    `CREATE TABLE IF NOT EXISTS records (
      table_name TEXT NOT NULL,
      id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (table_name, id)
    )`
  );

  return db;
}

function createSqlJsDb({ SQL, dbPath, seed = {}, migrateFromJson = true, legacyJsonPath = '', lock = {} } = {}) {
  if (!SQL || typeof SQL.Database !== 'function') {
    throw new Error('SQL.js module (initSqlJs result) is required: pass { driver: { type: "sql.js", SQL } }');
  }
  const resolvedDbPath = typeof dbPath === 'string' ? dbPath.trim() : '';
  if (!resolvedDbPath) {
    throw new Error('dbPath is required');
  }

  const normalizedSeed = normalizeTableSeed(seed);
  const lockPath =
    typeof lock.path === 'string' && lock.path.trim() ? lock.path.trim() : `${resolvedDbPath}.lock`;

  const now = () => new Date().toISOString();
  const genId = () => crypto.randomUUID();

  const withDb = (fn) => {
    acquireFileLock(lockPath, lock);
    let db = null;
    let dirty = false;
    try {
      ensureDirForFile(resolvedDbPath);
      const existed = fs.existsSync(resolvedDbPath);
      const binary = existed ? fs.readFileSync(resolvedDbPath) : null;
      if (binary && binary.length > 0) {
        db = new SQL.Database(new Uint8Array(binary));
      } else {
        db = new SQL.Database();
        dirty = true;
      }

      db.run(
        `CREATE TABLE IF NOT EXISTS records (
          table_name TEXT NOT NULL,
          id TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (table_name, id)
        )`
      );

      const beforeInitCount = countRecordsSqlJs(db);
      let migrated = false;
      let seeded = false;
      if (migrateFromJson) {
        migrated = maybeMigrateFromJsonSqlJs(db, resolvedDbPath, { legacyJsonPath });
      }
      seeded = bootstrapSeedSqlJs(db, normalizedSeed);
      const afterInitCount = countRecordsSqlJs(db);
      if (!existed || (binary && binary.length === 0) || afterInitCount !== beforeInitCount || migrated || seeded) {
        dirty = true;
      }

      const markDirty = () => {
        dirty = true;
      };
      const result = fn(db, { markDirty });
      if (dirty) {
        const data = db.export();
        atomicWriteFileSync(resolvedDbPath, Buffer.from(data));
      }
      return result;
    } finally {
      try {
        db?.close?.();
      } catch {
        // ignore
      }
      releaseFileLock(lockPath);
    }
  };

  return {
    path: resolvedDbPath,
    snapshot() {
      return withDb((db) => {
        const tables = selectManySqlJs(db, 'SELECT DISTINCT table_name as name FROM records')
          .map((row) => row.name)
          .filter(Boolean);
        const state = {};
        tables.forEach((table) => {
          const rows = selectManySqlJs(db, 'SELECT id, payload FROM records WHERE table_name = ?', [table]);
          state[table] = rows.map((row) => parsePayload(row.payload)).filter(Boolean);
        });
        return state;
      });
    },
    list(table) {
      return withDb((db) => {
        const rows = selectManySqlJs(db, 'SELECT id, payload FROM records WHERE table_name = ?', [table]);
        return rows.map((row) => parsePayload(row.payload)).filter(Boolean);
      });
    },
    get(table, id) {
      return withDb((db) => {
        const row = selectOneSqlJs(db, 'SELECT id, payload FROM records WHERE table_name = ? AND id = ?', [table, id]);
        return row ? parsePayload(row.payload) : null;
      });
    },
    insert(table, record) {
      return withDb((_db, { markDirty }) => {
        const payload = record && typeof record === 'object' ? { ...record } : {};
        payload.id = payload.id || genId();
        const ts = now();
        payload.createdAt = payload.createdAt || ts;
        payload.updatedAt = ts;
        execWithChangesSqlJs(
          _db,
          'INSERT INTO records (table_name, id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          [table, payload.id, JSON.stringify(payload), payload.createdAt, payload.updatedAt]
        );
        markDirty();
        return clone(payload);
      });
    },
    update(table, id, patch) {
      return withDb((db, { markDirty }) => {
        const existingRow = selectOneSqlJs(db, 'SELECT payload FROM records WHERE table_name = ? AND id = ?', [
          table,
          id,
        ]);
        const existing = existingRow ? parsePayload(existingRow.payload) : null;
        if (!existing) return null;
        const merged = {
          ...existing,
          ...(patch && typeof patch === 'object' ? patch : {}),
          id,
          updatedAt: now(),
        };
        execWithChangesSqlJs(db, 'UPDATE records SET payload = ?, updated_at = ? WHERE table_name = ? AND id = ?', [
          JSON.stringify(merged),
          merged.updatedAt,
          table,
          id,
        ]);
        markDirty();
        return clone(merged);
      });
    },
    remove(table, id) {
      return withDb((db, { markDirty }) => {
        const changes = execWithChangesSqlJs(db, 'DELETE FROM records WHERE table_name = ? AND id = ?', [table, id]);
        if (changes > 0) {
          markDirty();
          return true;
        }
        return false;
      });
    },
    reset(table, records) {
      return withDb((db, { markDirty }) => {
        execWithChangesSqlJs(db, 'DELETE FROM records WHERE table_name = ?', [table]);
        (Array.isArray(records) ? records : []).forEach((item) => {
          const payload = item && typeof item === 'object' ? { ...item } : {};
          if (!payload.id) payload.id = genId();
          const ts = payload.updatedAt || payload.createdAt || now();
          payload.createdAt = payload.createdAt || ts;
          payload.updatedAt = payload.updatedAt || ts;
          execWithChangesSqlJs(
            db,
            'INSERT INTO records (table_name, id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
            [table, payload.id, JSON.stringify(payload), payload.createdAt, payload.updatedAt]
          );
        });
        markDirty();
        const rows = selectManySqlJs(db, 'SELECT id, payload FROM records WHERE table_name = ?', [table]);
        return rows.map((row) => parsePayload(row.payload)).filter(Boolean);
      });
    },
  };
}

function createBetterSqliteDb({
  Database,
  dbPath,
  seed = {},
  migrateFromJson = true,
  legacyJsonPath = '',
  sqlite = {},
} = {}) {
  if (typeof Database !== 'function') {
    throw new Error(
      'better-sqlite3 module is required: pass { driver: { type: "better-sqlite3", Database } }'
    );
  }
  const resolvedDbPath = typeof dbPath === 'string' ? dbPath.trim() : '';
  if (!resolvedDbPath) {
    throw new Error('dbPath is required');
  }

  const normalizedSeed = normalizeTableSeed(seed);
  const now = () => new Date().toISOString();
  const genId = () => crypto.randomUUID();

  const withDb = (fn) => {
    const db = openSqliteDb(Database, resolvedDbPath, sqlite);
    try {
      if (migrateFromJson) {
        maybeMigrateFromJsonSqlite(db, resolvedDbPath, { legacyJsonPath });
      }
      bootstrapSeedSqlite(db, normalizedSeed);
      return fn(db);
    } finally {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  };

  return {
    path: resolvedDbPath,
    snapshot() {
      return withDb((db) => {
        const tables = selectManySqlite(db, 'SELECT DISTINCT table_name as name FROM records')
          .map((row) => row.name)
          .filter(Boolean);
        const state = {};
        tables.forEach((table) => {
          const rows = selectManySqlite(db, 'SELECT id, payload FROM records WHERE table_name = ?', [table]);
          state[table] = rows.map((row) => parsePayload(row.payload)).filter(Boolean);
        });
        return state;
      });
    },
    list(table) {
      return withDb((db) => {
        const rows = selectManySqlite(db, 'SELECT id, payload FROM records WHERE table_name = ?', [table]);
        return rows.map((row) => parsePayload(row.payload)).filter(Boolean);
      });
    },
    get(table, id) {
      return withDb((db) => {
        const row = selectOneSqlite(db, 'SELECT id, payload FROM records WHERE table_name = ? AND id = ?', [
          table,
          id,
        ]);
        return row ? parsePayload(row.payload) : null;
      });
    },
    insert(table, record) {
      return withDb((db) => {
        const payload = record && typeof record === 'object' ? { ...record } : {};
        payload.id = payload.id || genId();
        const ts = now();
        payload.createdAt = payload.createdAt || ts;
        payload.updatedAt = ts;
        execWithChangesSqlite(
          db,
          'INSERT INTO records (table_name, id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          [table, payload.id, JSON.stringify(payload), payload.createdAt, payload.updatedAt]
        );
        return clone(payload);
      });
    },
    update(table, id, patch) {
      return withDb((db) => {
        const existingRow = selectOneSqlite(db, 'SELECT payload FROM records WHERE table_name = ? AND id = ?', [
          table,
          id,
        ]);
        const existing = existingRow ? parsePayload(existingRow.payload) : null;
        if (!existing) return null;
        const merged = {
          ...existing,
          ...(patch && typeof patch === 'object' ? patch : {}),
          id,
          updatedAt: now(),
        };
        execWithChangesSqlite(db, 'UPDATE records SET payload = ?, updated_at = ? WHERE table_name = ? AND id = ?', [
          JSON.stringify(merged),
          merged.updatedAt,
          table,
          id,
        ]);
        return clone(merged);
      });
    },
    remove(table, id) {
      return withDb((db) => {
        const changes = execWithChangesSqlite(db, 'DELETE FROM records WHERE table_name = ? AND id = ?', [table, id]);
        return changes > 0;
      });
    },
    reset(table, records) {
      return withDb((db) => {
        const runReset = db.transaction((list) => {
          execWithChangesSqlite(db, 'DELETE FROM records WHERE table_name = ?', [table]);
          const insert = db.prepare(
            'INSERT INTO records (table_name, id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
          );
          (Array.isArray(list) ? list : []).forEach((item) => {
            const payload = item && typeof item === 'object' ? { ...item } : {};
            if (!payload.id) payload.id = genId();
            const ts = payload.updatedAt || payload.createdAt || now();
            payload.createdAt = payload.createdAt || ts;
            payload.updatedAt = payload.updatedAt || ts;
            insert.run([table, payload.id, JSON.stringify(payload), payload.createdAt, payload.updatedAt]);
          });
          const rows = selectManySqlite(db, 'SELECT id, payload FROM records WHERE table_name = ?', [table]);
          return rows.map((row) => parsePayload(row.payload)).filter(Boolean);
        });
        return runReset(records);
      });
    },
  };
}

export function createDb({
  driver,
  SQL,
  dbPath,
  seed = {},
  migrateFromJson = true,
  legacyJsonPath = '',
  lock = {},
  sqlite = {},
} = {}) {
  const resolvedDriver = driver || (SQL ? { type: 'sql.js', SQL } : null);
  if (!resolvedDriver || !resolvedDriver.type) {
    throw new Error('DB driver is required: pass { driver }');
  }
  const driverType = String(resolvedDriver.type || '').trim().toLowerCase();
  if (driverType === 'sql.js' || driverType === 'sqljs') {
    return createSqlJsDb({ SQL: resolvedDriver.SQL || SQL, dbPath, seed, migrateFromJson, legacyJsonPath, lock });
  }
  if (driverType === 'better-sqlite3' || driverType === 'better-sqlite') {
    const mergedSqlite = { ...(resolvedDriver.sqlite || {}), ...(sqlite || {}) };
    return createBetterSqliteDb({
      Database: resolvedDriver.Database,
      dbPath,
      seed,
      migrateFromJson,
      legacyJsonPath,
      sqlite: mergedSqlite,
    });
  }
  throw new Error(`Unsupported DB driver: ${resolvedDriver.type}`);
}
