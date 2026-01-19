import { ConfigManager } from '../../packages/configs/ConfigManager.js';

export function createConfigManager(adminDb, options = {}) {
  if (!adminDb) {
    throw new Error('createConfigManager requires adminDb');
  }
  return new ConfigManager(adminDb, options);
}
