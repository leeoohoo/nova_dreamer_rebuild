import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Drawer, Empty, List, Space, Tag, Tooltip, Typography } from 'antd';
import { SmileOutlined } from '@ant-design/icons';

import { api, hasApi } from '../lib/api.js';
import { normalizeRunId } from '../lib/runs.js';
import { listPendingUiPrompts, pickActiveUiPrompt } from '../lib/ui-prompts.js';
import { FloatingIslandPrompt } from '../features/session/floating-island/FloatingIslandPrompt.jsx';

const { Text } = Typography;

const UI_PROMPTS_OPEN_EVENT = 'chatos:uiPrompts:open';
const UI_PROMPTS_CLOSE_EVENT = 'chatos:uiPrompts:close';
const UI_PROMPTS_TOGGLE_EVENT = 'chatos:uiPrompts:toggle';

function getPromptTitle(prompt) {
  const safePrompt = prompt && typeof prompt === 'object' ? prompt : null;
  const explicit = typeof safePrompt?.title === 'string' ? safePrompt.title.trim() : '';
  if (explicit) return explicit;
  const kind = typeof safePrompt?.kind === 'string' ? safePrompt.kind.trim() : '';
  if (kind === 'task_confirm') return '任务创建确认';
  if (kind === 'file_change_confirm') return '文件变更确认';
  if (kind === 'choice') return '需要你做出选择';
  return '需要你补充信息';
}

export function UiPromptsSmileHub() {
  const [uiPrompts, setUiPrompts] = useState({ entries: [] });
  const [open, setOpen] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState('');
  const preferredRunIdRef = useRef('');

  useEffect(() => {
    if (!hasApi) return undefined;
    let canceled = false;

    const load = async () => {
      try {
        const data = await api.invoke('uiPrompts:read');
        if (!canceled) setUiPrompts(data || { entries: [] });
      } catch {
        // ignore prompt load errors (older builds may not support this channel)
      }
    };

    void load();

    const unsub = api.on('uiPrompts:update', (data) => setUiPrompts(data || { entries: [] }));
    return () => {
      canceled = true;
      try {
        unsub?.();
      } catch {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    const handleClose = () => setOpen(false);
    const handleToggle = () => setOpen((prev) => !prev);
    window.addEventListener(UI_PROMPTS_OPEN_EVENT, handleOpen);
    window.addEventListener(UI_PROMPTS_CLOSE_EVENT, handleClose);
    window.addEventListener(UI_PROMPTS_TOGGLE_EVENT, handleToggle);
    return () => {
      window.removeEventListener(UI_PROMPTS_OPEN_EVENT, handleOpen);
      window.removeEventListener(UI_PROMPTS_CLOSE_EVENT, handleClose);
      window.removeEventListener(UI_PROMPTS_TOGGLE_EVENT, handleToggle);
    };
  }, []);

  const entries = useMemo(() => (Array.isArray(uiPrompts?.entries) ? uiPrompts.entries : []), [uiPrompts]);
  const pending = useMemo(() => listPendingUiPrompts(entries), [entries]);
  const pendingCount = pending.length;

  useEffect(() => {
    const current = typeof selectedRequestId === 'string' ? selectedRequestId.trim() : '';
    if (!current) {
      const next = pickActiveUiPrompt(pending, preferredRunIdRef.current);
      setSelectedRequestId(typeof next?.requestId === 'string' ? next.requestId : '');
      return;
    }
    const stillPending = pending.some((entry) => String(entry?.requestId || '') === current);
    if (stillPending) return;
    const next = pickActiveUiPrompt(pending, preferredRunIdRef.current);
    setSelectedRequestId(typeof next?.requestId === 'string' ? next.requestId : '');
  }, [pending, selectedRequestId]);

  const selectedEntry = useMemo(() => {
    const current = typeof selectedRequestId === 'string' ? selectedRequestId.trim() : '';
    if (current) {
      const found = pending.find((entry) => String(entry?.requestId || '') === current);
      if (found) return found;
    }
    return pickActiveUiPrompt(pending, preferredRunIdRef.current);
  }, [pending, selectedRequestId]);

  const onUiPromptRespond = async ({ requestId, runId, response } = {}) => {
    if (!hasApi) throw new Error('IPC bridge not available');
    const rid = typeof requestId === 'string' ? requestId.trim() : '';
    if (!rid) throw new Error('requestId is required');
    const payload = {
      requestId: rid,
      runId: typeof runId === 'string' ? runId : '',
      response: response && typeof response === 'object' ? response : null,
    };
    const result = await api.invoke('uiPrompts:respond', payload);
    if (result?.ok === false) {
      throw new Error(result?.message || '提交失败');
    }
    return result;
  };

  const prompt = selectedEntry?.prompt && typeof selectedEntry.prompt === 'object' ? selectedEntry.prompt : null;
  const promptKind = typeof prompt?.kind === 'string' ? prompt.kind.trim() : '';
  const requestId = typeof selectedEntry?.requestId === 'string' ? selectedEntry.requestId.trim() : '';
  const promptActive = Boolean(
    requestId && (promptKind === 'kv' || promptKind === 'choice' || promptKind === 'task_confirm' || promptKind === 'file_change_confirm')
  );
  const promptRunId = normalizeRunId(selectedEntry?.runId);
  const allowCancel = prompt?.allowCancel !== false;

  const renderPendingItem = (entry) => {
    const rid = typeof entry?.requestId === 'string' ? entry.requestId.trim() : '';
    const safePrompt = entry?.prompt && typeof entry.prompt === 'object' ? entry.prompt : null;
    const title = getPromptTitle(safePrompt);
    const kind = typeof safePrompt?.kind === 'string' ? safePrompt.kind.trim() : '';
    const runId = normalizeRunId(entry?.runId);
    const source = typeof safePrompt?.source === 'string' ? safePrompt.source.trim() : '';
    const active = rid && rid === selectedRequestId;

    return (
      <List.Item
        key={rid || Math.random().toString(16).slice(2)}
        onClick={() => {
          if (!rid) return;
          setSelectedRequestId(rid);
          preferredRunIdRef.current = runId || '';
          setOpen(true);
        }}
        style={{
          cursor: rid ? 'pointer' : 'default',
          borderRadius: 14,
          padding: 10,
          background: active ? 'var(--ds-selected-bg)' : 'transparent',
        }}
      >
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Text strong ellipsis={{ tooltip: title }}>
            {title}
          </Text>
          <Space size={6} wrap>
            {kind ? <Tag>{kind}</Tag> : null}
            {runId ? <Tag color="blue">{runId}</Tag> : null}
            {source ? <Tag color="geekblue">{source}</Tag> : null}
          </Space>
        </Space>
      </List.Item>
    );
  };

  return (
    <>
      <div className="ds-ui-prompts-fab">
        <Tooltip title={pendingCount > 0 ? `有 ${pendingCount} 个待处理` : '交互待办'} placement="left">
          <Badge count={pendingCount} overflowCount={99} size="small">
            <Button
              className="ds-ui-prompts-button"
              shape="circle"
              type={pendingCount > 0 ? 'primary' : 'default'}
              icon={<SmileOutlined />}
              onClick={() => setOpen(true)}
            />
          </Badge>
        </Tooltip>
      </div>

      <Drawer
        className="ds-ui-prompts-drawer"
        title={
          <Space size={8} align="center">
            <Text strong>交互待办</Text>
            {pendingCount > 0 ? <Tag color="purple">{pendingCount}</Tag> : null}
          </Space>
        }
        placement="right"
        width={1100}
        open={open}
        onClose={() => setOpen(false)}
        zIndex={1305}
        styles={{ body: { padding: 0 } }}
      >
        <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
          <div
            style={{
              width: 300,
              minWidth: 300,
              borderRight: '1px solid var(--ds-panel-border)',
              padding: 12,
              overflow: 'auto',
            }}
          >
            {pendingCount === 0 ? (
              <Empty description="暂无待处理交互" />
            ) : (
              <List size="small" dataSource={pending} renderItem={renderPendingItem} />
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0, padding: 12, overflow: 'auto' }}>
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
                constrainHeight={false}
              />
            ) : (
              <Empty description="请选择一条待处理项" />
            )}
          </div>
        </div>
      </Drawer>
    </>
  );
}
