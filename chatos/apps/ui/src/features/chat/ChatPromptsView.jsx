import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Collapse, Modal, Space, Table, Tabs, Tag, Typography } from 'antd';
import { EyeOutlined, ReloadOutlined } from '@ant-design/icons';

import { api, hasApi } from '../../lib/api.js';

const { Paragraph, Text } = Typography;

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePromptNames(names) {
  if (!names || typeof names !== 'object') return { zh: '', en: '' };
  return {
    zh: normalizeId(names.zh),
    en: normalizeId(names.en),
  };
}

export function ChatPromptsView() {
  const [state, setState] = useState({ loading: true, error: null, registry: null, uiApps: null });
  const [viewer, setViewer] = useState({ open: false, loading: false, error: null, title: '', kind: '', content: '', zh: '', en: '' });

  const refresh = useCallback(async () => {
    if (!hasApi) {
      setState({ loading: false, error: 'IPC bridge not available. Is preload loaded?', registry: null, uiApps: null });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      // uiApps:list may sync ai.mcp/ai.mcpPrompt into Admin DB when explicitly enabled; call it first so registry reads fresh data.
      const uiAppsRes = await api.invoke('uiApps:list');
      if (uiAppsRes?.ok === false) {
        throw new Error(uiAppsRes?.message || '加载应用列表失败');
      }
      const registryRes = await api.invoke('registry:prompts:list');
      if (registryRes?.ok === false) {
        throw new Error(registryRes?.message || '加载 Prompts registry 失败');
      }
      setState({ loading: false, error: null, registry: registryRes || null, uiApps: uiAppsRes || null });
    } catch (err) {
      setState({ loading: false, error: err?.message || '加载失败', registry: null, uiApps: null });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const hostApps = useMemo(() => {
    const apps = Array.isArray(state.registry?.apps) ? state.registry.apps : [];
    return apps.map((app) => ({
      appId: String(app?.appId || ''),
      stateDir: String(app?.stateDir || ''),
      dbPath: String(app?.dbPath || ''),
      dbExists: Boolean(app?.dbExists),
      prompts: Array.isArray(app?.prompts) ? app.prompts : [],
    }));
  }, [state.registry]);

  const uiAppsErrors = useMemo(() => (Array.isArray(state.uiApps?.errors) ? state.uiApps.errors : []), [state.uiApps]);

  const uiAppPromptRows = useMemo(() => {
    const apps = Array.isArray(state.uiApps?.apps) ? state.uiApps.apps : [];
    const rows = [];
    apps.forEach((app) => {
      const pluginId = normalizeId(app?.plugin?.id);
      const appId = normalizeId(app?.id);
      const mcpPrompt = app?.ai?.mcpPrompt && typeof app.ai.mcpPrompt === 'object' ? app.ai.mcpPrompt : null;
      const promptNames = normalizePromptNames(mcpPrompt?.names);
      if (!pluginId || !appId) return;
      if (!promptNames.zh && !promptNames.en) return;
      const pluginName = normalizeId(app?.plugin?.name) || pluginId;
      const appName = normalizeId(app?.name) || appId;
      rows.push({
        key: `${pluginId}::${appId}`,
        pluginId,
        pluginName,
        appId,
        appName,
        title: normalizeId(mcpPrompt?.title) || `${appName} MCP Prompt`,
        promptNames,
      });
    });
    return rows.sort((a, b) => a.title.localeCompare(b.title));
  }, [state.uiApps]);

  const uiAppExposePromptRows = useMemo(() => {
    const apps = Array.isArray(state.uiApps?.apps) ? state.uiApps.apps : [];
    const rows = [];
    apps.forEach((app) => {
      const pluginId = normalizeId(app?.plugin?.id);
      const appId = normalizeId(app?.id);
      const expose = app?.ai?.prompts;
      if (!pluginId || !appId) return;
      if (expose !== true && !Array.isArray(expose)) return;
      const pluginName = normalizeId(app?.plugin?.name) || pluginId;
      const appName = normalizeId(app?.name) || appId;
      rows.push({
        key: `${pluginId}::${appId}`,
        pluginId,
        pluginName,
        appId,
        appName,
        expose,
      });
    });
    return rows.sort((a, b) => `${a.appName} ${a.pluginName}`.localeCompare(`${b.appName} ${b.pluginName}`));
  }, [state.uiApps]);

  const openDbPrompt = useCallback(async ({ appId, id }) => {
    const normalizedAppId = normalizeId(appId);
    const normalizedId = normalizeId(id);
    if (!normalizedAppId || !normalizedId) return;

    setViewer({ open: true, loading: true, error: null, title: `${normalizedAppId} · Prompt`, kind: 'db', content: '', zh: '', en: '' });
    try {
      const res = await api.invoke('registry:prompts:get', { appId: normalizedAppId, id: normalizedId });
      if (res?.ok === false) {
        throw new Error(res?.message || '读取 Prompt 失败');
      }
      const record = res?.record && typeof res.record === 'object' ? res.record : null;
      const title = normalizeId(record?.title) || normalizeId(record?.name) || `${normalizedAppId} · Prompt`;
      const content = typeof record?.content === 'string' ? record.content : '';
      setViewer({ open: true, loading: false, error: null, title, kind: 'db', content, zh: '', en: '' });
    } catch (err) {
      setViewer((prev) => ({ ...prev, loading: false, error: err?.message || '读取 Prompt 失败' }));
    }
  }, []);

  const openUiAppPrompt = useCallback(async ({ pluginId, appId, title }) => {
    const pid = normalizeId(pluginId);
    const aid = normalizeId(appId);
    if (!pid || !aid) return;

    setViewer({ open: true, loading: true, error: null, title: title || `${pid}/${aid} · MCP Prompt`, kind: 'uiapp', content: '', zh: '', en: '' });
    try {
      const res = await api.invoke('uiApps:ai:get', { pluginId: pid, appId: aid });
      if (res?.ok === false) {
        throw new Error(res?.message || '读取 UI App Prompt 失败');
      }
      const data = res?.data && typeof res.data === 'object' ? res.data : null;
      const mcpPrompt = data?.mcpPrompt && typeof data.mcpPrompt === 'object' ? data.mcpPrompt : null;
      const zh = typeof mcpPrompt?.zh === 'string' ? mcpPrompt.zh : '';
      const en = typeof mcpPrompt?.en === 'string' ? mcpPrompt.en : '';
      const nextTitle = normalizeId(mcpPrompt?.title) || title || `${pid}/${aid} · MCP Prompt`;
      setViewer({ open: true, loading: false, error: null, title: nextTitle, kind: 'uiapp', content: '', zh, en });
    } catch (err) {
      setViewer((prev) => ({ ...prev, loading: false, error: err?.message || '读取 UI App Prompt 失败' }));
    }
  }, []);

  const hostPromptColumns = useMemo(
    () => [
      { title: '名称', dataIndex: 'name', width: 220 },
      { title: '标题', dataIndex: 'title', width: 220 },
      { title: '类型', dataIndex: 'type', width: 120 },
      { title: '更新时间', dataIndex: 'updatedAt', width: 180 },
      {
        title: '预览',
        dataIndex: 'preview',
        render: (text) => (
          <Paragraph style={{ margin: 0 }} ellipsis={{ rows: 2 }}>
            {String(text || '')}
          </Paragraph>
        ),
      },
      {
        title: '查看',
        key: 'actions',
        width: 90,
        render: (_val, record) => (
          <Button size="small" icon={<EyeOutlined />} onClick={() => openDbPrompt({ appId: record.__appId, id: record.id })}>
            查看
          </Button>
        ),
      },
    ],
    [openDbPrompt]
  );

  const uiAppPromptColumns = useMemo(
    () => [
      {
        title: '应用',
        key: 'app',
        width: 280,
        render: (_val, record) => (
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {record.appName}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.pluginName} · {record.pluginId}/{record.appId}
            </Text>
          </div>
        ),
      },
      { title: '标题', dataIndex: 'title', width: 240 },
      {
        title: 'Prompt 名称',
        key: 'names',
        render: (_val, record) => {
          const zh = normalizeId(record?.promptNames?.zh);
          const en = normalizeId(record?.promptNames?.en);
          return (
            <Space size={6} wrap>
              {zh ? <Text code>{zh}</Text> : <Tag>zh-缺失</Tag>}
              {en ? <Text code>{en}</Text> : <Tag>en-缺失</Tag>}
            </Space>
          );
        },
      },
      {
        title: '查看',
        key: 'actions',
        width: 90,
        render: (_val, record) => (
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => openUiAppPrompt({ pluginId: record.pluginId, appId: record.appId, title: record.title })}
          >
            查看
          </Button>
        ),
      },
    ],
    [openUiAppPrompt]
  );

  const uiAppExposePromptColumns = useMemo(
    () => [
      {
        title: '应用',
        dataIndex: 'appName',
        width: 220,
        render: (_value, row) => (
          <Space size={6} wrap>
            <Text style={{ fontWeight: 650 }}>{row?.appName || row?.appId || '-'}</Text>
            {row?.appId ? <Tag>{row.appId}</Tag> : null}
          </Space>
        ),
      },
      {
        title: '插件',
        dataIndex: 'pluginName',
        width: 240,
        render: (_value, row) => (
          <Space size={6} wrap>
            <Text>{row?.pluginName || row?.pluginId || '-'}</Text>
            {row?.pluginId ? <Tag color="blue">{row.pluginId}</Tag> : null}
          </Space>
        ),
      },
      {
        title: '暴露 Prompts',
        dataIndex: 'expose',
        render: (value) => {
          if (value === true) return <Tag color="green">ALL</Tag>;
          if (Array.isArray(value) && value.length > 0) {
            return (
              <Space size={[4, 6]} wrap>
                <Tag color="geekblue">LIST</Tag>
                {value.slice(0, 8).map((name) => (
                  <Tag key={name}>{name}</Tag>
                ))}
                {value.length > 8 ? <Text type="secondary">…</Text> : null}
              </Space>
            );
          }
          return '-';
        },
      },
    ],
    []
  );

  if (!hasApi) {
    return <Alert type="error" message="IPC bridge not available. Is preload loaded?" />;
  }

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
      <Card
        size="small"
        style={{ borderRadius: 14 }}
        styles={{ body: { padding: 14 } }}
        title={<span style={{ fontWeight: 650 }}>Prompt</span>}
        extra={
          <Button icon={<ReloadOutlined />} loading={state.loading} onClick={() => refresh()}>
            刷新
          </Button>
        }
      >
        <Text type="secondary">
          按应用聚合展示 Prompts（每个应用独立 DB：~/.deepseek_cli/&lt;app&gt;/&lt;app&gt;.db.sqlite）以及 UI Apps 的 MCP Prompt 声明（manifest）。
        </Text>
      </Card>

      {state.error ? <Alert type="error" showIcon message={state.error} /> : null}
      {uiAppsErrors.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={`UI Apps 扫描发现 ${uiAppsErrors.length} 个问题（可能导致应用 MCP/Prompt 不显示）`}
          description={
            <div style={{ maxHeight: 140, overflow: 'auto' }}>
              {uiAppsErrors.slice(0, 6).map((entry, idx) => (
                <div key={`${idx}-${entry?.source || 'uiApps'}`} style={{ marginBottom: 4 }}>
                  <Text type="secondary">{String(entry?.source || 'uiApps')}：</Text> {String(entry?.message || '')}
                </div>
              ))}
              {uiAppsErrors.length > 6 ? (
                <div>
                  <Text type="secondary">…更多错误请到「应用」页查看。</Text>
                </div>
              ) : null}
            </div>
          }
        />
      ) : null}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 6 }}>
        <Card size="small" style={{ borderRadius: 14, marginBottom: 12 }} styles={{ body: { padding: 12 } }} title="Host Apps（各自 DB）">
          <Collapse
            items={hostApps.map((app) => {
              const title = `${app.appId} · ${app.prompts.length} prompts`;
              const prompts = app.prompts.map((p) => ({ ...p, __appId: app.appId }));
              return {
                key: app.appId,
                label: (
                  <Space size={8} wrap>
                    <Text style={{ fontWeight: 650 }}>{title}</Text>
                    {app.dbExists ? <Tag color="green">DB OK</Tag> : <Tag color="orange">未初始化</Tag>}
                  </Space>
                ),
                children: (
                  <div>
                    <div style={{ marginBottom: 10 }}>
                      <Text type="secondary">StateDir：</Text>{' '}
                      <Text code copyable={{ text: app.stateDir || '' }}>
                        {app.stateDir || '-'}
                      </Text>
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <Text type="secondary">DB：</Text>{' '}
                      <Text code copyable={{ text: app.dbPath || '' }}>
                        {app.dbPath || '-'}
                      </Text>
                    </div>
                    {!app.dbExists ? (
                      <div style={{ marginBottom: 12 }}>
                        <Text type="secondary">提示：首次启动该应用后会自动创建 DB，并注册默认 MCP Servers / Prompts。</Text>
                      </div>
                    ) : null}
                    <Table
                      size="small"
                      rowKey={(r) => r?.id || r?.name || Math.random().toString(36)}
                      columns={hostPromptColumns}
                      dataSource={prompts}
                      pagination={{ pageSize: 20 }}
                      scroll={{ x: 1300 }}
                    />
                  </div>
                ),
              };
            })}
          />
        </Card>

        <Card
          size="small"
          style={{ borderRadius: 14 }}
          styles={{ body: { padding: 12 } }}
          title="UI Apps（ai.mcpPrompt：应用自带 Prompt）"
        >
          <div style={{ marginBottom: 10 }}>
            <Text type="secondary">仅展示 manifest 中声明了 <Text code>ai.mcpPrompt</Text> 的应用。</Text>
          </div>
          <Table
            size="small"
            rowKey="key"
            columns={uiAppPromptColumns}
            dataSource={uiAppPromptRows}
            pagination={{ pageSize: 20 }}
            scroll={{ x: 1100 }}
          />
        </Card>

        <Card
          size="small"
          style={{ borderRadius: 14, marginTop: 12 }}
          styles={{ body: { padding: 12 } }}
          title="UI Apps（ai.prompts：允许挂载全局 Prompts）"
        >
          <div style={{ marginBottom: 10 }}>
            <Text type="secondary">这些应用会在 Agent 编辑器中提供“挂载全局 Prompts”的入口（ALL 或白名单）。</Text>
          </div>
          <Table
            size="small"
            rowKey="key"
            columns={uiAppExposePromptColumns}
            dataSource={uiAppExposePromptRows}
            pagination={{ pageSize: 20 }}
            scroll={{ x: 1100 }}
          />
        </Card>
      </div>

      <Modal
        open={viewer.open}
        title={viewer.title}
        onCancel={() => setViewer({ open: false, loading: false, error: null, title: '', kind: '', content: '', zh: '', en: '' })}
        footer={null}
        width={860}
      >
        {viewer.loading ? <Text type="secondary">加载中…</Text> : null}
        {viewer.error ? <Alert type="error" showIcon message={viewer.error} /> : null}
        {!viewer.loading && !viewer.error && viewer.kind === 'db' ? (
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 520, overflow: 'auto' }}>
            {viewer.content || ''}
          </pre>
        ) : null}
        {!viewer.loading && !viewer.error && viewer.kind === 'uiapp' ? (
          <Tabs
            items={[
              { key: 'zh', label: 'zh', children: <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 520, overflow: 'auto' }}>{viewer.zh || ''}</pre> },
              { key: 'en', label: 'en', children: <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 520, overflow: 'auto' }}>{viewer.en || ''}</pre> },
            ]}
          />
        ) : null}
      </Modal>
    </div>
  );
}
