import React, { useCallback, useMemo, useState } from 'react';
import { Button, Popconfirm, Space, Switch, Tag, Typography, message } from 'antd';

import { EntityManager } from '../../../components/EntityManager.jsx';

const { Text } = Typography;

function McpServersManager({ data, prompts, onCreate, onUpdate, onDelete, loading, developerMode = false }) {
  const normalized = (data || []).map((item) => ({
    ...item,
    authToken: item?.auth?.token || '',
  }));
  const [showBuiltins, setShowBuiltins] = useState(false);
  const classifyEndpoint = useCallback((value) => {
    const raw = String(value || '').trim();
    if (!raw) return { kind: 'unknown', label: 'UNKNOWN', color: 'default' };
    const lower = raw.toLowerCase();
    if (lower.startsWith('cmd://')) return { kind: 'cmd', label: 'CMD', color: 'blue' };
    if (lower.startsWith('http://') || lower.startsWith('https://')) return { kind: 'http', label: 'HTTP', color: 'geekblue' };
    if (lower.startsWith('ws://') || lower.startsWith('wss://')) return { kind: 'ws', label: 'WS', color: 'purple' };
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) return { kind: 'url', label: 'URL', color: 'default' };
    return { kind: 'cmd', label: 'CMD', color: 'blue' };
  }, []);
  const normalizeServerName = useCallback(
    (value) =>
      String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, ''),
    []
  );
  const promptMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(prompts) ? prompts : []).forEach((prompt) => {
      const name = String(prompt?.name || '').trim();
      if (!name) return;
      map.set(name, prompt);
    });
    return map;
  }, [prompts]);
  const builtinNames = useMemo(
    () =>
      new Set([
        'project_files',
        'code_writer',
        'shell_tasks',
        'task_manager',
        'subagent_router',
        'ui_prompter',
        'chrome_devtools',
      ]),
    []
  );
  const isExternalOnly = useCallback((record) => normalizeServerName(record?.name) === 'aide_island_chat', [
    normalizeServerName,
  ]);
  const isLocked = (record) => record?.locked || builtinNames.has(record?.name);
  const showLocked = developerMode || showBuiltins;
  const visible = showLocked ? normalized : normalized.filter((item) => !isLocked(item));
  const columns = useMemo(
    () => [
      { title: '名称', dataIndex: 'name', width: 180 },
      {
        title: '端点',
        dataIndex: 'url',
        width: 360,
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
        render: (enabled, record) => (
          <Switch
            size="small"
            checked={enabled !== false}
            disabled={!record?.id || loading || isExternalOnly(record)}
            onChange={async (checked) => {
              try {
                await onUpdate(record.id, { enabled: checked });
                message.success('已更新启用状态');
              } catch (err) {
                message.error(err?.message || '更新失败');
              }
            }}
          />
        ),
      },
      {
        title: '主程序可用',
        dataIndex: 'allowMain',
        width: 120,
        render: (allowMain, record) => (
          <Switch
            size="small"
            checked={allowMain === true}
            disabled={!record?.id || loading || isExternalOnly(record)}
            onChange={async (checked) => {
              try {
                await onUpdate(record.id, { allowMain: checked });
                message.success('已更新主程序权限');
              } catch (err) {
                message.error(err?.message || '更新失败');
              }
            }}
          />
        ),
      },
      {
        title: '子流程可用',
        dataIndex: 'allowSub',
        width: 120,
        render: (allowSub, record) => (
          <Switch
            size="small"
            checked={allowSub !== false}
            disabled={!record?.id || loading || isExternalOnly(record)}
            onChange={async (checked) => {
              try {
                await onUpdate(record.id, { allowSub: checked });
                message.success('已更新子流程权限');
              } catch (err) {
                message.error(err?.message || '更新失败');
              }
            }}
          />
        ),
      },
      {
        title: 'Prompt',
        key: 'prompt',
        width: 220,
        render: (_val, record) => {
          const promptName = `mcp_${normalizeServerName(record?.name)}`;
          const exists = promptMap.has(promptName);
          return (
            <Space size={6}>
              <Text code>{promptName}</Text>
              {exists ? <Tag color="green">已绑定</Tag> : <Tag color="red">缺失</Tag>}
            </Space>
          );
        },
      },
      {
        title: '标签',
        dataIndex: 'tags',
        render: (tags) => (Array.isArray(tags) && tags.length > 0 ? tags.map((t) => <Tag key={t}>{t}</Tag>) : '-'),
      },
      {
        title: '认证',
        dataIndex: 'auth',
        render: (auth) => (auth?.token ? 'Token' : auth ? 'Custom' : '-'),
        width: 120,
      },
      {
        title: '内置',
        dataIndex: 'locked',
        width: 100,
        render: (_locked, record) =>
          isExternalOnly(record) ? <Tag color="purple">外部调用</Tag> : isLocked(record) ? <Tag color="blue">内置</Tag> : '-',
      },
      { title: '更新时间', dataIndex: 'updatedAt', width: 180 },
    ],
    [classifyEndpoint, isExternalOnly, loading, normalizeServerName, onUpdate, promptMap]
  );
  const fields = useMemo(
    () => [
      { name: 'name', label: '名称', required: true, placeholder: 'server-1' },
      {
        name: 'url',
        label: '端点（URL / 命令）',
        required: true,
        placeholder: 'npx -y @modelcontextprotocol/server-github@latest',
        extra:
          '支持：cmd://... / 直接命令行（npx -y ...）/ http(s):// / ws(s)://。启用/修改后需要重启会话才会重新注册工具。',
      },
      { name: 'description', label: '描述', type: 'textarea', rows: 2 },
      { name: 'tags', label: '标签', type: 'tags', placeholder: 'marketplace,internal' },
      { name: 'authToken', label: 'Token (可选)', placeholder: '如需要鉴权' },
      {
        name: 'enabled',
        label: '启用',
        type: 'switch',
        defaultValue: true,
        extra: '关闭后不会连接该 MCP server，也不会注册其工具',
      },
      {
        name: 'allowMain',
        label: '允许主程序使用',
        type: 'switch',
        defaultValue: false,
        extra: '关闭 = 仅 sub-agent 可用（推荐）',
      },
      {
        name: 'allowSub',
        label: '允许子流程使用',
        type: 'switch',
        defaultValue: true,
        extra: '关闭 = 仅主程序可用',
      },
    ],
    []
  );
  const mapPayload = (values, existing) => {
    const payload = { ...values };
    const token = typeof payload.authToken === 'string' ? payload.authToken.trim() : '';
    delete payload.authToken;
    const prevToken = typeof existing?.auth?.token === 'string' ? existing.auth.token.trim() : '';
    if (token !== prevToken) {
      const prevAuth = existing?.auth && typeof existing.auth === 'object' ? existing.auth : null;
      if (token) {
        payload.auth = { ...(prevAuth || {}), token };
      } else if (prevAuth) {
        const { token: _ignored, ...rest } = prevAuth;
        payload.auth = Object.keys(rest).length > 0 ? rest : undefined;
      } else {
        payload.auth = undefined;
      }
    }
    return payload;
  };

  return (
    <EntityManager
      title="MCP Server 管理"
      description="注册/维护 MCP 服务端的端点（URL 或本地命令）、鉴权与标签。"
      data={visible}
      tableProps={{
        title: () => (
          <Space size={10} wrap>
            <Text type="secondary">显示内置：</Text>
            <Switch
              size="small"
              checked={showLocked}
              disabled={developerMode}
              onChange={(checked) => setShowBuiltins(Boolean(checked))}
            />
            {developerMode ? <Tag color="blue">开发者模式</Tag> : null}
          </Space>
        ),
      }}
      fields={fields}
      columns={columns}
      onCreate={(values) => onCreate(mapPayload(values, null))}
      onUpdate={(id, values) => onUpdate(id, mapPayload(values, normalized.find((item) => item?.id === id) || null))}
      onDelete={onDelete}
      renderActions={(record, { onEdit, onDelete: handleDelete }) =>
        isLocked(record) ? (
          <Tag color="blue">内置只读</Tag>
        ) : (
          <Space>
            <Button size="small" onClick={onEdit}>
              编辑
            </Button>
            <Popconfirm title="确认删除?" onConfirm={handleDelete}>
              <Button size="small" danger>
                删除
              </Button>
            </Popconfirm>
          </Space>
        )
      }
      loading={loading}
    />
  );
}

export { McpServersManager };
