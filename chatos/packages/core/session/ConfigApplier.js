import { ConfigValidator } from '../../configs/ConfigValidator.js';

export class ConfigApplier {
  constructor({ configManager, adminServices, onApplied, validator, sessionManager } = {}) {
    if (!configManager) throw new Error('ConfigApplier requires configManager');
    if (!adminServices) throw new Error('ConfigApplier requires adminServices');
    this.configManager = configManager;
    this.adminServices = adminServices;
    this.onApplied = typeof onApplied === 'function' ? onApplied : null;
    this.validator = validator || new ConfigValidator();
    this.sessionManager = sessionManager || null;
    this.currentConfigId = null;
    this.isApplying = false;
    this.lastApplied = null;
    this.cancelRequested = false;
  }

  async applyConfig(configId) {
    if (!configId) throw new Error('configId is required');
    if (this.isApplying) throw new Error('配置切换进行中，请稍后重试');
    this.isApplying = true;
    this.cancelRequested = false;
    try {
      const config = await this.configManager.getConfig(configId);
      if (!config) throw new Error('配置不存在');
      const items = await this.configManager.listConfigItems(configId);
      const errors = this.validator?.validateConfig?.({ config, items }) || [];
      if (errors.length > 0) {
        throw new Error(errors.join('；'));
      }
      this.ensureNotCanceled();

      await this.stopActiveSession();
      this.ensureNotCanceled();

      await this.applyConfigItems(items);
      this.ensureNotCanceled();

      await this.configManager.activateConfig(configId);
      this.currentConfigId = configId;
      this.lastApplied = new Date().toISOString();

      await this.startSession(config);
      this.ensureNotCanceled();

      if (this.onApplied) {
        await this.onApplied(config);
      }

      return { ok: true, config: config.name };
    } finally {
      this.isApplying = false;
      this.cancelRequested = false;
    }
  }

  ensureNotCanceled() {
    if (this.cancelRequested) {
      throw new Error('配置切换已取消');
    }
  }

  async stopActiveSession() {
    const manager = this.sessionManager;
    if (!manager) return;
    if (typeof manager.hasActiveSession === 'function' && !manager.hasActiveSession()) return;
    if (typeof manager.stopSession === 'function') {
      await manager.stopSession();
    }
  }

  async startSession(config) {
    const manager = this.sessionManager;
    if (!manager || typeof manager.startSession !== 'function') return;
    await manager.startSession({
      name: config?.name || 'config-session',
      configId: config?.id,
      timestamp: new Date().toISOString(),
    });
  }

  async cancelApply() {
    if (!this.isApplying) {
      return { ok: false, message: '当前没有进行中的切换' };
    }
    this.cancelRequested = true;
    return { ok: true };
  }

  async applyConfigItems(items = []) {
    const grouped = {
      model: [],
      mcp_server: [],
      prompt: [],
      subagent: [],
    };
    items.forEach((item) => {
      if (grouped[item.itemType]) grouped[item.itemType].push(item);
    });

    await this.applyModels(grouped.model);
    this.ensureNotCanceled();
    await this.applyMcpServers(grouped.mcp_server);
    this.ensureNotCanceled();
    await this.applyPrompts(grouped.prompt);
    this.ensureNotCanceled();
    await this.applySubagents(grouped.subagent);
  }

  async applyModels(modelItems) {
    const models = this.adminServices.models;
    const existing = models.list();
    existing.forEach((model) => {
      if (model?.id) models.remove(model.id);
    });
    modelItems.forEach((item) => {
      const payload = item.itemData || { id: item.itemId };
      models.create(payload);
    });
  }

  async applyMcpServers(serverItems) {
    const mcp = this.adminServices.mcpServers;
    const existing = mcp.list();
    existing.forEach((server) => {
      if (server?.id) {
        mcp.update(server.id, { enabled: false });
      }
    });
    serverItems.forEach((item) => {
      const existingServer = existing.find((server) => server?.id === item.itemId);
      const payload = { ...(item.itemData || {}), enabled: item.enabled !== false, id: item.itemId };
      if (existingServer) {
        mcp.update(existingServer.id, payload);
      } else {
        mcp.create(payload);
      }
    });
  }

  async applyPrompts(promptItems) {
    const prompts = this.adminServices.prompts;
    const existing = prompts.list();
    promptItems.forEach((item) => {
      const payload = { ...(item.itemData || {}), id: item.itemId };
      const hit = existing.find((prompt) => prompt?.id === item.itemId);
      if (hit) {
        prompts.update(hit.id, payload);
      } else {
        prompts.create(payload);
      }
    });
  }

  async applySubagents(subagentItems) {
    const subagents = this.adminServices.subagents;
    const existing = subagents.list();
    subagentItems.forEach((item) => {
      const payload = { ...(item.itemData || {}), id: item.itemId };
      const hit = existing.find((subagent) => subagent?.id === item.itemId);
      if (hit) {
        subagents.update(hit.id, payload);
      } else {
        subagents.create(payload);
      }
    });
  }
}
