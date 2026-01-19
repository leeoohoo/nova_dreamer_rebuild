const AUTO_EXPAND_IGNORED_DIR_NAMES = new Set(['.git', '.idea']);

export function getPathBaseName(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized) return '';
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

export function isAutoExpandIgnoredDirName(value) {
  const base = getPathBaseName(value);
  if (!base) return false;
  if (AUTO_EXPAND_IGNORED_DIR_NAMES.has(base)) return true;
  return base.startsWith('.');
}

export function normalizeRelPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
}

export function buildExpandedKeys(filePath) {
  const normalized = normalizeRelPath(filePath);
  const parts = normalized.split('/').filter(Boolean);
  const keys = ['.'];
  for (let i = 1; i < parts.length; i += 1) {
    keys.push(parts.slice(0, i).join('/'));
  }
  return keys;
}

export function buildNodes(items = []) {
  return (Array.isArray(items) ? items : []).map((entry, idx) => {
    const key = normalizeRelPath(entry?.path || '') || normalizeRelPath(entry?.name || '') || `unknown-${idx}`;
    const name = entry?.name || key.split('/').pop() || key;
    return {
      key,
      name,
      isDir: Boolean(entry?.isDir),
      isLeaf: !entry?.isDir,
      absolutePath: entry?.absolutePath ?? null,
      isSymlink: Boolean(entry?.isSymlink),
      size: entry?.size ?? null,
      mtime: entry?.mtime ?? null,
      children: undefined,
    };
  });
}

export function updateTreeChildren(list, key, children) {
  return (Array.isArray(list) ? list : []).map((node) => {
    if (node.key === key) return { ...node, children };
    if (node.children) return { ...node, children: updateTreeChildren(node.children, key, children) };
    return node;
  });
}

export function findNodeByKey(list, key) {
  const nodes = Array.isArray(list) ? list : [];
  for (const node of nodes) {
    if (node.key === key) return node;
    const found = node.children ? findNodeByKey(node.children, key) : null;
    if (found) return found;
  }
  return null;
}

export function buildChangeIndex(changeEntries, workspaceRoot) {
  const map = new Map();
  (Array.isArray(changeEntries) ? changeEntries : []).forEach((entry) => {
    const root = typeof entry?.workspaceRoot === 'string' ? entry.workspaceRoot.trim() : '';
    if (!workspaceRoot || root !== workspaceRoot) return;
    const relPath = normalizeRelPath(entry?.path || '');
    if (!relPath || relPath === 'patch') return;
    const ts = typeof entry?.ts === 'string' ? entry.ts : '';
    const prev = map.get(relPath) || { count: 0, lastTs: '', lastType: '', lastEntry: null };
    prev.count += 1;
    if (ts && (!prev.lastTs || ts > prev.lastTs)) {
      prev.lastTs = ts;
      prev.lastType = entry?.changeType || '';
      prev.lastEntry = entry;
    }
    map.set(relPath, prev);
  });
  return map;
}

export function buildChangedDirs(changeIndex) {
  const set = new Set();
  Array.from((changeIndex instanceof Map ? changeIndex : new Map()).keys()).forEach((path) => {
    const parts = String(path || '').split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i += 1) {
      set.add(parts.slice(0, i).join('/'));
    }
  });
  return set;
}

export function changeEntryKey(entry) {
  return [
    String(entry?.ts || ''),
    String(entry?.path || ''),
    String(entry?.changeType || ''),
    String(entry?.tool || ''),
    String(entry?.mode || ''),
    String(entry?.server || ''),
  ].join('|');
}

export function collectDirKeys(nodes) {
  const keys = new Set();
  const walk = (list) => {
    (Array.isArray(list) ? list : []).forEach((node) => {
      if (!node) return;
      const key = typeof node.key === 'string' ? node.key : '';
      if (node.isDir) {
        if (key === '.') {
          keys.add('.');
        } else {
          const name = typeof node.name === 'string' ? node.name.trim() : '';
          const label = name || getPathBaseName(key);
          if (isAutoExpandIgnoredDirName(label)) return;
          keys.add(key);
        }
      }
      if (node.children) walk(node.children);
    });
  };
  walk(nodes);
  return Array.from(keys);
}

