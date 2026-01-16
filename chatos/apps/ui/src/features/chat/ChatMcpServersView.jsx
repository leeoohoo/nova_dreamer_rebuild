import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Collapse, Space, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

import { api, hasApi } from '../../lib/api.js';

const { Text } = Typography;

function classifyEndpoint(value) {
  const raw = String(value || '').trim();
  if (!raw) return { label: 'UNKNOWN', color: 'default' };
  const lower = raw.toLowerCase();
  if (lower.startsWith('cmd://')) return { label: 'CMD', color: 'blue' };
  if (lower.startsWith('http://') || lower.startsWith('https://')) return { label: 'HTTP', color: 'geekblue' };
  if (lower.startsWith('ws://') || lower.startsWith('wss://')) return { label: 'WS', color: 'purple' };
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) return { label: 'URL', color: 'default' };
  return { label: 'CMD', color: 'blue' };
}

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function ChatMcpServersView() {
  const [state, setState] = useState({ loading: true, error: null, registry: null, uiApps: null });

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
      const registryRes = await api.invoke('registry:mcpServers:list');
      if (registryRes?.ok === false) {
        throw new Error(registryRes?.message || '加载 MCP registry 失败');
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
      mcpServers: Array.isArray(app?.mcpServers) ? app.mcpServers : [],
    }));
  }, [state.registry]);

  const uiAppsErrors = useMemo(() => (Array.isArray(state.uiApps?.errors) ? state.uiApps.errors : []), [state.uiApps]);

  const uiAppMcpRows = useMemo(() => {
    const apps = Array.isArray(state.uiApps?.apps) ? state.uiApps.apps : [];
    const rows = [];
    apps.forEach((app) => {
      const pluginId = normalizeId(app?.plugin?.id);
      const appId = normalizeId(app?.id);
      const mcp = app?.ai?.mcp && typeof app.ai.mcp === 'object' ? app.ai.mcp : null;
      const url = typeof mcp?.url === 'string' ? mcp.url.trim() : '';
      if (!pluginId || !appId || !url) return;
      const pluginName = normalizeId(app?.plugin?.name) || pluginId;
      const appName = normalizeId(app?.name) || appId;
      rows.push({
        key: `${pluginId}::${appId}`,
        pluginId,
        pluginName,
        appId,
        appName,
        name: normalizeId(mcp?.name) || `${pluginId}.${appId}`,
        url,
        description: normalizeId(mcp?.description),
        tags: Array.isArray(mcp?.tags) ? mcp.tags : [],
        enabled: mcp?.enabled,
        allowMain: mcp?.allowMain,
        allowSub: mcp?.allowSub,
      });
    });
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }, [state.uiApps]);

  const uiAppExposeMcpRows = useMemo(() => {
    const apps = Array.isArray(state.uiApps?.apps) ? state.uiApps.apps : [];
    const rows = [];
    apps.forEach((app) => {
      const pluginId = normalizeId(app?.plugin?.id);
      const appId = normalizeId(app?.id);
      const expose = app?.ai?.mcpServers;
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

  const hostMcpColumns = useMemo(
    () => [
      { title: '名称', dataIndex: 'name', width: 180 },
      {
        title: 'app_id',
        dataIndex: 'app_id',
        width: 110,
        render: (value) => {
          const text = String(value || '').trim();
          return text ? <Tag color="blue">{text}</Tag> : <Tag>unknown</Tag>;
        },
      },
      {
        title: '端点',
        dataIndex: 'url',
        render: (url) => {
          const meta = classifyEndpoint(url);
          const text = String(url || '');
          return (
            <Space size={6}>
              <Tag color={meta.color}>{meta.label}</Tag>
              <Text code ellipsis={{ tooltip: text || undefined }} copyable={{ text: text || '' }}>
                {text || '-'}
              </Text>
            </Space>
          );
        },
      },
      {
        title: '启用',
        dataIndex: 'enabled',
        width: 90,
        render: (enabled) => (enabled !== false ? <Tag color="green">ON</Tag> : <Tag color="red">OFF</Tag>),
      },
      {
        title: '标签',
        dataIndex: 'tags',
        render: (tags) => (Array.isArray(tags) && tags.length > 0 ? tags.map((t) => <Tag key={t}>{t}</Tag>) : '-'),
      },
      { title: '描述', dataIndex: 'description', width: 260 },
      { title: '更新时间', dataIndex: 'updatedAt', width: 180 },
    ],
    []
  );

  const uiAppMcpColumns = useMemo(
    () => [
      {
        title: '应用',
        key: 'app',
        width: 260,
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
      { title: 'MCP 名称', dataIndex: 'name', width: 220 },
      {
        title: '端点',
        dataIndex: 'url',
        render: (url) => {
          const meta = classifyEndpoint(url);
          const text = String(url || '');
          return (
            <Space size={6}>
              <Tag color={meta.color}>{meta.label}</Tag>
              <Text code ellipsis={{ tooltip: text || undefined }} copyable={{ text: text || '' }}>
                {text || '-'}
              </Text>
            </Space>
          );
        },
      },
      {
        title: '启用',
        dataIndex: 'enabled',
        width: 90,
        render: (enabled) => (enabled !== false ? <Tag color="green">ON</Tag> : <Tag color="red">OFF</Tag>),
      },
      {
        title: '标签',
        dataIndex: 'tags',
        render: (tags) => (Array.isArray(tags) && tags.length > 0 ? tags.map((t) => <Tag key={t}>{t}</Tag>) : '-'),
      },
      { title: '描述', dataIndex: 'description' },
    ],
    []
  );

  const uiAppExposeMcpColumns = useMemo(
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
        title: '暴露 MCP Servers',
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
        title={<span style={{ fontWeight: 650 }}>MCP Servers</span>}
        extra={
          <Button icon={<ReloadOutlined />} loading={state.loading} onClick={() => refresh()}>
            刷新
          </Button>
        }
      >
        <Text type="secondary">
          按应用聚合展示 MCP Servers（每个应用独立 DB：~/.deepseek_cli/&lt;app&gt;/&lt;app&gt;.db.sqlite）以及 UI Apps 的自带 MCP 声明（manifest）。
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
              const title = `${app.appId} · ${app.mcpServers.length} servers`;
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
                      columns={hostMcpColumns}
                      dataSource={app.mcpServers}
                      pagination={{ pageSize: 20 }}
                      scroll={{ x: 1100 }}
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
          title="UI Apps（ai.mcp：应用自带 MCP Server）"
        >
          <div style={{ marginBottom: 10 }}>
            <Text type="secondary">仅展示 manifest 中声明了 <Text code>ai.mcp</Text> 的应用。</Text>
          </div>
          <Table
            size="small"
            rowKey="key"
            columns={uiAppMcpColumns}
            dataSource={uiAppMcpRows}
            pagination={{ pageSize: 20 }}
            scroll={{ x: 1100 }}
          />
        </Card>

        <Card
          size="small"
          style={{ borderRadius: 14, marginTop: 12 }}
          styles={{ body: { padding: 12 } }}
          title="UI Apps（ai.mcpServers：允许挂载全局 MCP Servers）"
        >
          <div style={{ marginBottom: 10 }}>
            <Text type="secondary">
              这些应用本身不一定自带 MCP Server，但会在 Agent 编辑器中提供“挂载全局 MCP Servers”的入口（ALL 或白名单）。
            </Text>
          </div>
          <Table
            size="small"
            rowKey="key"
            columns={uiAppExposeMcpColumns}
            dataSource={uiAppExposeMcpRows}
            pagination={{ pageSize: 20 }}
            scroll={{ x: 1100 }}
          />
        </Card>
      </div>
    </div>
  );
}
