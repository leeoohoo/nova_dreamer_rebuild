import {
  persistSessionRoot as persistSessionRootCore,
  resolveSessionRoot as resolveSessionRootCore,
} from '../packages/common/state-core/session-root.js';

export function resolveSessionRoot(options = {}) {
  return resolveSessionRootCore({ ...options, fallbackHostApp: 'chatos' });
}

export function persistSessionRoot(sessionRoot, options = {}) {
  return persistSessionRootCore(sessionRoot, { ...options, fallbackHostApp: 'chatos' });
}
