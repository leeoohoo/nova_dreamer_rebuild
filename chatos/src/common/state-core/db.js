import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
const DEFAULT_LOCK_STALE_MS = 30_000;
const DEFAULT_LOCK_POLL_MS = 25;
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

function selectMany(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function selectOne(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function execWithChanges(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  const changes = db.getRowsModified();
  stmt.free();
  return changes;
}

function countRecords(db) {
  const stmt = db.prepare('SELECT COUNT(*) as c FROM records');
  const count = stmt.step() ? stmt.getAsObject().c : 0;
  stmt.free();
  return Number(count) || 0;
}

function bootstrapSeed(db, seed) {
  const hasData = countRecords(db) > 0;
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

function maybeMigrateFromJson(db, dbPath, options = {}) {
  const legacyPath = typeof options.legacyJsonPath === 'string' ? options.legacyJsonPath.trim() : '';
  const candidate = legacyPath || getLegacyJsonPath(dbPath);
  if (!candidate) return false;

  const hasData = countRecords(db) > 0;
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

export function createDb({ SQL, dbPath, seed = {}, migrateFromJson = true, legacyJsonPath = '', lock = {} } = {}) {
  if (!SQL || typeof SQL.Database !== 'function') {
    throw new Error('SQL.js module (initSqlJs result) is required: pass { SQL }');
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

      const beforeInitCount = countRecords(db);
      let migrated = false;
      let seeded = false;
      if (migrateFromJson) {
        migrated = maybeMigrateFromJson(db, resolvedDbPath, { legacyJsonPath });
      }
      seeded = bootstrapSeed(db, normalizedSeed);
      const afterInitCount = countRecords(db);
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
        const tables = selectMany(db, 'SELECT DISTINCT table_name as name FROM records')
          .map((row) => row.name)
          .filter(Boolean);
        const state = {};
        tables.forEach((table) => {
          const rows = selectMany(db, 'SELECT id, payload FROM records WHERE table_name = ?', [table]);
          state[table] = rows.map((row) => parsePayload(row.payload)).filter(Boolean);
        });
        return state;
      });
    },
    list(table) {
      return withDb((db) => {
        const rows = selectMany(db, 'SELECT id, payload FROM records WHERE table_name = ?', [table]);
        return rows.map((row) => parsePayload(row.payload)).filter(Boolean);
      });
    },
    get(table, id) {
      return withDb((db) => {
        const row = selectOne(db, 'SELECT id, payload FROM records WHERE table_name = ? AND id = ?', [table, id]);
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
        execWithChanges(
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
        const existingRow = selectOne(db, 'SELECT payload FROM records WHERE table_name = ? AND id = ?', [table, id]);
        const existing = existingRow ? parsePayload(existingRow.payload) : null;
        if (!existing) return null;
        const merged = {
          ...existing,
          ...(patch && typeof patch === 'object' ? patch : {}),
          id,
          updatedAt: now(),
        };
        execWithChanges(db, 'UPDATE records SET payload = ?, updated_at = ? WHERE table_name = ? AND id = ?', [
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
        const changes = execWithChanges(db, 'DELETE FROM records WHERE table_name = ? AND id = ?', [table, id]);
        if (changes > 0) {
          markDirty();
          return true;
        }
        return false;
      });
    },
    reset(table, records) {
      return withDb((db, { markDirty }) => {
        execWithChanges(db, 'DELETE FROM records WHERE table_name = ?', [table]);
        (Array.isArray(records) ? records : []).forEach((item) => {
          const payload = item && typeof item === 'object' ? { ...item } : {};
          if (!payload.id) payload.id = genId();
          const ts = payload.updatedAt || payload.createdAt || now();
          payload.createdAt = payload.createdAt || ts;
          payload.updatedAt = payload.updatedAt || ts;
          execWithChanges(
            db,
            'INSERT INTO records (table_name, id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
            [table, payload.id, JSON.stringify(payload), payload.createdAt, payload.updatedAt]
          );
        });
        markDirty();
        const rows = selectMany(db, 'SELECT id, payload FROM records WHERE table_name = ?', [table]);
        return rows.map((row) => parsePayload(row.payload)).filter(Boolean);
      });
    },
  };
}

