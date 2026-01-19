import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Empty, Layout, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import { EditOutlined, MenuUnfoldOutlined, PlusOutlined } from '@ant-design/icons';

import { hasApi } from '../../lib/api.js';
import { ChatSidebar } from '../../../../../src/common/aide-ui/features/chat/components/ChatSidebar.jsx';
import { ChatSessionHeader } from '../../../../../src/common/aide-ui/features/chat/components/ChatSessionHeader.jsx';
import { ChatMessages } from '../../../../../src/common/aide-ui/features/chat/components/ChatMessages.jsx';
import { ChatComposer } from '../../../../../src/common/aide-ui/features/chat/components/ChatComposer.jsx';
import { useChatAgents } from './hooks/useChatAgents.js';
import { useChatRooms } from './hooks/useChatRooms.js';
import { RoomEditorModal } from './components/RoomEditorModal.jsx';

const { Sider, Content } = Layout;
const { Text } = Typography;

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function ChatRoomsView({ admin }) {
  const models = useMemo(() => (Array.isArray(admin?.models) ? admin.models : []), [admin]);
  const modelById = useMemo(() => new Map(models.map((m) => [normalizeId(m?.id), m])), [models]);
  const { agents, refreshAgents } = useChatAgents({ models });
  const controller = useChatRooms();
  const {
    loading,
    rooms,
    messages,
    messagesHasMore,
    loadingMore,
    selectedRoomId,
    composerText,
    composerAttachments,
    streamState,
    currentRoom,
    setComposerText,
    setComposerAttachments,
    refreshRooms,
    selectRoom,
    loadMoreMessages,
    createRoom,
    updateRoom,
    deleteRoom,
    renameRoom,
    sendMessage,
    stopStreaming,
  } = controller;

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorInitial, setEditorInitial] = useState(null);

  const agentById = useMemo(() => new Map(agents.map((agent) => [normalizeId(agent?.id), agent])), [agents]);

  const hostAgentId = normalizeId(currentRoom?.hostAgentId || currentRoom?.agentId);
  const hostAgent = hostAgentId ? agentById.get(hostAgentId) : null;
  const hostModel = hostAgent ? modelById.get(normalizeId(hostAgent.modelId)) : null;
  const visionEnabled = Boolean(hostModel?.supportsVision);

  const memberEntries = useMemo(() => {
    const ids = Array.isArray(currentRoom?.memberAgentIds) ? currentRoom.memberAgentIds : [];
    const entries = ids
      .map((id) => ({ id: normalizeId(id), agent: agentById.get(normalizeId(id)) }))
      .filter((entry) => entry.id && entry.agent)
      .map((entry) => ({ id: entry.id, label: entry.agent?.name || entry.agent?.id }))
      .filter(Boolean)
      .filter((entry) => entry.label);
    return entries;
  }, [agentById, currentRoom?.memberAgentIds]);

  const openCreateModal = useCallback(() => {
    setEditorInitial({
      title: '新聊天室',
      hostAgentId: '',
      memberAgentIds: [],
    });
    setEditorOpen(true);
  }, []);

  const openEditModal = useCallback(() => {
    if (!currentRoom) return;
    setEditorInitial({
      id: currentRoom.id,
      title: currentRoom.title || '',
      hostAgentId: hostAgentId,
      memberAgentIds: Array.isArray(currentRoom.memberAgentIds) ? currentRoom.memberAgentIds : [],
    });
    setEditorOpen(true);
  }, [currentRoom, hostAgentId]);

  const handleSave = async (values) => {
    if (values?.id) {
      await updateRoom(values.id, {
        title: values.title,
        hostAgentId: values.hostAgentId,
        memberAgentIds: values.memberAgentIds,
      });
    } else {
      await createRoom({
        title: values.title,
        hostAgentId: values.hostAgentId,
        memberAgentIds: values.memberAgentIds,
      });
    }
    await refreshAgents();
    setEditorOpen(false);
    setEditorInitial(null);
  };

  if (!hasApi) {
    return <Alert type="error" message="IPC bridge not available. Is preload loaded?" />;
  }

  if (loading) {
    return (
      <div style={{ padding: 18 }}>
        <Spin />
      </div>
    );
  }

  return (
    <>
      <Layout style={{ height: '100%', minHeight: 0 }}>
        <Sider
          width={320}
          collapsed={sidebarCollapsed}
          collapsedWidth={0}
          collapsible
          trigger={null}
          style={{
            background: 'var(--ds-panel-bg)',
            borderRight: sidebarCollapsed ? 'none' : '1px solid var(--ds-panel-border)',
          }}
        >
          <ChatSidebar
            sessions={rooms}
            selectedSessionId={selectedRoomId}
            onSelectSession={selectRoom}
            onCreateSession={openCreateModal}
            onDeleteSession={async (rid) => {
              try {
                await deleteRoom(rid);
              } catch {
                // deleteRoom already toasts
              }
            }}
            onRenameSession={async (rid, title) => {
              try {
                await renameRoom(rid, title);
              } catch {
                // renameRoom already toasts
              }
            }}
            onRefresh={() => {
              refreshRooms?.();
              refreshAgents?.();
            }}
            onCollapse={() => setSidebarCollapsed(true)}
            headerLabel="聊天室"
            renameTitle="重命名聊天室"
            emptyLabel="未命名聊天室"
            namePlaceholder="聊天室名称"
          />
        </Sider>
        <Content
          style={{
            padding: 16,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {sidebarCollapsed ? (
              <Tooltip title="展开聊天室">
                <Button
                  size="small"
                  icon={<MenuUnfoldOutlined />}
                  onClick={() => setSidebarCollapsed(false)}
                  style={{ position: 'absolute', top: 0, left: 0, zIndex: 5 }}
                />
              </Tooltip>
            ) : null}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                borderRadius: 16,
                overflow: 'hidden',
                background: 'var(--ds-panel-bg)',
                border: '1px solid var(--ds-panel-border)',
                boxShadow: 'var(--ds-panel-shadow)',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div style={{ padding: 12, borderBottom: '1px solid var(--ds-panel-border)', background: 'var(--ds-subtle-bg)' }}>
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  <ChatSessionHeader session={currentRoom} streaming={Boolean(streamState)} />
                  {currentRoom ? (
                    <Space size={[6, 6]} wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                      <Space size={[6, 6]} wrap>
                        <Tag color="blue" style={{ marginRight: 0 }}>
                          默认助手: {hostAgent?.name || hostAgent?.id || '未设置'}
                        </Tag>
                        {memberEntries.length > 0 ? (
                          memberEntries.map((entry) => (
                            <Tag key={entry.id} style={{ marginRight: 0 }}>
                              {entry.label}
                            </Tag>
                          ))
                        ) : (
                          <Text type="secondary">暂无成员</Text>
                        )}
                      </Space>
                      <Space>
                        <Button
                          size="small"
                          icon={<EditOutlined />}
                          onClick={openEditModal}
                          disabled={!currentRoom || Boolean(streamState)}
                        >
                          编辑
                        </Button>
                      </Space>
                    </Space>
                  ) : null}
                </Space>
              </div>

              <div style={{ flex: 1, minHeight: 0, padding: 12 }}>
                {currentRoom ? (
                  <ChatMessages
                    messages={messages}
                    streaming={streamState}
                    hasMore={messagesHasMore}
                    loadingMore={loadingMore}
                    onLoadMore={loadMoreMessages}
                  />
                ) : (
                  <Empty description="暂无聊天室，点击左侧 + 新建" />
                )}
              </div>

              <div style={{ padding: 12, borderTop: '1px solid var(--ds-panel-border)', background: 'var(--ds-subtle-bg)' }}>
                {currentRoom ? (
                  <ChatComposer
                    value={composerText}
                    onChange={setComposerText}
                    attachments={composerAttachments}
                    onAttachmentsChange={setComposerAttachments}
                    visionEnabled={visionEnabled}
                    onSend={async () => {
                      try {
                        await sendMessage();
                      } catch {
                        // sendMessage already toasts
                      }
                    }}
                    onStop={stopStreaming}
                    sending={Boolean(streamState)}
                  />
                ) : (
                  <Space size={10}>
                    <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
                      新建聊天室
                    </Button>
                  </Space>
                )}
              </div>
            </div>
          </div>
        </Content>
      </Layout>

      <RoomEditorModal
        open={editorOpen}
        initialValues={editorInitial}
        agents={agents}
        onCancel={() => {
          setEditorOpen(false);
          setEditorInitial(null);
        }}
        onSave={handleSave}
      />
    </>
  );
}
