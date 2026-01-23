import { BaseService } from './base-service.js';
import { mcpServerSchema } from '../schema.js';
import { getHostApp } from '../../host-app.js';

export class McpService extends BaseService {
  constructor(db) {
    super(db, 'mcpServers', mcpServerSchema);
    this.appId = getHostApp() || 'chatos';
    this.#maybeBackfillAppId();
  }

  #normalizeAppId(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  #isUiAppServer(record) {
    const tags = Array.isArray(record?.tags) ? record.tags : [];
    return tags
      .map((tag) => String(tag || '').trim().toLowerCase())
      .filter(Boolean)
      .some((tag) => tag === 'uiapp' || tag.startsWith('uiapp:'));
  }

  #maybeBackfillAppId() {
    const host = this.#normalizeAppId(this.appId);
    if (!host) return;
    const all = this.db.list(this.tableName) || [];
    all.forEach((record) => {
      const id = record?.id;
      if (!id) return;
      const current = this.#normalizeAppId(record?.app_id);
      if (current) return;

      // Heuristic migration for legacy records with no app_id:
      // - UI Apps servers (tagged with uiapp) always belong to ChatOS host
      // - ChatOS claims all remaining legacy servers
      // - other hosts only claim locked/builtin servers (avoid stealing legacy user config from ChatOS)
      let next = '';
      if (this.#isUiAppServer(record)) {
        next = 'chatos';
      } else if (host === 'chatos') {
        next = 'chatos';
      } else if (record?.locked === true) {
        next = host;
      } else {
        return;
      }
      try {
        this.db.update(this.tableName, id, { app_id: next });
      } catch {
        // ignore migration errors
      }
    });
  }

  normalizeName(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  #matchesApp(record) {
    const host = this.#normalizeAppId(this.appId);
    if (!host) return true;
    // UI Apps 暴露的 MCP servers 只应在 ChatOS(host=chatos) 里可见/可用；
    // 独立 host 只使用内置/用户自定义的 MCP，不接纳 UIApp 的 MCP 列表。
    if (host !== 'chatos' && this.#isUiAppServer(record)) {
      return false;
    }
    const appId = this.#normalizeAppId(record?.app_id);
    return appId === host;
  }

  list() {
    return (super.list() || []).filter((record) => this.#matchesApp(record));
  }

  get(id) {
    const record = super.get(id);
    if (!record) return null;
    return this.#matchesApp(record) ? record : null;
  }

  create(payload) {
    const normalized = payload && typeof payload === 'object' ? { ...payload } : {};
    normalized.app_id = this.appId;
    return super.create(normalized);
  }

  update(id, payload) {
    const existing = super.get(id);
    if (!existing) return null;
    if (!this.#matchesApp(existing)) {
      throw new Error('MCP Server 不属于当前应用');
    }
    if (existing?.locked) {
      const keys = payload && typeof payload === 'object' ? Object.keys(payload) : [];
      const allowedKeys = new Set(['enabled']);
      const disallowed = keys.filter((key) => !allowedKeys.has(key));
      const hasAllowedUpdate = keys.some((key) => allowedKeys.has(key));
      if (disallowed.length > 0 || !hasAllowedUpdate) {
        throw new Error('该 MCP Server 为内置配置，仅允许调整启用状态');
      }
    }
    if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'app_id')) {
      throw new Error('禁止修改 MCP Server 的 app_id');
    }
    return super.update(id, payload);
  }

  remove(id) {
    const existing = super.get(id);
    if (!existing) return false;
    if (!this.#matchesApp(existing)) {
      throw new Error('MCP Server 不属于当前应用');
    }
    if (existing?.locked) {
      throw new Error('该 MCP Server 为内置配置，禁止删除');
    }
    return super.remove(id);
  }
}
