import React, { useCallback, useMemo, useState } from 'react';
import { Button, Modal, Popconfirm, Space, Switch, Tag, Typography, message } from 'antd';

import { EntityManager } from '../../../components/EntityManager.jsx';

const { Paragraph, Text } = Typography;

function PromptsManager({ data, mcpServers, onCreate, onUpdate, onDelete, loading, developerMode = false }) {
  const [restoringId, setRestoringId] = useState(null);
  const [toggling, setToggling] = useState(null);
  const [showBuiltins, setShowBuiltins] = useState(false);
  const normalizeServerName = useCallback(
    (value) =>
      String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, ''),
    []
  );
  const mcpServerMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(mcpServers) ? mcpServers : []).forEach((srv) => {
      const key = normalizeServerName(srv?.name);
      if (!key) return;
      map.set(key, srv);
    });
    return map;
  }, [mcpServers, normalizeServerName]);
  const resolveMcpDerivedFlags = useCallback(
    (record) => {
      const rawName = String(record?.name || '').trim().toLowerCase();
      if (!rawName.startsWith('mcp_')) return null;
      const stripLangSuffix = (value) => String(value || '').replace(/__(zh|en)$/i, '');
      const serverKey = normalizeServerName(stripLangSuffix(rawName.replace(/^mcp_/, '')));
      if (!serverKey) return null;
      const server = mcpServerMap.get(serverKey) || null;
      if (!server) {
        return { allowMain: false, allowSub: false, missingServer: true };
      }
      const enabled = server.enabled !== false;
      return {
        allowMain: enabled && server.allowMain === true,
        allowSub: enabled && server.allowSub !== false,
        missingServer: false,
      };
    },
    [mcpServerMap, normalizeServerName]
  );
  const reservedPromptNames = useMemo(
    () =>
      new Set(['internal', 'internal_main', 'internal_subagent', 'default', 'user_prompt', 'subagent_user_prompt']),
    []
  );
  const showLocked = developerMode || showBuiltins;
  const visible = useMemo(() => {
    const list = Array.isArray(data) ? data : [];
    if (developerMode) return list;
    return list.filter((record) => {
      if (!record || typeof record !== 'object') return false;
      if (reservedPromptNames.has(record?.name)) return false;
      if (!showLocked && record.builtin) return false;
      if (!showLocked && record.locked) return false;
      return true;
    });
  }, [data, developerMode, reservedPromptNames, showLocked]);
  const isLockedPrompt = (record) => Boolean(record?.locked || reservedPromptNames.has(record?.name));
  const shouldMaskContent = useCallback((record) => record?.builtin || reservedPromptNames.has(record?.name), [
    reservedPromptNames,
  ]);
  const resolveAllowMain = useCallback(
    (record) => {
      const mcpDerived = resolveMcpDerivedFlags(record);
      if (mcpDerived) return mcpDerived.allowMain;
      return record?.allowMain === true;
    },
    [resolveMcpDerivedFlags]
  );
  const resolveAllowSub = useCallback(
    (record) => {
      const mcpDerived = resolveMcpDerivedFlags(record);
      if (mcpDerived) return mcpDerived.allowSub;
      return record?.allowSub === true;
    },
    [resolveMcpDerivedFlags]
  );
  const handleToggle = useCallback(
    async (record, field, checked) => {
      if (!record?.id) return;
      try {
        setToggling({ id: record.id, field });
        await onUpdate(record.id, { [field]: checked });
      } catch (err) {
        message.error(err?.message || '更新失败');
      } finally {
        setToggling(null);
      }
    },
    [onUpdate]
  );
  const columns = useMemo(
    () => [
      { title: '名称', dataIndex: 'name', width: 160 },
      { title: '标题', dataIndex: 'title', width: 180 },
      { title: '类型', dataIndex: 'type', width: 120 },
      {
        title: '主代理',
        dataIndex: 'allowMain',
        width: 96,
        render: (_val, record) => {
          const derived = resolveMcpDerivedFlags(record);
          return (
            <Switch
              checked={resolveAllowMain(record)}
              onChange={(checked) => handleToggle(record, 'allowMain', checked)}
              loading={toggling?.id === record.id && toggling?.field === 'allowMain'}
              disabled={loading || Boolean(derived)}
            />
          );
        },
      },
      {
        title: '子代理',
        dataIndex: 'allowSub',
        width: 96,
        render: (_val, record) => {
          const derived = resolveMcpDerivedFlags(record);
          return (
            <Switch
              checked={resolveAllowSub(record)}
              onChange={(checked) => handleToggle(record, 'allowSub', checked)}
              loading={toggling?.id === record.id && toggling?.field === 'allowSub'}
              disabled={loading || Boolean(derived)}
            />
          );
        },
      },
      {
        title: '变量',
        dataIndex: 'variables',
        render: (vars) => (Array.isArray(vars) && vars.length > 0 ? vars.map((t) => <Tag key={t}>{t}</Tag>) : '-'),
      },
      {
        title: '内容',
        dataIndex: 'content',
        render: (text, record) => {
          const masked = shouldMaskContent(record);
          const display = masked ? '（内置已隐藏）' : text;
          return (
            <Paragraph style={{ margin: 0 }} ellipsis={{ rows: 2, expandable: false }}>
              {display}
            </Paragraph>
          );
        },
      },
      {
        title: '内置',
        dataIndex: 'builtin',
        width: 120,
        render: (_builtin, record) =>
          record?.builtin ? (
            <Space size={4}>
              <Tag color={record.locked ? 'gold' : 'blue'}>{record.locked ? '内置锁定' : '内置'}</Tag>
              {!record.locked ? <Tag color="green">可编辑</Tag> : null}
            </Space>
          ) : (
            '-'
          ),
      },
      { title: '更新时间', dataIndex: 'updatedAt', width: 180 },
    ],
    [
      handleToggle,
      loading,
      resolveMcpDerivedFlags,
      resolveAllowMain,
      resolveAllowSub,
      shouldMaskContent,
      toggling,
    ]
  );
  const handleRestore = async (record) => {
    if (!record?.defaultContent) {
      message.warning('暂无可恢复的默认内容');
      return;
    }
    try {
      setRestoringId(record.id);
      await onUpdate(record.id, { content: record.defaultContent });
      message.success('已恢复默认内容');
    } catch (err) {
      message.error(err?.message || '恢复失败');
    } finally {
      setRestoringId(null);
    }
  };

  const openPromptViewer = useCallback((record) => {
    const title = typeof record?.title === 'string' && record.title.trim() ? record.title.trim() : record?.name || 'Prompt';
    const content = typeof record?.content === 'string' ? record.content : '';
    Modal.info({
      title,
      width: 900,
      maskClosable: true,
      content: (
        <Paragraph
          style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            maxHeight: '60vh',
            overflow: 'auto',
            fontFamily: 'SFMono-Regular, Consolas, Menlo, monospace',
            fontSize: 12,
          }}
          copyable
        >
          {content || '（空）'}
        </Paragraph>
      ),
    });
  }, []);

  const fields = useMemo(
    () => [
      { name: 'name', label: '名称', required: true, placeholder: 'system-default' },
      { name: 'title', label: '标题', placeholder: '可选显示名称' },
      {
        name: 'type',
        label: '类型',
        required: true,
        type: 'select',
        defaultValue: 'system',
        extra:
          '目前仅区分 system 与非 system；task/tool/subagent 行为一致（作为 /prompt 候选，不参与 system prompt 自动注入）。',
        options: [
          { label: 'system（系统/注入）', value: 'system' },
          { label: 'task（/prompt 候选）', value: 'task' },
          { label: 'tool（/prompt 候选）', value: 'tool' },
          { label: 'subagent（/prompt 候选）', value: 'subagent' },
        ],
      },
      { name: 'variables', label: '变量', type: 'tags', placeholder: '如 user.name' },
      {
        name: 'allowMain',
        label: '主代理使用',
        type: 'switch',
        defaultValue: true,
        extra: '是否在主 agent 会话中注入该 Prompt（仅对 system 类型生效）。',
      },
      {
        name: 'allowSub',
        label: '子代理使用',
        type: 'switch',
        defaultValue: false,
        extra: '是否在 sub agent 会话中注入该 Prompt（仅对 system 类型生效）。',
      },
      {
        name: 'content',
        label: '内容',
        type: 'textarea',
        rows: 12,
        autoSize: { minRows: 12, maxRows: 24 },
        inputStyle: { fontFamily: 'SFMono-Regular, Consolas, Menlo, monospace' },
        required: true,
      },
    ],
    []
  );

  return (
    <EntityManager
      title="Prompt 管理"
      description="集中维护系统/任务/工具 Prompt 模板（mcp_* prompts 的主/子注入由 MCP Server 的启用与 allowMain/allowSub 自动派生）。"
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
      onCreate={onCreate}
      onUpdate={onUpdate}
      onDelete={onDelete}
      renderActions={(record, { onEdit, onDelete: handleDelete }) => {
        const reserved = reservedPromptNames.has(record?.name);
        const disableEdit = Boolean(record.locked || reserved);
        const disableDelete = Boolean(record.locked || record.builtin || reserved);
        const canRestore = record.defaultContent && record.content !== record.defaultContent;
        if (isLockedPrompt(record)) {
          return (
            <Space>
              <Button size="small" onClick={() => openPromptViewer(record)}>
                查看
              </Button>
              <Tag color="gold">内置只读</Tag>
            </Space>
          );
        }
        return (
          <Space>
            <Button size="small" onClick={onEdit} disabled={disableEdit}>
              编辑
            </Button>
            <Popconfirm
              title="确认删除?"
              onConfirm={handleDelete}
              disabled={disableDelete}
              okButtonProps={{ disabled: disableDelete }}
            >
              <Button size="small" danger disabled={disableDelete}>
                删除
              </Button>
            </Popconfirm>
            {canRestore ? (
              <Button size="small" onClick={() => handleRestore(record)} loading={restoringId === record.id}>
                恢复默认
              </Button>
            ) : null}
          </Space>
        );
      }}
      loading={loading}
      drawerWidth={820}
    />
  );
}

export { PromptsManager };
