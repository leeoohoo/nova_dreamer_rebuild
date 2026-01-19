import { BaseService } from './base-service.js';
import { DEFAULT_RUNTIME_SETTINGS, runtimeSettingsSchema } from '../schema.js';

export class SettingsService extends BaseService {
  constructor(db) {
    super(db, 'settings', runtimeSettingsSchema);
  }

  ensureRuntime(defaults = {}) {
    const LEGACY_DEFAULTS = {
      maxToolPasses: 60,
      mcpTimeoutMs: 300_000,
      mcpMaxTimeoutMs: 600_000,
    };
    const list = this.list();
    const existing = list.find((item) => item?.id === 'runtime') || list[0];
    if (!existing) {
      return this.create({ ...DEFAULT_RUNTIME_SETTINGS, ...defaults });
    }
    const patch = {};
    Object.entries({ ...DEFAULT_RUNTIME_SETTINGS, ...defaults }).forEach(([key, value]) => {
      if (existing[key] === undefined) {
        patch[key] = value;
        return;
      }
      if (Object.prototype.hasOwnProperty.call(LEGACY_DEFAULTS, key)) {
        const current = Number(existing[key]);
        if (Number.isFinite(current) && current === LEGACY_DEFAULTS[key]) {
          patch[key] = value;
        }
      }
    });
    if (Object.keys(patch).length > 0) {
      return this.update(existing.id, patch);
    }
    return existing;
  }

  getRuntime() {
    return this.ensureRuntime();
  }

  saveRuntime(payload = {}) {
    const current = this.ensureRuntime();
    return this.update(current.id, payload);
  }

  getRuntimeConfig() {
    const runtime = this.ensureRuntime();
    if (!runtime) return null;
    const base = { ...DEFAULT_RUNTIME_SETTINGS, ...runtime };
    const normalizeLanguage = (value) => {
      const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
      if (raw === 'zh' || raw === 'en') return raw;
      return DEFAULT_RUNTIME_SETTINGS.promptLanguage;
    };
    const toInt = (value) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : undefined;
    };
    return {
      maxToolPasses: toInt(base.maxToolPasses),
      promptLanguage: normalizeLanguage(base.promptLanguage),
      landConfigId: typeof base.landConfigId === 'string' ? base.landConfigId.trim() : '',
      summaryTokenThreshold: toInt(base.summaryTokenThreshold),
      autoRoute: Boolean(base.autoRoute),
      logRequests: Boolean(base.logRequests),
      streamRaw: Boolean(base.streamRaw),
      toolPreviewLimit: toInt(base.toolPreviewLimit),
      retry: toInt(base.retry),
      mcpTimeoutMs: toInt(base.mcpTimeoutMs),
      mcpMaxTimeoutMs: toInt(base.mcpMaxTimeoutMs),
    };
  }
}
