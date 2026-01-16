import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Input, Layout, Modal, Select, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import { CloseCircleOutlined, FolderOpenOutlined, MenuUnfoldOutlined } from '@ant-design/icons';

import { api, hasApi } from '../../lib/api.js';
import { parseTasks } from '../../lib/parse.js';
import { ChatSidebar } from './components/ChatSidebar.jsx';
import { ChatSessionHeader } from './components/ChatSessionHeader.jsx';
import { ChatMessages } from './components/ChatMessages.jsx';
import { ChatComposer } from './components/ChatComposer.jsx';
import { TasksWorkbenchDrawer } from './components/TasksWorkbenchDrawer.jsx';
import { useChatController } from './hooks/useChatController.js';

const { Sider, Content } = Layout;
const { Text } = Typography;

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function ChatView({ admin, sidebarCollapsed: sidebarCollapsedProp, onSidebarCollapsedChange }) {
  const controller = useChatController({ admin });
  const {
    loading,
    agents,
    sessions,
    messages,
    messagesHasMore,
    loadingMore,
    selectedAgentId,
    selectedSessionId,
    composerText,
    composerAttachments,
    streamState,
    currentSession,
    setComposerText,
    setComposerAttachments,
    refreshAll,
    selectSession,
    loadMoreMessages,
    createSession,
    deleteSession,
    renameSession,
    changeAgent,
    setWorkspaceRoot,
    pickWorkspaceRoot,
    clearWorkspaceRoot,
    sendMessage,
    stopStreaming,
  } = controller;

  const [tasks, setTasks] = useState([]);
  const [tasksWorkbenchOpen, setTasksWorkbenchOpen] = useState(false);
  const tasksSourceReadyRef = useRef(false);
  const tasksBaselineSessionIdRef = useRef('');
  const tasksBaselineIdsRef = useRef(new Set());
  const tasksBaselineReadyRef = useRef(false);
  const [localSidebarCollapsed, setLocalSidebarCollapsed] = useState(false);

  const sidebarCollapsed = typeof sidebarCollapsedProp === 'boolean' ? sidebarCollapsedProp : localSidebarCollapsed;
  const setSidebarCollapsed = useCallback(
    (next) => {
      const value = Boolean(next);
      if (typeof sidebarCollapsedProp === 'boolean') {
        onSidebarCollapsedChange?.(value);
        return;
      }
      setLocalSidebarCollapsed(value);
      onSidebarCollapsedChange?.(value);
    },
    [sidebarCollapsedProp, onSidebarCollapsedChange]
  );

  const models = useMemo(() => (Array.isArray(admin?.models) ? admin.models : []), [admin]);
  const modelById = useMemo(() => new Map(models.map((m) => [normalizeId(m?.id), m])), [models]);
  const selectedAgent = useMemo(
    () =>
      Array.isArray(agents)
        ? agents.find((a) => normalizeId(a?.id) === normalizeId(selectedAgentId)) || null
        : null,
    [agents, selectedAgentId]
  );
  const selectedModel = useMemo(
    () => (selectedAgent ? modelById.get(normalizeId(selectedAgent.modelId)) : null),
    [modelById, selectedAgent]
  );
  const visionEnabled = Boolean(selectedModel?.supportsVision);
  const agentOptions = useMemo(
    () =>
      (Array.isArray(agents) ? agents : []).map((a) => ({
        value: a.id,
        label: a.name || a.id,
      })),
    [agents]
  );
  const workspaceRoot = useMemo(() => {
    const raw = currentSession?.workspaceRoot;
    return typeof raw === 'string' ? raw.trim() : '';
  }, [currentSession?.workspaceRoot]);
  const workspaceRootLabel = workspaceRoot || '默认（App 启动目录）';
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [workspaceDraft, setWorkspaceDraft] = useState('');

  useEffect(() => {
    setWorkspaceDraft(workspaceRoot);
  }, [currentSession?.id, workspaceRoot]);

  useEffect(() => {
    if (!hasApi) return undefined;
    let canceled = false;

    const applyTaskSnapshot = (data) => {
      const list = Array.isArray(data?.tasksList) ? data.tasksList : parseTasks(data?.tasks);
      setTasks(Array.isArray(list) ? list : []);
    };

    (async () => {
      try {
        const payload = await api.invoke('config:read');
        if (canceled) return;
        tasksSourceReadyRef.current = true;
        applyTaskSnapshot(payload);
      } catch {
        // ignore (older hosts may not support config:read)
      }
    })();

    const unsub = api.on('config:update', (payload) => {
      tasksSourceReadyRef.current = true;
      applyTaskSnapshot(payload);
    });

    return () => {
      canceled = true;
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  const sessionTasks = useMemo(() => {
    const sid = normalizeId(selectedSessionId);
    if (!sid) return [];
    const list = Array.isArray(tasks) ? tasks : [];
    return list.filter((task) => normalizeId(task?.sessionId) === sid);
  }, [selectedSessionId, tasks]);

  useEffect(() => {
    if (!tasksSourceReadyRef.current) return;

    const sid = normalizeId(selectedSessionId);
    const currentIds = new Set(
      sessionTasks
        .map((task) => normalizeId(task?.id))
        .filter(Boolean)
    );

    if (!tasksBaselineReadyRef.current) {
      tasksBaselineReadyRef.current = true;
      tasksBaselineSessionIdRef.current = sid;
      tasksBaselineIdsRef.current = currentIds;
      return;
    }

    if (tasksBaselineSessionIdRef.current !== sid) {
      tasksBaselineSessionIdRef.current = sid;
      tasksBaselineIdsRef.current = currentIds;
      return;
    }

    const prev = tasksBaselineIdsRef.current;
    const hasNew = Array.from(currentIds).some((id) => id && !prev.has(id));
    tasksBaselineIdsRef.current = currentIds;
    if (!tasksWorkbenchOpen && hasNew) {
      setTasksWorkbenchOpen(true);
    }
  }, [selectedSessionId, sessionTasks, tasksWorkbenchOpen]);

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
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            streaming={Boolean(streamState)}
            onSelectSession={selectSession}
            onCreateSession={async () => {
              try {
                await createSession();
              } catch {
                // createSession already toasts
              }
            }}
            onDeleteSession={async (sid) => {
              try {
                await deleteSession(sid);
              } catch {
                // deleteSession already toasts
              }
            }}
            onRenameSession={async (sid, title) => {
              try {
                await renameSession(sid, title);
              } catch {
                // renameSession already toasts
              }
            }}
            onRefresh={refreshAll}
            onCollapse={() => setSidebarCollapsed(true)}
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
              <Tooltip title="展开会话">
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
                <ChatSessionHeader session={currentSession} streaming={Boolean(streamState)} />
              </div>

              <div style={{ flex: 1, minHeight: 0, padding: 12 }}>
                <ChatMessages
                  messages={messages}
                  streaming={streamState}
                  hasMore={messagesHasMore}
                  loadingMore={loadingMore}
                  onLoadMore={loadMoreMessages}
                />
              </div>

              <div style={{ padding: 12, borderTop: '1px solid var(--ds-panel-border)', background: 'var(--ds-subtle-bg)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                  <Space size={8} align="center" wrap>
                    <Text type="secondary">当前 Agent</Text>
                    <Select
                      value={selectedAgentId || undefined}
                      placeholder="选择 Agent"
                      options={agentOptions}
                      onChange={(agentId) => {
                        void (async () => {
                          try {
                            await changeAgent(agentId);
                          } catch {
                            // changeAgent already toasts
                          }
                        })();
                      }}
                      disabled={Boolean(streamState)}
                      style={{ minWidth: 220 }}
                    />
                  </Space>

                  <div style={{ flex: 1 }} />

                  <Space size={8} align="center" wrap>
                    <Tag color="blue" style={{ marginRight: 0 }}>
                      cwd
                    </Tag>
                    <Text type="secondary" ellipsis={{ tooltip: workspaceRootLabel }} style={{ maxWidth: 420 }}>
                      {workspaceRootLabel}
                    </Text>
                    <Button
                      size="small"
                      icon={<FolderOpenOutlined />}
                      onClick={() => setWorkspaceModalOpen(true)}
                      disabled={Boolean(streamState)}
                    >
                      设置目录
                    </Button>
                    <Button
                      size="small"
                      icon={<CloseCircleOutlined />}
                      onClick={() => clearWorkspaceRoot?.()}
                      disabled={Boolean(streamState) || !workspaceRoot}
                    >
                      清除
                    </Button>
                    <Button size="small" onClick={() => setTasksWorkbenchOpen(true)}>
                      任务 ({sessionTasks.length})
                    </Button>
                  </Space>
                </div>

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
              </div>
            </div>
          </div>
        </Content>
      </Layout>

      <Modal
        open={workspaceModalOpen}
        title="设置工作目录"
        okText="应用"
        cancelText="取消"
        onCancel={() => setWorkspaceModalOpen(false)}
        onOk={() => {
          setWorkspaceModalOpen(false);
          setWorkspaceRoot?.(workspaceDraft);
        }}
      >
        <Space size={8} align="start" style={{ width: '100%' }}>
          <Input
            value={workspaceDraft}
            onChange={(e) => setWorkspaceDraft(e.target.value)}
            placeholder="输入工作目录路径（绝对路径）"
            allowClear
            style={{ flex: 1, minWidth: 0 }}
            disabled={Boolean(streamState)}
          />
          {pickWorkspaceRoot ? (
            <Button
              icon={<FolderOpenOutlined />}
              onClick={() => {
                void (async () => {
                  const picked = await pickWorkspaceRoot?.();
                  if (picked) setWorkspaceModalOpen(false);
                })();
              }}
              disabled={Boolean(streamState)}
            >
              选择目录
            </Button>
          ) : null}
        </Space>
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 10 }}>
          该会话的 MCP 工具会以此目录作为 root。
        </Typography.Text>
      </Modal>

      <TasksWorkbenchDrawer
        open={tasksWorkbenchOpen}
        onClose={() => setTasksWorkbenchOpen(false)}
        tasks={sessionTasks}
      />
    </>
  );
}
