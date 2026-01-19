import React, { useEffect, useMemo, useState } from 'react';
import hljs from 'highlight.js';
import { Button, Space, Typography, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';

import { copyPlainText } from '../lib/clipboard.js';

const { Text } = Typography;

const MAX_HIGHLIGHT_CHARS = 200_000;
const MAX_AUTO_DETECT_CHARS = 20_000;

function normalizeHighlightLanguage(language) {
  if (!language) return null;
  const value = String(language).trim().toLowerCase();
  if (!value) return null;
  if (value === 'text') return 'plaintext';
  if (value === 'shell') return 'bash';
  if (value === 'yml') return 'yaml';
  if (value === 'md') return 'markdown';
  return value;
}

function highlightToHtml(code, language) {
  const raw = String(code ?? '');
  const normalized = normalizeHighlightLanguage(language);
  try {
    if (normalized && hljs.getLanguage(normalized)) {
      return hljs.highlight(raw, { language: normalized, ignoreIllegals: true }).value;
    }
    if (raw.length <= MAX_AUTO_DETECT_CHARS) {
      return hljs.highlightAuto(raw).value;
    }
  } catch {
    // ignore highlight errors
  }
  return null;
}

export function CodeBlock({
  text,
  maxHeight = 200,
  alwaysExpanded = false,
  highlight = false,
  language,
  wrap = true,
  showLineNumbers = false,
  disableScroll = false,
  constrainHeight = false,
}) {
  const [expanded, setExpanded] = useState(alwaysExpanded);
  const [forceHighlight, setForceHighlight] = useState(false);
  const [copying, setCopying] = useState(false);
  useEffect(() => {
    setExpanded(alwaysExpanded);
  }, [alwaysExpanded]);
  useEffect(() => {
    if (!highlight) setForceHighlight(false);
  }, [highlight]);
  if (text === null || text === undefined) return <Text type="secondary">无更多详情</Text>;
  const content = typeof text === 'string' ? text : String(text);
  const lines = useMemo(() => content.split('\n'), [content]);
  const lineCount = lines.length;
  const hasLongLine = useMemo(() => lines.some((line) => line.length > 200), [lines]);
  const tooLong = content.length > 320 || lineCount > 8;
  const limited = !(alwaysExpanded || expanded);
  const highlightTooLarge = highlight && content.length > MAX_HIGHLIGHT_CHARS;
  const highlightEnabled = highlight && (!highlightTooLarge || forceHighlight);
  const highlightedHtml = useMemo(
    () => (highlightEnabled ? highlightToHtml(content, language) : null),
    [highlightEnabled, content, language]
  );
  const useHighlight = Boolean(highlightEnabled && highlightedHtml);
  const showFooterActions = true;

  const useLineNumbers = showLineNumbers && !hasLongLine;
  const shouldWrap = wrap || hasLongLine;
  const effectiveWrap = useLineNumbers ? false : shouldWrap;
  const heightConstrained = limited || constrainHeight;
  const overflowY = heightConstrained ? (disableScroll ? 'hidden' : 'auto') : 'visible';
  const wordBreak = effectiveWrap ? (hasLongLine ? 'break-all' : 'break-word') : 'normal';
  const preStyle = {
    margin: 0,
    background: 'var(--ds-code-bg)',
    border: '1px solid var(--ds-code-border)',
    borderRadius: 6,
    padding: '10px 12px',
    fontFamily: 'SFMono-Regular, Consolas, Menlo, monospace',
    fontSize: 12,
    lineHeight: '18px',
    color: 'var(--ds-code-text)',
    whiteSpace: effectiveWrap ? 'pre-wrap' : 'pre',
    wordBreak,
    overflowWrap: effectiveWrap ? 'anywhere' : 'normal',
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
    maxHeight: heightConstrained ? maxHeight : undefined,
    overflowY,
    overflowX: 'auto',
  };

  const lineNumberText = useMemo(() => {
    if (!useLineNumbers) return '';
    const count = Math.max(1, lineCount);
    const width = String(count).length;
    return Array.from({ length: count }, (_, idx) => String(idx + 1).padStart(width, ' ')).join('\n');
  }, [useLineNumbers, lineCount]);

  const onCopy = async () => {
    if (copying) return;
    setCopying(true);
    try {
      await copyPlainText(content);
      message.success('已复制');
    } catch (err) {
      message.error(err?.message || '复制失败');
    } finally {
      setCopying(false);
    }
  };

  return (
    <Space direction="vertical" size={4} style={{ width: '100%', minWidth: 0, maxWidth: '100%' }}>
      {useLineNumbers ? (
        <div
          style={{
            margin: 0,
            background: 'var(--ds-code-bg)',
            border: '1px solid var(--ds-code-border)',
            borderRadius: 6,
            fontFamily: 'SFMono-Regular, Consolas, Menlo, monospace',
            fontSize: 12,
            lineHeight: '18px',
            maxWidth: '100%',
            maxHeight: heightConstrained ? maxHeight : undefined,
            overflowY,
            overflowX: 'hidden',
            alignItems: 'flex-start',
            display: 'flex',
          }}
        >
          <div
            style={{
              padding: '10px 10px 10px 12px',
              color: 'var(--ds-code-line-number)',
              userSelect: 'none',
              borderRight: '1px solid var(--ds-code-border)',
              background: 'var(--ds-code-bg)',
              whiteSpace: 'pre',
              textAlign: 'right',
            }}
          >
            <pre style={{ margin: 0 }}>{lineNumberText}</pre>
          </div>
          <div style={{ flex: '1 1 auto', minWidth: 0, overflowX: 'auto', overflowY: 'hidden' }}>
            {useHighlight ? (
              <pre
                className="hljs"
                style={{
                  margin: 0,
                  padding: '10px 12px',
                  whiteSpace: 'pre',
                  wordBreak: 'normal',
                  display: 'inline-block',
                  minWidth: '100%',
                }}
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
            ) : (
              <pre
                style={{
                  margin: 0,
                  padding: '10px 12px',
                  whiteSpace: 'pre',
                  wordBreak: 'normal',
                  display: 'inline-block',
                  minWidth: '100%',
                  color: 'var(--ds-code-text)',
                }}
              >
                {content}
              </pre>
            )}
          </div>
        </div>
      ) : useHighlight ? (
        <pre className="hljs" style={preStyle} dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
      ) : (
        <pre style={preStyle}>{content}</pre>
      )}
      {showFooterActions ? (
        <Space size={8} wrap>
          <Button type="link" size="small" icon={<CopyOutlined />} onClick={onCopy} loading={copying}>
            复制代码
          </Button>
          {highlightTooLarge && highlight && !forceHighlight ? (
            <Button type="link" size="small" onClick={() => setForceHighlight(true)}>
              内容较大，启用高亮
            </Button>
          ) : null}
          {tooLong && !alwaysExpanded ? (
            <Button type="link" size="small" onClick={() => setExpanded(!expanded)}>
              {expanded ? '收起' : '展开全部'}
            </Button>
          ) : null}
        </Space>
      ) : null}
    </Space>
  );
}
