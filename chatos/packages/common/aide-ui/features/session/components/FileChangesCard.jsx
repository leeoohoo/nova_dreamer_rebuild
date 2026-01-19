import React, { useMemo, useState } from 'react';
import { Button, Card, Drawer, Empty, List, Space, Tag, Typography, message } from 'antd';

import { CodeBlock } from '../../../components/CodeBlock.jsx';
import { formatDateTime } from '../../../lib/format.js';
import { setAideDragData } from '../../../lib/dnd.js';

const { Text } = Typography;

function FileChangesCard({ entries, logPath, onRefresh, onOpenWorkspace }) {
  const [selected, setSelected] = useState(null);
  const list = Array.isArray(entries) ? entries : [];
  const deduped = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const item = list[i];
      const key = item?.path || item?.absolutePath;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result;
  }, [list]);

  const renderChangeTag = (type) => {
    if (type === 'created') return <Tag color="green">新增</Tag>;
    if (type === 'deleted') return <Tag color="red">删除</Tag>;
    return <Tag color="gold">修改</Tag>;
  };
  const handleRefresh = onRefresh || (() => {});
  const canOpenWorkspace = (item) => Boolean(item?.workspaceRoot && item?.path && item.path !== 'patch');
  const openWorkspace = (item) =>
    typeof onOpenWorkspace === 'function' ? onOpenWorkspace(item) : message.info('请在左侧菜单打开「文件浏览器」');

  return (
    <Card
      title="文件改动记录"
      extra={
        <Button size="small" onClick={handleRefresh}>
          刷新
        </Button>
      }
    >
      {deduped.length === 0 ? (
        <Empty description="暂无文件改动" />
      ) : (
        <List
          size="small"
          dataSource={deduped}
          renderItem={(item) => (
            <List.Item
              key={item.path || item.absolutePath || item.ts}
              draggable
              onDragStart={(event) => {
                const relPath = typeof item?.path === 'string' ? item.path : '';
                const absolutePath = typeof item?.absolutePath === 'string' ? item.absolutePath : '';
                setAideDragData(
                  event,
                  {
                    kind: 'file_change',
                    workspaceRoot: item?.workspaceRoot,
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
              actions={[
                <Button type="link" size="small" onClick={() => setSelected(item)}>
                  查看 diff
                </Button>,
                <Button type="link" size="small" disabled={!canOpenWorkspace(item)} onClick={() => openWorkspace(item)}>
                  查看文件
                </Button>,
              ]}
            >
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Space size={8} wrap>
                    {renderChangeTag(item.changeType)}
                    <Text strong>{item.path || item.absolutePath || '未知文件'}</Text>
                    {item.tool ? <Tag color="purple">tool: {item.tool}</Tag> : null}
                    {item.mode ? <Tag color="geekblue">{item.mode}</Tag> : null}
                    {item.server ? <Tag color="cyan">{item.server}</Tag> : null}
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {formatDateTime(item.ts)}
                  </Text>
                </Space>
                {item.workspaceRoot ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    workspace: {item.workspaceRoot}
                  </Text>
                ) : null}
              </Space>
            </List.Item>
          )}
        />
      )}
      <Drawer
        title={selected?.path || selected?.absolutePath || '文件改动'}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        width={920}
        destroyOnClose
      >
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <Space size={8} wrap>
            {renderChangeTag(selected?.changeType)}
            {selected?.tool ? <Tag color="purple">tool: {selected.tool}</Tag> : null}
            {selected?.mode ? <Tag color="geekblue">{selected.mode}</Tag> : null}
            {selected?.server ? <Tag color="cyan">{selected.server}</Tag> : null}
          </Space>
          {selected?.workspaceRoot ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              workspace: {selected.workspaceRoot}
            </Text>
          ) : null}
          <CodeBlock text={selected?.diff || '无 diff 内容'} maxHeight={560} highlight language="diff" wrap={false} />
        </Space>
      </Drawer>
    </Card>
  );
}

export { FileChangesCard };

