import React, { useMemo, useRef } from 'react';
import { Drawer, Empty, Table, Tag } from 'antd';

import { CodeBlock } from '../../../components/CodeBlock.jsx';
import { useElementHeight } from '../../../hooks/useElementSize.js';
import { formatDateTime, formatJson } from '../../../lib/format.js';

function ToolDrawer({ open, onClose, events }) {
  const tableViewportRef = useRef(null);
  const tableViewportHeight = useElementHeight(tableViewportRef, 520);
  const scrollY = Math.max(240, tableViewportHeight - 140);
  const rows = useMemo(
    () =>
      events
        .filter((e) =>
          ['tool', 'tool_call', 'tool_result', 'subagent_tool', 'subagent_tool_call', 'subagent_tool_result'].includes(
            e.type
          )
        )
        .map((e, idx) => {
          const args = formatJson(
            e.payload?.args || e.payload?.parameters || e.payload?.params || e.payload?.arguments || e.payload?.input
          );
          const result = formatJson(
            e.payload?.result || e.payload?.data || e.payload?.output || e.payload?.response || e.payload?.res
          );
          const detail = e.rawEvent || e.rawJson || formatJson(e.payload || {});
          return {
            key: e.key || idx,
            type: e.meta?.label || e.type,
            color: e.meta?.color,
            tool: e.payload?.tool || e.payload?.agent || '-',
            args: args || '无参数',
            result: result || '无输出',
            detail: detail || '无详情',
            ts: e.tsText || formatDateTime(e.ts),
          };
        }),
    [events]
  );
  return (
    <Drawer
      title="工具调用历史"
      open={open}
      onClose={onClose}
      width={1000}
      styles={{ body: { display: 'flex', flexDirection: 'column', minHeight: 0 } }}
    >
      {rows.length === 0 ? (
        <Empty description="暂无工具调用" />
      ) : (
        <div ref={tableViewportRef} style={{ flex: 1, minHeight: 0 }}>
	          <Table
	            size="small"
	            dataSource={rows}
            columns={[
              { title: '时间', dataIndex: 'ts', width: 180 },
              {
                title: '类型',
                dataIndex: 'type',
                width: 180,
                render: (text, record) => <Tag color={record.color || 'default'}>{text}</Tag>,
              },
              { title: '工具/代理', dataIndex: 'tool', width: 200 },
              {
                title: '调用参数',
                dataIndex: 'args',
                width: 360,
                render: (v) => <CodeBlock text={v} maxHeight={140} />,
              },
              {
                title: '结果 / 输出',
                dataIndex: 'result',
                width: 360,
                render: (v) => <CodeBlock text={v} maxHeight={140} />,
              },
              {
                title: '原始事件',
                dataIndex: 'detail',
                width: 320,
                render: (v) => <CodeBlock text={v} maxHeight={200} />,
              },
	            ]}
	            pagination={{
	              defaultPageSize: 10,
	              showSizeChanger: true,
	              pageSizeOptions: ['10', '20', '50', '100'],
	            }}
	            scroll={{ x: 1600, y: scrollY }}
	          />
	        </div>
	      )}
    </Drawer>
  );
}

export { ToolDrawer };
