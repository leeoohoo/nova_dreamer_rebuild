import React, { useMemo } from 'react';
import { Button, Card, Empty, List, Modal, Space, Tag, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';

import { AgentEditorModal } from './components/AgentEditorModal.jsx';
import { useChatAgents } from './hooks/useChatAgents.js';
import { useUiAppsRegistry } from '../apps/hooks/useUiAppsRegistry.js';

const { Text } = Typography;

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function countList(value) {
  return Array.isArray(value) ? value.filter(Boolean).length : 0;
}

export function ChatAgentsView({ admin }) {
  const models = useMemo(() => (Array.isArray(admin?.models) ? admin.models : []), [admin]);
  const mcpServers = useMemo(() => (Array.isArray(admin?.mcpServers) ? admin.mcpServers : []), [admin]);
  const prompts = useMemo(() => (Array.isArray(admin?.prompts) ? admin.prompts : []), [admin]);
  const { data: uiAppsData, refresh: refreshUiApps } = useUiAppsRegistry();
  const uiApps = useMemo(() => (Array.isArray(uiAppsData?.apps) ? uiAppsData.apps : []), [uiAppsData]);

  const modelById = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);
  const controller = useChatAgents({ models });
  const {
    agents,
    refreshAgents,
    agentModalOpen,
    agentModalInitial,
    openNewAgentModal,
    openEditAgentModal,
    closeAgentModal,
    saveAgent,
    deleteAgent,
  } = controller;

  const onDelete = (agent) => {
    const id = normalizeId(agent?.id);
    if (!id) return;
    Modal.confirm({
      title: `删除 Agent「${agent?.name || id}」？`,
      content: '如果该 Agent 仍被会话使用，会删除失败。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => deleteAgent(id),
    });
  };

  return (
    <>
      <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div
          style={{
            background: 'var(--ds-panel-bg)',
            border: '1px solid var(--ds-panel-border)',
            borderRadius: 14,
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 650, fontSize: 16, lineHeight: '22px' }}>Agent 管理</div>
            <Text type="secondary">集中管理 Chat Agents（模型 + 应用能力：MCP/Prompt）。</Text>
          </div>
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                refreshAgents?.();
                refreshUiApps?.();
              }}
            >
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openNewAgentModal?.()}>
              新增 Agent
            </Button>
          </Space>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 6 }}>
          {Array.isArray(agents) && agents.length > 0 ? (
            <List
              dataSource={agents}
              renderItem={(agent) => {
                const modelName = normalizeId(agent?.modelId) ? modelById.get(agent.modelId)?.name || agent.modelId : '';
                const appCount = countList(agent?.uiApps);
                return (
                  <List.Item>
                    <Card
                      size="small"
                      style={{ borderRadius: 14 }}
                      styles={{ body: { padding: 14 } }}
                      title={
                        <Space size={8} wrap>
                          <span style={{ fontWeight: 650 }}>{agent?.name || '未命名 Agent'}</span>
                          {modelName ? <Tag color="blue">{modelName}</Tag> : null}
                        </Space>
                      }
                      extra={
                        <Space>
                          <Button size="small" icon={<EditOutlined />} onClick={() => openEditAgentModal(agent)}>
                            编辑
                          </Button>
                          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDelete(agent)}>
                            删除
                          </Button>
                        </Space>
                      }
                    >
                      {agent?.description ? (
                        <div style={{ marginBottom: 10, whiteSpace: 'pre-wrap' }}>{agent.description}</div>
                      ) : null}
                      <Space size={[6, 6]} wrap>
                        <Tag>Apps: {appCount}</Tag>
                      </Space>
                    </Card>
                  </List.Item>
                );
              }}
            />
          ) : (
            <Empty description="暂无 Agent" />
          )}
        </div>
      </div>

      <AgentEditorModal
        open={agentModalOpen}
        initialValues={agentModalInitial}
        models={models}
        mcpServers={mcpServers}
        prompts={prompts}
        uiApps={uiApps}
        onCancel={closeAgentModal}
        onSave={async (values) => saveAgent(values)}
      />
    </>
  );
}
