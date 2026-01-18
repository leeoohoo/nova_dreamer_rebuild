import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Col, Form, Input, Row, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import { formatStateDirLabel } from '../../../../../../../common/aide-ui/lib/state-paths.js';

const { Text, Paragraph } = Typography;
const SUBAGENT_INSTALL_HINT =
  `提示：安装会把外部 marketplace 的插件转换到 \`${formatStateDirLabel({ hostApp: '<hostApp>', style: 'tilde' })}/subagents/plugins/\`，并写入 \`subagents.json\`。`;

function SubagentsManager({
  data,
  models,
  onUpdateStatus,
  onListMarketplace,
  onAddMarketplaceSource,
  onInstallPlugin,
  onUninstallPlugin,
  loading,
  onSetModel,
  developerMode = false,
}) {
  const [form] = Form.useForm();
  const [marketForm] = Form.useForm();
  const [settingModel, setSettingModel] = useState(false);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketplace, setMarketplace] = useState([]);
  const [sources, setSources] = useState([]);
  const [showMarketplace, setShowMarketplace] = useState(true);
  const [pluginSearch, setPluginSearch] = useState('');
  const [pluginFilter, setPluginFilter] = useState('all');
  const [installingId, setInstallingId] = useState('');
  const [uninstallingId, setUninstallingId] = useState('');
  const [addingSource, setAddingSource] = useState(false);
  const allowMarketplace = developerMode || showMarketplace;

  const rows = (Array.isArray(data) ? data : []).map((item) => ({ ...item, key: item.id }));
  const pluginOptions = useMemo(
    () => (rows || []).map((item) => ({ label: item.name || item.id, value: item.id })),
    [rows]
  );
  const modelOptions = useMemo(() => {
    const list = Array.isArray(models) ? models : [];
    return list
      .filter((m) => m?.name)
      .map((m) => {
        const name = String(m.name);
        const provider = m?.provider ? String(m.provider) : '';
        const modelId = m?.model ? String(m.model) : '';
        const suffix = provider || modelId ? ` · ${[provider, modelId].filter(Boolean).join(':')}` : '';
        const isDefault = m?.isDefault === true;
        return {
          label: `${name}${suffix}${isDefault ? ' (默认)' : ''}`,
          value: name,
        };
      });
  }, [models]);
  const defaultModelValue = useMemo(() => {
    const list = Array.isArray(models) ? models : [];
    const preferred = list.find((m) => m?.isDefault && m?.name)?.name;
    const fallback = list.find((m) => m?.name)?.name;
    return preferred || fallback || 'deepseek_chat';
  }, [models]);
  const configuredModelNames = useMemo(() => {
    const set = new Set();
    (Array.isArray(models) ? models : []).forEach((m) => {
      const name = typeof m?.name === 'string' ? m.name.trim() : '';
      if (name) set.add(name);
    });
    return set;
  }, [models]);
  const inferredSubagentDefaultModel = useMemo(() => {
    return configuredModelNames.has('deepseek_chat') ? 'deepseek_chat' : null;
  }, [configuredModelNames]);

  const handleSetModel = async () => {
    if (!onSetModel) return;
    try {
      const values = await form.validateFields();
      const payload = {
        model: values.model,
        plugins: Array.isArray(values.plugins) && values.plugins.length > 0 ? values.plugins : null,
      };
      setSettingModel(true);
      const result = await onSetModel(payload);
      const updated = Number(result?.updated || 0);
      const scanned = Number(result?.scanned || 0);
      const errors = Array.isArray(result?.errors) ? result.errors : [];
      if (errors.length > 0) {
        const first = errors[0] || {};
        const head = [first?.plugin, first?.error].filter(Boolean).join(': ');
        if (updated > 0) {
          message.warning(`已更新 ${updated}/${scanned || updated} 个插件，但有 ${errors.length} 个失败：${head || '未知错误'}`);
        } else {
          message.error(`更新失败：${head || '未知错误'}`);
        }
      } else {
        message.success(updated > 0 ? `模型已更新（${updated} 个插件）` : '模型已更新');
      }
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.message || '更新模型失败');
    } finally {
      setSettingModel(false);
    }
  };

  const refreshMarketplace = async () => {
    if (!onListMarketplace) return;
    try {
      setMarketLoading(true);
      const result = await onListMarketplace();
      if (result?.ok === false) {
        throw new Error(result?.message || '加载 marketplace 失败');
      }
      setMarketplace(Array.isArray(result?.marketplace) ? result.marketplace : []);
      setSources(Array.isArray(result?.sources) ? result.sources : []);
    } catch (err) {
      message.error(err?.message || '加载 marketplace 失败');
    } finally {
      setMarketLoading(false);
    }
  };

  useEffect(() => {
    if (allowMarketplace) {
      refreshMarketplace();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddSource = async () => {
    if (!onAddMarketplaceSource) return;
    try {
      const values = await marketForm.validateFields();
      const source = String(values.source || '').trim();
      if (!source) return;
      setAddingSource(true);
      const result = await onAddMarketplaceSource(source);
      if (result?.ok === false) {
        throw new Error(result?.message || '添加 marketplace 源失败');
      }
      message.success(`已添加 marketplace 源：${result.sourceId || source}`);
      marketForm.resetFields();
      await refreshMarketplace();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.message || '添加 marketplace 源失败');
    } finally {
      setAddingSource(false);
    }
  };

  const handleInstall = async (pluginId) => {
    if (!onInstallPlugin) return;
    const id = String(pluginId || '').trim();
    if (!id) return;
    try {
      setInstallingId(id);
      const result = await onInstallPlugin(id);
      if (result?.ok === false) {
        throw new Error(result?.message || '安装失败');
      }
      message.success(`已安装插件：${id}`);
    } catch (err) {
      message.error(err?.message || '安装失败');
    } finally {
      setInstallingId('');
    }
  };

  const handleUninstall = async (pluginId) => {
    if (!onUninstallPlugin) return;
    const id = String(pluginId || '').trim();
    if (!id) return;
    try {
      setUninstallingId(id);
      const result = await onUninstallPlugin(id);
      if (result?.ok === false) {
        throw new Error(result?.message || '卸载失败');
      }
      message.success(`已卸载插件：${id}`);
    } catch (err) {
      message.error(err?.message || '卸载失败');
    } finally {
      setUninstallingId('');
    }
  };

  const mergedPlugins = useMemo(() => {
    const installed = Array.isArray(data) ? data : [];
    const market = allowMarketplace && Array.isArray(marketplace) ? marketplace : [];
    const installedById = new Map();
    installed.forEach((item) => {
      const id = String(item?.id || '').trim();
      if (!id) return;
      installedById.set(id, item);
    });
    const marketById = new Map();
    market.forEach((entry) => {
      const id = String(entry?.id || '').trim();
      if (!id) return;
      marketById.set(id, entry);
    });

    const ids = new Set([...installedById.keys(), ...marketById.keys()]);
    const combined = Array.from(ids).map((id) => {
      const installedEntry = installedById.get(id);
      const marketEntry = marketById.get(id);
      const marketTags =
        Array.isArray(marketEntry?.tags) && marketEntry.tags.length > 0
          ? marketEntry.tags
          : marketEntry?.category
            ? [marketEntry.category]
            : [];
      return {
        id,
        key: id,
        name: installedEntry?.name || marketEntry?.name || id,
        description: installedEntry?.description || marketEntry?.description || '',
        category: marketEntry?.category || '',
        source: marketEntry?.source || null,
        fromMarketplace: Boolean(marketEntry),
        installed: Boolean(installedEntry),
        enabled: installedEntry?.enabled === true,
        models: installedEntry?.models || (Array.isArray(marketEntry?.models) ? marketEntry.models : []),
        modelImplicit: installedEntry?.modelImplicit === true,
        agents: installedEntry?.agents || (Array.isArray(marketEntry?.agents) ? marketEntry.agents : []),
        skills: installedEntry?.skills || (Array.isArray(marketEntry?.skills) ? marketEntry.skills : []),
        commands: installedEntry?.commands || (Array.isArray(marketEntry?.commands) ? marketEntry.commands : []),
        tags: installedEntry?.tags || marketTags,
        updatedAt: installedEntry?.updatedAt || '',
      };
    });

    combined.sort((a, b) => {
      if (a.installed !== b.installed) return a.installed ? -1 : 1;
      const an = String(a.name || a.id || '');
      const bn = String(b.name || b.id || '');
      return an.localeCompare(bn);
    });
    return combined;
  }, [allowMarketplace, data, marketplace]);

  const pluginRows = useMemo(() => {
    const filter = String(pluginFilter || 'all');
    const query = String(pluginSearch || '').trim().toLowerCase();
    let list = Array.isArray(mergedPlugins) ? mergedPlugins : [];
    if (filter === 'installed') {
      list = list.filter((entry) => entry.installed);
    } else if (filter === 'available') {
      list = list.filter((entry) => !entry.installed);
    }
    if (!query) return list;
    return list.filter((entry) => {
      const hay = `${entry?.id || ''} ${entry?.name || ''} ${entry?.description || ''} ${entry?.category || ''} ${(entry?.tags || []).join(' ')}`.toLowerCase().trim();
      return hay.includes(query);
    });
  }, [mergedPlugins, pluginFilter, pluginSearch]);

  const renderTagList = (items) => {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) return <Text type="secondary">-</Text>;
    return list.map((item) => {
      const label = typeof item === 'string' ? item : item?.name || item?.id;
      const key = typeof item === 'string' ? item : item?.id || item?.name || label;
      if (!label) return null;
      return <Tag key={String(key || label)}>{label}</Tag>;
    });
  };

  const renderModelSummary = (record) => {
    if (!record?.installed) return <Text type="secondary">-</Text>;
    const explicit = Array.isArray(record?.models) ? record.models.filter((m) => typeof m === 'string' && m.trim()) : [];
    const implicit = record?.modelImplicit === true;
    const tags = [];
    explicit.forEach((m) => {
      const name = String(m).trim();
      if (!name) return;
      const known = configuredModelNames.has(name);
      tags.push(
        <Tag key={name} color={known ? 'geekblue' : 'orange'}>
          {name}
        </Tag>
      );
    });
    if (implicit) {
      const label = inferredSubagentDefaultModel ? `${inferredSubagentDefaultModel} (默认)` : '默认(当前对话模型)';
      tags.push(<Tag key="implicit">{label}</Tag>);
    }
    if (tags.length === 0) return <Text type="secondary">-</Text>;
    return (
      <Space size={4} wrap>
        {tags}
      </Space>
    );
  };

  const pluginColumns = useMemo(
    () => [
      { title: 'ID', dataIndex: 'id', width: 220 },
      { title: '名称', dataIndex: 'name', width: 220 },
      {
        title: '来源',
        dataIndex: 'source',
        width: 220,
        render: (src, record) => {
          const id = src?.id || '';
          if (id) return <Tag color="blue">{id}</Tag>;
          return record.fromMarketplace ? <Text type="secondary">builtin</Text> : <Text type="secondary">local</Text>;
        },
      },
      {
        title: '分类',
        dataIndex: 'category',
        width: 160,
        render: (v) => (v ? <Tag>{v}</Tag> : <Text type="secondary">-</Text>),
      },
      {
        title: '模型',
        width: 240,
        render: (_text, record) => renderModelSummary(record),
      },
      {
        title: '状态',
        width: 120,
        render: (_text, record) => {
          if (!record.installed) return <Tag>未安装</Tag>;
          return record.enabled ? <Tag color="green">已启用</Tag> : <Tag color="default">已禁用</Tag>;
        },
      },
      {
        title: '操作',
        width: 220,
        render: (_text, record) => {
          if (!record.installed) {
            return (
              <Button
                type="primary"
                size="small"
                onClick={() => handleInstall(record.id)}
                disabled={!onInstallPlugin}
                loading={installingId === record.id}
              >
                安装
              </Button>
            );
          }
          return (
            <Space size={8}>
              <Switch
                checked={record.enabled}
                onChange={(checked) => onUpdateStatus?.(record.id, { enabled: checked })}
                disabled={!onUpdateStatus}
              />
              <Button
                danger
                size="small"
                onClick={() => handleUninstall(record.id)}
                disabled={!onUninstallPlugin}
                loading={uninstallingId === record.id}
              >
                卸载
              </Button>
            </Space>
          );
        },
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
    ],
    [
      configuredModelNames,
      handleInstall,
      handleUninstall,
      inferredSubagentDefaultModel,
      installingId,
      onInstallPlugin,
      onUninstallPlugin,
      onUpdateStatus,
      uninstallingId,
    ]
  );

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {allowMarketplace ? (
      <Card
        title="Marketplace 源"
        size="small"
        extra={
          <Button onClick={refreshMarketplace} loading={marketLoading}>
            刷新
          </Button>
        }
      >
        <Form form={marketForm} layout="inline" onFinish={handleAddSource}>
          <Form.Item
            name="source"
            rules={[{ required: true, message: '请输入 repo/url/path' }]}
            style={{ flex: 1, minWidth: 360 }}
          >
            <Input placeholder="例如：wshobson/agents 或 https://github.com/wshobson/agents 或 /path/to/repo" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={addingSource}>
              添加
            </Button>
          </Form.Item>
        </Form>
	        <Table
	          size="small"
	          style={{ marginTop: 12 }}
	          dataSource={(Array.isArray(sources) ? sources : []).map((s) => ({ ...s, key: s.id }))}
	          loading={marketLoading}
          columns={[
	            { title: 'ID', dataIndex: 'id', width: 260 },
	            { title: '类型', dataIndex: 'type', width: 120, render: (t) => <Tag>{t || 'git'}</Tag> },
	            { title: 'URL', dataIndex: 'url', render: (v) => <Text type="secondary">{v || '-'}</Text> },
	          ]}
	          pagination={{
	            defaultPageSize: 5,
	            showSizeChanger: true,
	            pageSizeOptions: ['5', '10', '20', '50'],
	          }}
	          scroll={{ x: 800 }}
	        />
	      </Card>
      ) : null}
      <Card
        title="Sub-agent 插件"
        size="small"
        extra={
          <Space size={10} wrap>
            <Text type="secondary">显示 marketplace：</Text>
            <Switch
              size="small"
              checked={allowMarketplace}
              disabled={developerMode}
              onChange={(checked) => {
                const next = Boolean(checked);
                setShowMarketplace(next);
                if (next) refreshMarketplace();
              }}
            />
            {developerMode ? <Tag color="blue">开发者模式</Tag> : null}
            {allowMarketplace ? (
              <Button onClick={refreshMarketplace} loading={marketLoading} size="small">
                刷新
              </Button>
            ) : null}
          </Space>
        }
      >
        <Row gutter={[12, 12]} style={{ marginBottom: 8 }}>
          <Col xs={24} md={12} lg={9}>
            <Input
              value={pluginSearch}
              onChange={(e) => setPluginSearch(e.target.value)}
              placeholder="搜索插件 id / name / 描述 / 分类"
              allowClear
            />
          </Col>
          <Col xs={24} md={12} lg={5}>
            <Select
              value={pluginFilter}
              onChange={setPluginFilter}
              options={[
                { label: '全部', value: 'all' },
                { label: '已安装', value: 'installed' },
                { label: '未安装', value: 'available' },
              ]}
              style={{ width: '100%' }}
            />
          </Col>
          <Col xs={24} md={24} lg={10}>
            {allowMarketplace ? (
              <Text type="secondary">{SUBAGENT_INSTALL_HINT}</Text>
            ) : null}
          </Col>
        </Row>
        <Table
          size="small"
          dataSource={pluginRows}
          loading={loading || marketLoading}
          columns={pluginColumns}
          expandable={{
            expandedRowRender: (record) => {
              const hasDetails =
                (Array.isArray(record.agents) && record.agents.length > 0) ||
                (Array.isArray(record.skills) && record.skills.length > 0) ||
                (Array.isArray(record.commands) && record.commands.length > 0);
              if (!record.installed && !hasDetails) {
                return <Text type="secondary">未安装，安装后可查看 agents / skills / commands 等详情。</Text>;
              }
              return (
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  <div>
                    <Text type="secondary">模型：</Text>
                    {renderModelSummary(record)}
                  </div>
                  <div>
                    <Text type="secondary">角色：</Text>
                    {renderTagList(record.agents)}
                  </div>
                  <div>
                    <Text type="secondary">技能：</Text>
                    {renderTagList(record.skills)}
                  </div>
                  <div>
                    <Text type="secondary">命令：</Text>
                    {renderTagList(record.commands)}
                  </div>
                  <div>
                    <Text type="secondary">标签：</Text>
                    {renderTagList(record.tags)}
                  </div>
                  <div>
                    <Text type="secondary">更新时间：</Text>
                    <Text>{record.updatedAt || '-'}</Text>
                  </div>
                </Space>
              );
            },
            rowExpandable: (record) =>
              record.installed ||
              (Array.isArray(record.agents) && record.agents.length > 0) ||
              (Array.isArray(record.skills) && record.skills.length > 0) ||
              (Array.isArray(record.commands) && record.commands.length > 0),
	          }}
	          pagination={{
	            defaultPageSize: 10,
	            showSizeChanger: true,
	            pageSizeOptions: ['10', '20', '50', '100'],
	          }}
	          scroll={{ x: 1200 }}
	        />
	      </Card>
      <Card title="批量设置模型" size="small">
          <Form
            form={form}
            layout="vertical"
            initialValues={{ model: defaultModelValue, plugins: [] }}
            onFinish={handleSetModel}
            style={{ width: '100%' }}
          >
            <Row gutter={[12, 12]}>
              <Col xs={24} md={12} lg={8}>
                <Form.Item name="model" label="目标模型" rules={[{ required: true, message: '请选择目标模型' }]}>
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder={modelOptions.length > 0 ? '选择已配置的模型' : '未找到模型配置，请先到「模型」页面添加'}
                    options={modelOptions}
                    disabled={modelOptions.length === 0}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12} lg={16}>
                <Form.Item name="plugins" label="选择插件 (留空=全部)">
                  <Select
                    mode="multiple"
                    allowClear
                    style={{ width: '100%' }}
                    placeholder="选择部分插件，或留空批量应用"
                    options={pluginOptions}
                    maxTagCount="responsive"
                  />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Space wrap>
                  <Button onClick={() => form.setFieldsValue({ plugins: pluginOptions.map((p) => p.value) })}>全选</Button>
                  <Button onClick={() => form.setFieldsValue({ plugins: [] })}>清空选择</Button>
                  <Button type="primary" htmlType="submit" loading={settingModel}>
                    应用模型
                  </Button>
                </Space>
              </Col>
            </Row>
          </Form>
          <Text type="secondary" style={{ marginTop: 8, display: 'block' }}>
            提示：不选择插件时会对全部插件生效，更新 agents 与 commands 的模型字段。
          </Text>
        </Card>
    </Space>
  );
}

export { SubagentsManager };
