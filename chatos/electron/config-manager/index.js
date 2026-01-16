import { ConfigManager } from '../../src/configs/ConfigManager.js';

export function createConfigManager(adminDb, options = {}) {
  if (!adminDb) {
    throw new Error('createConfigManager requires adminDb');
  }
  return new ConfigManager(adminDb, options);
}
