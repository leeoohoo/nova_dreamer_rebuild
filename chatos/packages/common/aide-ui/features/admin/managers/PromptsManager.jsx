import React, { useCallback, useMemo, useState } from 'react';
import { Button, Modal, Popconfirm, Space, Switch, Tag, Typography, message } from 'antd';

import { EntityManager } from '../../../components/EntityManager.jsx';

const { Paragraph, Text } = Typography;

function PromptsManager({ data, onCreate, onUpdate, onDelete, loading, developerMode = false }) {
  const [restoringId, setRestoringId] = useState(null);
  const [showBuiltins, setShowBuiltins] = useState(false);
  const normalizePromptName = useCallback((value) => String(value || '').trim().toLowerCase(), []);
  const isMcpPromptName = useCallback(
    (value) => {
      const name = normalizePromptName(value);
      return name.startsWith('mcp_');
    },
    [normalizePromptName]
  );
  const reservedPromptNames = useMemo(
    () => new Set(['internal', 'internal_main', 'default', 'user_prompt']),
    []
  );
  const isReservedPromptName = useCallback(
    (value) => reservedPromptNames.has(normalizePromptName(value)),
    [normalizePromptName, reservedPromptNames]
  );
  const showLocked = developerMode || showBuiltins;
  const visible = useMemo(() => {
    const list = Array.isArray(data) ? data : [];
    return list.filter((record) => {
      if (!record || typeof record !== 'object') return false;
      if (isMcpPromptName(record?.name)) return false;
      if (isReservedPromptName(record?.name)) return false;
      if (!showLocked && record.builtin) return false;
      if (!showLocked && record.locked) return false;
      return true;
    });
  }, [data, isMcpPromptName, isReservedPromptName, showLocked]);
  const isLockedPrompt = (record) => Boolean(record?.locked || isReservedPromptName(record?.name));
  const shouldMaskContent = useCallback(
    (record) => record?.builtin || isReservedPromptName(record?.name),
    [isReservedPromptName]
  );
  const columns = useMemo(
    () => [
      { title: '名称', dataIndex: 'name', width: 160 },
      { title: '标题', dataIndex: 'title', width: 180 },
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
    [shouldMaskContent]
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
      { name: 'variables', label: '变量', type: 'tags', placeholder: '如 user.name' },
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
  const handleCreate = async (values) => {
    if (isMcpPromptName(values?.name)) {
      throw new Error('MCP Prompt 请在 MCP Servers 中维护');
    }
    return onCreate(values);
  };
  const handleUpdate = async (id, values) => {
    if (isMcpPromptName(values?.name)) {
      throw new Error('MCP Prompt 请在 MCP Servers 中维护');
    }
    return onUpdate(id, values);
  };

  return (
    <EntityManager
      title="Prompt 管理"
      description="集中维护 Prompt 模板（由 land_config 选择注入；MCP Prompt 请在 MCP Servers 中维护）。"
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
      onDelete={onDelete}
      renderActions={(record, { onEdit, onDelete: handleDelete }) => {
        const reserved = isReservedPromptName(record?.name);
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
