import React, { useMemo } from 'react';
import { Button, Popconfirm, Space, Tag, Typography } from 'antd';

import { EntityManager } from '../../../components/EntityManager.jsx';

const { Paragraph } = Typography;

function isGptModelId(modelId) {
  const id = String(modelId || '').trim().toLowerCase();
  return id.startsWith('gpt-');
}

function ModelsManager({
  data,
  onCreate,
  onUpdate,
  onDelete,
  onSetDefault = () => {},
  loading,
  developerMode = false,
}) {
  const providerOptions = useMemo(() => {
    const shouldShowAzure =
      developerMode ||
      (Array.isArray(data) && data.some((record) => String(record?.provider || '').trim().toLowerCase() === 'azure'));
    return [
      { label: 'OpenAI (兼容)', value: 'openai' },
      { label: 'DeepSeek (兼容)', value: 'deepseek' },
      ...(shouldShowAzure ? [{ label: 'Azure (未完整实现)', value: 'azure' }] : []),
    ];
  }, [data, developerMode]);
  const columns = useMemo(
    () => [
      { title: '名称', dataIndex: 'name', width: 140 },
      { title: 'Provider', dataIndex: 'provider', width: 120 },
      { title: '模型 ID', dataIndex: 'model', width: 200 },
      {
        title: '图片理解',
        dataIndex: 'supportsVision',
        width: 110,
        render: (v) => (v ? <Tag color="purple">支持</Tag> : '-'),
      },
      {
        title: '思考等级',
        dataIndex: 'reasoningEffort',
        width: 110,
        render: (v, record) => {
          const value = typeof v === 'string' ? v.trim() : '';
          if (!isGptModelId(record?.model)) return '-';
          if (!value) return <Tag>默认</Tag>;
          return <Tag color="gold">{value.toUpperCase()}</Tag>;
        },
      },
      {
        title: '工具后续',
        dataIndex: 'toolFollowupMode',
        width: 110,
        render: (v) => {
          const value = typeof v === 'string' ? v.trim().toLowerCase() : '';
          if (!value || value === 'auto') return <Tag>默认</Tag>;
          if (value === 'none') return <Tag color="gold">NONE</Tag>;
          return <Tag>{value.toUpperCase()}</Tag>;
        },
      },
      {
        title: 'Base URL',
        dataIndex: 'baseUrl',
        width: 180,
        render: (v) => (
          <Paragraph style={{ margin: 0 }} ellipsis={{ rows: 1, expandable: false }}>
            {v || '-'}
          </Paragraph>
        ),
      },
      { title: 'API Key Env', dataIndex: 'apiKeyEnv', width: 140, render: (v) => v || '-' },
      {
        title: '默认',
        dataIndex: 'isDefault',
        width: 90,
        render: (v) => (v ? <Tag color="green">默认</Tag> : '-'),
      },
      {
        title: '描述',
        dataIndex: 'description',
        render: (text) => (
          <Paragraph style={{ margin: 0 }} ellipsis={{ rows: 2, expandable: false }}>
            {text || '-'}
          </Paragraph>
        ),
      },
      { title: '创建时间', dataIndex: 'createdAt', width: 160, render: (v) => v || '-' },
      { title: '更新时间', dataIndex: 'updatedAt', width: 160, render: (v) => v || '-' },
    ],
    []
  );
  const fields = useMemo(
    () => [
      { name: 'name', label: '名称', required: true, placeholder: '如 default' },
      {
        name: 'provider',
        label: 'Provider',
        required: true,
        type: 'select',
        defaultValue: 'openai',
        options: providerOptions,
      },
      { name: 'model', label: '模型 ID', required: true, placeholder: 'gpt-4o-mini / ds-chat' },
      {
        name: 'reasoningEffort',
        label: '思考等级',
        type: 'select',
        options: [
          { label: '默认（不传）', value: '' },
          { label: 'MINIMAL', value: 'minimal' },
          { label: 'LOW', value: 'low' },
          { label: 'MEDIUM', value: 'medium' },
          { label: 'HIGH', value: 'high' },
        ],
        extra: '仅 GPT 系列模型支持（请求参数 reasoning_effort）。',
        hidden: (values) => !isGptModelId(values?.model),
      },
      {
        name: 'toolFollowupMode',
        label: '工具后续',
        type: 'select',
        options: [
          { label: '默认（继续传 tools）', value: '' },
          { label: 'NONE（后续请求不传 tools）', value: 'none' },
        ],
        extra: '部分兼容网关需要在工具返回后关闭 tools 参数。',
      },
      { name: 'baseUrl', label: 'Base URL', placeholder: '可选，代理/自托管入口' },
      { name: 'apiKeyEnv', label: 'API Key Env', placeholder: '如 OPENAI_API_KEY' },
      { name: 'description', label: '描述', type: 'textarea', rows: 2 },
      { name: 'isDefault', label: '设为默认', type: 'switch', defaultValue: false },
      {
        name: 'supportsVision',
        label: '支持图片理解',
        type: 'switch',
        defaultValue: false,
        extra: '开启后，对话输入框可粘贴/上传图片，并以 base64(data URL) 发送给模型。',
      },
    ],
    [providerOptions]
  );

  return (
    <EntityManager
      title="模型配置"
      description="管理模型/Provider 列表，支持自定义 baseUrl。"
      data={data}
      fields={fields}
      columns={columns}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onDelete={onDelete}
      loading={loading}
      renderActions={(record, { onEdit, onDelete: handleDelete }) => (
        <Space>
          <Button size="small" onClick={onEdit}>
            编辑
          </Button>
          <Popconfirm title="确认删除?" onConfirm={handleDelete}>
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
          <Button size="small" type="link" disabled={record.isDefault} onClick={() => onSetDefault(record.id)}>
            设为默认
          </Button>
        </Space>
      )}
      tableProps={{ scroll: { x: 1000 } }}
    />
  );
}

export { ModelsManager };
