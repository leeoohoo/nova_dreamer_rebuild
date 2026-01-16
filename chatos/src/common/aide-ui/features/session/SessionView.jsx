import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Row,
  Select,
  Space,
  Typography,
} from 'antd';

import { CodeBlock } from '../../components/CodeBlock.jsx';
import { formatBytes } from '../../lib/format.js';
import { buildSessionStats, pickRecentConversation } from '../../lib/events.js';
import { RUN_FILTER_ALL } from '../../lib/storage.js';
import { FileChangesCard } from './components/FileChangesCard.jsx';
import { RecentActivityCard } from './components/RecentActivityCard.jsx';
import { SessionStats } from './components/SessionStats.jsx';
import { SessionsPanel } from './components/SessionsPanel.jsx';
import { TasksDrawer } from './components/TasksDrawer.jsx';
import { ToolDrawer } from './components/ToolDrawer.jsx';

const { Title, Text, Paragraph } = Typography;

function SessionView({
  eventList,
  eventsPath,
  fileChanges,
  tasks,
  sessions,
  sessionsLoading,
  sessionsAction,
  runFilter,
  runOptions,
  onRunFilterChange,
  onRefreshLogs,
  onOpenWorkspace,
  onRefreshSessions,
  onKillSession,
  onRestartSession,
  onStopSession,
  onReadSessionLog,
  onKillAllSessions,
  onOpenTasksDrawer,
}) {
  const [toolOpen, setToolOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logSession, setLogSession] = useState(null);
  const [logLines, setLogLines] = useState(500);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState(null);
  const [logPayload, setLogPayload] = useState(null);
  const normalizedEvents = Array.isArray(eventList) ? eventList : [];
  const stats = useMemo(() => buildSessionStats(normalizedEvents, tasks), [normalizedEvents, tasks]);
  const recentConversation = useMemo(
    () => pickRecentConversation(normalizedEvents, 0),
    [normalizedEvents]
  );
  const lastUpdated = stats.lastEvent?.tsText || null;
  const changeEntries = useMemo(
    () => (Array.isArray(fileChanges?.entries) ? fileChanges.entries : []),
    [fileChanges]
  );

  const openSessionLog = (record) => {
    if (!record?.name) return;
    setLogSession(record);
    setLogOpen(true);
  };

  const closeSessionLog = () => {
    setLogOpen(false);
    setLogSession(null);
    setLogError(null);
    setLogPayload(null);
  };

  const refreshSessionLog = useCallback(async () => {
    if (!logSession?.name) return;
    if (typeof onReadSessionLog !== 'function') {
      setLogError('IPC bridge not available');
      return;
    }
    try {
      setLogLoading(true);
      setLogError(null);
      const result = await onReadSessionLog({ name: logSession.name, lineCount: logLines });
      setLogPayload(result || null);
    } catch (err) {
      setLogError(err?.message || '加载会话日志失败');
    } finally {
      setLogLoading(false);
    }
  }, [logLines, logSession?.name, onReadSessionLog]);

  useEffect(() => {
    if (!logOpen) return;
    refreshSessionLog();
  }, [logOpen, refreshSessionLog]);

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Card>
        <Row align="middle" gutter={[12, 12]}>
          <Col flex="auto">
	            <Space direction="vertical" size={2}>
	              <Title level={4} style={{ margin: 0 }}>
	                主页
	              </Title>
	              <Text type="secondary">
	                回溯对话、工具调用与文件改动记录，数据源自 .deepseek_cli。{lastUpdated ? ` 最新事件：${lastUpdated}` : ''}
	              </Text>
	            </Space>
          </Col>
	          <Col>
	            <Space>
	              <Select
	                value={runFilter || RUN_FILTER_ALL}
	                onChange={(val) =>
                  typeof onRunFilterChange === 'function' ? onRunFilterChange(val) : null
                }
                options={Array.isArray(runOptions) ? runOptions : [{ label: '全部终端', value: RUN_FILTER_ALL }]}
                style={{ minWidth: 260 }}
                showSearch
                optionFilterProp="label"
	                placeholder="按终端(runId)过滤"
	              />
		              <Button onClick={onRefreshLogs}>刷新</Button>
		              <Button onClick={() => setToolOpen(true)}>工具调用</Button>
		              <Button onClick={onOpenTasksDrawer}>任务</Button>
	            </Space>
	          </Col>
	        </Row>
	      </Card>

	      <SessionStats stats={stats} />

	      <RecentActivityCard events={recentConversation} />

      <SessionsPanel
        data={sessions}
        loading={sessionsLoading}
        actionName={sessionsAction}
        onRefresh={onRefreshSessions}
        onKill={onKillSession}
        onRestart={onRestartSession}
        onStop={onStopSession}
        onOpenLog={openSessionLog}
        onKillAll={onKillAllSessions}
      />

      <FileChangesCard
        entries={changeEntries}
        logPath={fileChanges?.path}
        onRefresh={onRefreshLogs}
        onOpenWorkspace={onOpenWorkspace}
      />

      <Drawer
        title={logSession?.name ? `会话日志 · ${logSession.name}` : '会话日志'}
        open={logOpen}
        onClose={closeSessionLog}
        width={980}
        destroyOnClose
        styles={{ body: { display: 'flex', flexDirection: 'column', minHeight: 0 } }}
        extra={
          <Space size={8} wrap>
            <Select
              size="small"
              value={logLines}
              onChange={(val) => setLogLines(Number(val) || 500)}
              options={[200, 500, 2000, 10_000].map((v) => ({ label: `${v} 行`, value: v }))}
              style={{ width: 120 }}
            />
            <Button size="small" onClick={refreshSessionLog} loading={logLoading}>
              刷新
            </Button>
          </Space>
        }
      >
        {logError ? (
          <Alert type="error" showIcon={false} message={logError} style={{ marginBottom: 12 }} />
        ) : null}
        {logPayload?.outputPath ? (
          <Alert
            type="info"
            showIcon={false}
            message={
              <Space size={12} wrap>
                <span style={{ fontFamily: 'monospace' }}>{logPayload.outputPath}</span>
                {typeof logPayload?.size === 'number' ? <Text type="secondary">{formatBytes(logPayload.size)}</Text> : null}
                {logPayload?.mtime ? <Text type="secondary">{logPayload.mtime}</Text> : null}
              </Space>
            }
            style={{ marginBottom: 12 }}
          />
        ) : null}
        <div style={{ flex: 1, minHeight: 0 }}>
          <CodeBlock
            text={logPayload?.content || ''}
            maxHeight={620}
            highlight={false}
            language="text"
            wrap={false}
            alwaysExpanded={false}
          />
        </div>
      </Drawer>

      <ToolDrawer open={toolOpen} onClose={() => setToolOpen(false)} events={normalizedEvents} />
    </Space>
  );
}


export { SessionView, TasksDrawer };
