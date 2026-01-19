import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Space, Tag, Typography, message } from 'antd';
import { useElementHeight, useElementWidth } from '../../hooks/useElementSize.js';
import { api, hasApi } from '../../lib/api.js';
import {
  RUN_FILTER_ALL,
  RUN_FILTER_UNKNOWN,
  buildWorkspaceExplorerSplitWidthStorageKey,
  buildWorkspaceRootStorageKey,
  WORKSPACE_EXPLORER_AUTO_OPEN_HISTORY_KEY,
  safeLocalStorageGet,
  safeLocalStorageSet,
} from '../../lib/storage.js';
import { normalizeRunId } from '../../lib/runs.js';
import { setAideDragData } from '../../lib/dnd.js';
import { WorkspaceExplorerLayout } from './WorkspaceExplorerLayout.jsx';
import {
  buildChangeIndex,
  buildChangedDirs,
  buildExpandedKeys,
  buildNodes,
  collectDirKeys,
  findNodeByKey,
  isAutoExpandIgnoredDirName,
  normalizeRelPath,
  updateTreeChildren,
  changeEntryKey,
} from './WorkspaceExplorerView.helpers.js';

const { Text } = Typography;

function WorkspaceExplorerView({ fileChanges, runs, selection, onSelectionApplied, runScope }) {
  const changeEntries = useMemo(
    () => (Array.isArray(fileChanges?.entries) ? fileChanges.entries : []),
    [fileChanges]
  );
  const runEntries = useMemo(() => (Array.isArray(runs?.entries) ? runs.entries : []), [runs]);

  const runRootMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(runEntries) ? runEntries : []).forEach((entry) => {
      const runId = normalizeRunId(entry?.runId);
      if (!runId) return;
      const root =
        typeof entry?.workspaceRoot === 'string'
          ? entry.workspaceRoot.trim()
          : typeof entry?.cwd === 'string'
            ? entry.cwd.trim()
            : '';
      if (!root) return;
      const ts = typeof entry?.ts === 'string' ? entry.ts : '';
      const prev = map.get(runId);
      if (!prev || (ts && (!prev.ts || ts > prev.ts))) {
        map.set(runId, { root, ts });
      }
    });
    return map;
  }, [runEntries]);

  const suggestedRoot = useMemo(() => {
    const scope = typeof runScope === 'string' ? runScope.trim() : '';
    if (scope && scope !== RUN_FILTER_ALL && scope !== RUN_FILTER_UNKNOWN) {
      return runRootMap.get(scope)?.root || '';
    }
    let best = { root: '', ts: '' };
    runRootMap.forEach((value) => {
      if (!value?.root) return;
      if (!best.root || (value.ts && (!best.ts || value.ts > best.ts))) {
        best = value;
      }
    });
    return best.root || '';
  }, [runScope, runRootMap]);

  const availableRoots = useMemo(() => {
    const roots = new Set();
    if (suggestedRoot) roots.add(suggestedRoot);
    changeEntries.forEach((entry) => {
      const root = typeof entry?.workspaceRoot === 'string' ? entry.workspaceRoot.trim() : '';
      if (root) roots.add(root);
    });
    runRootMap.forEach((value) => {
      if (value?.root) roots.add(value.root);
    });
    return Array.from(roots);
  }, [changeEntries, runRootMap, suggestedRoot]);

  const latestRoot = useMemo(() => {
    let best = { root: '', ts: '' };
    changeEntries.forEach((entry) => {
      const root = typeof entry?.workspaceRoot === 'string' ? entry.workspaceRoot.trim() : '';
      const ts = typeof entry?.ts === 'string' ? entry.ts : '';
      if (!root || !ts) return;
      if (!best.root || ts > best.ts) {
        best = { root, ts };
      }
    });
    return best.root || '';
  }, [changeEntries]);

  const fallbackRoot = suggestedRoot || latestRoot || '';
  const fallbackRootRef = useRef(fallbackRoot);
  useEffect(() => {
    fallbackRootRef.current = fallbackRoot;
  }, [fallbackRoot]);

  const workspaceRootStorageKey = useMemo(() => buildWorkspaceRootStorageKey(runScope), [runScope]);
  const [workspaceRoot, setWorkspaceRoot] = useState(() => {
    const stored = safeLocalStorageGet(workspaceRootStorageKey);
    const fromSelection = typeof selection?.workspaceRoot === 'string' ? selection.workspaceRoot.trim() : '';
    return fromSelection || stored || fallbackRoot || '';
  });
  const [manualRoot, setManualRoot] = useState('');
  const [pendingSelection, setPendingSelection] = useState(null);

  const [treeNodes, setTreeNodes] = useState([]);
  const treeNodesRef = useRef([]);
  useLayoutEffect(() => {
    treeNodesRef.current = treeNodes;
  }, [treeNodes]);

  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState(null);
  const [treeMeta, setTreeMeta] = useState(null);
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const [expandedKeys, setExpandedKeys] = useState(['.']);
  const [selectedKeys, setSelectedKeys] = useState([]);

  const [fileTarget, setFileTarget] = useState(null);
  const [fileReadKey, setFileReadKey] = useState(0);
  const [fileView, setFileView] = useState({ loading: false, error: null, payload: null });

  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeDiffKey, setActiveDiffKey] = useState(null);
  const [autoOpenHistoryOnSelect, setAutoOpenHistoryOnSelect] = useState(() => {
    const raw = safeLocalStorageGet(WORKSPACE_EXPLORER_AUTO_OPEN_HISTORY_KEY);
    const stored = typeof raw === 'string' ? raw.trim() : '';
    if (stored === '0') return false;
    if (stored === '1') return true;
    return true;
  });

  const splitViewRef = useRef(null);
  const splitViewWidth = useElementWidth(splitViewRef, 0);
  const [splitViewHeight, setSplitViewHeight] = useState(640);
  const treeViewportRef = useRef(null);
  const previewViewportRef = useRef(null);
  const treeViewportHeight = useElementHeight(treeViewportRef, 520);
  const treeViewportWidth = useElementWidth(treeViewportRef, 360);
  const previewViewportHeight = useElementHeight(previewViewportRef, 520);

  const splitWidthStorageKey = useMemo(() => buildWorkspaceExplorerSplitWidthStorageKey(runScope), [runScope]);
  const splitResizeRef = useRef(null);
  const [isResizingSplit, setIsResizingSplit] = useState(false);

  const splitMinLeft = 260;
  const splitMinRight = 320;
  const splitHandleWidth = 8;
  const splitGap = 12;

  const splitMaxLeft = useMemo(() => {
    const width = Number.isFinite(splitViewWidth) && splitViewWidth > 0 ? splitViewWidth : 0;
    if (!width) return 900;
    return Math.max(splitMinLeft, Math.floor(width - splitMinRight - splitHandleWidth - splitGap * 2));
  }, [splitViewWidth]);

  const [treePaneWidth, setTreePaneWidth] = useState(() => {
    const stored = safeLocalStorageGet(splitWidthStorageKey);
    const parsed = stored ? parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 360;
  });

  useEffect(() => {
    const stored = safeLocalStorageGet(splitWidthStorageKey);
    const parsed = stored ? parseInt(stored, 10) : NaN;
    const next = Number.isFinite(parsed) && parsed > 0 ? parsed : 360;
    setTreePaneWidth(next);
  }, [splitWidthStorageKey]);

  useEffect(() => {
    if (!splitViewWidth) return;
    setTreePaneWidth((prev) => Math.min(Math.max(prev, splitMinLeft), splitMaxLeft));
  }, [splitViewWidth, splitMaxLeft]);

  useEffect(() => {
    if (!isResizingSplit) return;
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
  }, [isResizingSplit]);

  const handleSplitterPointerDown = (event) => {
    if (event.pointerType === 'mouse' && typeof event.button === 'number' && event.button !== 0) return;
    const container = splitViewRef.current;
    const rect = container?.getBoundingClientRect();
    const containerWidth = rect?.width || 0;
    const maxWidth = containerWidth
      ? Math.max(splitMinLeft, Math.floor(containerWidth - splitMinRight - splitHandleWidth - splitGap * 2))
      : splitMaxLeft;
    splitResizeRef.current = {
      startX: event.clientX,
      startWidth: treePaneWidth,
      minWidth: splitMinLeft,
      maxWidth,
      lastWidth: treePaneWidth,
      pointerId: event.pointerId,
    };
    setIsResizingSplit(true);
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleSplitterPointerMove = (event) => {
    const state = splitResizeRef.current;
    if (!state) return;
    const delta = event.clientX - state.startX;
    const next = Math.round(Math.min(Math.max(state.startWidth + delta, state.minWidth), state.maxWidth));
    state.lastWidth = next;
    setTreePaneWidth(next);
    event.preventDefault();
  };

  const stopSplitterResize = (event) => {
    const state = splitResizeRef.current;
    if (!state) return;
    splitResizeRef.current = null;
    setIsResizingSplit(false);
    safeLocalStorageSet(splitWidthStorageKey, String(state.lastWidth));
    try {
      event.currentTarget.releasePointerCapture(state.pointerId);
    } catch {
      // ignore
    }
  };

  useLayoutEffect(() => {
    if (!workspaceRoot) return;

    const compute = () => {
      const el = splitViewRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const bottomPadding = 16;
      const next = Math.max(360, Math.floor(window.innerHeight - rect.top - bottomPadding));
      setSplitViewHeight((prev) => (Math.abs(prev - next) <= 1 ? prev : next));
    };

    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [workspaceRoot]);

  const workspaceLabel = useMemo(() => {
    const root = String(workspaceRoot || '').replace(/[\\/]+$/, '');
    if (!root) return 'workspace';
    const parts = root.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || root;
  }, [workspaceRoot]);

  const didInitScopeRef = useRef(false);
  useEffect(() => {
    if (!didInitScopeRef.current) {
      didInitScopeRef.current = true;
      return;
    }
    const stored = safeLocalStorageGet(workspaceRootStorageKey);
    const next = stored || fallbackRootRef.current || '';
    setWorkspaceRoot(next);
    setManualRoot('');
  }, [workspaceRootStorageKey]);

  useEffect(() => {
    if (workspaceRoot) {
      safeLocalStorageSet(workspaceRootStorageKey, workspaceRoot);
    }
  }, [workspaceRoot, workspaceRootStorageKey]);

  useEffect(() => {
    if (workspaceRoot) return;
    const stored = safeLocalStorageGet(workspaceRootStorageKey);
    if (stored) {
      setWorkspaceRoot(stored);
      return;
    }
    if (fallbackRoot) setWorkspaceRoot(fallbackRoot);
  }, [workspaceRoot, fallbackRoot, workspaceRootStorageKey]);

  useEffect(() => {
    if (!selection) return;
    setPendingSelection(selection);
    const selRoot = typeof selection?.workspaceRoot === 'string' ? selection.workspaceRoot.trim() : '';
    if (selRoot) setWorkspaceRoot(selRoot);
  }, [selection]);

  useEffect(() => {
    setTreeNodes([]);
    setTreeMeta(null);
    setTreeError(null);
    setExpandedKeys(['.']);
    setSelectedKeys([]);
    setFileTarget(null);
    setFileView({ loading: false, error: null, payload: null });
    setHistoryOpen(false);
    setActiveDiffKey(null);
  }, [workspaceRoot, runScope]);

  useEffect(() => {
    let cancelled = false;
    async function loadRootDir() {
      if (!hasApi || !workspaceRoot) return;
      setTreeLoading(true);
      setTreeError(null);
      setTreeMeta(null);
      setTreeNodes([{ key: '.', name: workspaceLabel, isDir: true, isLeaf: false, children: undefined }]);
      try {
        const data = await api.invoke('dir:list', { workspaceRoot, path: '.' });
        if (cancelled) return;
        setTreeNodes([
          {
            key: '.',
            name: workspaceLabel,
            isDir: true,
            isLeaf: false,
            absolutePath: data?.path || null,
            children: buildNodes(data?.entries || []),
          },
        ]);
        const firstDir = (Array.isArray(data?.entries) ? data.entries : []).find(
          (entry) => entry?.isDir && !isAutoExpandIgnoredDirName(entry?.name || entry?.path || '')
        );
        const firstDirKey = firstDir ? normalizeRelPath(firstDir.path || firstDir.name || '') : '';
        if (firstDirKey) {
          setExpandedKeys((prev) => {
            const keys = Array.isArray(prev) ? prev : [];
            const nonRoot = keys.filter((k) => k && k !== '.');
            if (nonRoot.length > 0) return keys;
            const withRoot = keys.includes('.') ? keys : ['.', ...keys];
            return withRoot.includes(firstDirKey) ? withRoot : [...withRoot, firstDirKey];
          });
        }
        setTreeMeta(
          data
            ? {
                path: data.path || null,
                truncated: Boolean(data.truncated),
                maxEntries: typeof data.maxEntries === 'number' ? data.maxEntries : null,
              }
            : null
        );
        setTreeLoading(false);
      } catch (err) {
        if (cancelled) return;
        setTreeLoading(false);
        setTreeError(err?.message || String(err));
      }
    }
    loadRootDir();
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot, workspaceLabel, treeRefreshKey, runScope]);

  const ensureDirLoaded = async (dirKey) => {
    if (!hasApi || !workspaceRoot) return;
    const normalized = normalizeRelPath(dirKey);
    const current = treeNodesRef.current;
    const target = findNodeByKey(current, normalized);
    if (target && (target.isLeaf || target.children)) return;

    try {
      const data = await api.invoke('dir:list', { workspaceRoot, path: normalized });
      const children = buildNodes(data?.entries || []);
      setTreeNodes((origin) => updateTreeChildren(origin, normalized, children));
    } catch (err) {
      message.error(err?.message || '读取目录失败');
    }
  };

  const handleLoadTreeData = async (node) => {
    const key = node?.key;
    if (!key || key === '.') return;
    await ensureDirLoaded(key);
  };

  useEffect(() => {
    let cancelled = false;
    async function applyPendingSelection() {
      if (!pendingSelection) return;
      const selRoot = typeof pendingSelection?.workspaceRoot === 'string' ? pendingSelection.workspaceRoot.trim() : '';
      if (selRoot && selRoot !== workspaceRoot) return;

      const relPath = normalizeRelPath(pendingSelection?.path || '');
      const absPath = typeof pendingSelection?.absolutePath === 'string' ? pendingSelection.absolutePath.trim() : '';
      if (relPath) {
        const expandKeys = buildExpandedKeys(relPath);
        setExpandedKeys(expandKeys);
        setSelectedKeys([relPath]);
        setFileTarget({ path: relPath, absolutePath: absPath });
        setFileReadKey((k) => k + 1);
        setHistoryOpen(true);
        setActiveDiffKey(null);
        for (let i = 1; i < expandKeys.length; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await ensureDirLoaded(expandKeys[i]);
          if (cancelled) return;
        }
      } else if (absPath) {
        setFileTarget({ path: '', absolutePath: absPath });
        setFileReadKey((k) => k + 1);
      }
      setPendingSelection(null);
      if (typeof onSelectionApplied === 'function') onSelectionApplied();
    }
    applyPendingSelection();
    return () => {
      cancelled = true;
    };
  }, [pendingSelection, workspaceRoot, onSelectionApplied]);

  useEffect(() => {
    let cancelled = false;
    async function loadFile() {
      if (!hasApi || !workspaceRoot) return;
      if (!fileTarget || !(fileTarget.absolutePath || fileTarget.path)) return;
      setFileView({ loading: true, error: null, payload: null });
      try {
        const data = await api.invoke('file:read', {
          workspaceRoot,
          path: fileTarget.path,
          absolutePath: fileTarget.absolutePath,
        });
        if (cancelled) return;
        setFileView({ loading: false, error: null, payload: data || null });
      } catch (err) {
        if (cancelled) return;
        setFileView({ loading: false, error: err?.message || String(err), payload: null });
      }
    }
    loadFile();
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot, fileTarget, fileReadKey]);

  const changeIndex = useMemo(() => {
    return buildChangeIndex(changeEntries, workspaceRoot);
  }, [changeEntries, workspaceRoot]);

  const changedDirs = useMemo(() => {
    return buildChangedDirs(changeIndex);
  }, [changeIndex]);

  const renderNodeTitle = (node) => {
    const isRoot = node.key === '.';
    const relKey = isRoot ? '' : node.key;
    const meta = relKey ? changeIndex.get(relKey) : null;
    const isDirChanged = !meta && node.isDir && relKey && changedDirs.has(relKey);
    const changeType = meta?.lastType || '';
    const color =
      changeType === 'deleted'
        ? '#ff4d4f'
        : changeType === 'created'
          ? '#52c41a'
          : meta || isDirChanged
            ? '#faad14'
            : undefined;
    const background =
      changeType === 'deleted'
        ? 'var(--ds-change-bg-error)'
        : changeType === 'created'
          ? 'var(--ds-change-bg-success)'
          : meta
            ? 'var(--ds-change-bg-warning)'
            : isDirChanged
              ? 'var(--ds-change-bg-warning)'
              : undefined;
    const badgeColor =
      changeType === 'deleted' ? 'red' : changeType === 'created' ? 'green' : meta ? 'gold' : null;
    const labelStyle = background
      ? { background, borderRadius: 4, padding: '0 4px', color, fontWeight: meta ? 600 : undefined }
      : color
        ? { color, fontWeight: meta ? 600 : undefined }
        : undefined;

    const handleDragStart = (event) => {
      if (isRoot) return;
      const relPath = normalizeRelPath(node.key);
      if (!relPath) return;
      const absolutePath = typeof node.absolutePath === 'string' ? node.absolutePath : '';
      setAideDragData(
        event,
        {
          kind: 'workspace_node',
          workspaceRoot,
          path: relPath,
          absolutePath,
          isDir: Boolean(node.isDir),
        },
        absolutePath || relPath
      );
      event.stopPropagation();
    };

    return (
      <div
        draggable={!isRoot}
        onDragStart={handleDragStart}
        style={{ display: 'inline-flex', maxWidth: '100%', cursor: isRoot ? 'default' : 'grab' }}
      >
        <Space size={6} wrap={false} style={{ maxWidth: '100%' }}>
          <Text style={{ ...(labelStyle || {}), whiteSpace: 'nowrap' }}>{node.name}</Text>
          {meta ? <Tag color={badgeColor || 'gold'}>{meta.count}</Tag> : null}
        </Space>
      </div>
    );
  };

  const treeData = useMemo(() => {
    const toTree = (nodes) =>
      (Array.isArray(nodes) ? nodes : []).map((node) => ({
        key: node.key,
        title: renderNodeTitle(node),
        isLeaf: node.isLeaf,
        isDir: Boolean(node.isDir),
        absolutePath: node.absolutePath,
        isSymlink: Boolean(node.isSymlink),
        size: node.size,
        mtime: node.mtime,
        children: node.children ? toTree(node.children) : undefined,
      }));
    return toTree(treeNodes);
  }, [treeNodes, changeIndex, changedDirs]);

  const treeScrollWidth = useMemo(() => {
    const viewport = Number.isFinite(treeViewportWidth) && treeViewportWidth > 0 ? treeViewportWidth : 360;
    let maxDepth = 0;
    let maxNameLength = 0;

    const walk = (nodes) => {
      (Array.isArray(nodes) ? nodes : []).forEach((node) => {
        if (!node) return;
        const key = typeof node.key === 'string' ? node.key : '';
        const depth = key && key !== '.' ? key.split('/').filter(Boolean).length : 0;
        if (depth > maxDepth) maxDepth = depth;
        const name = typeof node.name === 'string' ? node.name : '';
        if (name.length > maxNameLength) maxNameLength = name.length;
        if (node.children) walk(node.children);
      });
    };

    walk(treeNodes);

    const indentPx = 24;
    const charPx = 8;
    const extraPx = 160;
    const labelPx = Math.min(600, maxNameLength * charPx + extraPx);
    const required = maxDepth * indentPx + labelPx + 24;
    const target = Math.ceil(Math.max(viewport, required));

    if (target <= viewport + 8) return undefined;
    return Math.min(4000, target);
  }, [treeNodes, treeViewportWidth]);

  const currentFilePath = fileTarget?.path || '';
  const fileHistory = useMemo(() => {
    if (!workspaceRoot || !currentFilePath) return [];
    const matches = changeEntries.filter((entry) => {
      const root = typeof entry?.workspaceRoot === 'string' ? entry.workspaceRoot.trim() : '';
      if (root !== workspaceRoot) return false;
      const relPath = normalizeRelPath(entry?.path || '');
      return relPath === currentFilePath;
    });
    return matches.sort((a, b) => String(b?.ts || '').localeCompare(String(a?.ts || '')));
  }, [changeEntries, workspaceRoot, currentFilePath]);

  const activeDiff = useMemo(() => {
    if (activeDiffKey) {
      const found = fileHistory.find((entry) => changeEntryKey(entry) === activeDiffKey);
      if (found) return found;
    }
    return fileHistory[0] || null;
  }, [fileHistory, activeDiffKey]);

  const resolvedActiveKey = useMemo(() => {
    if (activeDiffKey) return activeDiffKey;
    return fileHistory.length > 0 ? changeEntryKey(fileHistory[0]) : null;
  }, [activeDiffKey, fileHistory]);

  useEffect(() => {
    if (!historyOpen) return;
    if (activeDiffKey) return;
    if (fileHistory.length > 0) setActiveDiffKey(changeEntryKey(fileHistory[0]));
  }, [historyOpen, fileHistory, activeDiffKey]);

  const handleSelectNode = (keys, info) => {
    const node = info?.node;
    const nextKeys = Array.isArray(keys) ? [...keys] : [];
    setSelectedKeys(nextKeys);
    if (!node) return;
    if (!node.isLeaf) return;
    const relPath = normalizeRelPath(node.key);
    setFileTarget({
      path: relPath,
      absolutePath: typeof node.absolutePath === 'string' ? node.absolutePath : '',
    });
    setFileReadKey((k) => k + 1);
    if (autoOpenHistoryOnSelect) setHistoryOpen(true);
    setActiveDiffKey(null);
  };

  const openRoot = (root) => {
    const next = typeof root === 'string' ? root.trim() : '';
    if (!next) return;
    setWorkspaceRoot(next);
    setManualRoot('');
  };

  const rootOptions = availableRoots.map((root) => {
    const trimmed = String(root || '').trim();
    const label = trimmed ? `${trimmed.split(/[\\/]/).filter(Boolean).slice(-1)[0] || trimmed} — ${trimmed}` : trimmed;
    return { value: trimmed, label };
  });

  const handleExpandAll = () => {
    const next = collectDirKeys(treeNodesRef.current);
    if (next.length === 0) return;
    if (!next.includes('.')) next.unshift('.');
    setExpandedKeys(next);
  };

  const handleCollapseAll = () => {
    setExpandedKeys(['.']);
  };

  const handleWorkspaceRootChange = (val) => setWorkspaceRoot(String(val || '').trim());
  const handleManualRootChange = (event) => setManualRoot(event?.target?.value || '');
  const handleAutoOpenHistoryOnSelectChange = (checked) => {
    const next = checked === true;
    setAutoOpenHistoryOnSelect(next);
    safeLocalStorageSet(WORKSPACE_EXPLORER_AUTO_OPEN_HISTORY_KEY, next ? '1' : '0');
  };

  return (
    <WorkspaceExplorerLayout
      rootOptions={rootOptions}
      workspaceRoot={workspaceRoot}
      onWorkspaceRootChange={handleWorkspaceRootChange}
      manualRoot={manualRoot}
      onManualRootChange={handleManualRootChange}
      onOpenRoot={openRoot}
      onRefreshTree={() => setTreeRefreshKey((k) => k + 1)}
      treeMeta={treeMeta}
      splitViewRef={splitViewRef}
      splitViewHeight={splitViewHeight}
      splitGap={splitGap}
      isResizingSplit={isResizingSplit}
      treePaneWidth={treePaneWidth}
      splitMinLeft={splitMinLeft}
      splitMaxLeft={splitMaxLeft}
      splitMinRight={splitMinRight}
      splitHandleWidth={splitHandleWidth}
      onSplitterPointerDown={handleSplitterPointerDown}
      onSplitterPointerMove={handleSplitterPointerMove}
      onSplitterPointerStop={stopSplitterResize}
      treeLoading={treeLoading}
      treeError={treeError}
      treeData={treeData}
      expandedKeys={expandedKeys}
      onExpandedKeysChange={setExpandedKeys}
      onLoadTreeData={handleLoadTreeData}
      selectedKeys={selectedKeys}
      onSelectNode={handleSelectNode}
      onExpandAll={handleExpandAll}
      onCollapseAll={handleCollapseAll}
      autoOpenHistoryOnSelect={autoOpenHistoryOnSelect}
      onAutoOpenHistoryOnSelectChange={handleAutoOpenHistoryOnSelectChange}
      treeViewportRef={treeViewportRef}
      treeViewportHeight={treeViewportHeight}
      treeScrollWidth={treeScrollWidth}
      currentFilePath={currentFilePath}
      fileTarget={fileTarget}
      fileView={fileView}
      previewViewportRef={previewViewportRef}
      previewViewportHeight={previewViewportHeight}
      onReloadFile={() => setFileReadKey((k) => k + 1)}
      onOpenHistory={() => setHistoryOpen(true)}
      historyOpen={historyOpen}
      onCloseHistory={() => setHistoryOpen(false)}
      fileHistory={fileHistory}
      activeDiff={activeDiff}
      resolvedActiveKey={resolvedActiveKey}
      changeEntryKey={changeEntryKey}
      onSelectHistoryKey={setActiveDiffKey}
    />
  );
}


export { WorkspaceExplorerView };
