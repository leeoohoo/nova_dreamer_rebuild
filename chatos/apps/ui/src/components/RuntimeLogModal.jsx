import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Input, Modal, Space, Typography } from 'antd';

import { api, hasApi } from '../lib/api.js';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

function filterLogContent(content, actionId) {
  const raw = typeof content === 'string' ? content : String(content || '');
  const lines = raw.split('\n').filter(Boolean);
  if (!actionId) {
    return { text: lines.join('\n'), matched: lines.length };
  }
  const matched = lines.filter((line) => {
    try {
      const parsed = JSON.parse(line);
      if (parsed?.actionId === actionId) return true;
      if (parsed?.meta?.actionId === actionId) return true;
    } catch {
      // ignore parse errors
    }
    return line.includes(actionId);
  });
  return { text: matched.join('\n'), matched: matched.length };
}

export function RuntimeLogModal({
  open,
  onClose,
  actionId,
  title,
  emptyText,
  refreshLabel,
  lineCount = 800,
  maxBytes = 1024 * 1024,
} = {}) {
  const [state, setState] = useState({
    loading: false,
    error: '',
    path: '',
    content: '',
  });

  const refresh = useCallback(async () => {
    if (!hasApi) {
      setState({ loading: false, error: 'IPC bridge not available.', path: '', content: '' });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const res = await api.invoke('runtimeLog:read', { lineCount, maxBytes });
      if (res?.ok === false) {
        throw new Error(res?.message || 'Failed to read runtime log');
      }
      setState({
        loading: false,
        error: '',
        path: res?.outputPath || '',
        content: res?.content || '',
      });
    } catch (err) {
      setState({ loading: false, error: err?.message || 'Failed to read runtime log', path: '', content: '' });
    }
  }, [lineCount, maxBytes]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const filtered = useMemo(() => filterLogContent(state.content, actionId), [state.content, actionId]);
  const titleText = typeof title === 'string' && title.trim() ? title.trim() : 'Runtime Log';
  const refreshText = typeof refreshLabel === 'string' && refreshLabel.trim() ? refreshLabel.trim() : 'Refresh';
  const emptyLabel = typeof emptyText === 'string' && emptyText.trim() ? emptyText.trim() : 'No log entries found.';
  const content = filtered.text || '';

  return (
    <Modal
      open={Boolean(open)}
      onCancel={onClose}
      title={titleText}
      width={900}
      footer={
        <Space>
          <Button onClick={refresh} loading={state.loading}>
            {refreshText}
          </Button>
          <Button type="primary" onClick={onClose}>
            Close
          </Button>
        </Space>
      }
    >
      {!hasApi ? <Alert type="warning" showIcon message="IPC bridge not available." /> : null}
      {state.error ? <Alert type="error" showIcon message={state.error} /> : null}
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        {actionId ? (
          <Paragraph style={{ marginBottom: 0 }}>
            Action ID: <Text code copyable>{actionId}</Text>
          </Paragraph>
        ) : null}
        {state.path ? (
          <Paragraph style={{ marginBottom: 0 }}>
            Log path: <Text code copyable>{state.path}</Text>
          </Paragraph>
        ) : null}
        <Paragraph style={{ marginBottom: 0 }}>
          Lines matched: {filtered.matched}
        </Paragraph>
        <TextArea
          value={content || emptyLabel}
          readOnly
          autoSize={{ minRows: 10, maxRows: 20 }}
        />
      </Space>
    </Modal>
  );
}
