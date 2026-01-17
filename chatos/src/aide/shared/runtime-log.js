import { createRuntimeLogger as createRuntimeLoggerCore, resolveRuntimeLogPath as resolveRuntimeLogPathCore } from '../../common/state-core/runtime-log.js';

export function resolveRuntimeLogPath(options = {}) {
  return resolveRuntimeLogPathCore({ ...options, fallbackHostApp: 'aide' });
}

export function createRuntimeLogger(options = {}) {
  return createRuntimeLoggerCore({ ...options, fallbackHostApp: 'aide' });
}
