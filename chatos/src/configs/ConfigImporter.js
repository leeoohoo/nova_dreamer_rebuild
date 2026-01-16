import fs from 'fs';

export class ConfigImporter {
  constructor(configManager) {
    if (!configManager) {
      throw new Error('ConfigImporter requires configManager');
    }
    this.configManager = configManager;
  }

  async importConfig(configData) {
    return await this.configManager.importConfig(configData);
  }

  async importFromFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    return await this.importConfig(content);
  }
}
