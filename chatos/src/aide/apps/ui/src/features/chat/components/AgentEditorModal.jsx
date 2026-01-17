import React, { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Form, Input, Modal, Select, Segmented, Space, Typography, message } from 'antd';
import { FolderOpenOutlined } from '@ant-design/icons';

import { api, hasApi } from '../../../lib/api.js';

const { Text } = Typography;

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMcpServerName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getMcpPromptNames(serverName) {
  const base = `mcp_${normalizeMcpServerName(serverName)}`;
  return { zh: base, en: `${base}__en` };
}

function toUiAppKey(pluginId, appId) {
  const pid = typeof pluginId === 'string' ? pluginId.trim() : '';
  const aid = typeof appId === 'string' ? appId.trim() : '';
  if (!pid || !aid) return '';
  return `${pid}::${aid}`;
}

function parseUiAppKey(key) {
  const raw = typeof key === 'string' ? key : '';
  const idx = raw.indexOf('::');
  if (idx <= 0) return null;
  const pluginId = raw.slice(0, idx).trim();
  const appId = raw.slice(idx + 2).trim();
  if (!pluginId || !appId) return null;
  return { pluginId, appId };
}

export function AgentEditorModal({ open, initialValues, models, mcpServers, prompts, uiApps, onCancel, onSave }) {
  const [form] = Form.useForm();
  const [mcpPromptLang, setMcpPromptLang] = useState('zh');
  const markdownEditorStyle = useMemo(
    () => ({
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 13,
      lineHeight: '20px',
    }),
    []
  );

  const modelOptions = useMemo(
    () =>
      (Array.isArray(models) ? models : []).map((m) => ({
        value: m.id,
        label: `${m.name}${m.provider ? ` (${m.provider}/${m.model})` : ''}`,
      })),
    [models]
  );
  const mcpOptions = useMemo(
    () =>
      (Array.isArray(mcpServers) ? mcpServers : [])
        .filter((srv) => normalizeId(srv?.id) && normalizeId(srv?.name))
        .map((srv) => ({
          value: srv.id,
          label: srv.name,
          disabled: srv.enabled === false,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [mcpServers]
  );
  const promptOptions = useMemo(
    () =>
      (Array.isArray(prompts) ? prompts : [])
        .filter((p) => normalizeId(p?.id) && normalizeId(p?.name))
        .map((p) => ({
          value: p.id,
          label: `${p.name}${p.title ? ` · ${p.title}` : ''}${p.type ? ` (${p.type})` : ''}`,
          disabled: p.allowMain === false,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [prompts]
  );

  const uniqueIds = (list) => {
    const out = [];
    const seen = new Set();
    (Array.isArray(list) ? list : []).forEach((item) => {
      const v = normalizeId(item);
      if (!v || seen.has(v)) return;
      seen.add(v);
      out.push(v);
    });
    return out;
  };

  const mcpServerById = useMemo(() => {
    const map = new Map();
    (Array.isArray(mcpServers) ? mcpServers : []).forEach((srv) => {
      const key = normalizeId(srv?.id);
      if (!key) return;
      map.set(key, srv);
    });
    return map;
  }, [mcpServers]);

  const promptByName = useMemo(() => {
    const map = new Map();
    (Array.isArray(prompts) ? prompts : []).forEach((p) => {
      const key = normalizeId(p?.name).toLowerCase();
      if (!key || !normalizeId(p?.id)) return;
      map.set(key, p);
    });
    return map;
  }, [prompts]);

  const mcpPromptNameById = useMemo(() => {
    const map = new Map();
    (Array.isArray(prompts) ? prompts : []).forEach((p) => {
      const id = normalizeId(p?.id);
      const name = typeof p?.name === 'string' ? p.name.trim().toLowerCase() : '';
      if (!id || !name) return;
      map.set(id, name);
    });
    return map;
  }, [prompts]);

  const uiAppMetaByKey = useMemo(() => {
    const map = new Map();
    (Array.isArray(uiApps) ? uiApps : []).forEach((app) => {
      const pluginId = normalizeId(app?.plugin?.id);
      const appId = normalizeId(app?.id);
      if (!pluginId || !appId) return;
      const key = toUiAppKey(pluginId, appId);
      const pluginLabel = app?.plugin?.name || pluginId;
      const appLabel = app?.name || appId || '未命名应用';
      const mcpName = app?.ai?.mcp?.name || `${pluginId}.${appId}`;
      const hasMcp = Boolean(app?.ai?.mcp?.url);
      const hasPrompt = Boolean(app?.ai?.mcpPrompt?.names);
      const label = `${appLabel} · ${pluginLabel}${mcpName ? `（${mcpName}）` : ''}`;
      map.set(key, { pluginId, appId, label, hasMcp, hasPrompt, mcpName, promptNames: app?.ai?.mcpPrompt?.names || null });
    });
    return map;
  }, [uiApps]);

  const uiAppOptions = useMemo(() => {
    const opts = [];
    for (const [key, meta] of uiAppMetaByKey.entries()) {
      if (!meta?.hasMcp && !meta?.hasPrompt) continue;
      const suffix = `${meta.hasMcp ? 'MCP' : ''}${meta.hasMcp && meta.hasPrompt ? '+' : ''}${meta.hasPrompt ? 'Prompt' : ''}`;
      opts.push({ value: key, label: `${meta.label}${suffix ? ` · ${suffix}` : ''}` });
    }
    return opts.sort((a, b) => a.label.localeCompare(b.label));
  }, [uiAppMetaByKey]);

  const normalizeUiAppRef = (ref) => {
    const pluginId = normalizeId(ref?.pluginId);
    const appId = normalizeId(ref?.appId);
    if (!pluginId || !appId) return null;
    const key = toUiAppKey(pluginId, appId);
    const meta = uiAppMetaByKey.get(key) || null;
    const mcpDefault = meta ? Boolean(meta.hasMcp) : true;
    const promptDefault = meta ? Boolean(meta.hasPrompt) : true;
    return {
      pluginId,
      appId,
      mcp: typeof ref?.mcp === 'boolean' ? ref.mcp : mcpDefault,
      prompt: typeof ref?.prompt === 'boolean' ? ref.prompt : promptDefault,
    };
  };

  const refsToKeys = (value) =>
    (Array.isArray(value) ? value : [])
      .map((ref) => toUiAppKey(ref?.pluginId, ref?.appId))
      .filter(Boolean);

  const keysToRefs = (keys, prev) => {
    const nextKeys = (Array.isArray(keys) ? keys : []).map((k) => String(k || '')).filter(Boolean);
    const prevList = Array.isArray(prev) ? prev : [];
    const prevByKey = new Map(
      prevList
        .map((ref) => normalizeUiAppRef(ref))
        .filter(Boolean)
        .map((ref) => [toUiAppKey(ref.pluginId, ref.appId), ref])
    );
    const next = [];
    nextKeys.forEach((key) => {
      const parsed = parseUiAppKey(key);
      if (!parsed) return;
      const existing = prevByKey.get(key) || null;
      const base = existing || parsed;
      const normalized = normalizeUiAppRef(base);
      if (!normalized) return;
      next.push(normalized);
    });
    return next;
  };

  useEffect(() => {
    if (!open) return;
    const rawUiApps = Array.isArray(initialValues?.uiApps) ? initialValues.uiApps : [];
    const normalizedUiApps = rawUiApps.map((ref) => normalizeUiAppRef(ref)).filter(Boolean);
    const initialMcpIds = Array.isArray(initialValues?.mcpServerIds) ? initialValues.mcpServerIds : [];
    const initialPromptIds = Array.isArray(initialValues?.promptIds) ? initialValues.promptIds : [];
    const inferredLang = (() => {
      const wantEn = initialMcpIds.some((id) => {
        const server = mcpServerById.get(normalizeId(id));
        if (!server?.name) return false;
        const names = getMcpPromptNames(server.name);
        const enPrompt = promptByName.get(String(names.en).toLowerCase());
        return enPrompt?.id && initialPromptIds.includes(enPrompt.id);
      });
      return wantEn ? 'en' : 'zh';
    })();
    setMcpPromptLang(inferredLang);
    form.setFieldsValue({
      name: initialValues?.name || '',
      description: initialValues?.description || '',
      prompt: initialValues?.prompt || '',
      modelId: initialValues?.modelId || '',
      workspaceRoot: initialValues?.workspaceRoot || '',
      mcpServerIds: Array.isArray(initialValues?.mcpServerIds) ? initialValues.mcpServerIds : [],
      promptIds: Array.isArray(initialValues?.promptIds) ? initialValues.promptIds : [],
      uiApps: normalizedUiApps,
    });
  }, [open, initialValues, form, mcpServerById, promptByName]);

  const selectedUiApps = Form.useWatch('uiApps', form);
  const selectedUiAppsSafe = Array.isArray(selectedUiApps) ? selectedUiApps.map((ref) => normalizeUiAppRef(ref)).filter(Boolean) : [];

  const selectedMcpServerIds = Form.useWatch('mcpServerIds', form);
  useEffect(() => {
    if (!open) return;
    const selectedIds = Array.isArray(selectedMcpServerIds) ? selectedMcpServerIds : [];
    const existingPromptIds = Array.isArray(form.getFieldValue('promptIds')) ? form.getFieldValue('promptIds') : [];
    const mcpPromptIds = [];
    const mcpPromptNamesAll = new Set();
    (Array.isArray(mcpServers) ? mcpServers : []).forEach((srv) => {
      if (!srv?.name) return;
      const names = getMcpPromptNames(srv.name);
      mcpPromptNamesAll.add(String(names.zh).toLowerCase());
      mcpPromptNamesAll.add(String(names.en).toLowerCase());
    });

    selectedIds.forEach((id) => {
      const server = mcpServerById.get(normalizeId(id));
      if (!server?.name) return;
      const names = getMcpPromptNames(server.name);
      const targetName = mcpPromptLang === 'en' ? names.en : names.zh;
      const fallbackName = mcpPromptLang === 'en' ? names.zh : names.en;
      const targetPrompt = promptByName.get(String(targetName).toLowerCase());
      const fallbackPrompt = promptByName.get(String(fallbackName).toLowerCase());
      const picked = targetPrompt || fallbackPrompt;
      if (picked?.id) {
        mcpPromptIds.push(picked.id);
      }
    });

    const filtered = existingPromptIds.filter((id) => {
      const name = mcpPromptNameById.get(normalizeId(id));
      return !name || !mcpPromptNamesAll.has(name);
    });
    const merged = uniqueIds([...filtered, ...mcpPromptIds]);
    form.setFieldsValue({ promptIds: merged });
  }, [open, selectedMcpServerIds, mcpPromptLang, mcpServerById, promptByName, mcpPromptNameById, mcpServers, form]);

  const pickWorkspaceRoot = async () => {
    if (!hasApi) {
      message.error('IPC bridge not available');
      return;
    }
    const current = typeof form.getFieldValue('workspaceRoot') === 'string' ? form.getFieldValue('workspaceRoot').trim() : '';
    try {
      const result = await api.invoke('dialog:selectDirectory', { defaultPath: current || undefined });
      if (result?.ok && typeof result?.path === 'string' && result.path.trim()) {
        form.setFieldsValue({ workspaceRoot: result.path.trim() });
      }
    } catch (err) {
      message.error(err?.message || '选择目录失败');
    }
  };

  return (
    <Modal
      open={open}
      title={normalizeId(initialValues?.id) ? '编辑 Agent' : '新增 Agent'}
      okText="保存"
      cancelText="取消"
      onCancel={() => onCancel?.()}
      onOk={async () => {
        const values = await form.validateFields();
        onSave?.({ ...(initialValues || {}), ...values });
      }}
      width={720}
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={initialValues || {}}>
        <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
          <Input placeholder="例如：前端助手 / 需求分析师" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea
            placeholder="可选（支持 Markdown）"
            autoSize={{ minRows: 3, maxRows: 10 }}
            style={markdownEditorStyle}
          />
        </Form.Item>
        <Form.Item name="prompt" label="Prompt" extra="作为系统提示，在与该 Agent 对话时自动注入（支持 Markdown）。">
          <Input.TextArea placeholder="可选" autoSize={{ minRows: 6, maxRows: 16 }} style={markdownEditorStyle} />
        </Form.Item>
        <Form.Item name="modelId" label="模型" rules={[{ required: true, message: '请选择模型' }]}>
          <Select options={modelOptions} showSearch optionFilterProp="label" placeholder="选择模型" />
        </Form.Item>
        <Form.Item name="mcpServerIds" label="启用的 MCP">
          <Select
            mode="multiple"
            options={mcpOptions}
            showSearch
            optionFilterProp="label"
            placeholder="选择要启用的 MCP（可多选）"
          />
        </Form.Item>
        <Form.Item label="MCP Prompt 语言">
          <Segmented
            value={mcpPromptLang}
            options={[
              { label: '中文', value: 'zh' },
              { label: 'English', value: 'en' },
            ]}
            onChange={(value) => setMcpPromptLang(value === 'en' ? 'en' : 'zh')}
          />
        </Form.Item>
        <Form.Item name="promptIds" label="启用的 Prompt">
          <Select
            mode="multiple"
            options={promptOptions}
            showSearch
            optionFilterProp="label"
            placeholder="选择要启用的 Prompt（可多选）"
          />
        </Form.Item>
        <Form.Item
          label="工作目录"
          extra="可选：留空则使用当前对话设置的目录；如果 Agent 自身设置了目录，将优先生效。"
        >
          <Space size={8} align="start" style={{ width: '100%' }}>
            <Form.Item name="workspaceRoot" noStyle>
              <Input placeholder="输入工作目录路径（绝对路径）" allowClear />
            </Form.Item>
            <Button icon={<FolderOpenOutlined />} onClick={pickWorkspaceRoot}>
              选择目录
            </Button>
          </Space>
        </Form.Item>
        <Form.Item
          name="uiApps"
          label="应用（可选暴露 MCP / Prompt）"
          getValueProps={(value) => ({ value: refsToKeys(value) })}
          getValueFromEvent={(nextKeys) => keysToRefs(nextKeys, form.getFieldValue('uiApps'))}
        >
          <Select
            mode="multiple"
            options={uiAppOptions}
            showSearch
            optionFilterProp="label"
            placeholder="选择一个或多个应用"
          />
        </Form.Item>

        {selectedUiAppsSafe.length > 0 ? (
          <div style={{ display: 'grid', gap: 8, marginBottom: 8 }}>
            {selectedUiAppsSafe.map((ref) => {
              const key = toUiAppKey(ref.pluginId, ref.appId);
              const meta = uiAppMetaByKey.get(key) || null;
              const label = meta?.label || `${ref.pluginId}:${ref.appId}`;
              const hasMcp = Boolean(meta?.hasMcp);
              const hasPrompt = Boolean(meta?.hasPrompt);
              return (
                <div
                  key={key}
                  style={{
                    border: '1px solid var(--ds-panel-border)',
                    background: 'var(--ds-panel-bg)',
                    borderRadius: 12,
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {ref.pluginId}:{ref.appId}
                    </Text>
                  </div>
                  <Space size={10}>
                    <Checkbox
                      checked={ref.mcp !== false}
                      disabled={!hasMcp}
                      onChange={(e) => {
                        const list = Array.isArray(form.getFieldValue('uiApps')) ? form.getFieldValue('uiApps') : [];
                        const next = list.map((item) => {
                          const k = toUiAppKey(item?.pluginId, item?.appId);
                          if (k !== key) return item;
                          return { ...item, mcp: e.target.checked };
                        });
                        form.setFieldsValue({ uiApps: next });
                      }}
                    >
                      MCP
                    </Checkbox>
                    <Checkbox
                      checked={ref.prompt !== false}
                      disabled={!hasPrompt}
                      onChange={(e) => {
                        const list = Array.isArray(form.getFieldValue('uiApps')) ? form.getFieldValue('uiApps') : [];
                        const next = list.map((item) => {
                          const k = toUiAppKey(item?.pluginId, item?.appId);
                          if (k !== key) return item;
                          return { ...item, prompt: e.target.checked };
                        });
                        form.setFieldsValue({ uiApps: next });
                      }}
                    >
                      Prompt
                    </Checkbox>
                  </Space>
                </div>
              );
            })}
          </div>
        ) : null}

        <Space direction="vertical" size={6}>
          <Text type="secondary">提示：选择 MCP 后会自动补全对应的 MCP Prompt。</Text>
        </Space>
      </Form>
    </Modal>
  );
}
