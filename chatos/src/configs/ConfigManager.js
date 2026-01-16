import crypto from 'crypto';
import yaml from 'yaml';
import { CONFIG_ITEM_TYPES, CONFIG_ITEMS_TABLE, CONFIG_TABLE } from './db-schema.js';

const DEFAULT_CONFIG_NAME = '默认配置（迁移）';

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

function normalizeType(type) {
  const raw = typeof type === 'string' ? type.trim() : '';
  if (!raw) throw new Error('itemType is required');
  if (!CONFIG_ITEM_TYPES.includes(raw)) {
    throw new Error(`Unsupported itemType: ${raw}`);
  }
  return raw;
}

function sortItems(a, b) {
  const orderA = Number.isFinite(a?.orderIndex) ? a.orderIndex : 0;
  const orderB = Number.isFinite(b?.orderIndex) ? b.orderIndex : 0;
  if (orderA !== orderB) return orderA - orderB;
  const tsA = typeof a?.createdAt === 'string' ? a.createdAt : '';
  const tsB = typeof b?.createdAt === 'string' ? b.createdAt : '';
  return tsA.localeCompare(tsB);
}

export class ConfigManager {
  constructor(db, options = {}) {
    if (!db) throw new Error('ConfigManager requires db');
    this.db = db;
    this.adminServices = options.adminServices || null;
  }

  async createConfig({ name, description = '' } = {}) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) {
      throw new Error('name is required');
    }
    const id = makeId('config');
    const config = {
      id,
      name: trimmed,
      description: typeof description === 'string' ? description : '',
      isActive: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    return this.db.insert(CONFIG_TABLE, config);
  }

  async updateConfig(id, updates = {}) {
    const targetId = typeof id === 'string' ? id.trim() : '';
    if (!targetId) throw new Error('id is required');
    const payload = {};
    if (typeof updates.name === 'string') payload.name = updates.name.trim();
    if (typeof updates.description === 'string') payload.description = updates.description;
    if (typeof updates.isActive === 'boolean') payload.isActive = updates.isActive;
    return this.db.update(CONFIG_TABLE, targetId, payload);
  }

  async deleteConfig(id) {
    const targetId = typeof id === 'string' ? id.trim() : '';
    if (!targetId) throw new Error('id is required');
    const items = await this.listConfigItems(targetId);
    items.forEach((item) => {
      if (item?.id) {
        this.db.remove(CONFIG_ITEMS_TABLE, item.id);
      }
    });
    const removed = this.db.remove(CONFIG_TABLE, targetId);
    return { ok: removed };
  }

  async listConfigs() {
    const configs = this.db.list(CONFIG_TABLE) || [];
    return configs.sort((a, b) => {
      const tsA = typeof a?.updatedAt === 'string' ? a.updatedAt : '';
      const tsB = typeof b?.updatedAt === 'string' ? b.updatedAt : '';
      return tsB.localeCompare(tsA);
    });
  }

  async getConfig(id) {
    const targetId = typeof id === 'string' ? id.trim() : '';
    if (!targetId) return null;
    return this.db.get(CONFIG_TABLE, targetId);
  }

  async activateConfig(id) {
    const targetId = typeof id === 'string' ? id.trim() : '';
    if (!targetId) throw new Error('id is required');
    const configs = this.db.list(CONFIG_TABLE) || [];
    configs.forEach((cfg) => {
      if (!cfg?.id) return;
      if (cfg.id === targetId) return;
      if (cfg.isActive) {
        this.db.update(CONFIG_TABLE, cfg.id, { isActive: false });
      }
    });
    const updated = this.db.update(CONFIG_TABLE, targetId, { isActive: true });
    if (!updated) throw new Error(`config not found: ${targetId}`);
    return { ok: true, configId: targetId };
  }

  async addConfigItem(configId, itemType, itemId, itemData = {}, options = {}) {
    const cfgId = typeof configId === 'string' ? configId.trim() : '';
    const type = normalizeType(itemType);
    const targetItemId = typeof itemId === 'string' ? itemId.trim() : '';
    if (!cfgId) throw new Error('configId is required');
    if (!targetItemId) throw new Error('itemId is required');
    const existing = await this.findConfigItem(cfgId, type, targetItemId);
    const enabled = typeof options.enabled === 'boolean' ? options.enabled : true;
    const orderIndex = Number.isFinite(options.orderIndex) ? options.orderIndex : 0;
    if (existing) {
      return this.db.update(CONFIG_ITEMS_TABLE, existing.id, {
        itemData,
        enabled,
        orderIndex,
      });
    }
    const payload = {
      id: makeId('config_item'),
      configId: cfgId,
      itemType: type,
      itemId: targetItemId,
      itemData,
      enabled,
      orderIndex,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    return this.db.insert(CONFIG_ITEMS_TABLE, payload);
  }

  async removeConfigItem(configId, itemType, itemId) {
    const target = await this.findConfigItem(configId, itemType, itemId);
    if (!target?.id) return { ok: false };
    return { ok: this.db.remove(CONFIG_ITEMS_TABLE, target.id) };
  }

  async updateConfigItem(configId, itemType, itemId, updates = {}) {
    const target = await this.findConfigItem(configId, itemType, itemId);
    if (!target?.id) return null;
    const payload = {};
    if (typeof updates.itemData !== 'undefined') payload.itemData = updates.itemData;
    if (typeof updates.enabled === 'boolean') payload.enabled = updates.enabled;
    if (Number.isFinite(updates.orderIndex)) payload.orderIndex = updates.orderIndex;
    return this.db.update(CONFIG_ITEMS_TABLE, target.id, payload);
  }

  async listConfigItems(configId, itemType) {
    const cfgId = typeof configId === 'string' ? configId.trim() : '';
    if (!cfgId) return [];
    const type = typeof itemType === 'string' && itemType.trim() ? itemType.trim() : '';
    const items = this.db.list(CONFIG_ITEMS_TABLE) || [];
    return items
      .filter((item) => item?.configId === cfgId && (!type || item?.itemType === type))
      .sort(sortItems);
  }

  async getActiveConfig() {
    const configs = this.db.list(CONFIG_TABLE) || [];
    return configs.find((cfg) => cfg?.isActive) || null;
  }

  async exportConfig(id, format = 'json') {
    const config = await this.getConfig(id);
    if (!config) throw new Error('config not found');
    const items = await this.listConfigItems(id);
    const exportData = {
      version: '1.0',
      exportDate: nowIso(),
      app: 'chatos',
      config: {
        ...config,
        items: items.map((item) => ({
          type: item.itemType,
          id: item.itemId,
          data: item.itemData,
          enabled: item.enabled !== false,
          orderIndex: Number.isFinite(item.orderIndex) ? item.orderIndex : 0,
        })),
      },
    };
    if (format === 'json') {
      return JSON.stringify(exportData, null, 2);
    }
    if (format === 'yaml') {
      return yaml.stringify(exportData);
    }
    return exportData;
  }

  async importConfig(configData) {
    const parsed =
      typeof configData === 'string'
        ? (() => {
            try {
              return JSON.parse(configData);
            } catch {
              return yaml.parse(configData);
            }
          })()
        : configData;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid config data');
    }
    const rawConfig = parsed.config || {};
    const name = typeof rawConfig.name === 'string' ? rawConfig.name.trim() : '';
    if (!name) throw new Error('Config name missing');

    const created = await this.createConfig({
      name: `${name} (导入)`,
      description: typeof rawConfig.description === 'string' ? rawConfig.description : '从文件导入',
    });

    const items = Array.isArray(rawConfig.items) ? rawConfig.items : [];
    for (const item of items) {
      const type = normalizeType(item?.type);
      const itemId = typeof item?.id === 'string' ? item.id.trim() : '';
      if (!itemId) continue;
      await this.addConfigItem(created.id, type, itemId, item?.data || {}, {
        enabled: item?.enabled !== false,
        orderIndex: Number.isFinite(item?.orderIndex) ? item.orderIndex : 0,
      });
    }
    return created;
  }

  async migrateLegacyConfig() {
    const configs = await this.listConfigs();
    if (configs.length > 0) return { ok: true, skipped: true };
    const created = await this.createConfig({
      name: DEFAULT_CONFIG_NAME,
      description: '从现有配置迁移而来',
    });
    const models = this.getLegacyModels();
    for (const model of models) {
      if (!model?.id) continue;
      await this.addConfigItem(created.id, 'model', model.id, model);
    }
    const mcpServers = this.getLegacyMcpServers();
    for (const server of mcpServers) {
      if (!server?.id) continue;
      await this.addConfigItem(created.id, 'mcp_server', server.id, server);
    }
    const prompts = this.getLegacyPrompts();
    for (const prompt of prompts) {
      if (!prompt?.id) continue;
      await this.addConfigItem(created.id, 'prompt', prompt.id, prompt);
    }
    const subagents = this.getLegacySubagents();
    for (const subagent of subagents) {
      if (!subagent?.id) continue;
      await this.addConfigItem(created.id, 'subagent', subagent.id, subagent);
    }
    await this.activateConfig(created.id);
    return { ok: true, configId: created.id };
  }

  getLegacyModels() {
    return this.adminServices?.models?.list?.() || this.db.list('models') || [];
  }

  getLegacyMcpServers() {
    return this.adminServices?.mcpServers?.list?.() || this.db.list('mcpServers') || [];
  }

  getLegacyPrompts() {
    return this.adminServices?.prompts?.list?.() || this.db.list('prompts') || [];
  }

  getLegacySubagents() {
    return this.adminServices?.subagents?.list?.() || this.db.list('subagents') || [];
  }

  async findConfigItem(configId, itemType, itemId) {
    const cfgId = typeof configId === 'string' ? configId.trim() : '';
    const type = normalizeType(itemType);
    const targetItemId = typeof itemId === 'string' ? itemId.trim() : '';
    if (!cfgId || !targetItemId) return null;
    const items = this.db.list(CONFIG_ITEMS_TABLE) || [];
    return items.find((item) => item?.configId === cfgId && item?.itemType === type && item?.itemId === targetItemId);
  }
}
