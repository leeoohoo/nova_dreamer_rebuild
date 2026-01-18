import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Empty, List, Pagination, Segmented, Select, Space, Tag, Typography, Input } from 'antd';

import { CodeBlock } from '../../components/CodeBlock.jsx';
import { MarkdownBlock } from '../../components/MarkdownBlock.jsx';
import { buildEventMarkdown, formatToolLabel } from '../../lib/event-markdown.js';
import { formatJson } from '../../lib/format.js';
import { RUN_FILTER_ALL } from '../../lib/storage.js';
import { normalizeRunId } from '../../lib/runs.js';

const { Text } = Typography;
const { Search } = Input;

function shouldCollapseDetails(type) {
  const normalized = String(type || '');
  return (
    normalized.endsWith('tool_call') ||
    normalized.endsWith('tool_result') ||
    normalized === 'tool' ||
    normalized === 'subagent_tool'
  );
}

function EventStreamMarkdown({ events, onRefresh, runFilter, runOptions, onRunFilterChange }) {
  const list = Array.isArray(events) ? events : [];
  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState([]);
  const [expandedDetails, setExpandedDetails] = useState({});
  const [pageSize, setPageSize] = useState(10);
  const [followLatest, setFollowLatest] = useState(true);
  const [page, setPage] = useState(() => Math.max(1, Math.ceil(list.length / 10)));
  const scrollContainerRef = useRef(null);
  const ignoreScrollRef = useRef(false);
  const nextScrollBehaviorRef = useRef('auto');
  const lastUpdated = list.length > 0 ? list[list.length - 1].tsText : null;
  const codeBlockClampStyle = { width: '100%', maxWidth: '100%', minWidth: 0, overflowX: 'auto' };

  const toggleDetails = (key) => {
    setExpandedDetails((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const typeOptions = useMemo(
    () =>
      Array.from(new Set(list.map((e) => e.type).filter(Boolean))).map((type) => ({
        label: type,
        value: type,
      })),
    [list]
  );

  const filtered = useMemo(() => {
    const lower = search.trim().toLowerCase();
    return list.filter((event) => {
      const type = event.type || '';
      const matchesQuick =
        quickFilter === 'all' ||
        (quickFilter === 'conversation' &&
          ['user', 'assistant', 'assistant_thinking', 'system'].includes(type)) ||
        (quickFilter === 'tools' && type.includes('tool') && !type.startsWith('subagent')) ||
        (quickFilter === 'subagent' && type.includes('subagent'));
      if (!matchesQuick) return false;
      if (typeFilter.length > 0 && !typeFilter.includes(type)) return false;
      if (!lower) return true;
      return (
        (event.preview || '').toLowerCase().includes(lower) ||
        (event.rawJson || '').toLowerCase().includes(lower) ||
        (event.rawEvent || '').toLowerCase().includes(lower) ||
        type.toLowerCase().includes(lower)
      );
    });
  }, [list, search, quickFilter, typeFilter]);

	  const total = filtered.length;
	  const lastPage = Math.max(1, Math.ceil(total / pageSize));
	  const pagedEvents = useMemo(() => {
	    const safePage = Math.min(Math.max(1, page), lastPage);
	    const start = (safePage - 1) * pageSize;
	    return filtered.slice(start, start + pageSize);
	  }, [filtered, page, pageSize, lastPage]);

	  const handlePageChange = (nextPage, nextSize) => {
	    const size = Number(nextSize) || 10;
	    const computedLast = Math.max(1, Math.ceil(total / size));
	    const safeNextPage = Math.min(Math.max(1, Number(nextPage) || 1), computedLast);
	    const sizeChanged = size !== pageSize;
	    setPageSize(size);
	    if (sizeChanged) {
	      if (followLatest) {
	        nextScrollBehaviorRef.current = 'auto';
	        setPage(computedLast);
	        setFollowLatest(true);
	      } else {
	        setPage(safeNextPage);
	        setFollowLatest(false);
	      }
	      return;
	    }
	    setPage(safeNextPage);
	    if (safeNextPage === computedLast) {
	      nextScrollBehaviorRef.current = 'auto';
	      setFollowLatest(true);
	    } else {
	      setFollowLatest(false);
	    }
	  };

  const scrollToBottom = (behavior = 'auto') => {
    const el = scrollContainerRef.current;
    if (!el) return;
    ignoreScrollRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior });
    window.setTimeout(() => {
      ignoreScrollRef.current = false;
    }, 120);
  };

  const jumpToLatest = () => {
    nextScrollBehaviorRef.current = 'smooth';
    setFollowLatest(true);
    setPage(lastPage);
  };

  useEffect(() => {
    if (followLatest) {
      if (page !== lastPage) setPage(lastPage);
      return;
    }
    if (page > lastPage) setPage(lastPage);
  }, [followLatest, page, lastPage]);

  useLayoutEffect(() => {
    if (!followLatest) return;
    if (page !== lastPage) return;
    const behavior = nextScrollBehaviorRef.current || 'auto';
    nextScrollBehaviorRef.current = 'auto';
    scrollToBottom(behavior);
  }, [followLatest, page, lastPage, pageSize, total]);

  const handleScroll = () => {
    if (ignoreScrollRef.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    if (page !== lastPage) return;
    const distance = el.scrollHeight - (el.scrollTop + el.clientHeight);
    const isNearBottom = distance <= 48;
    if (!isNearBottom && followLatest) setFollowLatest(false);
    if (isNearBottom && !followLatest) setFollowLatest(true);
  };

  return (
    <Card
      title=""
      extra={
        <Space size={8}>
          {!followLatest ? (
            <Button size="small" type="primary" onClick={jumpToLatest}>
              回到最新
            </Button>
          ) : null}
          {onRefresh ? (
            <Button size="small" onClick={onRefresh}>
              刷新
            </Button>
          ) : null}
        </Space>
      }
      style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}
      bodyStyle={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}
    >
      <Space size="small" wrap style={{ marginBottom: 12, width: '100%', minWidth: 0 }}>
        {lastUpdated ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            最新事件：{lastUpdated}
          </Text>
        ) : null}
      </Space>
      <Space size="small" wrap style={{ marginBottom: 12, width: '100%', minWidth: 0 }}>
        <Select
          value={runFilter || RUN_FILTER_ALL}
          onChange={(val) => (typeof onRunFilterChange === 'function' ? onRunFilterChange(val) : null)}
          options={Array.isArray(runOptions) ? runOptions : [{ label: '全部终端', value: RUN_FILTER_ALL }]}
          style={{ minWidth: 260 }}
          showSearch
          optionFilterProp="label"
          placeholder="按终端(runId)过滤"
        />
        <Segmented
          value={quickFilter}
          onChange={(val) => setQuickFilter(val)}
          options={[
            { label: '全部', value: 'all' },
            { label: '对话', value: 'conversation' },
            { label: '工具', value: 'tools' },
            { label: '子代理', value: 'subagent' },
          ]}
        />
        <Select
          mode="multiple"
          allowClear
          placeholder="按类型过滤"
          style={{ minWidth: 200 }}
          value={typeFilter}
          onChange={(value) => setTypeFilter(value)}
          options={typeOptions}
        />
        <Search
          allowClear
          placeholder="关键字搜索 payload/type"
          style={{ width: 240 }}
          onChange={(e) => setSearch(e.target.value)}
        />
      </Space>
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{ flex: 1, minHeight: 0, minWidth: 0, maxWidth: '100%', overflow: 'auto' }}
      >
	        <List
	          itemLayout="vertical"
	          dataSource={pagedEvents}
	          locale={{ emptyText: <Empty description="暂无事件记录" /> }}
	          renderItem={(item) => {
            const collapsible = shouldCollapseDetails(item.type);
            const expanded = Boolean(expandedDetails[item.key]);
            const isToolLike = item.type === 'tool' || item.type === 'subagent_tool';
            const toolLabel = formatToolLabel(item.payload?.tool);
            const payloadJson = typeof item.rawJson === 'string' && item.rawJson.trim() ? item.rawJson : '';
            const eventJson = typeof item.rawEvent === 'string' && item.rawEvent.trim() ? item.rawEvent : '';
            const rid = normalizeRunId(item.runId);
            const markdown = buildEventMarkdown(item);

            return (
              <List.Item key={item.key} style={{ paddingLeft: 0, paddingRight: 0, minWidth: 0 }}>
                <Space direction="vertical" size={8} style={{ width: '100%', minWidth: 0 }}>
                    <Space align="start" wrap style={{ justifyContent: 'space-between', width: '100%', minWidth: 0 }}>
                    <Space size={8} wrap style={{ flex: 1, minWidth: 0 }}>
                      <Tag color={item.meta?.color || 'default'}>{item.meta?.label || item.type}</Tag>
                      {toolLabel ? <Tag color="purple">tool: {toolLabel}</Tag> : null}
                      {item.payload?.agent ? <Tag color="magenta">agent: {item.payload.agent}</Tag> : null}
                      {rid ? <Tag color="geekblue">run: {rid}</Tag> : null}
                    </Space>
                    <Space size={8} align="center" style={{ flexShrink: 0 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {item.tsText}
                      </Text>
                      <Button type="link" size="small" onClick={() => toggleDetails(item.key)}>
                        {expanded ? '收起详情' : '展开详情'}
                      </Button>
                    </Space>
                  </Space>

                  {markdown ? <MarkdownBlock text={markdown} alwaysExpanded /> : <Text type="secondary">无内容</Text>}

                  {expanded ? (
                    <Space direction="vertical" size={6} style={{ width: '100%', minWidth: 0 }}>
                      {isToolLike ? (
                        <>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            args
                          </Text>
                          <div style={codeBlockClampStyle}>
                            <CodeBlock text={formatJson(item?.payload?.args) || '无 args'} maxHeight={220} highlight />
                          </div>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            result
                          </Text>
                          <div style={codeBlockClampStyle}>
                            <CodeBlock text={formatJson(item?.payload?.result) || '无 result'} maxHeight={260} highlight />
                          </div>
                        </>
                      ) : null}
                      {collapsible || !isToolLike ? (
                        <>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            payload / event
                          </Text>
                          {payloadJson ? (
                            <div style={codeBlockClampStyle}>
                              <CodeBlock text={payloadJson} maxHeight={260} highlight language="json" />
                            </div>
                          ) : eventJson ? (
                            <div style={codeBlockClampStyle}>
                              <CodeBlock text={eventJson} maxHeight={260} highlight language="json" />
                            </div>
                          ) : (
                            <div style={codeBlockClampStyle}>
                              <CodeBlock text="无更多详情" maxHeight={260} />
                            </div>
                          )}
                          {eventJson && eventJson !== payloadJson ? (
                            <div style={codeBlockClampStyle}>
                              <CodeBlock text={eventJson} maxHeight={260} highlight language="json" />
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </Space>
                  ) : null}
                </Space>
              </List.Item>
	            );
	          }}
	          style={{ minHeight: 0, minWidth: 0, width: '100%' }}
	        />
	      </div>
	      <div style={{ paddingTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
	        <Pagination
	          size="small"
	          current={page}
	          pageSize={pageSize}
	          total={total}
	          showSizeChanger
	          pageSizeOptions={['10', '20', '50', '100']}
	          onChange={handlePageChange}
	          onShowSizeChange={handlePageChange}
	        />
	      </div>
	    </Card>
	  );
	}

export function EventStreamMarkdownView({
  eventList,
  eventsPath,
  runFilter,
  runOptions,
  onRunFilterChange,
  onRefreshLogs,
}) {
  void eventsPath;
  return (
    <div style={{ width: '100%', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <EventStreamMarkdown
        events={eventList}
        onRefresh={onRefreshLogs}
        runFilter={runFilter}
        runOptions={runOptions}
        onRunFilterChange={onRunFilterChange}
      />
    </div>
  );
}
