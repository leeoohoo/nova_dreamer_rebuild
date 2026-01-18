import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Layout, Modal, Segmented, Space, Typography, message } from 'antd';
import { ConfigProvider, theme as antdTheme } from 'antd';

import { createAdminActions } from './app/admin-actions.js';
import { EventStreamMarkdownView } from './features/session/EventStreamMarkdownView.jsx';
import { FloatingIsland } from './features/session/FloatingIsland.jsx';
import { SessionView, TasksDrawer } from './features/session/SessionView.jsx';
import { WorkspaceExplorerView } from './features/workspace/WorkspaceExplorerView.jsx';
import { useElementHeight } from './hooks/useElementSize.js';
import { api, hasApi } from './lib/api.js';
import { buildEventList, readRawEventList } from './lib/events.js';
import { parseTasks } from './lib/parse.js';
import { buildRunFilterOptions, filterEntriesByRunId, normalizeRunId, parseTimestampMs } from './lib/runs.js';
import {
  DISPATCH_CWD_STORAGE_KEY,
  HIDDEN_RUNS_STORAGE_KEY,
  RUN_FILTER_ALL,
  RUN_FILTER_AUTO,
  RUN_FILTER_STORAGE_KEY,
  RUN_FILTER_UNKNOWN,
  safeLocalStorageGet,
  safeLocalStorageSet,
} from './lib/storage.js';
import { listPendingUiPrompts, pickActiveUiPrompt } from './lib/ui-prompts.js';

const { Content } = Layout;
const { Text, Paragraph } = Typography;

function resolveThemeFromHost(host) {
  const getTheme = typeof host?.theme?.get === 'function' ? host.theme.get : null;
  const value = typeof getTheme === 'function' ? getTheme() : document?.documentElement?.dataset?.theme || 'light';
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'dark' ? 'dark' : 'light';
}

function normalizeTab(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (v === 'session' || v === 'workspace' || v === 'events') return v;
  return 'session';
}

export function CliApp({ host, mountContainer }) {
  const [themeMode, setThemeMode] = useState(() => resolveThemeFromHost(host));

  useEffect(() => {
    setThemeMode(resolveThemeFromHost(host));
    const onChange = typeof host?.theme?.onChange === 'function' ? host.theme.onChange : null;
    if (!onChange) return undefined;
    return onChange((next) => setThemeMode(next === 'dark' ? 'dark' : 'light'));
  }, [host]);

  const algorithm = useMemo(
    () => (themeMode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm),
    [themeMode]
  );

  return (
    <ConfigProvider theme={{ algorithm }}>
      <CliAppBody host={host} mountContainer={mountContainer} />
    </ConfigProvider>
  );
}

function CliAppBody({ host, mountContainer }) {
  const [tab, setTab] = useState(() => normalizeTab(typeof window !== 'undefined' ? window.__aideuiCliTab : ''));

  const [config, setConfig] = useState(null);
  const [session, setSession] = useState(null);
  const [events, setEvents] = useState(null);
  const [fileChanges, setFileChanges] = useState({ entries: [] });
  const [uiPrompts, setUiPrompts] = useState({ entries: [] });
  const [runs, setRuns] = useState({ entries: [] });
  const [tasks, setTasks] = useState([]);
  const [admin, setAdmin] = useState({
    models: [],
    secrets: [],
    mcpServers: [],
    subagents: [],
    prompts: [],
    settings: [],
    landConfigs: [],
  });
  const [adminDbPath, setAdminDbPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [clearingCache, setClearingCache] = useState(false);
  const [sessionsState, setSessionsState] = useState({ available: null, sessions: [] });
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsAction, setSessionsAction] = useState(null);
  const [error, setError] = useState(hasApi ? null : 'IPC bridge not available. Is preload loaded?');
  const [tasksDrawerOpen, setTasksDrawerOpen] = useState(false);
  const [runFilter, setRunFilter] = useState(() => {
    const raw = safeLocalStorageGet(RUN_FILTER_STORAGE_KEY);
    const stored = typeof raw === 'string' ? raw.trim() : '';
    if (!stored || stored === RUN_FILTER_ALL) return RUN_FILTER_AUTO;
    return stored;
  });
  const [workspaceSelection, setWorkspaceSelection] = useState(null);
  const [terminalStatusMap, setTerminalStatusMap] = useState({});
  const [dispatchInput, setDispatchInput] = useState('');
  const hideTopBar = Boolean(host?.ui?.aideui?.hideTopBar);
  const [dispatchCwd, setDispatchCwd] = useState(() => {
    const raw = safeLocalStorageGet(DISPATCH_CWD_STORAGE_KEY);
    return typeof raw === 'string' ? raw.trim() : '';
  });
  const [hiddenRunIds, setHiddenRunIds] = useState(() => {
    const raw = safeLocalStorageGet(HIDDEN_RUNS_STORAGE_KEY);
    let parsed = [];
    try {
      parsed = JSON.parse(raw || '[]');
    } catch {
      parsed = [];
    }
    if (!Array.isArray(parsed)) return [];
    const unique = new Set();
    parsed.forEach((value) => {
      const rid = normalizeRunId(value);
      if (!rid) return;
      unique.add(rid);
    });
    return Array.from(unique);
  });
  const [dispatching, setDispatching] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [closing, setClosing] = useState(false);

  const floatingIslandRef = useRef(null);
  const floatingIslandHeight = useElementHeight(floatingIslandRef, 190);
  const contentBottomPadding = Math.max(80, floatingIslandHeight + 34);

  const allRawEvents = useMemo(() => readRawEventList(events), [events]);
  const allFileChangeEntries = useMemo(
    () => (Array.isArray(fileChanges?.entries) ? fileChanges.entries : []),
    [fileChanges]
  );
  const uiPromptEntries = useMemo(() => (Array.isArray(uiPrompts?.entries) ? uiPrompts.entries : []), [uiPrompts]);
  const runEntries = useMemo(() => (Array.isArray(runs?.entries) ? runs.entries : []), [runs]);

  const runSummary = useMemo(
    () => buildRunFilterOptions(allRawEvents, allFileChangeEntries, tasks, runEntries),
    [allRawEvents, allFileChangeEntries, tasks, runEntries]
  );
  const hiddenRunSet = useMemo(() => new Set(hiddenRunIds), [hiddenRunIds]);
  const visibleRunSummary = useMemo(() => {
    const summary = runSummary || { options: [], latestRunId: null };
    const options = Array.isArray(summary?.options) ? summary.options : [];
    const visibleOptions = options.filter((opt) => {
      const value = typeof opt?.value === 'string' ? opt.value : '';
      if (!value) return false;
      if (value === RUN_FILTER_AUTO || value === RUN_FILTER_ALL || value === RUN_FILTER_UNKNOWN) return true;
      return !hiddenRunSet.has(value);
    });
    const latestRunId = normalizeRunId(summary?.latestRunId);
    const latestVisible = latestRunId && !hiddenRunSet.has(latestRunId) ? latestRunId : null;
    return {
      options: visibleOptions,
      latestRunId: latestVisible || null,
    };
  }, [runSummary, hiddenRunSet]);

  const handleRunFilterChange = (value) => {
    const next = typeof value === 'string' && value.trim() ? value.trim() : RUN_FILTER_AUTO;
    setRunFilter(next);
    safeLocalStorageSet(RUN_FILTER_STORAGE_KEY, next);
  };

  const effectiveRunFilter = useMemo(() => {
    const selection = typeof runFilter === 'string' ? runFilter : '';
    if (!selection || selection === RUN_FILTER_AUTO) {
      return visibleRunSummary?.latestRunId || RUN_FILTER_ALL;
    }
    return selection;
  }, [runFilter, visibleRunSummary]);

  const filteredRawEvents = useMemo(
    () => filterEntriesByRunId(allRawEvents, effectiveRunFilter),
    [allRawEvents, effectiveRunFilter]
  );
  const filteredEventList = useMemo(() => buildEventList(filteredRawEvents), [filteredRawEvents]);
  const filteredFileChanges = useMemo(
    () => filterEntriesByRunId(allFileChangeEntries, effectiveRunFilter),
    [allFileChangeEntries, effectiveRunFilter]
  );
  const filteredTasks = useMemo(() => filterEntriesByRunId(tasks, effectiveRunFilter), [tasks, effectiveRunFilter]);
  const filteredFileChangesPayload = useMemo(
    () => ({ ...(fileChanges || {}), entries: filteredFileChanges }),
    [fileChanges, filteredFileChanges]
  );
  const pendingUiPrompts = useMemo(() => listPendingUiPrompts(uiPromptEntries), [uiPromptEntries]);
  const activeUiPrompt = useMemo(
    () => pickActiveUiPrompt(pendingUiPrompts, effectiveRunFilter),
    [pendingUiPrompts, effectiveRunFilter]
  );

  const dispatchRunId = useMemo(() => {
    const selection = typeof runFilter === 'string' ? runFilter.trim() : '';
    if (!selection) return null;
    if (selection === RUN_FILTER_ALL || selection === RUN_FILTER_UNKNOWN) return null;
    if (selection === RUN_FILTER_AUTO) {
      const latest = normalizeRunId(visibleRunSummary?.latestRunId);
      return latest || null;
    }
    return selection;
  }, [runFilter, visibleRunSummary]);

  const dispatchRunCwd = useMemo(() => {
    const rid = normalizeRunId(dispatchRunId);
    if (!rid) return '';
    let best = { cwd: '', ms: 0 };
    (Array.isArray(runEntries) ? runEntries : []).forEach((entry) => {
      if (normalizeRunId(entry?.runId) !== rid) return;
      const root =
        typeof entry?.workspaceRoot === 'string' && entry.workspaceRoot.trim()
          ? entry.workspaceRoot.trim()
          : typeof entry?.cwd === 'string'
            ? entry.cwd.trim()
            : '';
      if (!root) return;
      const ms = parseTimestampMs(entry?.ts);
      if (!best.cwd || ms >= best.ms) {
        best = { cwd: root, ms };
      }
    });
    return best.cwd || '';
  }, [dispatchRunId, runEntries]);

  const activeTerminalStatus = dispatchRunId ? terminalStatusMap[dispatchRunId] : null;
  const stopVisible = Boolean(activeTerminalStatus && activeTerminalStatus.state === 'running');
  const cwdPickerVisible = !dispatchRunId;

  const loadConfig = async () => {
    try {
      const data = await api.invoke('config:read');
      setConfig(data);
      setTasks(Array.isArray(data?.tasksList) ? data.tasksList : parseTasks(data?.tasks));
    } catch (err) {
      setError(err?.message || '加载配置失败');
    }
  };

  const loadSession = async () => {
    try {
      const data = await api.invoke('session:read');
      setSession(data);
    } catch (err) {
      setError(err?.message || '加载会话失败');
    }
  };

  const loadEvents = async () => {
    try {
      const data = await api.invoke('events:read');
      setEvents(data);
    } catch (err) {
      setError(err?.message || '加载事件失败');
    }
  };

  const loadFileChanges = async () => {
    if (!hasApi) return;
    try {
      const data = await api.invoke('fileChanges:read');
      setFileChanges(data || { entries: [] });
    } catch (err) {
      setError(err?.message || '加载文件改动失败');
    }
  };

  const loadUiPrompts = async () => {
    if (!hasApi) return;
    try {
      const data = await api.invoke('uiPrompts:read');
      setUiPrompts(data || { entries: [] });
    } catch {
      // ignore prompt load errors (older UI build may not support this channel)
    }
  };

  const loadRuns = async () => {
    if (!hasApi) return;
    try {
      const data = await api.invoke('runs:read');
      setRuns(data || { entries: [] });
    } catch {
      // ignore runs load errors (older UI build may not support this channel)
    }
  };

  const loadAdmin = async () => {
    try {
      const payload = await api.invoke('admin:state');
      setAdmin(payload?.data || {});
      setAdminDbPath(payload?.dbPath || '');
    } catch (err) {
      setError(err?.message || '加载管理数据失败');
    }
  };

  const refreshLogs = async () => {
    if (!hasApi) return;
    await Promise.all([loadSession(), loadEvents(), loadFileChanges(), loadUiPrompts(), loadRuns()]);
  };

  const loadSessions = async () => {
    if (!hasApi) return;
    try {
      setSessionsLoading(true);
      const data = await api.invoke('sessions:list');
      setSessionsState(data || { available: null, sessions: [] });
    } catch (err) {
      setError(err?.message || '加载会话状态失败');
    } finally {
      setSessionsLoading(false);
    }
  };

  const clearAllCache = async () => {
    if (!hasApi) {
      setError('IPC bridge not available');
      return;
    }
    try {
      setClearingCache(true);
      await api.invoke('session:clearCache');
      await Promise.all([loadConfig(), refreshLogs(), loadAdmin(), loadSessions()]);
      message.success('已清除所有缓存');
    } catch (err) {
      const msg = err?.message || '清除缓存失败';
      setError(msg);
      message.error(msg);
    } finally {
      setClearingCache(false);
    }
  };

  const killSession = async (name) => {
    if (!hasApi || !name) return;
    try {
      setSessionsAction(name);
      await api.invoke('sessions:kill', { name });
      await loadSessions();
      message.success(`已关闭会话 ${name}`);
    } catch (err) {
      const msg = err?.message || '关闭会话失败';
      setError(msg);
      message.error(msg);
    } finally {
      setSessionsAction(null);
    }
  };

  const restartSession = async (name) => {
    if (!hasApi || !name) return;
    try {
      setSessionsAction(`restart:${name}`);
      await api.invoke('sessions:restart', { name });
      await loadSessions();
      message.success(`已重启会话 ${name}`);
    } catch (err) {
      const msg = err?.message || '重启会话失败';
      setError(msg);
      message.error(msg);
    } finally {
      setSessionsAction(null);
    }
  };

  const stopBackendSession = async (name) => {
    if (!hasApi || !name) return;
    try {
      setSessionsAction(`stop:${name}`);
      await api.invoke('sessions:stop', { name });
      await loadSessions();
      message.success(`已停止会话 ${name}`);
    } catch (err) {
      const msg = err?.message || '停止会话失败';
      setError(msg);
      message.error(msg);
    } finally {
      setSessionsAction(null);
    }
  };

  const readSessionLog = async ({ name, lineCount = 500 } = {}) => {
    if (!hasApi) throw new Error('IPC bridge not available');
    const sessionName = typeof name === 'string' ? name.trim() : '';
    if (!sessionName) throw new Error('session name is required');
    const result = await api.invoke('sessions:readLog', { name: sessionName, lineCount });
    if (result?.ok === false) {
      throw new Error(result?.message || '读取会话日志失败');
    }
    return result;
  };

  const readRuntimeLog = async ({ lineCount = 500 } = {}) => {
    if (!hasApi) throw new Error('IPC bridge not available');
    const result = await api.invoke('runtimeLog:read', { lineCount });
    if (result?.ok === false) {
      throw new Error(result?.message || '读取运行日志失败');
    }
    return result;
  };

  const killAllSessions = async () => {
    if (!hasApi) return;
    try {
      setSessionsAction('all');
      const result = await api.invoke('sessions:killAll');
      await loadSessions();
      if (result?.ok === false) {
        message.error(result?.errors?.join('; ') || '关闭会话失败');
      } else {
        message.success('已关闭所有会话');
      }
    } catch (err) {
      const msg = err?.message || '关闭会话失败';
      setError(msg);
      message.error(msg);
    } finally {
      setSessionsAction(null);
    }
  };

  const openWorkspaceFromChange = (entry) => {
    const workspaceRoot = typeof entry?.workspaceRoot === 'string' ? entry.workspaceRoot : '';
    const relPath = typeof entry?.path === 'string' ? entry.path : '';
    const absolutePath = typeof entry?.absolutePath === 'string' ? entry.absolutePath : '';
    if (!workspaceRoot || !relPath) {
      message.info('该条记录缺少 workspaceRoot 或 path，无法打开文件浏览器。');
      return;
    }
    setWorkspaceSelection({ workspaceRoot, path: relPath, absolutePath });
    setTab('workspace');
  };

  const dispatchToCli = async ({ text, force = false } = {}) => {
    if (!hasApi) throw new Error('IPC bridge not available');
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    const payload = {
      text: trimmed,
      runId: dispatchRunId,
      force,
      cwd: dispatchRunId ? undefined : dispatchCwd,
    };
    return await api.invoke('terminal:dispatch', payload);
  };

  const respondUiPrompt = async ({ requestId, runId, response } = {}) => {
    if (!hasApi) throw new Error('IPC bridge not available');
    const result = await api.invoke('uiPrompts:respond', { requestId, runId, response });
    if (result?.ok === false) {
      throw new Error(result?.message || '提交失败');
    }
    return result;
  };

  const pickRunIdForCorrection = () => {
    const explicit = normalizeRunId(dispatchRunId);
    if (explicit) return explicit;
    const statuses = Object.values(terminalStatusMap || {});
    const running = statuses
      .map((s) => ({
        runId: normalizeRunId(s?.runId),
        state: typeof s?.state === 'string' ? s.state : '',
        ms: parseTimestampMs(s?.updatedAt),
      }))
      .filter((s) => s.runId && s.state === 'running');
    if (running.length === 1) return running[0].runId;
    if (running.length > 1) return null;
    return null;
  };

  const handlePickCwd = async () => {
    if (!hasApi) {
      message.error('IPC bridge not available');
      return;
    }
    try {
      const result = await api.invoke('dialog:selectDirectory', { defaultPath: dispatchCwd || undefined });
      if (result?.ok && typeof result?.path === 'string' && result.path.trim()) {
        const next = result.path.trim();
        setDispatchCwd(next);
        safeLocalStorageSet(DISPATCH_CWD_STORAGE_KEY, next);
        message.success('已选择目录');
      }
    } catch (err) {
      message.error(err?.message || '选择目录失败');
    }
  };

  const handleClearCwd = () => {
    setDispatchCwd('');
    safeLocalStorageSet(DISPATCH_CWD_STORAGE_KEY, '');
  };

  const handleSend = async () => {
    const text = (dispatchInput || '').trim();
    if (!text) return;
    if (!hasApi) {
      message.error('IPC bridge not available');
      return;
    }
    try {
      setDispatching(true);
      const result = await dispatchToCli({ text, force: false });
      if (result?.ok === false && result?.reason === 'busy') {
        const runningText = typeof result?.currentMessage === 'string' ? result.currentMessage : '';
        Modal.confirm({
          title: 'CLI 正在执行',
          content: (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Text type="secondary">当前正在执行的消息：</Text>
              <Paragraph style={{ margin: 0 }} ellipsis={{ rows: 4, expandable: true, symbol: '展开' }}>
                {runningText || '（未知）'}
              </Paragraph>
              <Text>是否要打断并发送新的消息？</Text>
            </Space>
          ),
          okText: '打断并发送',
          cancelText: '取消',
          onOk: async () => {
            const forced = await dispatchToCli({ text, force: true });
            if (forced?.ok === false) {
              throw new Error(forced?.message || '发送失败');
            }
            if (forced?.runId) {
              handleRunFilterChange(forced.runId);
            }
            setDispatchInput('');
            message.success('已打断并发送');
          },
        });
        return;
      }
      if (result?.ok === false) {
        throw new Error(result?.message || '发送失败');
      }
      if (result?.runId) {
        handleRunFilterChange(result.runId);
      }
      setDispatchInput('');
      message.success('已发送');
    } catch (err) {
      const msg = err?.message || '发送失败';
      setError(msg);
      message.error(msg);
    } finally {
      setDispatching(false);
    }
  };

  const handleSummaryNow = async () => {
    if (!hasApi) {
      message.error('IPC bridge not available');
      return;
    }
    const runId = normalizeRunId(dispatchRunId);
    if (!runId) {
      message.error('请先在灵动岛选择一个终端(runId)。');
      return;
    }
    const status = terminalStatusMap?.[runId] || null;
    const state = typeof status?.state === 'string' ? status.state.trim() : '';
    if (!status || state === 'exited') {
      message.error('该终端未运行，无法执行总结。请先发送任意消息启动/恢复该终端。');
      return;
    }
    try {
      setDispatching(true);
      const result = await api.invoke('terminal:action', { runId, action: 'summary_now' });
      if (result?.ok === false) {
        throw new Error(result?.message || '发送失败');
      }
      message.success('已请求立即总结（不会打断当前执行）');
    } catch (err) {
      const msg = err?.message || '发送失败';
      setError(msg);
      message.error(msg);
    } finally {
      setDispatching(false);
    }
  };

  const handleCorrect = async () => {
    const text = (dispatchInput || '').trim();
    if (!text) return;
    if (!hasApi) {
      message.error('IPC bridge not available');
      return;
    }
    const runId = pickRunIdForCorrection();
    if (!runId) {
      message.error('请先在灵动岛选择一个终端(runId)，或确保只有 1 个正在运行的终端。');
      return;
    }
    try {
      setDispatching(true);
      const result = await api.invoke('terminal:intervene', { text, runId, target: 'auto' });
      if (result?.ok === false) {
        throw new Error(result?.message || '发送失败');
      }
      setDispatchInput('');
      message.success('已发送纠正');
    } catch (err) {
      const msg = err?.message || '发送失败';
      setError(msg);
      message.error(msg);
    } finally {
      setDispatching(false);
    }
  };

  const handleStop = async () => {
    if (!dispatchRunId) return;
    if (!hasApi) {
      message.error('IPC bridge not available');
      return;
    }
    try {
      setStopping(true);
      const result = await api.invoke('terminal:stop', { runId: dispatchRunId });
      if (result?.ok === false) {
        throw new Error(result?.message || '停止失败');
      }
      message.success('已发送停止信号');
    } catch (err) {
      const msg = err?.message || '停止失败';
      setError(msg);
      message.error(msg);
    } finally {
      setStopping(false);
    }
  };

  const rememberHiddenRun = (runId) => {
    const rid = normalizeRunId(runId);
    if (!rid) return;
    setHiddenRunIds((prev) => {
      const next = new Set(Array.isArray(prev) ? prev : []);
      next.add(rid);
      const list = Array.from(next);
      safeLocalStorageSet(HIDDEN_RUNS_STORAGE_KEY, JSON.stringify(list));
      return list;
    });
  };

  const handleCloseTerminal = async () => {
    if (!dispatchRunId) return;
    if (!hasApi) {
      message.error('IPC bridge not available');
      return;
    }
    const rid = dispatchRunId;
    const closeRun = async (force = false) => await api.invoke('terminal:close', { runId: rid, force });
    try {
      setClosing(true);
      const result = await closeRun(false);
      if (result?.ok === false && result?.reason === 'busy') {
        const runningText = typeof result?.currentMessage === 'string' ? result.currentMessage : '';
        Modal.confirm({
          title: '终端正在执行',
          content: (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Text type="secondary">当前正在执行的消息：</Text>
              <Paragraph style={{ margin: 0 }} ellipsis={{ rows: 4, expandable: true, symbol: '展开' }}>
                {runningText || '（未知）'}
              </Paragraph>
              <Text>确认要停止并关闭这个终端吗？</Text>
            </Space>
          ),
          okText: '停止并关闭',
          cancelText: '取消',
          onOk: async () => {
            const forced = await closeRun(true);
            if (forced?.ok === false) throw new Error(forced?.message || '关闭失败');
            rememberHiddenRun(rid);
            handleRunFilterChange(RUN_FILTER_AUTO);
            message.success('已停止并关闭终端');
          },
        });
        return;
      }
      if (result?.ok === false) {
        throw new Error(result?.message || '关闭失败');
      }
      rememberHiddenRun(rid);
      handleRunFilterChange(RUN_FILTER_AUTO);
      message.success('已关闭终端');
    } catch (err) {
      const msg = err?.message || '关闭失败';
      setError(msg);
      message.error(msg);
    } finally {
      setClosing(false);
    }
  };

  useEffect(() => {
    if (!hasApi) {
      setLoading(false);
      return undefined;
    }
    (async () => {
      setLoading(true);
      try {
        await Promise.all([
          loadConfig(),
          loadSession(),
          loadEvents(),
          loadFileChanges(),
          loadUiPrompts(),
          loadRuns(),
          loadAdmin(),
          loadSessions(),
          api
            .invoke('terminalStatus:list')
            .then((payload) => {
              const list = Array.isArray(payload?.statuses) ? payload.statuses : [];
              const next = {};
              list.forEach((item) => {
                const rid = normalizeRunId(item?.runId);
                if (!rid) return;
                next[rid] = item;
              });
              setTerminalStatusMap(next);
            })
            .catch(() => {}),
        ]);
      } finally {
        setLoading(false);
      }
    })();

    const unsub = api.on('session:update', (data) => setSession(data));
    const unsubEvents = api.on('events:update', (data) => setEvents(data));
    const unsubFileChanges = api.on('fileChanges:update', (data) => setFileChanges(data || { entries: [] }));
    const unsubUiPrompts = api.on('uiPrompts:update', (data) => setUiPrompts(data || { entries: [] }));
    const unsubRuns = api.on('runs:update', (data) => setRuns(data || { entries: [] }));
    const unsubAdmin = api.on('admin:update', (payload) => {
      setAdmin(payload?.data || {});
      setAdminDbPath(payload?.dbPath || '');
    });
    const unsubConfig = api.on('config:update', (data) => {
      setConfig(data);
      setTasks(Array.isArray(data?.tasksList) ? data.tasksList : parseTasks(data?.tasks));
    });
    const unsubTerminal = api.on('terminalStatus:update', (payload) => {
      const statuses = Array.isArray(payload?.statuses) ? payload.statuses : [];
      const next = {};
      statuses.forEach((item) => {
        const rid = normalizeRunId(item?.runId);
        if (!rid) return;
        next[rid] = item;
      });
      setTerminalStatusMap(next);
    });

    return () => {
      if (typeof unsub === 'function') unsub();
      if (typeof unsubEvents === 'function') unsubEvents();
      if (typeof unsubFileChanges === 'function') unsubFileChanges();
      if (typeof unsubUiPrompts === 'function') unsubUiPrompts();
      if (typeof unsubRuns === 'function') unsubRuns();
      if (typeof unsubAdmin === 'function') unsubAdmin();
      if (typeof unsubConfig === 'function') unsubConfig();
      if (typeof unsubTerminal === 'function') unsubTerminal();
    };
  }, []);

  const { saveSettings } = useMemo(() => createAdminActions({ api, hasApi }), []);

  useEffect(() => {
    try {
      window.__aideuiCliTab = tab;
    } catch {
      // ignore
    }
    try {
      window.dispatchEvent(new CustomEvent('aideui:cli:tabChange', { detail: { tab } }));
    } catch {
      // ignore
    }
  }, [tab]);

  useEffect(() => {
    const handler = (event) => setTab(normalizeTab(event?.detail?.tab));
    window.addEventListener('aideui:cli:setTab', handler);
    return () => window.removeEventListener('aideui:cli:setTab', handler);
  }, []);

  const runtimeSettings = useMemo(() => {
    const list = Array.isArray(admin?.settings) ? admin.settings : [];
    if (list.length === 0) return {};
    return list.find((item) => item?.id === 'runtime') || list[0] || {};
  }, [admin]);

  useEffect(() => {
    const allowed = new Set(
      (Array.isArray(visibleRunSummary?.options) ? visibleRunSummary.options : [])
        .map((opt) => (typeof opt?.value === 'string' ? opt.value.trim() : ''))
        .filter(Boolean)
    );
    const selected = typeof runFilter === 'string' ? runFilter : '';
    const hidden = selected && hiddenRunSet.has(selected);
    if (selected && !hidden && (allowed.has(selected) || selected.startsWith('run-'))) return;
    setRunFilter(RUN_FILTER_AUTO);
    safeLocalStorageSet(RUN_FILTER_STORAGE_KEY, RUN_FILTER_AUTO);
  }, [runFilter, visibleRunSummary, hiddenRunSet]);

	  const currentTab = normalizeTab(tab);

  const renderView = () => {
    if (currentTab === 'events') {
      return (
        <EventStreamMarkdownView
          eventList={filteredEventList}
          eventsPath={events?.path}
          runFilter={runFilter}
          runOptions={visibleRunSummary?.options}
          onRunFilterChange={handleRunFilterChange}
          onRefreshLogs={refreshLogs}
        />
      );
    }
    if (currentTab === 'workspace') {
      return (
        <WorkspaceExplorerView
          fileChanges={filteredFileChangesPayload}
          runs={runs}
          selection={workspaceSelection}
          onSelectionApplied={() => setWorkspaceSelection(null)}
          runScope={effectiveRunFilter}
        />
      );
    }
    return (
      <SessionView
        eventList={filteredEventList}
        eventsPath={events?.path}
        fileChanges={filteredFileChangesPayload}
        tasks={filteredTasks}
        sessions={sessionsState}
        sessionsLoading={sessionsLoading}
        sessionsAction={sessionsAction}
        runFilter={runFilter}
        runOptions={visibleRunSummary?.options}
        onRunFilterChange={handleRunFilterChange}
        onRefreshLogs={refreshLogs}
        onOpenWorkspace={openWorkspaceFromChange}
        onRefreshSessions={loadSessions}
        onKillSession={killSession}
        onRestartSession={restartSession}
        onStopSession={stopBackendSession}
        onReadSessionLog={readSessionLog}
        onReadRuntimeLog={readRuntimeLog}
        onKillAllSessions={killAllSessions}
        onOpenTasksDrawer={() => setTasksDrawerOpen(true)}
      />
    );
  };

	  const topBarVisible = !hideTopBar;

	  return (
	    <Layout style={{ height: '100%', minHeight: 0, background: 'transparent', overflow: 'hidden' }}>
      {topBarVisible ? (
        <div
          style={{
            position: 'relative',
            zIndex: 10,
            padding: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: 'var(--ds-header-bg, rgba(255, 255, 255, 0.72))',
            borderBottom: '1px solid var(--ds-header-border, rgba(15, 23, 42, 0.08))',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            }}
          >
            <Segmented
              className="ds-seg"
              value={currentTab}
            options={[
              { label: '主页', value: 'session' },
              { label: '文件浏览器', value: 'workspace' },
              { label: '轨迹', value: 'events' },
            ]}
            onChange={(value) => setTab(normalizeTab(String(value)))}
          />
          <div style={{ flex: 1 }} />
        </div>
	      ) : null}

	      <Content
	        style={{
	          flex: 1,
	          padding: 12,
	          paddingBottom: contentBottomPadding,
	          minHeight: 0,
	          overflow: currentTab === 'events' ? 'hidden' : 'auto',
	          display: currentTab === 'events' ? 'flex' : undefined,
	          flexDirection: currentTab === 'events' ? 'column' : undefined,
	        }}
	      >
	        {!hasApi ? (
	          <Alert
	            type="error"
	            showIcon
	            message="IPC bridge not available"
            description="检查 preload.cjs / contextIsolation 设置。"
            style={{ marginBottom: 12 }}
          />
        ) : null}

	        {error ? (
	          <Alert
	            type="error"
	            showIcon
	            closable
	            onClose={() => setError(null)}
	            message="Error"
	            description={error}
	            style={{ marginBottom: 12 }}
	          />
	        ) : null}

	        {currentTab === 'events' ? (
	          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
	            {loading ? <Paragraph>加载中…</Paragraph> : renderView()}
	          </div>
	        ) : loading ? (
	          <Paragraph>加载中…</Paragraph>
	        ) : (
	          renderView()
	        )}
	      </Content>

	      <FloatingIsland
	        containerRef={floatingIslandRef}
	        input={dispatchInput}
        onInputChange={setDispatchInput}
        onSend={handleSend}
        onCorrect={handleCorrect}
        onSummaryNow={handleSummaryNow}
        sending={dispatching}
        uiPrompt={activeUiPrompt}
        uiPromptCount={pendingUiPrompts.length}
        onUiPromptRespond={respondUiPrompt}
        runtimeSettings={runtimeSettings}
        onSaveSettings={saveSettings}
        landConfigs={admin?.landConfigs}
        runFilter={runFilter}
        runOptions={visibleRunSummary?.options}
        onRunFilterChange={handleRunFilterChange}
        onOpenTasksDrawer={() => setTasksDrawerOpen(true)}
        onClearCache={clearAllCache}
        clearingCache={clearingCache}
        activeRunCwd={dispatchRunCwd}
        cwdPickerVisible={cwdPickerVisible}
        cwd={dispatchCwd}
        onPickCwd={handlePickCwd}
        onClearCwd={handleClearCwd}
        stopVisible={stopVisible}
        onStop={handleStop}
        stopping={stopping}
        closeVisible={Boolean(dispatchRunId)}
        onClose={handleCloseTerminal}
        closing={closing}
      />

      <TasksDrawer open={tasksDrawerOpen} onClose={() => setTasksDrawerOpen(false)} tasks={filteredTasks} />
    </Layout>
  );
}
