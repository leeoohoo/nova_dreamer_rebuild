export class ConfigSynchronizer {
  constructor({ configManager, adminServices } = {}) {
    if (!configManager) {
      throw new Error('ConfigSynchronizer requires configManager');
    }
    if (!adminServices) {
      throw new Error('ConfigSynchronizer requires adminServices');
    }
    this.configManager = configManager;
    this.adminServices = adminServices;
  }

  async applyConfig(configId) {
    const config = await this.configManager.getConfig(configId);
    if (!config) throw new Error('配置不存在');
    const items = await this.configManager.listConfigItems(configId);
    await this.applyConfigItems(items);
    return { ok: true, applied: items.length };
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
    await this.applyMcpServers(grouped.mcp_server);
    await this.applyPrompts(grouped.prompt);
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
