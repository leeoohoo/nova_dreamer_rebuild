import path from 'node:path';
import { createUiAppsBackend } from '../src/backend/index.mjs';
import { ensureDir } from '../src/lib/utils.mjs';

export const createMockHost = async ({ rootDir, pluginId = 'com.example.chatos_scaffold' } = {}) => {
  const stateDir = path.join(rootDir, '.state');
  const dataDir = path.join(stateDir, 'ui_apps', 'data', pluginId);
  await ensureDir(dataDir);

  const backend = await createUiAppsBackend({ pluginId, dataDir, stateDir });

  return {
    stateDir,
    dataDir,
    backend: {
      invoke: async (method, params) => {
        const handler = backend.methods?.[method];
        if (!handler) throw new Error(`Unknown backend method: ${method}`);
        return await handler(params, { pluginId });
      },
    },
  };
};
