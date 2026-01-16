import {
  persistSessionRoot as persistSessionRootCore,
  resolveSessionRoot as resolveSessionRootCore,
} from './common/state-core/session-root.js';

export function resolveSessionRoot() {
  return resolveSessionRootCore({ fallbackHostApp: 'chatos' });
}

export function persistSessionRoot(sessionRoot) {
  return persistSessionRootCore(sessionRoot, { fallbackHostApp: 'chatos' });
}
