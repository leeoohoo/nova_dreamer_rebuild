import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import initSqlJs from 'sql.js';
import { resolveAppDbFileName, resolveAppStateDir } from '../../src/common/state-core/state-paths.js';
import { normalizeHostApp } from '../../src/common/state-core/utils.js';

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

function normalizeRecordTags(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = parseJsonSafe(value);
    if (Array.isArray(parsed)) return parsed;
  }
  return [];
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

export function resolveExistingAppDbPath({ sessionRoot, hostApp }) {
  const normalized = normalizeHostApp(hostApp);
  if (!normalized) {
    return {
      hostApp: '',
      stateDir: '',
      dbPath: '',
      dbExists: false,
      desiredDbPath: '',
      legacyDbPath: '',
    };
  }

  const stateDir = resolveAppStateDir(sessionRoot, { hostApp: normalized, fallbackHostApp: normalized });
  const desiredDbPath = stateDir ? path.join(stateDir, resolveAppDbFileName(normalized)) : '';
  const legacyDbPath = stateDir ? path.join(stateDir, 'admin.db.sqlite') : '';

  const desiredExists = Boolean(desiredDbPath && fs.existsSync(desiredDbPath));
  const legacyExists = Boolean(legacyDbPath && fs.existsSync(legacyDbPath));
  const dbPath = desiredExists ? desiredDbPath : legacyExists ? legacyDbPath : desiredDbPath;

  return {
    hostApp: normalized,
    stateDir,
    dbPath,
    dbExists: Boolean(dbPath && fs.existsSync(dbPath)),
    desiredDbPath,
    legacyDbPath,
  };
}

export async function syncRegistryFromAppDb({ registry, providerAppId, dbPath } = {}) {
  if (!registry) throw new Error('registry is required');
  const provider = normalizeHostApp(providerAppId);
  if (!provider) throw new Error('providerAppId is required');
  const resolvedDbPath = typeof dbPath === 'string' ? dbPath.trim() : '';
  if (!resolvedDbPath) return { ok: true, providerAppId: provider, dbPath: '', synced: false, servers: 0, prompts: 0 };
  if (!fs.existsSync(resolvedDbPath)) {
    return { ok: true, providerAppId: provider, dbPath: resolvedDbPath, synced: false, servers: 0, prompts: 0 };
  }

  const SQL = await getSql();
  const servers = readDbTable({ SQL, dbPath: resolvedDbPath, tableName: 'mcpServers' });
  const prompts = readDbTable({ SQL, dbPath: resolvedDbPath, tableName: 'prompts' });

  let serverCount = 0;
  (Array.isArray(servers) ? servers : []).forEach((srv) => {
    const name = typeof srv?.name === 'string' ? srv.name.trim() : '';
    const url = typeof srv?.url === 'string' ? srv.url.trim() : '';
    if (!name || !url) return;
    const appId = normalizeHostApp(srv?.app_id);
    if (appId && appId !== provider) return;

    try {
      registry.registerMcpServer(provider, {
        id: name,
        name,
        url,
        description: typeof srv?.description === 'string' ? srv.description : '',
        tags: normalizeRecordTags(srv?.tags),
        enabled: typeof srv?.enabled === 'boolean' ? srv.enabled : srv?.enabled !== false,
        allowMain: typeof srv?.allowMain === 'boolean' ? srv.allowMain : srv?.allowMain === true,
        allowSub: typeof srv?.allowSub === 'boolean' ? srv.allowSub : srv?.allowSub !== false,
        auth: srv?.auth || undefined,
      });
      serverCount += 1;
    } catch {
      // ignore individual record failures
    }
  });

  let promptCount = 0;
  (Array.isArray(prompts) ? prompts : []).forEach((prompt) => {
    const name = typeof prompt?.name === 'string' ? prompt.name.trim() : '';
    const content = typeof prompt?.content === 'string' ? prompt.content : '';
    if (!name || !content.trim()) return;
    try {
      registry.registerPrompt(provider, {
        id: name,
        name,
        title: typeof prompt?.title === 'string' ? prompt.title : '',
        type: typeof prompt?.type === 'string' ? prompt.type : 'system',
        content,
        allowMain: typeof prompt?.allowMain === 'boolean' ? prompt.allowMain : prompt?.allowMain !== false,
        allowSub: typeof prompt?.allowSub === 'boolean' ? prompt.allowSub : prompt?.allowSub === true,
      });
      promptCount += 1;
    } catch {
      // ignore individual record failures
    }
  });

  return {
    ok: true,
    providerAppId: provider,
    dbPath: resolvedDbPath,
    synced: true,
    servers: serverCount,
    prompts: promptCount,
  };
}

export function syncRegistryFromServices({ registry, providerAppId, services } = {}) {
  if (!registry) throw new Error('registry is required');
  const provider = normalizeHostApp(providerAppId);
  if (!provider) throw new Error('providerAppId is required');
  if (!services?.mcpServers || !services?.prompts) {
    return { ok: true, providerAppId: provider, synced: false, servers: 0, prompts: 0 };
  }

  let servers = [];
  let prompts = [];
  try {
    servers = services.mcpServers.list ? services.mcpServers.list() : [];
  } catch {
    servers = [];
  }
  try {
    prompts = services.prompts.list ? services.prompts.list() : [];
  } catch {
    prompts = [];
  }

  let serverCount = 0;
  (Array.isArray(servers) ? servers : []).forEach((srv) => {
    const name = typeof srv?.name === 'string' ? srv.name.trim() : '';
    const url = typeof srv?.url === 'string' ? srv.url.trim() : '';
    if (!name || !url) return;
    try {
      registry.registerMcpServer(provider, {
        id: name,
        name,
        url,
        description: typeof srv?.description === 'string' ? srv.description : '',
        tags: normalizeRecordTags(srv?.tags),
        enabled: typeof srv?.enabled === 'boolean' ? srv.enabled : srv?.enabled !== false,
        allowMain: typeof srv?.allowMain === 'boolean' ? srv.allowMain : srv?.allowMain === true,
        allowSub: typeof srv?.allowSub === 'boolean' ? srv.allowSub : srv?.allowSub !== false,
        auth: srv?.auth || undefined,
      });
      serverCount += 1;
    } catch {
      // ignore
    }
  });

  let promptCount = 0;
  (Array.isArray(prompts) ? prompts : []).forEach((prompt) => {
    const name = typeof prompt?.name === 'string' ? prompt.name.trim() : '';
    const content = typeof prompt?.content === 'string' ? prompt.content : '';
    if (!name || !content.trim()) return;
    try {
      registry.registerPrompt(provider, {
        id: name,
        name,
        title: typeof prompt?.title === 'string' ? prompt.title : '',
        type: typeof prompt?.type === 'string' ? prompt.type : 'system',
        content,
        allowMain: typeof prompt?.allowMain === 'boolean' ? prompt.allowMain : prompt?.allowMain !== false,
        allowSub: typeof prompt?.allowSub === 'boolean' ? prompt.allowSub : prompt?.allowSub === true,
      });
      promptCount += 1;
    } catch {
      // ignore
    }
  });

  return { ok: true, providerAppId: provider, synced: true, servers: serverCount, prompts: promptCount };
}
