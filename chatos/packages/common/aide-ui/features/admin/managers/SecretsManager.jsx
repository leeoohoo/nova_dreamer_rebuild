import React, { useMemo, useState } from 'react';
import { Button, Popconfirm, Space, Tag, Typography, message } from 'antd';

import { EntityManager } from '../../../components/EntityManager.jsx';

const { Text, Paragraph } = Typography;

function SecretsManager({ data, onCreate, onUpdate, onDelete, loading }) {
  const [togglingId, setTogglingId] = useState(null);

  const columns = useMemo(
    () => [
      { title: '环境变量名', dataIndex: 'name', width: 180 },
      {
        title: '状态',
        dataIndex: 'hasValue',
        width: 90,
        render: (v) => (v ? <Tag color="green">已设置</Tag> : <Tag>未设置</Tag>),
      },
      {
        title: '策略',
        dataIndex: 'override',
        width: 110,
        render: (v) => (v ? <Tag color="volcano">覆盖系统</Tag> : <Tag>仅补充</Tag>),
      },
      {
        title: 'Key (masked)',
        dataIndex: 'value',
        width: 160,
        render: (v) => (v ? <Text code>{v}</Text> : '-'),
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
      {
        name: 'name',
        label: '环境变量名',
        required: true,
        placeholder: '如 DEEPSEEK_API_KEY',
        extra: '用于模型配置中的 apiKeyEnv / api_key_env 引用。',
      },
      {
        name: 'value',
        label: 'API Key',
        type: 'password',
        requiredOnCreate: true,
        omitInitialValue: true,
        placeholder: 'sk-xxxx',
        extra: '新建必填；编辑时留空表示不修改。',
      },
      { name: 'description', label: '描述', type: 'textarea', rows: 2 },
    ],
    []
  );

  const handleUpdate = async (id, values) => {
    const patch = { ...(values || {}) };
    if (typeof patch.value === 'string' && patch.value.trim() === '') {
      delete patch.value;
    }
    await onUpdate(id, patch);
  };

  const toggleOverride = async (record, next) => {
    const id = record?.id;
    if (!id) return;
    setTogglingId(id);
    try {
      await onUpdate(id, { override: next });
      message.success(next ? '已启用覆盖系统 env' : '已关闭覆盖系统 env');
    } catch (err) {
      message.error(err?.message || '操作失败');
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <EntityManager
      title="API Keys"
      description="在 UI 中保存 API Key（模型调用只从这里读取；也会注入到进程 env 供部分工具使用）。"
      data={data}
      fields={fields}
      columns={columns}
      onCreate={onCreate}
      onUpdate={handleUpdate}
      onDelete={onDelete}
      loading={loading}
      tableProps={{ scroll: { x: 980 } }}
      renderActions={(record, { onEdit, onDelete: handleDelete }) => {
        const overrideEnabled = record?.override === true;
        return (
          <Space>
            <Button size="small" onClick={onEdit}>
              编辑
            </Button>
            <Popconfirm title="确认删除?" onConfirm={handleDelete}>
              <Button size="small" danger>
                删除
              </Button>
            </Popconfirm>
            {overrideEnabled ? (
              <Popconfirm
                title="关闭覆盖系统 env?"
                description="关闭后：若终端/系统已有同名环境变量，将优先使用系统值。"
                okText="关闭"
                cancelText="取消"
                onConfirm={() => toggleOverride(record, false)}
              >
                <Button size="small" loading={togglingId === record?.id}>
                  取消覆盖
                </Button>
              </Popconfirm>
            ) : (
              <Popconfirm
                title="启用覆盖系统 env?"
                description="启用后：即使终端/系统已设置同名环境变量，也会用这里的值覆盖（仅对 CLI 进程生效）。"
                okText="启用覆盖"
                cancelText="取消"
                onConfirm={() => toggleOverride(record, true)}
              >
                <Button size="small" type="link" loading={togglingId === record?.id}>
                  覆盖系统 env
                </Button>
              </Popconfirm>
            )}
          </Space>
        );
      }}
    />
  );
}

export { SecretsManager };
