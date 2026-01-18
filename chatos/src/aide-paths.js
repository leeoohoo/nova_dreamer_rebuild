import { resolveEngineFileUrl, resolveEnginePath, resolveEngineRoot } from './engine-paths.js';

export function resolveAideRoot(options) {
  return resolveEngineRoot(options);
}

export function resolveAidePath(options) {
  return resolveEnginePath(options);
}

export function resolveAideFileUrl(options) {
  return resolveEngineFileUrl(options);
}
