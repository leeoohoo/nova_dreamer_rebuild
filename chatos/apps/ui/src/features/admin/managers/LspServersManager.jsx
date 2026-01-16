import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Checkbox, Space, Tag, Typography, message } from 'antd';

import { api, hasApi } from '../../../lib/api.js';

const { Text, Paragraph, Title } = Typography;

export function LspServersManager() {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [selected, setSelected] = useState([]);
  const [installing, setInstalling] = useState(false);

  const items = useMemo(() => (Array.isArray(state?.data?.items) ? state.data.items : []), [state]);

  const refresh = useCallback(async () => {
    if (!hasApi) {
      setState({ loading: false, error: 'IPC bridge not available. Is preload loaded?', data: null });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await api.invoke('lsp:catalog');
      if (res?.ok === false) {
        throw new Error(res?.message || '加载失败');
      }
      setState({ loading: false, error: null, data: res || null });
      setSelected((prev) => {
        if (Array.isArray(prev) && prev.length > 0) return prev;
        const preselect = (Array.isArray(res?.items) ? res.items : [])
          .filter((item) => item && item.installed !== true && item?.install?.available === true)
          .map((item) => item.id)
          .filter(Boolean);
        return preselect;
      });
    } catch (err) {
      setState({ loading: false, error: err?.message || '加载失败', data: null });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const installSelected = useCallback(async () => {
    if (!hasApi) {
      message.error('IPC bridge not available. Is preload loaded?');
      return;
    }
    const ids = Array.isArray(selected) ? selected.filter(Boolean) : [];
    if (ids.length === 0) {
      message.warning('请先勾选要安装的 Language Server');
      return;
    }
    setInstalling(true);
    try {
      const res = await api.invoke('lsp:install', { ids });
      if (res?.ok === false) {
        throw new Error(res?.message || '安装失败');
      }
      const results = Array.isArray(res?.results) ? res.results : [];
      const okCount = results.filter((r) => r && r.ok === true && r.skipped !== true).length;
      const skippedCount = results.filter((r) => r && r.skipped === true).length;
      const failCount = results.filter((r) => r && r.ok !== true && r.skipped !== true).length;
      message.success(`LSP 安装完成：成功 ${okCount}，跳过 ${skippedCount}，失败 ${failCount}`);

      if (res?.catalog) {
        setState({ loading: false, error: null, data: res.catalog });
      } else {
        await refresh();
      }
      setSelected((prev) => (Array.isArray(prev) ? prev.filter((id) => !results.some((r) => r?.id === id && r.ok === true)) : prev));
    } catch (err) {
      message.error(err?.message || '安装失败');
    } finally {
      setInstalling(false);
    }
  }, [refresh, selected]);

  const platformLabel = typeof state?.data?.platform?.osLabel === 'string' ? state.data.platform.osLabel : '';

  return (
    <div style={{ maxWidth: 980 }}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space align="baseline" wrap>
          <Title level={4} style={{ margin: 0 }}>
            语言服务（LSP）
          </Title>
          {platformLabel ? <Tag>{platformLabel}</Tag> : null}
        </Space>

        <Card>
          <Paragraph type="secondary" style={{ marginBottom: 12 }}>
            这些 Language Server 会被 MCP <Text code>lsp_bridge</Text> 拉起，用于 hover / definition / completion / diagnostics 等语义能力。
          </Paragraph>

          {!hasApi ? <Alert type="warning" showIcon message="IPC bridge 不可用，无法安装。" /> : null}
          {state?.error ? <Alert type="error" showIcon message="加载失败" description={state.error} /> : null}

          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            {items.length === 0 ? (
              <Text type="secondary">{state.loading ? '加载中…' : '暂无可用条目'}</Text>
            ) : (
              items.map((item, idx) => {
                const id = item?.id || '';
                const installed = item?.installed === true;
                const install = item?.install || {};
                const available = install?.available === true;
                const disabled = installed || !available || installing || !hasApi;
                const checked = Array.isArray(selected) && selected.includes(id);
                const missingReq = Array.isArray(install?.missing_requirements) ? install.missing_requirements : [];
                return (
                  <div
                    key={id || `lsp-${idx}`}
                    style={{
                      display: 'flex',
                      gap: 10,
                      padding: '10px 12px',
                      border: '1px solid var(--ds-header-border)',
                      borderRadius: 12,
                      background: 'var(--ds-card-bg, transparent)',
                    }}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onChange={(e) => {
                        const next = Boolean(e?.target?.checked);
                        setSelected((prev) => {
                          const current = new Set(Array.isArray(prev) ? prev : []);
                          if (next) current.add(id);
                          else current.delete(id);
                          return Array.from(current);
                        });
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 6 }}>
                      <Space size={8} wrap>
                        <Text>{item?.title || id}</Text>
                        {installed ? <Tag color="green">已安装</Tag> : <Tag color="orange">未安装</Tag>}
                        {!installed && available ? <Tag color="blue">可自动安装</Tag> : null}
                        {!installed && !available && missingReq.length ? (
                          <Tag color="default">缺少: {missingReq.join(', ')}</Tag>
                        ) : null}
                      </Space>
                      {item?.description ? <Text type="secondary">{item.description}</Text> : null}
                      {install?.display ? (
                        <Text code copyable={{ text: install.display }}>
                          {install.display}
                        </Text>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <Space wrap style={{ marginTop: 12 }}>
            <Button type="primary" loading={installing} onClick={installSelected} disabled={state.loading || !hasApi}>
              安装选中
            </Button>
            <Button size="small" onClick={refresh} disabled={state.loading || installing || !hasApi}>
              刷新状态
            </Button>
          </Space>

          <Paragraph type="secondary" style={{ margin: '12px 0 0 0' }}>
            提示：某些语言（例如 C/C++、Rust、Go）可能依赖系统工具链；如果自动安装失败，请先安装对应的{' '}
            <Text code>brew</Text> / <Text code>go</Text> / <Text code>rustup</Text> / <Text code>npm</Text>。
          </Paragraph>
        </Card>
      </Space>
    </div>
  );
}

