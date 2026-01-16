import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Empty, Input, List, Modal, Select, Space, Spin, Tag, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

import { api, hasApi } from '../../lib/api.js';
import { ConfigForm } from './ConfigForm.jsx';
import { ConfigDetail } from './ConfigDetail.jsx';

const { Title, Paragraph } = Typography;
const MIGRATION_CONFIG_NAME = '默认配置（迁移）';

export function ConfigManagerPage({ admin }) {
  const [configs, setConfigs] = useState([]);
  const [activeConfigId, setActiveConfigId] = useState(null);
  const [selectedConfigId, setSelectedConfigId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState('json');
  const [exportContent, setExportContent] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importContent, setImportContent] = useState('');
  const [importLoading, setImportLoading] = useState(false);

  const selectedConfig = useMemo(
    () => configs.find((config) => config.id === selectedConfigId) || null,
    [configs, selectedConfigId]
  );

  const loadConfigs = async () => {
    if (!hasApi) return;
    setLoading(true);
    try {
      const [listRes, activeRes] = await Promise.all([api.invoke('configs:list'), api.invoke('configs:getActive')]);
      if (!listRes?.ok) {
        message.error(listRes?.message || '加载配置失败');
        return;
      }
      const filtered = Array.isArray(listRes.data)
        ? listRes.data.filter((config) => config?.name !== MIGRATION_CONFIG_NAME)
        : [];
      setConfigs(filtered);
      if (filtered.length === 0) {
        setSelectedConfigId(null);
      } else if (selectedConfigId && !filtered.some((config) => config.id === selectedConfigId)) {
        setSelectedConfigId(filtered[0].id);
      }
      const activeId = activeRes?.data?.id || null;
      setActiveConfigId(filtered.some((config) => config.id === activeId) ? activeId : null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfigs();
  }, []);

  const handleCreate = async (values) => {
    if (!hasApi) return;
    const res = await api.invoke('configs:create', values);
    if (!res?.ok) {
      message.error(res?.message || '创建失败');
      return;
    }
    setCreateOpen(false);
    await loadConfigs();
    setSelectedConfigId(res.data?.id || null);
  };

  const handleActivate = async (id) => {
    if (!hasApi) return;
    const res = await api.invoke('configs:quickSwitch', { configId: id });
    if (!res?.ok) {
      message.error(res?.error || res?.message || '激活失败');
      return;
    }
    message.success('配置已激活');
    await loadConfigs();
  };

  const handleDelete = (id) => {
    if (id === activeConfigId) {
      message.error('不能删除当前激活的配置');
      return;
    }
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个配置吗？此操作不可恢复。',
      onOk: async () => {
        const res = await api.invoke('configs:delete', { id });
        if (!res?.ok) {
          message.error(res?.message || '删除失败');
          return;
        }
        if (selectedConfigId === id) {
          setSelectedConfigId(null);
        }
        await loadConfigs();
      },
    });
  };

  const loadExportContent = async (format = exportFormat) => {
    if (!hasApi || !selectedConfigId) return;
    setExportLoading(true);
    try {
      const res = await api.invoke('configs:export', { id: selectedConfigId, format });
      if (!res?.ok) {
        message.error(res?.message || '导出失败');
        return;
      }
      const data = res.data;
      setExportContent(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    } finally {
      setExportLoading(false);
    }
  };

  const openExport = async () => {
    if (!selectedConfigId) {
      message.warning('请选择需要导出的配置');
      return;
    }
    setExportOpen(true);
    setExportFormat('json');
    setExportContent('');
    await loadExportContent('json');
  };

  const handleCopyExport = async () => {
    if (!exportContent) return;
    try {
      await navigator.clipboard.writeText(exportContent);
      message.success('已复制导出内容');
    } catch {
      message.error('复制失败');
    }
  };

  const handleImport = async () => {
    if (!hasApi) return;
    const payload = importContent.trim();
    if (!payload) {
      message.warning('请粘贴配置内容');
      return;
    }
    setImportLoading(true);
    try {
      const res = await api.invoke('configs:import', { configData: payload });
      if (!res?.ok) {
        message.error(res?.message || '导入失败');
        return;
      }
      message.success('导入成功');
      setImportOpen(false);
      setImportContent('');
      await loadConfigs();
      setSelectedConfigId(res?.data?.id || null);
    } finally {
      setImportLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <div style={{ width: 320, borderRight: '1px solid var(--ds-panel-border)', padding: 16 }}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Title level={4} style={{ margin: 0 }}>
            配置管理
          </Title>
          <Paragraph type="secondary" style={{ margin: 0 }}>
            多配置切换与组件管理
          </Paragraph>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新建配置
          </Button>
          <Space size={8}>
            <Button onClick={() => setImportOpen(true)}>导入配置</Button>
            <Button onClick={openExport} disabled={!selectedConfigId}>
              导出配置
            </Button>
          </Space>
        </Space>

        <div style={{ marginTop: 16 }}>
          {loading ? (
            <Spin />
          ) : (
            <List
              dataSource={configs}
              locale={{ emptyText: '暂无配置' }}
              renderItem={(config) => (
                <List.Item
                  key={config.id}
                  onClick={() => setSelectedConfigId(config.id)}
                  style={{
                    cursor: 'pointer',
                    background: selectedConfigId === config.id ? 'rgba(24, 144, 255, 0.08)' : 'transparent',
                    borderRadius: 6,
                    padding: 12,
                  }}
                  actions={[
                    <Button
                      key="activate"
                      type="link"
                      size="small"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleActivate(config.id);
                      }}
                      disabled={config.id === activeConfigId}
                    >
                      {config.id === activeConfigId ? '已激活' : '激活'}
                    </Button>,
                    <Button
                      key="delete"
                      type="link"
                      size="small"
                      danger
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDelete(config.id);
                      }}
                    >
                      删除
                    </Button>,
                  ]}
                >
                  <Space direction="vertical" size={4}>
                    <Space size={6}>
                      <span>{config.name}</span>
                      {config.id === activeConfigId ? <Badge status="success" /> : null}
                      {config.id === activeConfigId ? <Tag color="green">当前</Tag> : null}
                    </Space>
                    <span style={{ color: '#888', fontSize: 12 }}>{config.description || '暂无描述'}</span>
                  </Space>
                </List.Item>
              )}
            />
          )}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {selectedConfigId ? (
          <ConfigDetail
            configId={selectedConfigId}
            availableModels={admin?.models || []}
            availableMcpServers={admin?.mcpServers || []}
            availablePrompts={admin?.prompts || []}
            availableSubagents={admin?.subagents || []}
            onConfigUpdated={loadConfigs}
          />
        ) : (
          <Empty style={{ marginTop: 120 }} description="选择一个配置进行编辑" />
        )}
      </div>

      <Modal
        title="新建配置"
        open={createOpen}
        footer={null}
        onCancel={() => setCreateOpen(false)}
        destroyOnClose
      >
        <ConfigForm onSubmit={handleCreate} onCancel={() => setCreateOpen(false)} />
      </Modal>

      <Modal
        title={`导出配置${selectedConfig ? `：${selectedConfig.name}` : ''}`}
        open={exportOpen}
        onCancel={() => setExportOpen(false)}
        footer={[
          <Button key="copy" onClick={handleCopyExport} disabled={!exportContent}>
            复制
          </Button>,
          <Button key="close" type="primary" onClick={() => setExportOpen(false)}>
            关闭
          </Button>,
        ]}
        width={720}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space size={8}>
            <span>格式</span>
            <Select
              value={exportFormat}
              options={[
                { label: 'JSON', value: 'json' },
                { label: 'YAML', value: 'yaml' },
              ]}
              onChange={(value) => {
                setExportFormat(value);
                void loadExportContent(value);
              }}
              style={{ width: 120 }}
            />
            {exportLoading ? <Spin size="small" /> : null}
          </Space>
          <Input.TextArea rows={14} value={exportContent} readOnly />
        </Space>
      </Modal>

      <Modal
        title="导入配置"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setImportOpen(false)}>
            取消
          </Button>,
          <Button key="submit" type="primary" loading={importLoading} onClick={handleImport}>
            导入
          </Button>,
        ]}
        width={720}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            支持 JSON 或 YAML 格式。
          </Paragraph>
          <Input.TextArea
            rows={14}
            value={importContent}
            placeholder="粘贴配置内容"
            onChange={(event) => setImportContent(event.target.value)}
          />
        </Space>
      </Modal>
    </div>
  );
}
