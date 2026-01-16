import React, { useEffect, useMemo, useState } from 'react';
import { Card, Divider, Drawer, Empty, List, Space, Tag, Typography } from 'antd';

import { CodeBlock } from '../../../components/CodeBlock.jsx';
import { normalizeRunId } from '../../../lib/runs.js';

const { Text } = Typography;

function RecentActivityCard({ events }) {
  const [selected, setSelected] = useState(null);
  const list = useMemo(() => (Array.isArray(events) ? events : []), [events]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const selectedRunId = normalizeRunId(selected?.runId);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(list.length / pageSize));
    if (page > maxPage) setPage(maxPage);
  }, [list.length, page, pageSize]);

  return (
    <Card
      title={
        <Space size={8} align="center" wrap>
          <Text strong>最近对话</Text>
          <Tag>{list.length}</Tag>
        </Space>
      }
      size="small"
      bodyStyle={{ paddingTop: 12 }}
    >
      {list.length === 0 ? (
        <Empty description="暂无对话事件" />
      ) : (
        <List
          size="small"
          dataSource={list}
          renderItem={(item) => (
            <List.Item
              key={item.key}
              style={{ paddingLeft: 0, paddingRight: 0, cursor: 'pointer' }}
              onClick={() => setSelected(item)}
            >
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Space align="start" style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Space>
                    <Tag color={item.meta?.color || 'default'}>{item.meta?.label || item.type}</Tag>
                    <Text strong>{item.preview || '无内容'}</Text>
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {item.tsText}
                  </Text>
                </Space>
              </Space>
            </List.Item>
          )}
          pagination={{
            current: page,
            pageSize,
            total: list.length,
            onChange: (nextPage, nextPageSize) => {
              const normalizedPageSize = Number(nextPageSize) || pageSize;
              if (normalizedPageSize !== pageSize) {
                setPage(1);
                setPageSize(normalizedPageSize);
                return;
              }
              setPage(nextPage);
            },
            showSizeChanger: true,
            pageSizeOptions: ['5', '10', '20', '50'],
          }}
        />
      )}
      <Drawer
        title={selected ? `${selected.meta?.label || selected.type} · ${selected.tsText || ''}` : '对话详情'}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        width={920}
        destroyOnClose
      >
        {selected ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Space size={8} wrap>
              <Tag color={selected.meta?.color || 'default'}>{selected.meta?.label || selected.type}</Tag>
              {selectedRunId ? <Tag color="geekblue">run: {selectedRunId}</Tag> : null}
              <Text type="secondary" style={{ fontSize: 12 }}>
                {selected.tsText}
              </Text>
            </Space>
            <CodeBlock text={selected.rawJson || selected.rawEvent || '无更多详情'} maxHeight={560} highlight language="json" />
            {selected.rawEvent && selected.rawEvent !== selected.rawJson ? (
              <>
                <Divider />
                <Text type="secondary">原始事件</Text>
                <CodeBlock text={selected.rawEvent} maxHeight={420} highlight language="json" />
              </>
            ) : null}
          </Space>
        ) : null}
      </Drawer>
    </Card>
  );
}

export { RecentActivityCard };
