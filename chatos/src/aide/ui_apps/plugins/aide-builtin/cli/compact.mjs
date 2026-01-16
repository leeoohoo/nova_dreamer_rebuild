export function mount({ container, host }) {
  if (!container) throw new Error('container is required');

  const api = typeof window !== 'undefined' ? window.api : null;
  const bridgeEnabled = Boolean(api && typeof api.invoke === 'function' && typeof api.on === 'function');
  const ctx = typeof host?.context?.get === 'function' ? host.context.get() : {};
  const themeGet = typeof host?.theme?.get === 'function' ? host.theme.get : null;
  const themeOnChange = typeof host?.theme?.onChange === 'function' ? host.theme.onChange : null;

  const root = document.createElement('div');
  root.className = 'aide-compact-root';

  const style = document.createElement('style');
  style.textContent = `
    .aide-compact-root {
      position: relative;
      height: 100%;
      min-height: 0;
      display: flex;
      flex-direction: column;
      color: var(--aide-compact-text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .aide-compact-header {
      padding: 14px 16px 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid var(--aide-compact-border);
    }
    .aide-compact-title {
      font-size: 15px;
      font-weight: 700;
      line-height: 1.2;
    }
    .aide-compact-meta {
      font-size: 12px;
      color: var(--aide-compact-text-secondary);
    }
    .aide-compact-body {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: 12px 16px 180px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-sizing: border-box;
    }
    .aide-compact-card {
      border-radius: 12px;
      border: 1px solid var(--aide-compact-border);
      background: var(--aide-compact-card-bg);
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .aide-compact-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .aide-compact-card-title {
      font-weight: 700;
      font-size: 13px;
    }
    .aide-compact-card-meta {
      font-size: 12px;
      color: var(--aide-compact-text-secondary);
    }
    .aide-compact-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .aide-compact-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 8px;
      border-radius: 10px;
      background: var(--aide-compact-muted-bg);
    }
    .aide-compact-row-title {
      font-weight: 600;
      font-size: 12px;
      line-height: 1.2;
    }
    .aide-compact-row-text {
      font-size: 12px;
      color: var(--aide-compact-text-secondary);
      line-height: 1.4;
    }
    .aide-compact-row-main {
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1;
      min-width: 0;
    }
    .aide-compact-tag {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 2px 6px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
      background: var(--aide-compact-tag-bg);
      color: var(--aide-compact-tag-text);
    }
    .aide-compact-tag.success {
      background: var(--aide-compact-tag-green-bg);
      color: var(--aide-compact-tag-green-text);
    }
    .aide-compact-tag.warning {
      background: var(--aide-compact-tag-orange-bg);
      color: var(--aide-compact-tag-orange-text);
    }
    .aide-compact-tag.danger {
      background: var(--aide-compact-tag-red-bg);
      color: var(--aide-compact-tag-red-text);
    }
    .aide-compact-tag.info {
      background: var(--aide-compact-tag-blue-bg);
      color: var(--aide-compact-tag-blue-text);
    }
    .aide-compact-button {
      border-radius: 8px;
      border: 1px solid var(--aide-compact-border-strong);
      background: var(--aide-compact-button-bg);
      color: var(--aide-compact-text);
      padding: 4px 10px;
      font-size: 12px;
      cursor: pointer;
    }
    .aide-compact-button:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
    .aide-compact-alert {
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--aide-compact-border);
      background: var(--aide-compact-alert-bg);
      font-size: 12px;
      color: var(--aide-compact-text-secondary);
    }
    .aide-compact-pagination {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
      color: var(--aide-compact-text-secondary);
    }
    .aide-compact-pagination-controls {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .aide-compact-float {
      position: absolute;
      left: 16px;
      right: 16px;
      bottom: 12px;
      padding: 10px 12px;
      border-radius: 16px;
      border: 1px solid var(--aide-compact-border);
      background: var(--aide-compact-float-bg);
      display: flex;
      flex-direction: column;
      gap: 8px;
      box-shadow: 0 8px 18px rgba(0, 0, 0, 0.12);
    }
    .aide-compact-float.is-collapsed {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }
    .aide-compact-float-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
    }
    .aide-compact-float-panel {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .aide-compact-float-text {
      font-size: 12px;
      color: var(--aide-compact-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
    }
    .aide-compact-tabs {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 2px 0;
    }
    .aide-compact-tab {
      border: 1px solid var(--aide-compact-border);
      background: var(--aide-compact-muted-bg);
      color: var(--aide-compact-text);
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 12px;
      cursor: pointer;
    }
    .aide-compact-tab.is-active {
      background: var(--aide-compact-tab-active-bg);
      color: var(--aide-compact-tab-active-text);
      border-color: var(--aide-compact-tab-active-border);
      font-weight: 600;
    }
    .aide-compact-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-height: 0;
    }
    .aide-compact-row.is-clickable {
      cursor: pointer;
    }
    .aide-compact-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .aide-compact-button.is-mini {
      padding: 2px 8px;
      font-size: 11px;
    }
    .aide-compact-select {
      width: 100%;
      min-width: 160px;
      padding: 4px 8px;
      border-radius: 8px;
      border: 1px solid var(--aide-compact-border);
      background: var(--aide-compact-card-bg);
      color: var(--aide-compact-text);
      font-size: 12px;
    }
    .aide-compact-input {
      width: 100%;
      min-height: 34px;
      max-height: 120px;
      padding: 6px 8px;
      border-radius: 8px;
      border: 1px solid var(--aide-compact-border);
      background: var(--aide-compact-card-bg);
      color: var(--aide-compact-text);
      font-size: 12px;
      resize: vertical;
      box-sizing: border-box;
    }
    .aide-compact-float-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      justify-content: flex-end;
      flex-wrap: wrap;
    }
    .aide-compact-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.35);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
      z-index: 20;
      box-sizing: border-box;
    }
    .aide-compact-overlay-panel {
      width: min(860px, 100%);
      max-height: 90%;
      background: var(--aide-compact-card-bg);
      border: 1px solid var(--aide-compact-border);
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
      box-sizing: border-box;
    }
    .aide-compact-overlay-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .aide-compact-overlay-body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      background: var(--aide-compact-muted-bg);
      border-radius: 10px;
      padding: 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 12px;
      white-space: pre-wrap;
      color: var(--aide-compact-text);
    }
  `;
  root.appendChild(style);

  const header = document.createElement('div');
  header.className = 'aide-compact-header';
  const headerLeft = document.createElement('div');
  headerLeft.style.display = 'flex';
  headerLeft.style.flexDirection = 'column';
  headerLeft.style.gap = '4px';
  const title = document.createElement('div');
  title.className = 'aide-compact-title';
  title.textContent = 'AIDE 半屏概览';
  const meta = document.createElement('div');
  meta.className = 'aide-compact-meta';
  meta.textContent = `${ctx?.pluginId || ''}:${ctx?.appId || ''} · compact · bridge=${bridgeEnabled ? 'on' : 'off'}`;
  headerLeft.appendChild(title);
  headerLeft.appendChild(meta);
  const headerRight = document.createElement('div');
  const refreshButton = document.createElement('button');
  refreshButton.className = 'aide-compact-button';
  refreshButton.textContent = '刷新';
  refreshButton.disabled = !bridgeEnabled;
  headerRight.appendChild(refreshButton);
  header.appendChild(headerLeft);
  header.appendChild(headerRight);

  const body = document.createElement('div');
  body.className = 'aide-compact-body';

  const alert = document.createElement('div');
  alert.className = 'aide-compact-alert';
  alert.style.display = 'none';
  body.appendChild(alert);

  const tabBar = document.createElement('div');
  tabBar.className = 'aide-compact-tabs';
  const overviewTab = document.createElement('button');
  overviewTab.type = 'button';
  overviewTab.className = 'aide-compact-tab is-active';
  overviewTab.textContent = '概览';
  const traceTab = document.createElement('button');
  traceTab.type = 'button';
  traceTab.className = 'aide-compact-tab';
  traceTab.textContent = '轨迹';
  tabBar.appendChild(overviewTab);
  tabBar.appendChild(traceTab);
  body.appendChild(tabBar);

  const overviewSection = document.createElement('div');
  overviewSection.className = 'aide-compact-section';
  const traceSection = document.createElement('div');
  traceSection.className = 'aide-compact-section';

  const conversationCard = document.createElement('div');
  conversationCard.className = 'aide-compact-card';
  const conversationHeader = document.createElement('div');
  conversationHeader.className = 'aide-compact-card-header';
  const conversationTitle = document.createElement('div');
  conversationTitle.className = 'aide-compact-card-title';
  conversationTitle.textContent = '最近对话';
  const conversationMeta = document.createElement('div');
  conversationMeta.className = 'aide-compact-card-meta';
  conversationHeader.appendChild(conversationTitle);
  conversationHeader.appendChild(conversationMeta);
  const conversationList = document.createElement('div');
  conversationList.className = 'aide-compact-list';
  conversationCard.appendChild(conversationHeader);
  conversationCard.appendChild(conversationList);

  const sessionsCard = document.createElement('div');
  sessionsCard.className = 'aide-compact-card';
  const sessionsHeader = document.createElement('div');
  sessionsHeader.className = 'aide-compact-card-header';
  const sessionsTitle = document.createElement('div');
  sessionsTitle.className = 'aide-compact-card-title';
  sessionsTitle.textContent = '后台会话';
  const sessionsMeta = document.createElement('div');
  sessionsMeta.className = 'aide-compact-card-meta';
  const sessionsHeaderRight = document.createElement('div');
  sessionsHeaderRight.style.display = 'flex';
  sessionsHeaderRight.style.alignItems = 'center';
  sessionsHeaderRight.style.gap = '8px';
  const sessionsRefresh = document.createElement('button');
  sessionsRefresh.className = 'aide-compact-button';
  sessionsRefresh.textContent = '刷新';
  sessionsRefresh.disabled = !bridgeEnabled;
  sessionsHeaderRight.appendChild(sessionsMeta);
  sessionsHeaderRight.appendChild(sessionsRefresh);
  sessionsHeader.appendChild(sessionsTitle);
  sessionsHeader.appendChild(sessionsHeaderRight);
  const sessionsList = document.createElement('div');
  sessionsList.className = 'aide-compact-list';
  sessionsCard.appendChild(sessionsHeader);
  sessionsCard.appendChild(sessionsList);

  const filesCard = document.createElement('div');
  filesCard.className = 'aide-compact-card';
  const filesHeader = document.createElement('div');
  filesHeader.className = 'aide-compact-card-header';
  const filesTitle = document.createElement('div');
  filesTitle.className = 'aide-compact-card-title';
  filesTitle.textContent = '文件改动';
  const filesMeta = document.createElement('div');
  filesMeta.className = 'aide-compact-card-meta';
  const filesHeaderRight = document.createElement('div');
  filesHeaderRight.style.display = 'flex';
  filesHeaderRight.style.alignItems = 'center';
  filesHeaderRight.style.gap = '8px';
  const filesRefresh = document.createElement('button');
  filesRefresh.className = 'aide-compact-button';
  filesRefresh.textContent = '刷新';
  filesRefresh.disabled = !bridgeEnabled;
  filesHeaderRight.appendChild(filesMeta);
  filesHeaderRight.appendChild(filesRefresh);
  filesHeader.appendChild(filesTitle);
  filesHeader.appendChild(filesHeaderRight);
  const filesList = document.createElement('div');
  filesList.className = 'aide-compact-list';
  const filesPagination = document.createElement('div');
  filesPagination.className = 'aide-compact-pagination';
  const filesPageText = document.createElement('div');
  const filesControls = document.createElement('div');
  filesControls.className = 'aide-compact-pagination-controls';
  const filesPrev = document.createElement('button');
  filesPrev.className = 'aide-compact-button';
  filesPrev.textContent = '上一页';
  const filesNext = document.createElement('button');
  filesNext.className = 'aide-compact-button';
  filesNext.textContent = '下一页';
  filesControls.appendChild(filesPrev);
  filesControls.appendChild(filesNext);
  filesPagination.appendChild(filesPageText);
  filesPagination.appendChild(filesControls);
  filesCard.appendChild(filesHeader);
  filesCard.appendChild(filesList);
  filesCard.appendChild(filesPagination);

  const traceCard = document.createElement('div');
  traceCard.className = 'aide-compact-card';
  const traceHeader = document.createElement('div');
  traceHeader.className = 'aide-compact-card-header';
  const traceTitle = document.createElement('div');
  traceTitle.className = 'aide-compact-card-title';
  traceTitle.textContent = '轨迹';
  const traceMeta = document.createElement('div');
  traceMeta.className = 'aide-compact-card-meta';
  traceHeader.appendChild(traceTitle);
  traceHeader.appendChild(traceMeta);
  const traceList = document.createElement('div');
  traceList.className = 'aide-compact-list';
  const tracePagination = document.createElement('div');
  tracePagination.className = 'aide-compact-pagination';
  const tracePageText = document.createElement('div');
  const traceControls = document.createElement('div');
  traceControls.className = 'aide-compact-pagination-controls';
  const tracePrev = document.createElement('button');
  tracePrev.className = 'aide-compact-button';
  tracePrev.textContent = '上一页';
  const traceNext = document.createElement('button');
  traceNext.className = 'aide-compact-button';
  traceNext.textContent = '下一页';
  traceControls.appendChild(tracePrev);
  traceControls.appendChild(traceNext);
  tracePagination.appendChild(tracePageText);
  tracePagination.appendChild(traceControls);
  traceCard.appendChild(traceHeader);
  traceCard.appendChild(traceList);
  traceCard.appendChild(tracePagination);
  traceSection.appendChild(traceCard);

  overviewSection.appendChild(conversationCard);
  overviewSection.appendChild(sessionsCard);
  overviewSection.appendChild(filesCard);
  body.appendChild(overviewSection);
  body.appendChild(traceSection);

  const floatBar = document.createElement('div');
  floatBar.className = 'aide-compact-float';

  const floatRow = document.createElement('div');
  floatRow.className = 'aide-compact-float-row';
  const floatText = document.createElement('div');
  floatText.className = 'aide-compact-float-text';
  const floatToggle = document.createElement('button');
  floatToggle.className = 'aide-compact-button is-mini';
  floatToggle.textContent = '收起';
  floatRow.appendChild(floatText);
  floatRow.appendChild(floatToggle);

  const floatPanel = document.createElement('div');
  floatPanel.className = 'aide-compact-float-panel';
  const floatRunRow = document.createElement('div');
  floatRunRow.className = 'aide-compact-float-row';
  const runSelect = document.createElement('select');
  runSelect.className = 'aide-compact-select';
  runSelect.style.flex = '1';
  const runStatus = document.createElement('div');
  runStatus.className = 'aide-compact-row-text';
  runStatus.style.whiteSpace = 'nowrap';
  runStatus.style.maxWidth = '180px';
  runStatus.style.overflow = 'hidden';
  runStatus.style.textOverflow = 'ellipsis';
  const floatRefresh = document.createElement('button');
  floatRefresh.className = 'aide-compact-button is-mini';
  floatRefresh.textContent = '刷新';
  floatRefresh.disabled = !bridgeEnabled;
  floatRunRow.appendChild(runSelect);
  floatRunRow.appendChild(runStatus);
  floatRunRow.appendChild(floatRefresh);

  const dispatchInput = document.createElement('textarea');
  dispatchInput.className = 'aide-compact-input';
  dispatchInput.placeholder = '输入要发送给 CLI 的内容（Enter 发送，Shift+Enter 换行）';

  const floatActions = document.createElement('div');
  floatActions.className = 'aide-compact-float-actions';
  const stopButton = document.createElement('button');
  stopButton.className = 'aide-compact-button';
  stopButton.textContent = '停止';
  stopButton.disabled = true;
  const sendButton = document.createElement('button');
  sendButton.className = 'aide-compact-button';
  sendButton.textContent = '发送';
  sendButton.disabled = !bridgeEnabled;
  floatActions.appendChild(stopButton);
  floatActions.appendChild(sendButton);

  floatPanel.appendChild(floatRunRow);
  floatPanel.appendChild(dispatchInput);
  floatPanel.appendChild(floatActions);

  floatBar.appendChild(floatRow);
  floatBar.appendChild(floatPanel);

  const overlay = document.createElement('div');
  overlay.className = 'aide-compact-overlay';
  const overlayPanel = document.createElement('div');
  overlayPanel.className = 'aide-compact-overlay-panel';
  const overlayHeader = document.createElement('div');
  overlayHeader.className = 'aide-compact-overlay-header';
  const overlayTitle = document.createElement('div');
  overlayTitle.style.fontWeight = '700';
  const overlayActions = document.createElement('div');
  overlayActions.className = 'aide-compact-actions';
  const overlayRefresh = document.createElement('button');
  overlayRefresh.className = 'aide-compact-button is-mini';
  overlayRefresh.textContent = '刷新';
  overlayRefresh.style.display = 'none';
  const overlayClose = document.createElement('button');
  overlayClose.className = 'aide-compact-button is-mini';
  overlayClose.textContent = '关闭';
  overlayActions.appendChild(overlayRefresh);
  overlayActions.appendChild(overlayClose);
  overlayHeader.appendChild(overlayTitle);
  overlayHeader.appendChild(overlayActions);
  const overlayBody = document.createElement('div');
  overlayBody.className = 'aide-compact-overlay-body';
  overlayPanel.appendChild(overlayHeader);
  overlayPanel.appendChild(overlayBody);
  overlay.appendChild(overlayPanel);

  root.appendChild(header);
  root.appendChild(body);
  root.appendChild(floatBar);
  root.appendChild(overlay);
  container.appendChild(root);

  const RUN_FILTER_STORAGE_KEY = 'deepseek_cli.ui.runFilter';
  const RUN_FILTER_AUTO = '__auto__';
  const RUN_FILTER_ALL = 'all';
  const FLOATING_ISLAND_COLLAPSED_STORAGE_KEY = 'deepseek_cli.ui.floatingIsland.collapsed';

  function safeLocalStorageGet(key) {
    try {
      if (!window?.localStorage) return null;
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeLocalStorageSet(key, value) {
    try {
      if (!window?.localStorage) return;
      window.localStorage.setItem(key, value);
    } catch {
      // ignore storage errors
    }
  }

  function normalizeRunId(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || '';
  }

  const state = {
    events: null,
    fileChanges: { entries: [] },
    sessions: null,
    runs: { entries: [] },
    terminalStatuses: {},
    pageIndex: 1,
    tracePageIndex: 1,
    loading: false,
    sending: false,
    sessionAction: null,
    runSummary: { options: [], latestRunId: null },
    runFilter: RUN_FILTER_AUTO,
    floatCollapsed: safeLocalStorageGet(FLOATING_ISLAND_COLLAPSED_STORAGE_KEY) === '1',
    activeTab: 'overview',
  };
  const storedRunFilter = safeLocalStorageGet(RUN_FILTER_STORAGE_KEY);
  if (typeof storedRunFilter === 'string' && storedRunFilter.trim()) {
    state.runFilter = storedRunFilter.trim();
  }

  const CONVERSATION_LIMIT = 6;
  const SESSION_LIMIT = 6;
  const FILE_PAGE_SIZE = 6;
  const TRACE_PAGE_SIZE = 12;
  const SESSION_LOG_LINES = 400;

  const TYPE_LABELS = {
    user: '用户',
    assistant: '助手',
    assistant_thinking: '思考',
    system: '系统',
  };

  const EVENT_META = {
    user: { label: '用户', variant: 'info' },
    assistant: { label: '助手', variant: 'success' },
    assistant_thinking: { label: '思考', variant: 'warning' },
    system: { label: '系统', variant: 'warning' },
    tool_call: { label: '工具调用', variant: 'warning' },
    tool_result: { label: '工具结果', variant: 'info' },
    tool: { label: '工具', variant: 'info' },
    subagent_start: { label: '子代理', variant: 'warning' },
    subagent_done: { label: '子代理', variant: 'success' },
    subagent_thinking: { label: '子代理思考', variant: 'warning' },
    subagent_assistant: { label: '子代理回复', variant: 'success' },
    subagent_tool_call: { label: '子代理工具', variant: 'warning' },
    subagent_tool_result: { label: '子代理结果', variant: 'info' },
    subagent_tool: { label: '子代理工具', variant: 'info' },
  };

  function applyTheme(mode) {
    const isDark = mode === 'dark';
    root.style.setProperty('--aide-compact-text', isDark ? 'rgba(255,255,255,0.86)' : 'rgba(0,0,0,0.88)');
    root.style.setProperty(
      '--aide-compact-text-secondary',
      isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)'
    );
    root.style.setProperty('--aide-compact-border', isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)');
    root.style.setProperty('--aide-compact-border-strong', isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)');
    root.style.setProperty('--aide-compact-card-bg', isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)');
    root.style.setProperty('--aide-compact-muted-bg', isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)');
    root.style.setProperty('--aide-compact-alert-bg', isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)');
    root.style.setProperty('--aide-compact-button-bg', isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)');
    root.style.setProperty('--aide-compact-float-bg', isDark ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.96)');
    root.style.setProperty('--aide-compact-tag-bg', isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)');
    root.style.setProperty('--aide-compact-tag-text', isDark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.75)');
    root.style.setProperty('--aide-compact-tag-green-bg', isDark ? 'rgba(22,201,90,0.2)' : 'rgba(22,201,90,0.15)');
    root.style.setProperty('--aide-compact-tag-green-text', isDark ? '#7ff0a4' : '#168f3f');
    root.style.setProperty('--aide-compact-tag-orange-bg', isDark ? 'rgba(255,173,51,0.2)' : 'rgba(255,173,51,0.18)');
    root.style.setProperty('--aide-compact-tag-orange-text', isDark ? '#ffd08a' : '#b66a00');
    root.style.setProperty('--aide-compact-tag-red-bg', isDark ? 'rgba(255,77,79,0.22)' : 'rgba(255,77,79,0.16)');
    root.style.setProperty('--aide-compact-tag-red-text', isDark ? '#ff9c9e' : '#c0342c');
    root.style.setProperty('--aide-compact-tag-blue-bg', isDark ? 'rgba(64,169,255,0.25)' : 'rgba(64,169,255,0.2)');
    root.style.setProperty('--aide-compact-tag-blue-text', isDark ? '#9cd2ff' : '#1b6fa8');
    root.style.setProperty('--aide-compact-tab-active-bg', isDark ? 'rgba(64,169,255,0.2)' : 'rgba(64,169,255,0.22)');
    root.style.setProperty('--aide-compact-tab-active-text', isDark ? '#cfe8ff' : '#1b6fa8');
    root.style.setProperty('--aide-compact-tab-active-border', isDark ? 'rgba(64,169,255,0.45)' : 'rgba(64,169,255,0.5)');
  }

  const detectTheme = () => {
    if (typeof themeGet === 'function') return themeGet() === 'dark' ? 'dark' : 'light';
    const raw = document?.documentElement?.dataset?.theme || 'light';
    return raw === 'dark' ? 'dark' : 'light';
  };

  applyTheme(detectTheme());

  const removeThemeListener = typeof themeOnChange === 'function' ? themeOnChange((mode) => applyTheme(mode)) : null;

  function setAlert(message) {
    if (!message) {
      alert.style.display = 'none';
      alert.textContent = '';
      return;
    }
    alert.style.display = 'block';
    alert.textContent = message;
  }

  function truncateText(text, limit = 120) {
    if (!text) return '';
    const str = String(text);
    if (str.length <= limit) return str;
    return `${str.slice(0, limit)}...`;
  }

  function normalizeTimestamp(value) {
    if (!value) return null;
    if (typeof value === 'number') {
      return value < 1e12 ? value * 1000 : value;
    }
    if (typeof value === 'string') {
      const asNum = Number(value);
      if (!Number.isNaN(asNum)) return normalizeTimestamp(asNum);
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return null;
  }

  function formatTimestamp(value) {
    const ts = normalizeTimestamp(value);
    if (!ts) return '';
    const date = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
      date.getMinutes()
    )}`;
  }

  function buildEventPreview(payload) {
    if (!payload) return '';
    if (typeof payload.text === 'string') return payload.text;
    if (typeof payload.content === 'string') return payload.content;
    if (typeof payload.responsePreview === 'string') return payload.responsePreview;
    if (typeof payload.task === 'string') return payload.task;
    if (typeof payload === 'string') return payload;
    try {
      return JSON.stringify(payload);
    } catch {
      return String(payload);
    }
  }

  function getEventMeta(type) {
    const key = typeof type === 'string' ? type.trim() : '';
    if (EVENT_META[key]) return EVENT_META[key];
    if (key.includes('tool')) return { label: '工具', variant: 'warning' };
    if (key.includes('assistant')) return { label: '助手', variant: 'success' };
    if (key.includes('user')) return { label: '用户', variant: 'info' };
    if (key.includes('system')) return { label: '系统', variant: 'warning' };
    return { label: key || '事件', variant: 'info' };
  }

  function parseTimestampMs(value) {
    const ts = normalizeTimestamp(value);
    return typeof ts === 'number' ? ts : 0;
  }

  function buildRunSummary() {
    const stats = new Map();
    const touch = (runId, ts) => {
      const rid = normalizeRunId(runId);
      if (!rid) return;
      const ms = parseTimestampMs(ts);
      if (!stats.has(rid)) {
        stats.set(rid, { runId: rid, lastMs: ms });
        return;
      }
      const item = stats.get(rid);
      if (ms > item.lastMs) item.lastMs = ms;
    };
    const events = Array.isArray(state.events?.eventsList) ? state.events.eventsList : [];
    events.forEach((entry) => touch(entry?.runId, entry?.ts));
    const changes = Array.isArray(state.fileChanges?.entries) ? state.fileChanges.entries : [];
    changes.forEach((entry) => touch(entry?.runId, entry?.ts));
    const runs = Array.isArray(state.runs?.entries) ? state.runs.entries : [];
    runs.forEach((entry) => touch(entry?.runId, entry?.ts));
    const options = Array.from(stats.values()).sort((a, b) => b.lastMs - a.lastMs);
    const latestRunId = options.length > 0 ? options[0].runId : null;
    const formatted = options.map((item) => ({
      value: item.runId,
      label: item.lastMs ? `${item.runId} · ${formatTimestamp(item.lastMs)}` : item.runId,
    }));
    return { options: formatted, latestRunId };
  }

  function resolveActiveRunId() {
    const selection = typeof state.runFilter === 'string' ? state.runFilter.trim() : RUN_FILTER_AUTO;
    if (!selection || selection === RUN_FILTER_AUTO) return normalizeRunId(state.runSummary?.latestRunId);
    if (selection === RUN_FILTER_ALL) return '';
    return normalizeRunId(selection);
  }

  function getRunLabel() {
    const selection = typeof state.runFilter === 'string' ? state.runFilter.trim() : RUN_FILTER_AUTO;
    if (!selection || selection === RUN_FILTER_AUTO) {
      const latest = normalizeRunId(state.runSummary?.latestRunId);
      return latest ? `最近终端 ${latest}` : '最近终端';
    }
    if (selection === RUN_FILTER_ALL) return '全部终端';
    return selection;
  }

  function filterEntriesByRun(list) {
    const entries = Array.isArray(list) ? list : [];
    const selection = typeof state.runFilter === 'string' ? state.runFilter.trim() : RUN_FILTER_AUTO;
    if (selection === RUN_FILTER_ALL) return entries;
    const activeRunId = resolveActiveRunId();
    if (!activeRunId) return entries;
    return entries.filter((entry) => normalizeRunId(entry?.runId) === activeRunId);
  }

  function updateRunSelect() {
    const options = Array.isArray(state.runSummary?.options) ? state.runSummary.options : [];
    runSelect.textContent = '';
    const addOption = (label, value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      runSelect.appendChild(option);
    };
    addOption('最近终端', RUN_FILTER_AUTO);
    addOption('全部终端', RUN_FILTER_ALL);
    options.forEach((opt) => addOption(opt.label, opt.value));
    const current = typeof state.runFilter === 'string' ? state.runFilter.trim() : RUN_FILTER_AUTO;
    const hasCurrent = options.some((opt) => opt.value === current);
    if (current && current !== RUN_FILTER_AUTO && current !== RUN_FILTER_ALL && !hasCurrent) {
      addOption(current, current);
    }
    runSelect.value = current || RUN_FILTER_AUTO;
  }

  function setRunFilter(next) {
    const value = typeof next === 'string' ? next.trim() : '';
    const resolved = value || RUN_FILTER_AUTO;
    state.runFilter = resolved;
    state.pageIndex = 1;
    state.tracePageIndex = 1;
    safeLocalStorageSet(RUN_FILTER_STORAGE_KEY, resolved);
    updateRunSelect();
    renderAll();
  }

  function dedupeFileChanges(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const seen = new Set();
    const result = [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const item = list[i];
      const key = item?.path || item?.absolutePath;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result;
  }

  function createTag(label, variant) {
    const tag = document.createElement('span');
    tag.className = `aide-compact-tag${variant ? ` ${variant}` : ''}`;
    tag.textContent = label;
    return tag;
  }

  function createActionButton(label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'aide-compact-button is-mini';
    button.textContent = label;
    if (typeof onClick === 'function') {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        onClick();
      });
    }
    return button;
  }

  function openOverlay({ title, body, onRefresh }) {
    overlayTitle.textContent = title || '';
    overlayBody.textContent = body || '';
    if (typeof onRefresh === 'function') {
      overlayRefresh.style.display = '';
      overlayRefresh.onclick = onRefresh;
    } else {
      overlayRefresh.style.display = 'none';
      overlayRefresh.onclick = null;
    }
    overlay.style.display = 'flex';
  }

  function closeOverlay() {
    overlay.style.display = 'none';
    overlayBody.textContent = '';
    overlayTitle.textContent = '';
    overlayRefresh.onclick = null;
  }

  async function loadSessionLog(name) {
    if (!bridgeEnabled || !name) return;
    overlayBody.textContent = '加载中...';
    try {
      const result = await api.invoke('sessions:readLog', { name, lineCount: SESSION_LOG_LINES });
      overlayBody.textContent = result?.content || '暂无日志';
    } catch (err) {
      overlayBody.textContent = err?.message || '加载日志失败';
    }
  }

  function openSessionLog(record) {
    const name = typeof record?.name === 'string' ? record.name.trim() : '';
    if (!name) return;
    openOverlay({
      title: `会话日志 · ${name}`,
      body: '加载中...',
      onRefresh: () => loadSessionLog(name),
    });
    loadSessionLog(name);
  }

  async function runSessionAction(action, name) {
    if (!bridgeEnabled || !name) return;
    state.sessionAction = { name, action };
    renderSessions();
    try {
      if (action === 'stop') {
        await api.invoke('sessions:stop', { name });
      } else if (action === 'restart') {
        await api.invoke('sessions:restart', { name });
      } else if (action === 'kill') {
        await api.invoke('sessions:kill', { name });
      }
      await loadSessions();
      setAlert('');
    } catch (err) {
      setAlert(err?.message || '会话操作失败');
    } finally {
      state.sessionAction = null;
      renderSessions();
    }
  }

  function confirmSessionAction(action, record) {
    const name = typeof record?.name === 'string' ? record.name.trim() : '';
    if (!name) return;
    const label = action === 'stop' ? '停止' : action === 'restart' ? '重启' : '关闭';
    const confirmed = window.confirm(`${label}会话 ${name}？`);
    if (!confirmed) return;
    runSessionAction(action, name);
  }

  function openEventDetail(event) {
    const meta = getEventMeta(event?.type);
    const title = `${meta?.label || event?.type || '事件'} · ${formatTimestamp(event?.ts) || ''}`;
    let payload = '';
    try {
      payload = JSON.stringify(event, null, 2);
    } catch {
      payload = String(event || '');
    }
    openOverlay({ title, body: payload });
  }

  function renderConversation() {
    const events = Array.isArray(state.events?.eventsList) ? state.events.eventsList : [];
    const scopedEvents = filterEntriesByRun(events);
    const conversation = scopedEvents.filter((item) =>
      ['user', 'assistant', 'assistant_thinking', 'system'].includes(item?.type)
    );
    const recent = conversation.slice(-CONVERSATION_LIMIT).reverse();
    const runLabel = getRunLabel();
    conversationMeta.textContent = recent.length > 0 ? `${recent.length} 条 · ${runLabel}` : `暂无 · ${runLabel}`;
    conversationList.textContent = '';
    if (recent.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'aide-compact-row-text';
      empty.textContent = '暂无对话事件';
      conversationList.appendChild(empty);
      return;
    }
    recent.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'aide-compact-row';
      const tag = createTag(TYPE_LABELS[entry?.type] || entry?.type || '未知', 'info');
      const main = document.createElement('div');
      main.className = 'aide-compact-row-main';
      const preview = document.createElement('div');
      preview.className = 'aide-compact-row-title';
      preview.textContent = truncateText(buildEventPreview(entry?.payload), 120) || '无内容';
      const time = document.createElement('div');
      time.className = 'aide-compact-row-text';
      time.textContent = formatTimestamp(entry?.ts) || '';
      main.appendChild(preview);
      if (time.textContent) main.appendChild(time);
      row.appendChild(tag);
      row.appendChild(main);
      conversationList.appendChild(row);
    });
  }

  function renderSessions() {
    const sessions = Array.isArray(state.sessions?.sessions) ? state.sessions.sessions : [];
    const runningCount = sessions.filter((item) => item?.running).length;
    sessionsMeta.textContent = sessions.length > 0 ? `运行 ${runningCount}/${sessions.length}` : '暂无';
    sessionsList.textContent = '';
    if (!state.sessions) {
      const empty = document.createElement('div');
      empty.className = 'aide-compact-row-text';
      empty.textContent = '等待加载会话...';
      sessionsList.appendChild(empty);
      return;
    }
    if (sessions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'aide-compact-row-text';
      empty.textContent = '暂无后台会话';
      sessionsList.appendChild(empty);
      return;
    }
    const list = sessions.slice(0, SESSION_LIMIT);
    list.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'aide-compact-row';
      const tag = createTag(item?.running ? '运行中' : '已停止', item?.running ? 'success' : '');
      const main = document.createElement('div');
      main.className = 'aide-compact-row-main';
      const name = document.createElement('div');
      name.className = 'aide-compact-row-title';
      name.textContent = item?.name || '未命名会话';
      const metaText = document.createElement('div');
      metaText.className = 'aide-compact-row-text';
      const pid = typeof item?.resolvedPid === 'number' ? item.resolvedPid : item?.pid;
      const port = Array.isArray(item?.ports) && item.ports.length > 0 ? item.ports[0] : item?.port;
      const parts = [];
      if (pid) parts.push(`PID ${pid}`);
      if (port) parts.push(`端口 ${port}`);
      if (item?.startedAt) parts.push(formatTimestamp(item.startedAt));
      metaText.textContent = parts.join(' · ');
      main.appendChild(name);
      if (metaText.textContent) main.appendChild(metaText);
      const actions = document.createElement('div');
      actions.className = 'aide-compact-actions';
      actions.style.marginLeft = 'auto';
      actions.style.flexShrink = '0';
      const busy = state.sessionAction && state.sessionAction.name === item?.name;
      const canRestart = Boolean(String(item?.command || '').trim());
      const logButton = createActionButton('日志', () => openSessionLog(item));
      const stopAction = createActionButton('停止', () => confirmSessionAction('stop', item));
      const restartAction = createActionButton('重启', () => confirmSessionAction('restart', item));
      const killAction = createActionButton('关闭', () => confirmSessionAction('kill', item));
      stopAction.disabled = !item?.running || busy;
      restartAction.disabled = !canRestart || busy;
      killAction.disabled = busy;
      logButton.disabled = !item?.name || busy;
      actions.appendChild(logButton);
      actions.appendChild(stopAction);
      actions.appendChild(restartAction);
      actions.appendChild(killAction);

      row.appendChild(tag);
      row.appendChild(main);
      row.appendChild(actions);
      sessionsList.appendChild(row);
    });
  }

  function renderFileChanges() {
    const filtered = filterEntriesByRun(state.fileChanges?.entries);
    const deduped = dedupeFileChanges(filtered);
    const totalPages = Math.max(1, Math.ceil(deduped.length / FILE_PAGE_SIZE));
    if (state.pageIndex > totalPages) state.pageIndex = totalPages;
    const start = (state.pageIndex - 1) * FILE_PAGE_SIZE;
    const pageItems = deduped.slice(start, start + FILE_PAGE_SIZE);
    const runLabel = getRunLabel();
    filesMeta.textContent = deduped.length > 0 ? `${deduped.length} 条 · ${runLabel}` : `暂无 · ${runLabel}`;
    filesList.textContent = '';
    if (deduped.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'aide-compact-row-text';
      empty.textContent = '暂无文件改动';
      filesList.appendChild(empty);
    } else {
      pageItems.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'aide-compact-row';
        let variant = '';
        let label = '修改';
        if (item?.changeType === 'created') {
          variant = 'success';
          label = '新增';
        } else if (item?.changeType === 'deleted') {
          variant = 'danger';
          label = '删除';
        } else if (item?.changeType) {
          variant = 'warning';
          label = '修改';
        }
        const tag = createTag(label, variant);
        const main = document.createElement('div');
        main.className = 'aide-compact-row-main';
        const name = document.createElement('div');
        name.className = 'aide-compact-row-title';
        name.textContent = item?.path || item?.absolutePath || '未知文件';
        const metaText = document.createElement('div');
        metaText.className = 'aide-compact-row-text';
        const detailParts = [];
        if (item?.tool) detailParts.push(`tool ${item.tool}`);
        if (item?.server) detailParts.push(item.server);
        if (item?.ts) detailParts.push(formatTimestamp(item.ts));
        metaText.textContent = detailParts.join(' · ');
        main.appendChild(name);
        if (metaText.textContent) main.appendChild(metaText);
        row.appendChild(tag);
        row.appendChild(main);
        filesList.appendChild(row);
      });
    }
    filesPageText.textContent = `第 ${state.pageIndex} / ${totalPages} 页`;
    filesPrev.disabled = state.pageIndex <= 1;
    filesNext.disabled = state.pageIndex >= totalPages;
  }

  function renderTrace() {
    const events = filterEntriesByRun(state.events?.eventsList);
    const ordered = Array.isArray(events) ? events.slice().reverse() : [];
    const totalPages = Math.max(1, Math.ceil(ordered.length / TRACE_PAGE_SIZE));
    if (state.tracePageIndex > totalPages) state.tracePageIndex = totalPages;
    const start = (state.tracePageIndex - 1) * TRACE_PAGE_SIZE;
    const pageItems = ordered.slice(start, start + TRACE_PAGE_SIZE);
    const runLabel = getRunLabel();
    traceMeta.textContent = ordered.length > 0 ? `${ordered.length} 条 · ${runLabel}` : `暂无 · ${runLabel}`;
    traceList.textContent = '';
    if (ordered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'aide-compact-row-text';
      empty.textContent = '暂无事件';
      traceList.appendChild(empty);
    } else {
      pageItems.forEach((item) => {
        const meta = getEventMeta(item?.type);
        const row = document.createElement('div');
        row.className = 'aide-compact-row is-clickable';
        row.addEventListener('click', () => openEventDetail(item));
        const tag = createTag(meta?.label || item?.type || '事件', meta?.variant || 'info');
        const main = document.createElement('div');
        main.className = 'aide-compact-row-main';
        const preview = document.createElement('div');
        preview.className = 'aide-compact-row-title';
        preview.textContent = truncateText(buildEventPreview(item?.payload), 120) || '无内容';
        const metaText = document.createElement('div');
        metaText.className = 'aide-compact-row-text';
        const runId = normalizeRunId(item?.runId);
        const infoParts = [];
        if (runId) infoParts.push(`run ${runId}`);
        const timeText = formatTimestamp(item?.ts);
        if (timeText) infoParts.push(timeText);
        metaText.textContent = infoParts.join(' · ');
        main.appendChild(preview);
        if (metaText.textContent) main.appendChild(metaText);
        row.appendChild(tag);
        row.appendChild(main);
        traceList.appendChild(row);
      });
    }
    tracePageText.textContent = `第 ${state.tracePageIndex} / ${totalPages} 页`;
    tracePrev.disabled = state.tracePageIndex <= 1;
    traceNext.disabled = state.tracePageIndex >= totalPages;
  }

  function renderFloatingBar() {
    const sessions = Array.isArray(state.sessions?.sessions) ? state.sessions.sessions : [];
    const runningCount = sessions.filter((item) => item?.running).length;
    const fileTotal = dedupeFileChanges(filterEntriesByRun(state.fileChanges?.entries)).length;
    const events = filterEntriesByRun(state.events?.eventsList);
    const lastEvent = events.length > 0 ? events[events.length - 1] : null;
    const lastEventText = lastEvent?.ts ? formatTimestamp(lastEvent.ts) : '';
    const runLabel = getRunLabel();
    const activeRunId = resolveActiveRunId();
    const status = activeRunId ? state.terminalStatuses?.[activeRunId] : null;
    const statusText = activeRunId
      ? status?.state === 'running'
        ? '运行中'
        : status?.state === 'exited'
          ? '已停止'
          : status?.state || '未知状态'
      : '未选择终端';
    runStatus.textContent = statusText;
    stopButton.disabled = !(status && status.state === 'running');
    sendButton.disabled = !bridgeEnabled || state.sending || !dispatchInput.value.trim();
    dispatchInput.disabled = !bridgeEnabled || state.sending;
    sendButton.textContent = state.sending ? '发送中...' : '发送';
    floatToggle.textContent = state.floatCollapsed ? '展开' : '收起';
    floatBar.classList.toggle('is-collapsed', state.floatCollapsed);
    floatPanel.style.display = state.floatCollapsed ? 'none' : 'flex';
    const parts = [];
    parts.push(runLabel);
    if (activeRunId && statusText) parts.push(statusText);
    parts.push(`会话 ${runningCount}/${sessions.length || 0}`);
    parts.push(`文件 ${fileTotal}`);
    if (lastEventText) parts.push(`最近事件 ${lastEventText}`);
    floatText.textContent = parts.join(' · ');
  }

  function applyActiveTab() {
    const active = state.activeTab === 'trace' ? 'trace' : 'overview';
    overviewTab.classList.toggle('is-active', active === 'overview');
    traceTab.classList.toggle('is-active', active === 'trace');
    overviewSection.style.display = active === 'overview' ? 'flex' : 'none';
    traceSection.style.display = active === 'trace' ? 'flex' : 'none';
  }

  function setActiveTab(tab) {
    state.activeTab = tab === 'trace' ? 'trace' : 'overview';
    applyActiveTab();
  }

  function renderAll() {
    state.runSummary = buildRunSummary();
    updateRunSelect();
    renderConversation();
    renderSessions();
    renderFileChanges();
    renderTrace();
    renderFloatingBar();
    applyActiveTab();
  }

  function setLoading(loading) {
    state.loading = loading;
    const disabled = !bridgeEnabled || loading;
    refreshButton.disabled = disabled;
    sessionsRefresh.disabled = disabled;
    filesRefresh.disabled = disabled;
    floatRefresh.disabled = disabled;
    refreshButton.textContent = loading ? '刷新中...' : '刷新';
    sessionsRefresh.textContent = loading ? '刷新中...' : '刷新';
    filesRefresh.textContent = loading ? '刷新中...' : '刷新';
    floatRefresh.textContent = loading ? '刷新中...' : '刷新';
  }

  async function loadEvents() {
    if (!bridgeEnabled) return;
    const data = await api.invoke('events:read');
    state.events = data || { eventsList: [] };
  }

  async function loadFileChanges() {
    if (!bridgeEnabled) return;
    const data = await api.invoke('fileChanges:read');
    state.fileChanges = data || { entries: [] };
  }

  async function loadSessions() {
    if (!bridgeEnabled) return;
    const data = await api.invoke('sessions:list');
    state.sessions = data || { sessions: [] };
  }

  async function loadRuns() {
    if (!bridgeEnabled) return;
    try {
      const data = await api.invoke('runs:read');
      state.runs = data || { entries: [] };
    } catch {
      state.runs = { entries: [] };
    }
  }

  async function loadTerminalStatuses() {
    if (!bridgeEnabled) return;
    try {
      const payload = await api.invoke('terminalStatus:list');
      const statuses = Array.isArray(payload?.statuses) ? payload.statuses : [];
      const map = {};
      statuses.forEach((item) => {
        const rid = normalizeRunId(item?.runId);
        if (!rid) return;
        map[rid] = item;
      });
      state.terminalStatuses = map;
    } catch {
      state.terminalStatuses = {};
    }
  }

  async function refreshAll() {
    if (!bridgeEnabled || state.loading) return;
    setLoading(true);
    try {
      await Promise.all([loadEvents(), loadFileChanges(), loadSessions(), loadRuns(), loadTerminalStatuses()]);
      setAlert('');
    } catch (err) {
      setAlert(err?.message || '加载失败');
    } finally {
      setLoading(false);
      renderAll();
    }
  }

  function resolveDispatchRunId() {
    const selection = typeof state.runFilter === 'string' ? state.runFilter.trim() : RUN_FILTER_AUTO;
    if (!selection || selection === RUN_FILTER_AUTO) return normalizeRunId(state.runSummary?.latestRunId);
    if (selection === RUN_FILTER_ALL) return '';
    return normalizeRunId(selection);
  }

  async function sendMessage({ force = false } = {}) {
    if (!bridgeEnabled) {
      setAlert('IPC bridge 未启用，无法发送消息。');
      return;
    }
    const text = dispatchInput.value.trim();
    if (!text) return;
    state.sending = true;
    renderFloatingBar();
    try {
      const runId = resolveDispatchRunId();
      const result = await api.invoke('terminal:dispatch', {
        text,
        runId: runId || undefined,
        force,
      });
      if (result?.ok === false && result?.reason === 'busy' && !force) {
        state.sending = false;
        renderFloatingBar();
        const confirmed = window.confirm('该终端正在执行中，是否打断并发送新的消息？');
        if (confirmed) {
          await sendMessage({ force: true });
        }
        return;
      }
      if (result?.ok === false) {
        throw new Error(result?.message || '发送失败');
      }
      if (result?.runId) {
        setRunFilter(result.runId);
      }
      dispatchInput.value = '';
      setAlert('');
    } catch (err) {
      setAlert(err?.message || '发送失败');
    } finally {
      state.sending = false;
      renderFloatingBar();
    }
  }

  async function stopRun() {
    if (!bridgeEnabled) {
      setAlert('IPC bridge 未启用，无法停止。');
      return;
    }
    const runId = resolveDispatchRunId();
    if (!runId) {
      setAlert('请先选择一个终端。');
      return;
    }
    try {
      await api.invoke('terminal:stop', { runId });
      setAlert('');
    } catch (err) {
      setAlert(err?.message || '停止失败');
    }
  }

  refreshButton.addEventListener('click', refreshAll);
  floatRefresh.addEventListener('click', refreshAll);
  overviewTab.addEventListener('click', () => setActiveTab('overview'));
  traceTab.addEventListener('click', () => setActiveTab('trace'));
  runSelect.addEventListener('change', (event) => setRunFilter(event.target.value));
  floatToggle.addEventListener('click', () => {
    state.floatCollapsed = !state.floatCollapsed;
    safeLocalStorageSet(FLOATING_ISLAND_COLLAPSED_STORAGE_KEY, state.floatCollapsed ? '1' : '0');
    renderFloatingBar();
  });
  dispatchInput.addEventListener('input', () => renderFloatingBar());
  dispatchInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    if (event.shiftKey) return;
    event.preventDefault();
    sendMessage();
  });
  sendButton.addEventListener('click', () => sendMessage());
  stopButton.addEventListener('click', stopRun);
  overlayClose.addEventListener('click', closeOverlay);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeOverlay();
  });
  sessionsRefresh.addEventListener('click', async () => {
    if (!bridgeEnabled || state.loading) return;
    setLoading(true);
    try {
      await loadSessions();
      setAlert('');
    } catch (err) {
      setAlert(err?.message || '加载会话失败');
    } finally {
      setLoading(false);
      renderAll();
    }
  });
  filesRefresh.addEventListener('click', async () => {
    if (!bridgeEnabled || state.loading) return;
    setLoading(true);
    try {
      await loadFileChanges();
      setAlert('');
    } catch (err) {
      setAlert(err?.message || '加载文件改动失败');
    } finally {
      setLoading(false);
      renderAll();
    }
  });

  filesPrev.addEventListener('click', () => {
    if (state.pageIndex <= 1) return;
    state.pageIndex -= 1;
    renderFileChanges();
  });
  filesNext.addEventListener('click', () => {
    state.pageIndex += 1;
    renderFileChanges();
  });
  tracePrev.addEventListener('click', () => {
    if (state.tracePageIndex <= 1) return;
    state.tracePageIndex -= 1;
    renderTrace();
  });
  traceNext.addEventListener('click', () => {
    state.tracePageIndex += 1;
    renderTrace();
  });

  const unsubs = [];
  if (bridgeEnabled) {
    try {
      unsubs.push(
        api.on('events:update', (data) => {
          state.events = data || { eventsList: [] };
          renderAll();
        })
      );
      unsubs.push(
        api.on('fileChanges:update', (data) => {
          state.fileChanges = data || { entries: [] };
          renderAll();
        })
      );
      unsubs.push(
        api.on('runs:update', (data) => {
          state.runs = data || { entries: [] };
          renderAll();
        })
      );
      unsubs.push(
        api.on('terminalStatus:update', (payload) => {
          const statuses = Array.isArray(payload?.statuses) ? payload.statuses : [];
          const map = {};
          statuses.forEach((item) => {
            const rid = normalizeRunId(item?.runId);
            if (!rid) return;
            map[rid] = item;
          });
          state.terminalStatuses = map;
          renderFloatingBar();
        })
      );
    } catch (err) {
      setAlert(err?.message || '监听更新失败');
    }
  } else {
    setAlert('IPC bridge 未启用，无法读取会话与文件数据。');
  }

  renderAll();
  if (bridgeEnabled) refreshAll();

  return () => {
    try {
      unsubs.forEach((fn) => (typeof fn === 'function' ? fn() : null));
      if (typeof removeThemeListener === 'function') removeThemeListener();
      container.textContent = '';
    } catch {
      // ignore
    }
  };
}
