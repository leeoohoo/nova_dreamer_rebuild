export class SubagentConfigManager {
  constructor(configManager) {
    if (!configManager) {
      throw new Error('SubagentConfigManager requires configManager');
    }
    this.configManager = configManager;
  }

  async enableSubagent(configId, subagentId, settings = {}) {
    const subagent = this.getSubagentDetails(subagentId);
    const payload = {
      ...(subagent || {}),
      id: subagent?.id || subagentId,
      enabled: true,
      settings,
    };
    return await this.configManager.addConfigItem(configId, 'subagent', subagentId, payload, { enabled: true });
  }

  async disableSubagent(configId, subagentId) {
    return await this.configManager.updateConfigItem(configId, 'subagent', subagentId, { enabled: false });
  }

  async updateSubagentSettings(configId, subagentId, settings = {}) {
    const existing = await this.configManager.findConfigItem(configId, 'subagent', subagentId);
    if (!existing) return null;
    const nextData = { ...(existing.itemData || {}), settings };
    return await this.configManager.updateConfigItem(configId, 'subagent', subagentId, { itemData: nextData });
  }

  getSubagentDetails(subagentId) {
    if (!subagentId) return null;
    const list = this.configManager.getLegacySubagents?.() || [];
    return list.find((item) => item?.id === subagentId) || { id: subagentId };
  }
}
