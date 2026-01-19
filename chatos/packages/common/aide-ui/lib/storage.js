export const RUN_FILTER_STORAGE_KEY = 'deepseek_cli.ui.runFilter';
export const RUN_FILTER_AUTO = '__auto__';
export const RUN_FILTER_ALL = 'all';
export const RUN_FILTER_UNKNOWN = '__unknown__';
export const THEME_STORAGE_KEY = 'deepseek_cli.ui.theme';
export const DISPATCH_CWD_STORAGE_KEY = 'deepseek_cli.ui.dispatchCwd';
export const HIDDEN_RUNS_STORAGE_KEY = 'deepseek_cli.ui.hiddenRunIds';
export const WORKSPACE_ROOT_STORAGE_KEY_PREFIX = 'deepseek_cli.ui.workspaceRoot';
export const WORKSPACE_EXPLORER_SPLIT_WIDTH_KEY_PREFIX = 'deepseek_cli.ui.workspaceExplorer.splitLeftWidth';
export const WORKSPACE_EXPLORER_AUTO_OPEN_HISTORY_KEY = 'deepseek_cli.ui.workspaceExplorer.autoOpenHistory';
export const FLOATING_ISLAND_COLLAPSED_STORAGE_KEY = 'deepseek_cli.ui.floatingIsland.collapsed';

export function safeLocalStorageGet(key) {
  try {
    if (!window?.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeLocalStorageSet(key, value) {
  try {
    if (!window?.localStorage) return;
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage errors
  }
}

export function buildWorkspaceRootStorageKey(runScope) {
  const normalized = typeof runScope === 'string' ? runScope.trim() : '';
  const suffix = normalized || RUN_FILTER_ALL;
  return `${WORKSPACE_ROOT_STORAGE_KEY_PREFIX}:${suffix}`;
}

export function buildWorkspaceExplorerSplitWidthStorageKey(runScope) {
  const normalized = typeof runScope === 'string' ? runScope.trim() : '';
  const suffix = normalized || RUN_FILTER_ALL;
  return `${WORKSPACE_EXPLORER_SPLIT_WIDTH_KEY_PREFIX}:${suffix}`;
}
