import React, { useMemo, useState } from 'react';
import { Button, Card, Empty, List, Modal, Space, Tag, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';

import { AgentEditorModal } from './components/AgentEditorModal.jsx';
import { useChatAgents } from './hooks/useChatAgents.js';
import { useUiAppsRegistry } from '../apps/hooks/useUiAppsRegistry.js';

const { Text } = Typography;

const TAG_COLORS = ['geekblue', 'purple', 'cyan', 'gold', 'green'];

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function countList(value) {
  return Array.isArray(value) ? value.filter(Boolean).length : 0;
}

function AgentCard({ agent, modelName, onEdit, onDelete, index = 0 }) {
  const [hovered, setHovered] = useState(false);
  const appCount = countList(agent?.uiApps);
  const mcpCount = countList(agent?.mcpServerIds);
  const promptCount = countList(agent?.promptIds);
  const workspaceRoot =
    typeof agent?.workspaceRoot === 'string' && agent.workspaceRoot.trim() ? agent.workspaceRoot.trim() : '';
  const tagColor = TAG_COLORS[index % TAG_COLORS.length];

  return (
    <Card
      hoverable
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onEdit?.(agent)}
      style={{
        borderRadius: 18,
        border: '1px solid var(--ds-panel-border)',
        background:
          'linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(56, 189, 248, 0.08), rgba(16, 185, 129, 0.05))',
        boxShadow: hovered
          ? '0 18px 36px rgba(15, 23, 42, 0.16)'
          : '0 10px 26px rgba(15, 23, 42, 0.12)',
        transform: hovered ? 'translateY(-3px)' : 'translateY(0)',
        transition: 'all 0.2s ease',
        overflow: 'hidden',
        height: '100%',
      }}
      styles={{ body: { padding: 16, display: 'flex', flexDirection: 'column', gap: 12 } }}
    >
      <div
        style={{
          height: 4,
          borderRadius: 999,
          background:
            'linear-gradient(90deg, rgba(99, 102, 241, 0.9), rgba(56, 189, 248, 0.9), rgba(16, 185, 129, 0.9))',
        }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Space size={8} wrap>
          <span style={{ fontWeight: 650, fontSize: 16 }}>
            {agent?.name || '未命名 Agent'}
          </span>
          {modelName ? <Tag color={tagColor}>{modelName}</Tag> : null}
        </Space>
        <Text
          type="secondary"
          style={{
            minHeight: 42,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {agent?.description ? agent.description : '为该 Agent 添加描述，帮助团队理解其职责与能力。'}
        </Text>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <Tag color="purple">Apps {appCount}</Tag>
        <Tag color="cyan">MCP {mcpCount}</Tag>
        <Tag color="gold">Prompts {promptCount}</Tag>
      </div>

      {workspaceRoot ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          工作目录：{workspaceRoot}
        </Text>
      ) : (
        <Text type="secondary" style={{ fontSize: 12 }}>
          工作目录：继承会话设置
        </Text>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 'auto' }}>
        <Button
          size="small"
          icon={<EditOutlined />}
          onClick={(event) => {
            event.stopPropagation();
            onEdit?.(agent);
          }}
        >
          编辑
        </Button>
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={(event) => {
            event.stopPropagation();
            onDelete?.(agent);
          }}
        >
          删除
        </Button>
      </div>
    </Card>
  );
}

export function ChatAgentsView({ admin }) {
  const models = useMemo(() => (Array.isArray(admin?.models) ? admin.models : []), [admin]);
  const mcpServers = useMemo(() => (Array.isArray(admin?.mcpServers) ? admin.mcpServers : []), [admin]);
  const prompts = useMemo(() => (Array.isArray(admin?.prompts) ? admin.prompts : []), [admin]);
  const { data: uiAppsData } = useUiAppsRegistry();
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
      <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          style={{
            background:
              'linear-gradient(135deg, rgba(99, 102, 241, 0.16), rgba(56, 189, 248, 0.16), rgba(16, 185, 129, 0.12))',
            border: '1px solid rgba(99, 102, 241, 0.2)',
            borderRadius: 18,
            padding: '16px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
            boxShadow: '0 12px 30px rgba(15, 23, 42, 0.12)',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 18, lineHeight: '24px' }}>Agent 管理</div>
            <Text type="secondary">集中管理 Chat Agents，快速配置模型与应用能力（MCP/Prompt）。</Text>
          </div>
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => refreshAgents?.()} style={{ borderRadius: 10 }}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => openNewAgentModal?.()}
              style={{ borderRadius: 10 }}
            >
              新增 Agent
            </Button>
          </Space>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            paddingRight: 6,
            paddingBottom: 6,
          }}
        >
          {Array.isArray(agents) && agents.length > 0 ? (
            <List
              grid={{ gutter: [16, 16], xs: 1, sm: 2, md: 2, lg: 3, xl: 3, xxl: 4 }}
              dataSource={agents}
              renderItem={(agent, index) => {
                const modelName = normalizeId(agent?.modelId) ? modelById.get(agent.modelId)?.name || agent.modelId : '';
                return (
                  <List.Item style={{ height: '100%' }}>
                    <AgentCard
                      agent={agent}
                      modelName={modelName}
                      index={index}
                      onEdit={openEditAgentModal}
                      onDelete={onDelete}
                    />
                  </List.Item>
                );
              }}
            />
          ) : (
            <Empty description="暂无 Agent" style={{ marginTop: 40 }} />
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
