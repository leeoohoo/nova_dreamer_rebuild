import fs from 'fs';

export class ConfigExporter {
  constructor(configManager) {
    if (!configManager) {
      throw new Error('ConfigExporter requires configManager');
    }
    this.configManager = configManager;
  }

  async exportConfig(configId, format = 'json') {
    return await this.configManager.exportConfig(configId, format);
  }

  async exportToFile(configId, filePath, format = 'json') {
    const content = await this.exportConfig(configId, format);
    fs.writeFileSync(filePath, content, 'utf8');
    return { ok: true, filePath };
  }
}
