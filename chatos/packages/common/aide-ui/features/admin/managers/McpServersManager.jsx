import React, { useCallback, useMemo, useState } from 'react';
import { Button, Popconfirm, Space, Switch, Tag, Typography, message } from 'antd';

import { EntityManager } from '../../../components/EntityManager.jsx';

const { Paragraph, Text } = Typography;

function McpServersManager({
  data,
  prompts,
  onCreate,
  onUpdate,
  onDelete,
  promptActions,
  loading,
  developerMode = false,
}) {
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
  const getPromptNames = useCallback(
    (value) => {
      const normalizedName = normalizeServerName(value);
      if (!normalizedName) return { zh: '', en: '' };
      const base = `mcp_${normalizedName}`;
      return { zh: base, en: `${base}__en` };
    },
    [normalizeServerName]
  );
  const normalizePromptText = useCallback((value) => {
    if (typeof value !== 'string') return '';
    return value.trim();
  }, []);
  const promptMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(prompts) ? prompts : []).forEach((prompt) => {
      const name = String(prompt?.name || '').trim().toLowerCase();
      if (!name) return;
      map.set(name, prompt);
    });
    return map;
  }, [prompts]);
  const normalized = useMemo(() => {
    const list = Array.isArray(data) ? data : [];
    return list.map((item) => {
      const { zh: promptZhName, en: promptEnName } = getPromptNames(item?.name);
      const promptZh = promptZhName ? promptMap.get(promptZhName.toLowerCase()) : null;
      const promptEn = promptEnName ? promptMap.get(promptEnName.toLowerCase()) : null;
      return {
        ...item,
        authToken: item?.auth?.token || '',
        promptZh: promptZh?.content || '',
        promptEn: promptEn?.content || '',
        promptZhId: promptZh?.id || '',
        promptEnId: promptEn?.id || '',
        promptZhTitle: promptZh?.title || '',
        promptEnTitle: promptEn?.title || '',
      };
    });
  }, [data, getPromptNames, promptMap]);
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
  const isLocked = (record) => record?.locked || builtinNames.has(record?.name);
  const showLocked = developerMode || showBuiltins;
  const visible = showLocked ? normalized : normalized.filter((item) => !isLocked(item));
  const canManagePrompts = Boolean(promptActions?.create && promptActions?.update);
  const resolvePromptRecord = useCallback(
    (name, fallback) => {
      const primaryKey = typeof name === 'string' ? name.trim().toLowerCase() : '';
      const fallbackKey = typeof fallback === 'string' ? fallback.trim().toLowerCase() : '';
      if (primaryKey && promptMap.has(primaryKey)) return promptMap.get(primaryKey);
      if (fallbackKey && promptMap.has(fallbackKey)) return promptMap.get(fallbackKey);
      return null;
    },
    [promptMap]
  );
  const resolvePromptTitle = useCallback((existing, serverName, lang) => {
    const current = typeof existing?.title === 'string' ? existing.title.trim() : '';
    if (current) return current;
    const suffix = lang === 'en' ? ' (EN)' : '（中文）';
    return `MCP / ${serverName}${suffix}`;
  }, []);
  const renderPromptPreview = useCallback(
    (value) => {
      const content = normalizePromptText(value);
      if (!content) return <Tag color="red">缺失</Tag>;
      return (
        <Paragraph style={{ margin: 0 }} ellipsis={{ rows: 2, expandable: false }}>
          {content}
        </Paragraph>
      );
    },
    [normalizePromptText]
  );
  const upsertPrompt = useCallback(
    async ({ existing, name, serverName, content, lang }) => {
      if (!canManagePrompts) return;
      const trimmed = normalizePromptText(content);
      if (!trimmed) return;
      if (existing?.locked || existing?.builtin) {
        const current = normalizePromptText(existing?.content);
        if (current && current !== trimmed) {
          message.warning('内置 MCP Prompt 不支持编辑');
        }
        return;
      }
      const payload = {
        name,
        title: resolvePromptTitle(existing, serverName, lang),
        content: trimmed,
        allowMain: true,
        allowSub: true,
      };
      if (existing?.id) {
        await promptActions.update(existing.id, payload);
      } else {
        await promptActions.create(payload);
      }
    },
    [canManagePrompts, normalizePromptText, promptActions, resolvePromptTitle]
  );
  const syncPrompts = useCallback(
    async ({ existing, values }) => {
      if (!canManagePrompts) return;
      const serverName = typeof values?.name === 'string' ? values.name.trim() : '';
      if (!serverName) return;
      const { zh: promptZhName, en: promptEnName } = getPromptNames(serverName);
      const previous = existing?.name || '';
      const { zh: prevZhName, en: prevEnName } = getPromptNames(previous);
      const zhPrompt = resolvePromptRecord(promptZhName, prevZhName);
      const enPrompt = resolvePromptRecord(promptEnName, prevEnName);
      await upsertPrompt({
        existing: zhPrompt,
        name: promptZhName,
        serverName,
        content: values?.promptZh,
        lang: 'zh',
      });
      await upsertPrompt({
        existing: enPrompt,
        name: promptEnName,
        serverName,
        content: values?.promptEn,
        lang: 'en',
      });
    },
    [canManagePrompts, getPromptNames, resolvePromptRecord, upsertPrompt]
  );
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
              disabled={!record?.id || loading}
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
        title: 'Prompt（中文）',
        dataIndex: 'promptZh',
        width: 260,
        render: (value) => renderPromptPreview(value),
      },
      {
        title: 'Prompt（英文）',
        dataIndex: 'promptEn',
        width: 260,
        render: (value) => renderPromptPreview(value),
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
        render: (_locked, record) => (isLocked(record) ? <Tag color="blue">内置</Tag> : '-'),
      },
      { title: '更新时间', dataIndex: 'updatedAt', width: 180 },
    ],
    [classifyEndpoint, loading, onUpdate, renderPromptPreview]
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
        name: 'promptZh',
        label: 'Prompt（中文）',
        type: 'textarea',
        rows: 8,
        autoSize: { minRows: 8, maxRows: 18 },
        inputStyle: { fontFamily: 'SFMono-Regular, Consolas, Menlo, monospace' },
        requiredOnCreate: true,
        extra: '保存后会写入 mcp_<name>（中文版本）。',
      },
      {
        name: 'promptEn',
        label: 'Prompt（英文）',
        type: 'textarea',
        rows: 8,
        autoSize: { minRows: 8, maxRows: 18 },
        inputStyle: { fontFamily: 'SFMono-Regular, Consolas, Menlo, monospace' },
        requiredOnCreate: true,
        extra: '保存后会写入 mcp_<name>__en（英文版本）。',
      },
    ],
    []
  );
  const mapPayload = (values, existing) => {
    const payload = { ...values };
    delete payload.promptZh;
    delete payload.promptEn;
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
  const handleCreate = async (values) => {
    const promptZh = normalizePromptText(values?.promptZh);
    const promptEn = normalizePromptText(values?.promptEn);
    if (!promptZh || !promptEn) {
      throw new Error('请补全中英文 MCP Prompt');
    }
    const payload = mapPayload({ ...values, promptZh, promptEn }, null);
    await onCreate(payload);
    if (!canManagePrompts) return;
    try {
      await syncPrompts({ existing: null, values: { ...values, promptZh, promptEn } });
    } catch (err) {
      throw new Error(`MCP Server 已创建，但 Prompt 保存失败：${err?.message || '未知错误'}`);
    }
  };
  const handleUpdate = async (id, values) => {
    const existing = normalized.find((item) => item?.id === id) || null;
    const payload = mapPayload(values, existing);
    await onUpdate(id, payload);
    if (!canManagePrompts) return;
    try {
      await syncPrompts({ existing, values });
    } catch (err) {
      throw new Error(`MCP Server 已更新，但 Prompt 保存失败：${err?.message || '未知错误'}`);
    }
  };
  const handleDelete = async (id) => {
    const existing = normalized.find((item) => item?.id === id) || null;
    await onDelete(id);
    if (!promptActions?.delete || !existing?.name) return;
    const { zh: promptZhName, en: promptEnName } = getPromptNames(existing.name);
    const zhPrompt = resolvePromptRecord(promptZhName, '');
    const enPrompt = resolvePromptRecord(promptEnName, '');
    const deletions = [];
    if (zhPrompt?.id) deletions.push(promptActions.delete(zhPrompt.id));
    if (enPrompt?.id) deletions.push(promptActions.delete(enPrompt.id));
    if (deletions.length === 0) return;
    try {
      await Promise.all(deletions);
    } catch (err) {
      message.warning(err?.message || '删除 MCP Prompt 失败');
    }
  };

  return (
    <EntityManager
      title="MCP Server 管理"
      description="注册/维护 MCP 服务端的端点（URL 或本地命令）、鉴权与标签，并在此维护中英文 MCP Prompt。"
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
      onCreate={handleCreate}
      onUpdate={handleUpdate}
      onDelete={handleDelete}
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
      drawerWidth={820}
    />
  );
}

export { McpServersManager };
