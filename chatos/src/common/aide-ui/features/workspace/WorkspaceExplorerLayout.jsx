import React from 'react';
import { Alert, Button, Card, Col, Drawer, Empty, Input, List, Row, Select, Space, Spin, Switch, Tag, Tree, Typography } from 'antd';

import { CodeBlock } from '../../components/CodeBlock.jsx';
import { formatBytes, formatDateTime } from '../../lib/format.js';
import { detectLanguageFromPath } from '../../lib/highlight.js';
import { setAideDragData } from '../../lib/dnd.js';

const { Text, Title } = Typography;
const { Search } = Input;

export function WorkspaceExplorerLayout({
  rootOptions,
  workspaceRoot,
  onWorkspaceRootChange,
  manualRoot,
  onManualRootChange,
  onOpenRoot,
  onRefreshTree,
  treeMeta,
  splitViewRef,
  splitViewHeight,
  splitGap,
  isResizingSplit,
  treePaneWidth,
  splitMinLeft,
  splitMaxLeft,
  splitMinRight,
  splitHandleWidth,
  onSplitterPointerDown,
  onSplitterPointerMove,
  onSplitterPointerStop,
  treeLoading,
  treeError,
  treeData,
  expandedKeys,
  onExpandedKeysChange,
  onLoadTreeData,
  selectedKeys,
  onSelectNode,
  onExpandAll,
  onCollapseAll,
  autoOpenHistoryOnSelect,
  onAutoOpenHistoryOnSelectChange,
  treeViewportRef,
  treeViewportHeight,
  treeScrollWidth,
  currentFilePath,
  fileTarget,
  fileView,
  previewViewportRef,
  previewViewportHeight,
  onReloadFile,
  onOpenHistory,
  historyOpen,
  onCloseHistory,
  fileHistory,
  activeDiff,
  resolvedActiveKey,
  changeEntryKey,
  onSelectHistoryKey,
}) {
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Card>
        <Row align="middle" gutter={[12, 12]}>
          <Col flex="auto">
            <Space direction="vertical" size={2}>
              <Title level={4} style={{ margin: 0 }}>
                文件浏览器
              </Title>
              <Text type="secondary">默认打开 CLI 启动目录（workspaceRoot），变更文件会高亮并可查看历史 diff。</Text>
            </Space>
          </Col>
          <Col>
            <Space wrap>
              <Select
                value={workspaceRoot || undefined}
                onChange={onWorkspaceRootChange}
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="选择 workspaceRoot（来自 file-changes）"
                options={rootOptions}
                style={{ width: 420 }}
              />
              <Search
                value={manualRoot}
                onChange={onManualRootChange}
                onSearch={onOpenRoot}
                enterButton="打开"
                placeholder="手动输入目录路径"
                style={{ width: 320 }}
              />
              <Button disabled={!workspaceRoot} onClick={onRefreshTree}>
                刷新
              </Button>
            </Space>
          </Col>
        </Row>
        <Space wrap style={{ marginTop: 12 }}>
          <Tag color="blue">root</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {workspaceRoot || '<not set>'}
          </Text>
          {treeMeta?.truncated ? <Tag color="warning">目录已截断</Tag> : null}
        </Space>
      </Card>

      {!workspaceRoot ? (
        <Alert
          type="info"
          message="未检测到 workspaceRoot"
          description="请从下拉选择（来自 file-changes）或手动输入一个目录路径。"
        />
      ) : (
        <div
          ref={splitViewRef}
          style={{
            height: splitViewHeight,
            minHeight: 360,
            width: '100%',
            display: 'flex',
            gap: splitGap,
            ...(isResizingSplit ? { userSelect: 'none' } : null),
          }}
        >
          <div
            style={{
              width: treePaneWidth,
              minWidth: splitMinLeft,
              maxWidth: splitMaxLeft,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              flex: '0 0 auto',
            }}
          >
            <Card
              size="small"
              title="文件"
              extra={
                <Space size={8} align="center" wrap>
                  <Button size="small" disabled={treeLoading || treeData.length === 0} onClick={onExpandAll}>
                    全部展开
                  </Button>
                  <Button
                    size="small"
                    disabled={treeLoading || treeData.length === 0 || expandedKeys.length <= 1}
                    onClick={onCollapseAll}
                  >
                    全部收起
                  </Button>
                  <Space size={6} align="center">
                    <Switch
                      size="small"
                      checked={autoOpenHistoryOnSelect !== false}
                      onChange={(checked) =>
                        typeof onAutoOpenHistoryOnSelectChange === 'function'
                          ? onAutoOpenHistoryOnSelectChange(checked)
                          : null
                      }
                    />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      点击文件自动打开变更记录
                    </Text>
                  </Space>
                </Space>
              }
              style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
              bodyStyle={{ padding: 8, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
            >
              <div ref={treeViewportRef} style={{ flex: 1, minHeight: 0 }}>
                {treeError ? (
                  <Alert type="error" message="读取目录失败" description={treeError} />
                ) : (
                  <Spin spinning={treeLoading} size="small" style={{ height: '100%' }}>
                    {treeData.length === 0 ? (
                      <Empty description="暂无目录数据" />
                    ) : (
                      <Tree.DirectoryTree
                        className="ds-workspace-tree"
                        height={Math.max(240, treeViewportHeight)}
                        scrollWidth={treeScrollWidth}
                        expandAction="doubleClick"
                        treeData={treeData}
                        loadData={onLoadTreeData}
                        expandedKeys={expandedKeys}
                        selectedKeys={selectedKeys}
                        onExpand={(keys) => onExpandedKeysChange(Array.isArray(keys) ? [...keys] : [])}
                        onSelect={onSelectNode}
                      />
                    )}
                  </Spin>
                )}
              </div>
              {treeMeta?.path ? (
                <Text type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
                  {treeMeta.path}
                </Text>
              ) : null}
            </Card>
          </div>

          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panels"
            onPointerDown={onSplitterPointerDown}
            onPointerMove={onSplitterPointerMove}
            onPointerUp={onSplitterPointerStop}
            onPointerCancel={onSplitterPointerStop}
            style={{
              width: splitHandleWidth,
              borderRadius: 6,
              cursor: 'col-resize',
              background: isResizingSplit ? '#1677ff' : 'var(--ds-splitter-bg)',
              opacity: isResizingSplit ? 0.45 : 0.25,
              alignSelf: 'stretch',
              flex: '0 0 auto',
            }}
          />

          <div
            style={{
              flex: '1 1 auto',
              minWidth: splitMinRight,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Card
              size="small"
              title={currentFilePath ? `预览：${currentFilePath}` : '预览'}
              extra={
                <Space>
                  <Button
                    size="small"
                    disabled={!fileTarget || !(fileTarget.absolutePath || fileTarget.path)}
                    loading={fileView.loading}
                    onClick={onReloadFile}
                  >
                    重新读取
                  </Button>
                  <Button size="small" disabled={!currentFilePath} onClick={onOpenHistory}>
                    变更记录
                  </Button>
                </Space>
              }
              style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
              bodyStyle={{ flex: 1, minHeight: 0 }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                {fileView.error ? (
                  <Alert type="error" message="读取失败" description={fileView.error} style={{ marginBottom: 8 }} />
                ) : null}
                {currentFilePath ? (
                  <Space size={8} wrap style={{ marginBottom: 8 }}>
                    {fileView.payload?.truncated ? <Tag color="warning">内容已截断</Tag> : null}
                    {typeof fileView.payload?.size === 'number' ? <Tag>size: {formatBytes(fileView.payload.size)}</Tag> : null}
                    {fileView.payload?.mtime ? <Tag>mtime: {formatDateTime(fileView.payload.mtime)}</Tag> : null}
                  </Space>
                ) : null}
                <div ref={previewViewportRef} style={{ flex: 1, minHeight: 0 }}>
                  {!currentFilePath ? (
                    <Empty description="从左侧选择一个文件查看内容" />
                  ) : fileView.loading ? (
                    <Text type="secondary">读取文件中...</Text>
                  ) : (
                    <CodeBlock
                      text={fileView.payload?.content || ''}
                      maxHeight={Math.max(240, previewViewportHeight)}
                      highlight
                      language={detectLanguageFromPath(fileView.payload?.path || currentFilePath)}
                      wrap={false}
                      showLineNumbers
                    />
                  )}
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      <Drawer
        title={currentFilePath ? `变更记录：${currentFilePath}` : '变更记录'}
        open={historyOpen}
        onClose={onCloseHistory}
        width={1000}
        destroyOnClose
      >
        {fileHistory.length === 0 ? (
          <Empty description="暂无该文件的变更记录" />
        ) : (
          <Row gutter={[12, 12]} wrap={false} style={{ width: '100%' }}>
            <Col flex="340px">
              <List
                size="small"
                dataSource={fileHistory}
                renderItem={(item) => {
                  const key = changeEntryKey(item);
                  const active = Boolean(resolvedActiveKey && key === resolvedActiveKey);
                  const type = item?.changeType;
                  const color = type === 'created' ? 'green' : type === 'deleted' ? 'red' : 'gold';
                  return (
                    <List.Item
                      key={key}
                      draggable
                      style={{
                        cursor: 'pointer',
                        background: active ? 'var(--ds-selected-bg)' : undefined,
                        borderRadius: 6,
                      }}
                      onDragStart={(event) => {
                        const relPath = typeof item?.path === 'string' ? item.path : '';
                        const absolutePath = typeof item?.absolutePath === 'string' ? item.absolutePath : '';
                        setAideDragData(
                          event,
                          {
                            kind: 'file_change',
                            workspaceRoot,
                            path: relPath,
                            absolutePath,
                            changeType: item?.changeType,
                            ts: item?.ts,
                            tool: item?.tool,
                            mode: item?.mode,
                            server: item?.server,
                            diff: item?.diff,
                          },
                          relPath || absolutePath
                        );
                      }}
                      onClick={() => onSelectHistoryKey(key)}
                    >
                      <Space direction="vertical" size={2} style={{ width: '100%' }}>
                        <Space size={6} wrap>
                          <Tag color={color}>{type === 'created' ? '新增' : type === 'deleted' ? '删除' : '修改'}</Tag>
                          {item?.tool ? <Tag color="purple">{item.tool}</Tag> : null}
                        </Space>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {formatDateTime(item?.ts)}
                        </Text>
                      </Space>
                    </List.Item>
                  );
                }}
              />
            </Col>
            <Col flex="auto">
              <CodeBlock
                text={activeDiff?.diff || '选择左侧记录查看 diff'}
                maxHeight={720}
                highlight
                language="diff"
                wrap={false}
                alwaysExpanded
                constrainHeight
              />
            </Col>
          </Row>
        )}
      </Drawer>
    </Space>
  );
}
