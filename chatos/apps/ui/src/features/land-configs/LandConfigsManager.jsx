import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Divider, Empty, Form, Input, List, Modal, Select, Space, Tag, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

import { api, hasApi } from '../../lib/api.js';
import { useUiAppsRegistry } from '../apps/hooks/useUiAppsRegistry.js';

const { Title, Paragraph, Text } = Typography;

const RESERVED_PROMPT_NAMES = new Set([
  'internal',
  'internal_main',
  'internal_subagent',
  'default',
  'user_prompt',
  'subagent_user_prompt',
]);

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeServerName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function resolveMcpPromptNames(serverName) {
  const normalized = normalizeServerName(serverName);
  if (!normalized) return { zh: '', en: '' };
  const base = `mcp_${normalized}`;
  return { zh: base, en: `${base}__en` };
}

function toAppKey(pluginId, appId) {
  const pid = String(pluginId || '').trim();
  const aid = String(appId || '').trim();
  if (!pid || !aid) return '';
  return `${pid}::${aid}`;
}

function parseAppKey(key) {
  const raw = typeof key === 'string' ? key : '';
  const idx = raw.indexOf('::');
  if (idx <= 0) return null;
  const pluginId = raw.slice(0, idx).trim();
  const appId = raw.slice(idx + 2).trim();
  if (!pluginId || !appId) return null;
  return { pluginId, appId };
}

function ensureFlow(flow) {
  const base = flow && typeof flow === 'object' ? flow : {};
  return {
    mcpServers: Array.isArray(base.mcpServers) ? base.mcpServers : [],
    apps: Array.isArray(base.apps) ? base.apps : [],
    prompts: Array.isArray(base.prompts) ? base.prompts : [],
  };
}

export function LandConfigsManager({ admin }) {
  const [configs, setConfigs] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();

  const { data: uiAppsData, loading: uiAppsLoading } = useUiAppsRegistry();

  const promptIndex = useMemo(() => {
    const map = new Map();
    (Array.isArray(admin?.prompts) ? admin.prompts : []).forEach((prompt) => {
      const rawName = typeof prompt?.name === 'string' ? prompt.name.trim() : '';
      if (!rawName) return;
      const lower = normalizeKey(rawName);
      if (lower.startsWith('mcp_')) return;
      if (RESERVED_PROMPT_NAMES.has(lower)) return;
      const isEn = /__en$/i.test(rawName);
      const key = isEn ? rawName.replace(/__en$/i, '') : rawName;
      const entry = map.get(key) || { key, title: '', zh: null, en: null };
      if (isEn) {
        entry.en = prompt;
      } else {
        entry.zh = prompt;
      }
      if (!entry.title) {
        entry.title = typeof prompt?.title === 'string' && prompt.title.trim() ? prompt.title.trim() : key;
      }
      map.set(key, entry);
    });
    return map;
  }, [admin?.prompts]);

  const promptOptions = useMemo(
    () =>
      Array.from(promptIndex.values()).map((entry) => ({
        value: entry.key,
        label: `${entry.title} (${entry.key})`,
      })),
    [promptIndex]
  );

  const mcpServerOptions = useMemo(
    () =>
      (Array.isArray(admin?.mcpServers) ? admin.mcpServers : []).map((server) => ({
        value: server.id,
        label: server.name || server.id,
        disabled: server.enabled === false,
      })),
    [admin?.mcpServers]
  );

  const uiAppOptions = useMemo(() => {
    const apps = Array.isArray(uiAppsData?.apps) ? uiAppsData.apps : [];
    return apps
      .filter((app) => Boolean(app?.ai?.mcp?.url))
      .map((app) => {
        const pluginId = app?.plugin?.id || '';
        const appId = app?.id || '';
        const key = toAppKey(pluginId, appId);
        const pluginLabel = app?.plugin?.name || pluginId;
        const appLabel = app?.name || appId;
        return {
          value: key,
          label: `${appLabel} · ${pluginLabel}`,
          meta: {
            pluginId,
            appId,
            name: appLabel,
          },
        };
      })
      .filter((entry) => entry.value);
  }, [uiAppsData]);

  const uiAppOptionMap = useMemo(() => {
    const map = new Map();
    uiAppOptions.forEach((entry) => map.set(entry.value, entry.meta));
    return map;
  }, [uiAppOptions]);

  const mcpServerMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(admin?.mcpServers) ? admin.mcpServers : []).forEach((server) => {
      if (server?.id) map.set(server.id, server);
    });
    return map;
  }, [admin?.mcpServers]);

  const loadConfigs = useCallback(async () => {
    if (!hasApi) return;
    setLoading(true);
    try {
      const list = await api.invoke('admin:landConfigs:list');
      const normalized = Array.isArray(list) ? list : [];
      setConfigs(normalized);
      if (normalized.length === 0) {
        setSelectedId(null);
      } else if (!selectedId || !normalized.some((item) => item.id === selectedId)) {
        setSelectedId(normalized[0].id);
      }
    } catch (err) {
      message.error(err?.message || '加载 land_configs 失败');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  useEffect(() => {
    if (!hasApi) return undefined;
    const unsub = api.on('admin:update', () => {
      void loadConfigs();
    });
    return () => unsub?.();
  }, [loadConfigs]);

  useEffect(() => {
    const selected = configs.find((item) => item.id === selectedId) || null;
    if (!selected) {
      setDraft(null);
      return;
    }
    setDraft(JSON.parse(JSON.stringify(selected)));
  }, [configs, selectedId]);

  const updateDraft = (patch) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, ...patch };
    });
  };

  const isLocked = Boolean(draft?.locked);

  const updateFlow = (flowKey, patch) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const nextFlow = { ...ensureFlow(prev?.[flowKey]), ...patch };
      return { ...prev, [flowKey]: nextFlow };
    });
  };

  const updateMcpServers = (flowKey, ids) => {
    const prev = ensureFlow(draft?.[flowKey]);
    const prevById = new Map(prev.mcpServers.map((item) => [item.id, item]));
    const nextList = (Array.isArray(ids) ? ids : []).map((id) => {
      const existing = prevById.get(id) || {};
      const server = mcpServerMap.get(id);
      return {
        id,
        name: server?.name || existing.name || '',
        promptLang: existing.promptLang === 'en' ? 'en' : 'zh',
      };
    });
    updateFlow(flowKey, { mcpServers: nextList });
  };

  const updateMcpLang = (flowKey, id, lang) => {
    const prev = ensureFlow(draft?.[flowKey]);
    const nextList = prev.mcpServers.map((item) =>
      item.id === id ? { ...item, promptLang: lang === 'en' ? 'en' : 'zh' } : item
    );
    updateFlow(flowKey, { mcpServers: nextList });
  };

  const updateApps = (flowKey, keys) => {
    const prev = ensureFlow(draft?.[flowKey]);
    const prevByKey = new Map(prev.apps.map((item) => [toAppKey(item.pluginId, item.appId), item]));
    const nextList = (Array.isArray(keys) ? keys : []).map((key) => {
      const parsed = parseAppKey(key);
      if (!parsed) return null;
      const existing = prevByKey.get(key) || {};
      const meta = uiAppOptionMap.get(key) || null;
      return {
        pluginId: parsed.pluginId,
        appId: parsed.appId,
        name: meta?.name || existing.name || '',
      };
    });
    updateFlow(
      flowKey,
      { apps: nextList.filter(Boolean) }
    );
  };

  const updatePrompts = (flowKey, keys) => {
    const prev = ensureFlow(draft?.[flowKey]);
    const prevByKey = new Map(prev.prompts.map((item) => [item.key, item]));
    const nextList = (Array.isArray(keys) ? keys : []).map((key) => {
      const entry = promptIndex.get(key);
      const existing = prevByKey.get(key) || {};
      const defaultLang = entry?.zh ? 'zh' : entry?.en ? 'en' : 'zh';
      let lang = existing.lang === 'en' || existing.lang === 'zh' ? existing.lang : defaultLang;
      if (lang === 'en' && !entry?.en && entry?.zh) lang = 'zh';
      if (lang === 'zh' && !entry?.zh && entry?.en) lang = 'en';
      return { key, lang };
    });
    updateFlow(flowKey, { prompts: nextList });
  };

  const updatePromptLang = (flowKey, key, lang) => {
    const prev = ensureFlow(draft?.[flowKey]);
    const entry = promptIndex.get(key);
    let nextLang = lang === 'en' ? 'en' : 'zh';
    if (nextLang === 'en' && !entry?.en && entry?.zh) nextLang = 'zh';
    if (nextLang === 'zh' && !entry?.zh && entry?.en) nextLang = 'en';
    const nextList = prev.prompts.map((item) => (item.key === key ? { ...item, lang: nextLang } : item));
    updateFlow(flowKey, { prompts: nextList });
  };

  const applyFlowLanguage = (flowKey, lang) => {
    const targetLang = lang === 'en' ? 'en' : 'zh';
    setDraft((prev) => {
      if (!prev) return prev;
      const flow = ensureFlow(prev?.[flowKey]);
      const nextMcpServers = flow.mcpServers.map((item) => ({
        ...item,
        promptLang: targetLang,
      }));
      const nextPrompts = flow.prompts.map((item) => {
        const entry = promptIndex.get(item.key);
        let nextLang = targetLang;
        if (nextLang === 'en' && !entry?.en && entry?.zh) nextLang = 'zh';
        if (nextLang === 'zh' && !entry?.zh && entry?.en) nextLang = 'en';
        return { ...item, lang: nextLang };
      });
      return {
        ...prev,
        [flowKey]: {
          ...flow,
          mcpServers: nextMcpServers,
          prompts: nextPrompts,
        },
      };
    });
  };

  const handleSave = async () => {
    if (!draft?.id) return;
    if (!hasApi) return;
    if (draft?.locked) {
      message.warning('该 land_config 为内置配置，禁止编辑。');
      return;
    }
    const payload = {
      name: typeof draft.name === 'string' ? draft.name.trim() : '',
      description: typeof draft.description === 'string' ? draft.description : '',
      main: ensureFlow(draft.main),
      sub: ensureFlow(draft.sub),
    };
    if (!payload.name) {
      message.warning('名称不能为空');
      return;
    }
    try {
      setSaving(true);
      await api.invoke('admin:landConfigs:update', { id: draft.id, data: payload });
      message.success('已保存');
      await loadConfigs();
    } catch (err) {
      message.error(err?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!hasApi) return;
    try {
      const values = await createForm.validateFields();
      const payload = {
        name: typeof values?.name === 'string' ? values.name.trim() : '',
        description: typeof values?.description === 'string' ? values.description : '',
      };
      if (!payload.name) {
        message.warning('名称不能为空');
        return;
      }
      const created = await api.invoke('admin:landConfigs:create', payload);
      setCreateOpen(false);
      createForm.resetFields();
      await loadConfigs();
      if (created?.id) {
        setSelectedId(created.id);
      }
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.message || '创建失败');
    }
  };

  const handleDelete = async (id) => {
    if (!hasApi) return;
    const target = configs.find((item) => item.id === id);
    if (target?.locked) {
      message.warning('该 land_config 为内置配置，禁止删除。');
      return;
    }
    try {
      await api.invoke('admin:landConfigs:delete', { id });
      message.success('已删除');
      await loadConfigs();
    } catch (err) {
      message.error(err?.message || '删除失败');
    }
  };

  const renderFlowSection = (flowKey, title) => {
    const flow = ensureFlow(draft?.[flowKey]);
    const selectedMcpIds = flow.mcpServers.map((item) => item.id);
    const selectedAppKeys = flow.apps.map((item) => toAppKey(item.pluginId, item.appId));
    const selectedPromptKeys = flow.prompts.map((item) => item.key);
    return (
      <div>
        <Title level={5} style={{ marginTop: 0 }}>
          {title}
        </Title>
        <Space size={8} style={{ marginBottom: 12 }}>
          <Text type="secondary">一键语言</Text>
          <Button size="small" onClick={() => applyFlowLanguage(flowKey, 'zh')} disabled={isLocked}>
            中文
          </Button>
          <Button size="small" onClick={() => applyFlowLanguage(flowKey, 'en')} disabled={isLocked}>
            English
          </Button>
        </Space>

        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <Text strong>MCP Servers</Text>
            <Select
              mode="multiple"
              allowClear
              placeholder="选择 MCP Server"
              style={{ width: '100%', marginTop: 6 }}
              options={mcpServerOptions}
              value={selectedMcpIds}
              onChange={(values) => updateMcpServers(flowKey, values)}
              disabled={isLocked}
            />
            {flow.mcpServers.length > 0 ? (
              <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                {flow.mcpServers.map((item) => {
                  const server = mcpServerMap.get(item.id);
                  const serverName = server?.name || item.name || item.id;
                  const promptNames = resolveMcpPromptNames(serverName);
                  const promptName = item.promptLang === 'en' ? promptNames.en : promptNames.zh;
                  return (
                    <Space key={item.id} size={8} wrap>
                      <Tag color={server?.enabled === false ? 'default' : 'blue'}>{serverName}</Tag>
                      <Text type="secondary">Prompt：</Text>
                      <Tag>{promptName || '-'}</Tag>
                      <Select
                        size="small"
                        value={item.promptLang === 'en' ? 'en' : 'zh'}
                        onChange={(value) => updateMcpLang(flowKey, item.id, value)}
                        options={[
                          { label: '中文', value: 'zh' },
                          { label: 'English', value: 'en' },
                        ]}
                        style={{ width: 110 }}
                        disabled={isLocked}
                      />
                    </Space>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div>
            <Text strong>应用（带 MCP）</Text>
            <Select
              mode="multiple"
              allowClear
              placeholder={uiAppsLoading ? '加载应用中...' : '选择应用'}
              style={{ width: '100%', marginTop: 6 }}
              options={uiAppOptions}
              value={selectedAppKeys}
              onChange={(values) => updateApps(flowKey, values)}
              disabled={isLocked}
            />
            {flow.apps.length > 0 ? (
              <Space size={[6, 6]} wrap style={{ marginTop: 8 }}>
                {flow.apps.map((app) => {
                  const key = toAppKey(app.pluginId, app.appId);
                  return (
                    <Tag key={key}>{app.name ? `${app.name} (${app.pluginId}/${app.appId})` : key}</Tag>
                  );
                })}
              </Space>
            ) : null}
          </div>

          <div>
            <Text strong>Prompts</Text>
            <Select
              mode="multiple"
              allowClear
              placeholder="选择 Prompt"
              style={{ width: '100%', marginTop: 6 }}
              options={promptOptions}
              value={selectedPromptKeys}
              onChange={(values) => updatePrompts(flowKey, values)}
              disabled={isLocked}
            />
            {flow.prompts.length > 0 ? (
              <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                {flow.prompts.map((item) => {
                  const entry = promptIndex.get(item.key);
                  const title = entry?.title || item.key;
                  const allowZh = Boolean(entry?.zh);
                  const allowEn = Boolean(entry?.en);
                  return (
                    <Space key={item.key} size={8} wrap>
                      <Tag color="geekblue">{title}</Tag>
                      <Text type="secondary">{item.key}</Text>
                      <Select
                        size="small"
                        value={item.lang === 'en' ? 'en' : 'zh'}
                        onChange={(value) => updatePromptLang(flowKey, item.key, value)}
                        options={[
                          { label: '中文', value: 'zh', disabled: !allowZh && allowEn },
                          { label: 'English', value: 'en', disabled: !allowEn && allowZh },
                        ]}
                        style={{ width: 110 }}
                        disabled={isLocked}
                      />
                      {!allowZh && allowEn ? <Tag color="orange">仅英文</Tag> : null}
                      {allowZh && !allowEn ? <Tag color="default">仅中文</Tag> : null}
                    </Space>
                  );
                })}
              </div>
            ) : null}
          </div>
        </Space>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <div style={{ width: 320, borderRight: '1px solid var(--ds-panel-border)', padding: 16 }}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Title level={4} style={{ margin: 0 }}>
            land_configs
          </Title>
          <Paragraph type="secondary" style={{ margin: 0 }}>
            主/子流程 MCP 与 Prompt 组合配置
          </Paragraph>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新建配置
          </Button>
        </Space>

        <div style={{ marginTop: 16 }}>
          {loading ? (
            <Text type="secondary">加载中...</Text>
          ) : (
            <List
              dataSource={configs}
              locale={{ emptyText: '暂无配置' }}
              renderItem={(config) => (
                <List.Item
                  key={config.id}
                  onClick={() => setSelectedId(config.id)}
                  style={{
                    cursor: 'pointer',
                    background: selectedId === config.id ? 'rgba(24, 144, 255, 0.08)' : 'transparent',
                    borderRadius: 6,
                    padding: 12,
                  }}
                  actions={[
                    <Button
                      key="delete"
                      type="link"
                      size="small"
                      danger
                      disabled={config?.locked}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (config?.locked) return;
                        Modal.confirm({
                          title: '确认删除',
                          content: '确定要删除这个配置吗？此操作不可恢复。',
                          onOk: async () => handleDelete(config.id),
                        });
                      }}
                    >
                      删除
                    </Button>,
                  ]}
                >
                  <Space direction="vertical" size={4}>
                    <Space size={6}>
                      <span>{config.name}</span>
                      {config?.id === selectedId ? <Tag color="blue">当前</Tag> : null}
                      {config?.locked ? <Tag color="gold">内置</Tag> : null}
                    </Space>
                    <span style={{ color: '#888', fontSize: 12 }}>{config.description || '暂无描述'}</span>
                  </Space>
                </List.Item>
              )}
            />
          )}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, padding: 16, overflow: 'auto' }}>
        {!draft ? (
          <Empty style={{ marginTop: 120 }} description="选择一个配置进行编辑" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div>
              <Title level={5} style={{ marginBottom: 8 }}>
                基本信息
              </Title>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <div>
                  <Text strong>名称</Text>
                  <Input
                    value={draft.name || ''}
                    onChange={(event) => updateDraft({ name: event.target.value })}
                    placeholder="配置名称"
                    style={{ marginTop: 6 }}
                    disabled={isLocked}
                  />
                </div>
                <div>
                  <Text strong>描述</Text>
                  <Input.TextArea
                    value={draft.description || ''}
                    onChange={(event) => updateDraft({ description: event.target.value })}
                    placeholder="可选描述"
                    rows={3}
                    style={{ marginTop: 6 }}
                    disabled={isLocked}
                  />
                </div>
              </Space>
            </div>

            <Divider />

            {renderFlowSection('main', '主流程配置')}

            <Divider />

            {renderFlowSection('sub', '子流程配置')}

            <div>
              <Button type="primary" onClick={handleSave} loading={saving} disabled={isLocked}>
                {isLocked ? '内置配置不可编辑' : '保存配置'}
              </Button>
            </div>
          </Space>
        )}
      </div>

      <Modal
        title="新建 land_configs"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="配置名称" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="可选描述" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
