import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Popconfirm, Select, Space, Switch, Tag, Typography, message } from 'antd';

import {
  FLOATING_ISLAND_COLLAPSED_STORAGE_KEY,
  RUN_FILTER_ALL,
  RUN_FILTER_AUTO,
  RUN_FILTER_UNKNOWN,
  safeLocalStorageGet,
  safeLocalStorageSet,
} from '../../lib/storage.js';
import { normalizeRunId } from '../../lib/runs.js';
import { formatAideDropText, getAideDragPayload, getAideDragText } from '../../lib/dnd.js';
import { FloatingIslandPrompt } from './floating-island/FloatingIslandPrompt.jsx';

const { Text } = Typography;
const { TextArea } = Input;

function FloatingIsland({
  containerRef,
  input,
  onInputChange,
  onSend,
  onCorrect,
  onSummaryNow,
  sending,
  uiPrompt,
  uiPromptCount,
  onUiPromptRespond,
  runtimeSettings,
  onSaveSettings,
  landConfigs,
  runFilter,
  runOptions,
  onRunFilterChange,
  onOpenTasksDrawer,
  onClearCache,
  clearingCache,
  activeRunCwd,
  cwdPickerVisible,
  cwd,
  onPickCwd,
  onClearCwd,
  stopVisible,
  onStop,
  stopping,
  closeVisible,
  onClose,
  closing,
}) {
  const requestId = typeof uiPrompt?.requestId === 'string' ? uiPrompt.requestId.trim() : '';
  const prompt = uiPrompt?.prompt && typeof uiPrompt.prompt === 'object' ? uiPrompt.prompt : null;
  const promptKind = typeof prompt?.kind === 'string' ? prompt.kind.trim() : '';
  const promptActive = Boolean(
    requestId && (promptKind === 'kv' || promptKind === 'choice' || promptKind === 'task_confirm' || promptKind === 'file_change_confirm')
  );
  const promptRunId = normalizeRunId(uiPrompt?.runId);
  const allowCancel = prompt?.allowCancel !== false;
  const pendingCount = Number.isFinite(Number(uiPromptCount)) ? Number(uiPromptCount) : 0;
  const [collapsed, setCollapsed] = useState(() => safeLocalStorageGet(FLOATING_ISLAND_COLLAPSED_STORAGE_KEY) === '1');
  const [dropActive, setDropActive] = useState(false);
  const dropCounterRef = useRef(0);
  const dispatchInputRef = useRef(null);

  useEffect(() => {
    safeLocalStorageSet(FLOATING_ISLAND_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    if (promptActive) setCollapsed(false);
  }, [promptActive, requestId]);

  const [settingsSaving, setSettingsSaving] = useState(false);

  const applyRuntimeSettingsPatch = async (patch) => {
    if (typeof onSaveSettings !== 'function') {
      message.error('IPC bridge not available');
      return;
    }
    if (!patch || typeof patch !== 'object') return;
    try {
      setSettingsSaving(true);
      await onSaveSettings(patch);
      message.success('已更新');
    } catch (err) {
      message.error(err?.message || '更新失败');
    } finally {
      setSettingsSaving(false);
    }
  };

  const confirmMainTaskCreate = runtimeSettings?.confirmMainTaskCreate === true;
  const confirmSubTaskCreate = runtimeSettings?.confirmSubTaskCreate === true;
  const confirmFileChanges = runtimeSettings?.confirmFileChanges === true;
  const landConfigId = typeof runtimeSettings?.landConfigId === 'string' ? runtimeSettings.landConfigId.trim() : '';
  const landConfigOptions = useMemo(() => {
    const list = Array.isArray(landConfigs) ? landConfigs : [];
    const options = list
      .filter((config) => config?.id)
      .map((config) => ({
        label: config?.name ? config.name : config?.id,
        value: config?.id,
      }));
    return [{ label: '不使用 land_configs', value: '' }, ...options];
  }, [landConfigs]);
  const uiTerminalMode = useMemo(() => {
    const raw = typeof runtimeSettings?.uiTerminalMode === 'string' ? runtimeSettings.uiTerminalMode.trim().toLowerCase() : '';
    if (raw === 'system' || raw === 'headless' || raw === 'auto') return raw;
    return 'auto';
  }, [runtimeSettings]);
  const platformPrefersSystemTerminal = useMemo(() => {
    const platform = typeof navigator !== 'undefined' ? String(navigator.platform || '') : '';
    const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
    const haystack = `${platform} ${ua}`.toLowerCase();
    return haystack.includes('mac') || haystack.includes('win');
  }, []);
  const openSystemTerminalOnSend =
    uiTerminalMode === 'system' ? true : uiTerminalMode === 'headless' ? false : platformPrefersSystemTerminal;

  const runLabel = useMemo(() => {
    const value = runFilter || RUN_FILTER_ALL;
    const options = Array.isArray(runOptions) ? runOptions : [];
    const found = options.find((opt) => opt && opt.value === value);
    if (found && typeof found.label === 'string' && found.label.trim()) return found.label.trim();
    return value;
  }, [runFilter, runOptions]);

  const toggleCollapsed = () => setCollapsed((prev) => !prev);

  const appendToInput = (text) => {
    if (typeof onInputChange !== 'function') return;
    const next = typeof text === 'string' ? text : '';
    if (!next.trim()) return;
    const current = typeof input === 'string' ? input : '';
    const separator = current && !current.endsWith('\n') ? '\n' : '';
    onInputChange(`${current || ''}${separator}${next}`);
    setTimeout(() => {
      dispatchInputRef.current?.focus?.();
    }, 0);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    dropCounterRef.current = 0;
    setDropActive(false);
    if (collapsed) setCollapsed(false);
    if (promptActive) {
      message.info('当前有待处理的确认项，暂不支持拖入输入框。');
      return;
    }

    const payload = getAideDragPayload(event);
    const formatted = payload ? formatAideDropText(payload) : '';
    const fallback = formatted || getAideDragText(event);
    if (!fallback || !fallback.trim()) return;
    appendToInput(fallback);
  };

  return (
    <div className="ds-floating-island" ref={containerRef}>
      <div
        className={`ds-floating-island-inner${collapsed ? ' is-collapsed' : ''}${dropActive ? ' is-drag-over' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault();
          dropCounterRef.current += 1;
          setDropActive(true);
          if (collapsed) setCollapsed(false);
        }}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDragLeave={() => {
          dropCounterRef.current = Math.max(0, dropCounterRef.current - 1);
          if (dropCounterRef.current === 0) setDropActive(false);
        }}
        onDrop={handleDrop}
      >
        <div
          className="ds-floating-island-handle"
          role="button"
          tabIndex={0}
          aria-expanded={!collapsed}
          onClick={toggleCollapsed}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
            e.preventDefault();
            toggleCollapsed();
          }}
        >
          <Space align="center" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space size={8} align="center" wrap>
              <Text strong>灵动岛</Text>
              <Tag color="blue">
                <Text ellipsis={{ tooltip: runLabel }} style={{ maxWidth: 300 }}>
                  {runLabel}
                </Text>
              </Tag>
              {pendingCount > 0 ? <Tag color="purple">待处理 {pendingCount}</Tag> : null}
              {sending ? <Tag color="gold">发送中</Tag> : null}
            </Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {collapsed ? '点击展开' : '点击收起'}
            </Text>
          </Space>
        </div>

        {collapsed ? null : (
          <div style={{ marginTop: 12 }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Space size={8} align="center" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                <Space size={8} align="center" wrap>
                  <Select
                    size="large"
                    value={landConfigId || ''}
                    onChange={(value) => applyRuntimeSettingsPatch({ landConfigId: value || '' })}
                    options={landConfigOptions}
                    style={{ minWidth: 220 }}
                    dropdownStyle={{ zIndex: 1301 }}
                    showSearch
                    optionFilterProp="label"
                    placeholder="选择 land_config"
                    disabled={settingsSaving}
                  />
                  <Select
                    size="large"
                    value={runFilter || RUN_FILTER_ALL}
                    onChange={(val) => (typeof onRunFilterChange === 'function' ? onRunFilterChange(val) : null)}
                    options={Array.isArray(runOptions) ? runOptions : [{ label: '全部终端', value: RUN_FILTER_ALL }]}
                    style={{ minWidth: 260 }}
                    dropdownStyle={{ zIndex: 1301 }}
                    showSearch
                    optionFilterProp="label"
                    placeholder="选择终端(runId)"
                  />
                  {(() => {
                    const selected = typeof runFilter === 'string' ? runFilter.trim() : '';
                    const isConcrete =
                      selected &&
                      selected !== RUN_FILTER_AUTO &&
                      selected !== RUN_FILTER_ALL &&
                      selected !== RUN_FILTER_UNKNOWN;
                    if (!isConcrete) return null;
                    const cwdText = typeof activeRunCwd === 'string' ? activeRunCwd.trim() : '';
                    return (
                      <Text type="secondary" ellipsis={{ tooltip: cwdText || '未知' }} style={{ maxWidth: 420 }}>
                        目录: {cwdText || '未知'}
                      </Text>
                    );
                  })()}
                  <Button size="large" onClick={onOpenTasksDrawer}>
                    打开任务抽屉
                  </Button>
                  <Popconfirm
                    title="清除所有缓存?"
                    description="会移除任务列表、工具调用记录、会话/事件日志、文件改动记录与快照。"
                    okText="确认清除"
                    cancelText="再想想"
                    zIndex={1302}
                    onConfirm={onClearCache}
                  >
                    <Button size="large" danger loading={clearingCache}>
                      清除所有缓存
                    </Button>
                  </Popconfirm>
                  {cwdPickerVisible ? (
                    <Space size={6} align="center" wrap>
                      <Button size="large" onClick={onPickCwd}>
                        {cwd ? '更换目录' : '选择目录'}
                      </Button>
                      {cwd ? (
                        <Text type="secondary" ellipsis={{ tooltip: cwd }} style={{ maxWidth: 420 }}>
                          {cwd}
                        </Text>
                      ) : (
                        <Text type="secondary">未选择目录</Text>
                      )}
                      {cwd ? (
                        <Button size="large" onClick={onClearCwd}>
                          清除
                        </Button>
                      ) : null}
                    </Space>
                  ) : null}
                </Space>
              </Space>

              <Space size={10} align="center" wrap>
                <Text type="secondary">开关：</Text>
                <Space size={6} align="center">
                  <Switch
                    checked={confirmMainTaskCreate}
                    onChange={(checked) => applyRuntimeSettingsPatch({ confirmMainTaskCreate: checked })}
                    disabled={settingsSaving}
                  />
                  <Text>主流程任务创建确认</Text>
                </Space>
                <Space size={6} align="center">
                  <Switch
                    checked={confirmSubTaskCreate}
                    onChange={(checked) => applyRuntimeSettingsPatch({ confirmSubTaskCreate: checked })}
                    disabled={settingsSaving}
                  />
                  <Text>子流程任务创建确认</Text>
                </Space>
                <Space size={6} align="center">
                  <Switch
                    checked={confirmFileChanges}
                    onChange={(checked) => applyRuntimeSettingsPatch({ confirmFileChanges: checked })}
                    disabled={settingsSaving}
                  />
                  <Text>文件变更</Text>
                </Space>
                <Space size={6} align="center">
                  <Switch
                    checked={openSystemTerminalOnSend}
                    onChange={(checked) => applyRuntimeSettingsPatch({ uiTerminalMode: checked ? 'system' : 'headless' })}
                    disabled={settingsSaving}
                  />
                  <Text>拉起终端</Text>
                </Space>
              </Space>

              {promptActive ? (
                <FloatingIslandPrompt
                  promptActive={promptActive}
                  promptKind={promptKind}
                  prompt={prompt}
                  requestId={requestId}
                  promptRunId={promptRunId}
                  allowCancel={allowCancel}
                  pendingCount={pendingCount}
                  onUiPromptRespond={onUiPromptRespond}
                />
              ) : (
                <>
                  <TextArea
                    className="ds-dispatch-input"
                    ref={dispatchInputRef}
                    value={input}
                    onChange={(e) => onInputChange(e.target.value)}
                    placeholder={
                      stopVisible
                        ? '输入纠正内容...（Enter 纠正 / Shift+Enter 换行）'
                        : '输入要发送给 CLI 的内容...（Enter 发送 / Shift+Enter 换行）'
                    }
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      if (e.shiftKey) return;
                      e.preventDefault();
                      if (stopVisible) {
                        if (typeof onCorrect === 'function') onCorrect();
                        return;
                      }
                      if (typeof onSend === 'function') onSend();
                    }}
                    autoSize={{ minRows: 1, maxRows: 8 }}
                    style={{ width: '100%' }}
                    disabled={sending}
                    allowClear
                  />

                  <Space size={10} align="center" style={{ width: '100%', justifyContent: 'flex-end' }} wrap>
                    {closeVisible ? (
                      <Button size="large" danger loading={closing} onClick={onClose}>
                        关闭终端
                      </Button>
                    ) : null}
                    {stopVisible ? (
                      <Button size="large" danger loading={stopping} onClick={onStop}>
                        停止
                      </Button>
                    ) : null}
                    <Button
                      size="large"
                      onClick={() => (typeof onSummaryNow === 'function' ? onSummaryNow() : null)}
                      disabled={!closeVisible}
                    >
                      立即总结
                    </Button>
                    <Button
                      size="large"
                      danger
                      loading={sending}
                      onClick={() => (typeof onCorrect === 'function' ? onCorrect() : null)}
                      disabled={!input || !input.trim()}
                    >
                      纠正
                    </Button>
                    {stopVisible ? null : (
                      <Button
                        size="large"
                        type="primary"
                        loading={sending}
                        onClick={onSend}
                        disabled={!input || !input.trim()}
                      >
                        发送
                      </Button>
                    )}
                  </Space>
                </>
              )}
            </Space>
          </div>
        )}
      </div>
    </div>
  );
}


export { FloatingIsland };
