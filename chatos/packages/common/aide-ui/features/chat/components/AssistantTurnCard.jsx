import React, { useMemo, useState } from 'react';
import { Button, Collapse, Space, Tag, Typography, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';

import { MarkdownBlock } from '../../../components/MarkdownBlock.jsx';
import { PopoverTag } from './PopoverTag.jsx';
import { copyPlainText } from '../../../lib/clipboard.js';

const { Text } = Typography;

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatTime(ts) {
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString();
}

function getToolName(call) {
  const name = call?.function?.name;
  return typeof name === 'string' ? name.trim() : '';
}

function getToolArgs(call) {
  const args = call?.function?.arguments;
  if (typeof args === 'string') return args;
  if (args === undefined || args === null) return '';
  return String(args);
}

function getToolResultText(results = []) {
  const parts = (Array.isArray(results) ? results : [])
    .map((msg) => {
      if (!msg) return '';
      if (typeof msg?.content === 'string') return msg.content;
      return String(msg?.content || '');
    })
    .map((text) => (typeof text === 'string' ? text.trim() : String(text || '').trim()))
    .filter(Boolean);
  return parts.join('\n\n');
}

function extractThinkContent(text) {
  const raw = typeof text === 'string' ? text : String(text ?? '');
  if (!raw) return { content: '', reasoning: '' };
  const regex = /<think(?:\s[^>]*)?>([\s\S]*?)<\/think>/gi;
  let cleaned = '';
  let lastIndex = 0;
  const reasoningParts = [];
  let match;
  while ((match = regex.exec(raw)) !== null) {
    cleaned += raw.slice(lastIndex, match.index);
    if (match[1]) {
      reasoningParts.push(match[1]);
    }
    lastIndex = match.index + match[0].length;
  }
  const remainder = raw.slice(lastIndex);
  const openMatch = remainder.match(/<think(?:\s[^>]*)?>([\s\S]*)$/i);
  if (openMatch) {
    cleaned += remainder.slice(0, openMatch.index);
    if (openMatch[1]) {
      reasoningParts.push(openMatch[1]);
    }
  } else {
    cleaned += remainder;
  }
  const reasoning = reasoningParts
    .map((part) => (typeof part === 'string' ? part.trim() : String(part || '').trim()))
    .filter(Boolean)
    .join('\n\n');
  return { content: cleaned, reasoning };
}

export function AssistantTurnCard({ messages, streaming }) {
  const list = useMemo(() => (Array.isArray(messages) ? messages.filter(Boolean) : []), [messages]);
  const [copying, setCopying] = useState(false);
  const createdAt = useMemo(() => {
    const first = list.find((m) => m?.createdAt);
    return first?.createdAt || '';
  }, [list]);
  const timeText = useMemo(() => (createdAt ? formatTime(createdAt) : ''), [createdAt]);

  const blocks = useMemo(() => {
    const out = [];
    const toolResultsByCallId = new Map();

    list.forEach((msg) => {
      if (msg?.role !== 'tool') return;
      const callId = normalizeId(msg?.toolCallId);
      if (!callId) return;
      const existing = toolResultsByCallId.get(callId);
      if (existing) {
        existing.push(msg);
      } else {
        toolResultsByCallId.set(callId, [msg]);
      }
    });

    const consumedToolMessageIds = new Set();

    list.forEach((msg, msgIdx) => {
      if (!msg) return;

      if (msg.role === 'assistant') {
        const reasoning =
          typeof msg?.reasoning === 'string' ? msg.reasoning : String(msg?.reasoning || '');
        const contentRaw = typeof msg?.content === 'string' ? msg.content : String(msg?.content || '');
        const extracted = extractThinkContent(contentRaw);
        const combinedReasoning = [reasoning, extracted.reasoning]
          .map((part) => (typeof part === 'string' ? part.trim() : String(part || '').trim()))
          .filter(Boolean)
          .join('\n\n');
        if (combinedReasoning) {
          out.push({
            type: 'assistant_reasoning',
            key: `${normalizeId(msg?.id) || `assistant_${msgIdx}`}_reasoning`,
            content: combinedReasoning,
          });
        }

        const content = extracted.content;
        if (content.trim()) {
          out.push({
            type: 'assistant',
            key: normalizeId(msg?.id) || `assistant_${msgIdx}`,
            content,
          });
        }

        const calls = Array.isArray(msg?.toolCalls) ? msg.toolCalls.filter(Boolean) : [];
        if (calls.length > 0) {
          const invocations = calls.map((call, idx) => {
            const callId = normalizeId(call?.id);
            const results = callId ? toolResultsByCallId.get(callId) || [] : [];
            results.forEach((res) => {
              const mid = normalizeId(res?.id);
              if (mid) consumedToolMessageIds.add(mid);
            });

            const nameFromCall = getToolName(call);
            const nameFromResult =
              results.length > 0 && typeof results?.[0]?.toolName === 'string'
                ? results[0].toolName.trim()
                : '';
            const name = nameFromCall || nameFromResult || 'tool';

            return {
              callId,
              name,
              args: getToolArgs(call),
              resultText: getToolResultText(results),
              key: callId || `${normalizeId(msg?.id) || `assistant_${msgIdx}`}_${name}_${idx}`,
            };
          });

          out.push({
            type: 'tool_invocations',
            key: `${normalizeId(msg?.id) || `assistant_${msgIdx}`}_tool_invocations`,
            invocations,
            assistantId: normalizeId(msg?.id),
          });
        }

        return;
      }

      if (msg.role === 'tool') {
        const mid = normalizeId(msg?.id);
        if (mid && consumedToolMessageIds.has(mid)) {
          return;
        }
        const last = out[out.length - 1];
        if (last && last.type === 'tool_orphans') {
          last.results.push(msg);
          return;
        }
        out.push({ type: 'tool_orphans', key: mid || `tool_${msgIdx}`, results: [msg] });
      }
    });

    return out;
  }, [list]);

  const hasBlocks = blocks.length > 0;
  const isStreaming = Boolean(
    streaming?.messageId &&
      list.some((m) => normalizeId(m?.id) === normalizeId(streaming.messageId))
  );

  const copyText = useMemo(() => {
    const parts = blocks
      .filter((b) => b?.type === 'assistant')
      .map((b) => (typeof b?.content === 'string' ? b.content : String(b?.content || '')))
      .map((text) => text.trim())
      .filter(Boolean);
    return parts.join('\n\n');
  }, [blocks]);

  const onCopy = async () => {
    if (!copyText || copying) return;
    setCopying(true);
    try {
      await copyPlainText(copyText);
      message.success('已复制');
    } catch (err) {
      message.error(err?.message || '复制失败');
    } finally {
      setCopying(false);
    }
  };

  return (
    <div style={{ width: '100%', padding: '4px 0' }}>
      <Space size={8} wrap>
        <Tag color="green" style={{ marginRight: 0 }}>
          AI
        </Tag>
        {timeText ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {timeText}
          </Text>
        ) : null}
        {isStreaming ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            （输出中…）
          </Text>
        ) : null}
      </Space>

      <div style={{ marginTop: 6 }}>
        {hasBlocks ? (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {blocks.map((block) => {
              if (block.type === 'assistant') {
                return <MarkdownBlock key={block.key} text={block.content} alwaysExpanded container={false} copyable />;
              }

              if (block.type === 'assistant_reasoning') {
                const reasoningText =
                  typeof block?.content === 'string' ? block.content : String(block?.content || '');
                const previewRaw = reasoningText.trim().replace(/\s+/g, ' ').slice(0, 86);
                const preview =
                  previewRaw && reasoningText.trim().length > previewRaw.length ? `${previewRaw}…` : previewRaw;

                return (
                  <Collapse
                    key={block.key}
                    ghost
                    size="small"
                    items={[
                      {
                        key: 'reasoning',
                        label: (
                          <Space size={6} wrap>
                            <Tag color="gold" style={{ marginRight: 0 }}>
                              思考过程
                            </Tag>
                            {preview ? <Text type="secondary">{preview}</Text> : null}
                          </Space>
                        ),
                        children: (
                          <MarkdownBlock text={reasoningText} maxHeight={240} alwaysExpanded container={false} copyable />
                        ),
                      },
                    ]}
                  />
                );
              }

              if (block.type === 'tool_invocations') {
                return (
                  <Space key={block.key} size={[4, 4]} wrap>
                    {(Array.isArray(block.invocations) ? block.invocations : []).map((invocation, idx) => {
                      const name = invocation?.name || 'tool';
                      const callId = normalizeId(invocation?.callId);
                      const args = typeof invocation?.args === 'string' ? invocation.args : String(invocation?.args || '');
                      const resultText =
                        typeof invocation?.resultText === 'string'
                          ? invocation.resultText
                          : String(invocation?.resultText || '');
                      const key = invocation?.key || callId || `${block.assistantId || block.key}_${name}_${idx}`;
                      const title = `${name}${callId ? ` · ${callId}` : ''}`;

                      return (
                        <PopoverTag key={key} color={resultText ? 'purple' : 'gold'} text={name} title={title}>
                          <div>
                            {args ? (
                              <>
                                <Text type="secondary">参数</Text>
                                <pre style={{ margin: '6px 0 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                  {args}
                                </pre>
                              </>
                            ) : null}
                            <Text type="secondary">结果</Text>
                            {resultText ? (
                              <MarkdownBlock text={resultText} maxHeight={320} container={false} copyable />
                            ) : (
                              <Text type="secondary">（暂无结果）</Text>
                            )}
                          </div>
                        </PopoverTag>
                      );
                    })}
                  </Space>
                );
              }

              if (block.type === 'tool_orphans') {
                return (
                  <Space key={block.key} size={[4, 4]} wrap>
                    {(Array.isArray(block.results) ? block.results : []).map((result, idx) => {
                      const name = typeof result?.toolName === 'string' ? result.toolName.trim() : '';
                      const callId = normalizeId(result?.toolCallId);
                      const content = typeof result?.content === 'string' ? result.content : String(result?.content || '');
                      const key = normalizeId(result?.id) || `${name || 'tool'}_${callId || ''}_${idx}`;
                      const title = `${name || 'tool'}${callId ? ` · ${callId}` : ''}`;

                      return (
                        <PopoverTag key={key} color="purple" text={name || 'tool'} title={title}>
                          <div>
                            <Text type="secondary">结果</Text>
                            {content ? (
                              <MarkdownBlock text={content} maxHeight={320} alwaysExpanded container={false} copyable />
                            ) : (
                              <Text type="secondary">（空）</Text>
                            )}
                          </div>
                        </PopoverTag>
                      );
                    })}
                  </Space>
                );
              }

              return null;
            })}
          </Space>
        ) : (
          <Text type="secondary">（无内容）</Text>
        )}
      </div>

      {copyText ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
          <Button size="small" type="text" icon={<CopyOutlined />} onClick={onCopy} loading={copying}>
            复制全部
          </Button>
        </div>
      ) : null}
    </div>
  );
}
