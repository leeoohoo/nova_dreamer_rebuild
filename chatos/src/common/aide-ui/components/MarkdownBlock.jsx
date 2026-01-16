import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Space, Typography, message } from 'antd';
import mermaid from 'mermaid';
import { CopyOutlined } from '@ant-design/icons';

import { CodeBlock } from './CodeBlock.jsx';
import { copyPlainText } from '../lib/clipboard.js';

const { Text } = Typography;

let mermaidInitialized = false;
let mermaidTheme = '';

let cachedDocumentTheme = null;
let documentThemeObserver = null;
const documentThemeListeners = new Set();

function getDocumentTheme() {
  if (typeof document === 'undefined') return 'light';
  return document?.documentElement?.dataset?.theme || 'light';
}

function ensureDocumentThemeObserver() {
  if (documentThemeObserver) return;
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root) return;
  cachedDocumentTheme = getDocumentTheme();
  documentThemeObserver = new MutationObserver(() => {
    const next = getDocumentTheme();
    if (next === cachedDocumentTheme) return;
    cachedDocumentTheme = next;
    documentThemeListeners.forEach((listener) => {
      try {
        listener(next);
      } catch {
        // ignore listener errors
      }
    });
  });
  documentThemeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
}

function useDocumentTheme() {
  const [theme, setTheme] = useState(() => cachedDocumentTheme || getDocumentTheme());
  useEffect(() => {
    ensureDocumentThemeObserver();
    documentThemeListeners.add(setTheme);
    return () => {
      documentThemeListeners.delete(setTheme);
    };
  }, []);
  return theme || 'light';
}

function ensureMermaid(theme) {
  const normalized = theme === 'dark' ? 'dark' : 'light';
  if (mermaidInitialized && mermaidTheme === normalized) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: normalized === 'dark' ? 'dark' : 'default',
    themeVariables: {
      background: 'transparent',
    },
  });
  mermaidInitialized = true;
  mermaidTheme = normalized;
}

const MERMAID_KEYWORDS = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'mindmap',
  'timeline',
  'quadrantChart',
  'gitGraph',
  'requirementDiagram',
];

const MERMAID_START_RE = new RegExp(`\\b(${MERMAID_KEYWORDS.join('|')})\\b`, 'i');
const MERMAID_FIRST_LINE_RE = new RegExp(`^\\s*(${MERMAID_KEYWORDS.join('|')})\\b`, 'i');

function looksLikeMermaid(text) {
  const raw = String(text ?? '');
  if (!raw.trim()) return false;
  const lines = raw.split('\n').filter((line) => line.trim());
  const firstLine = lines[0] || '';
  if (!MERMAID_FIRST_LINE_RE.test(firstLine)) return false;
  if (lines.length > 1) return true;
  return /-->|->>|-->>|==>|<--|<->|\bclass\b|:\s*\w+/.test(raw);
}

function normalizeMermaidSource(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').trim();
}

function MermaidDiagram({ text }) {
  const theme = useDocumentTheme();
  const idRef = useRef('');
  if (!idRef.current) {
    idRef.current = `mermaid_${Math.random().toString(36).slice(2)}`;
  }
  const source = useMemo(() => normalizeMermaidSource(text), [text]);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    if (!source) {
      setSvg('');
      setError('');
      setRendering(false);
      return;
    }
    let cancelled = false;
    setRendering(true);
    setError('');

    (async () => {
      try {
        ensureMermaid(theme);
        const result = await mermaid.render(idRef.current, source);
        const svgText = typeof result === 'string' ? result : result?.svg;
        if (!cancelled) setSvg(svgText || '');
      } catch (err) {
        if (!cancelled) setError(err?.message || String(err));
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, theme]);

  if (error) {
    return (
      <div style={{ margin: '8px 0' }}>
        <Text type="secondary">Mermaid 渲染失败：{error}</Text>
        <div style={{ marginTop: 8 }}>
          <CodeBlock
            text={source}
            maxHeight={320}
            highlight
            language="mermaid"
            wrap={false}
            showLineNumbers
            disableScroll
          />
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        margin: '8px 0',
        overflowX: 'auto',
        border: '1px solid var(--ds-panel-border)',
        borderRadius: 10,
        padding: '10px 12px',
        background: 'var(--ds-subtle-bg)',
      }}
    >
      {svg ? (
        <div style={{ minWidth: 'max-content' }} dangerouslySetInnerHTML={{ __html: svg }} />
      ) : rendering ? (
        <Text type="secondary">渲染中…</Text>
      ) : (
        <Text type="secondary">（无内容）</Text>
      )}
    </div>
  );
}

function splitMermaidParagraph(lines) {
  const list = Array.isArray(lines) ? lines : [];
  for (let idx = 0; idx < list.length; idx += 1) {
    const line = String(list[idx] ?? '');
    const match = MERMAID_START_RE.exec(line);
    if (!match) continue;
    const col = match.index;
    const beforeLines = list.slice(0, idx);
    const prefix = line.slice(0, col).trim();
    const firstMermaidLine = line.slice(col).trim();
    const mermaidLines = [firstMermaidLine, ...list.slice(idx + 1)];
    const mermaidText = mermaidLines.join('\n').trim();
    if (!looksLikeMermaid(mermaidText)) return null;
    const blocks = [];
    const beforeText = beforeLines.join('\n').trim();
    if (beforeText) blocks.push({ type: 'p', text: beforeText });
    if (prefix) blocks.push({ type: 'p', text: prefix });
    blocks.push({ type: 'mermaid', text: mermaidText });
    return blocks;
  }
  return null;
}

function splitTableRow(line) {
  const raw = typeof line === 'string' ? line : String(line ?? '');
  let text = raw.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|')) text = text.slice(0, -1);

  const cells = [];
  let current = '';
  let inCode = false;
  let codeDelimiter = '';

  for (let i = 0; i < text.length; ) {
    const ch = text[i];

    if (ch === '\\') {
      if (i + 1 < text.length && text[i + 1] === '|') {
        current += '|';
        i += 2;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }

    if (ch === '`') {
      let j = i + 1;
      while (j < text.length && text[j] === '`') j += 1;
      const ticks = text.slice(i, j);
      if (!inCode) {
        inCode = true;
        codeDelimiter = ticks;
      } else if (ticks === codeDelimiter) {
        inCode = false;
        codeDelimiter = '';
      }
      current += ticks;
      i = j;
      continue;
    }

    if (ch === '|' && !inCode) {
      cells.push(current.trim());
      current = '';
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  cells.push(current.trim());
  return cells;
}

function parseMarkdownBlocks(input) {
  const text = String(input ?? '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const blocks = [];

  const isFence = (line) => line.trim().startsWith('```');
  const fenceLang = (line) => line.trim().slice(3).trim();
  const isHeading = (line) => /^#{1,6}\s+/.test(line.trim());
  const headingLevel = (line) => line.trim().match(/^#+/)[0].length;
  const headingText = (line) => line.trim().replace(/^#{1,6}\s+/, '');
  const isQuote = (line) => /^\s*>/.test(line);
  const stripQuote = (line) => line.replace(/^\s*>\s?/, '');
  const isUnordered = (line) => /^\s*[-*+]\s+/.test(line);
  const stripUnordered = (line) => line.replace(/^\s*[-*+]\s+/, '');
  const isOrdered = (line) => /^\s*\d+\.\s+/.test(line);
  const stripOrdered = (line) => line.replace(/^\s*\d+\.\s+/, '');
  const isHr = (line) => /^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(line.trim());

  const isTableDelimiterCell = (cell) => /^:?-{3,}:?$/.test(String(cell || '').trim());
  const isTableDelimiterLine = (line) => {
    const raw = typeof line === 'string' ? line : '';
    if (!raw.includes('|')) return false;
    const cells = splitTableRow(raw);
    if (cells.length < 2) return false;
    return cells.every(isTableDelimiterCell);
  };
  const isTableStartAt = (idx) => {
    if (!Number.isInteger(idx) || idx < 0) return false;
    if (idx + 1 >= lines.length) return false;
    const headerLine = lines[idx];
    const delimiterLine = lines[idx + 1];
    if (!headerLine || !delimiterLine) return false;
    if (!headerLine.includes('|')) return false;
    if (!isTableDelimiterLine(delimiterLine)) return false;
    const headerCells = splitTableRow(headerLine);
    const delimiterCells = splitTableRow(delimiterLine);
    if (headerCells.length < 2 || delimiterCells.length < 2) return false;
    return true;
  };

  const isSpecialAt = (idx) => {
    const line = lines[idx];
    return (
      isFence(line) ||
      isHeading(line) ||
      isQuote(line) ||
      isUnordered(line) ||
      isOrdered(line) ||
      isTableStartAt(idx) ||
      isHr(line)
    );
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (isFence(line)) {
      const language = fenceLang(line);
      const codeLines = [];
      i += 1;
      while (i < lines.length && !isFence(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && isFence(lines[i])) i += 1;
      blocks.push({ type: 'code', language, text: codeLines.join('\n') });
      continue;
    }

    if (isHeading(line)) {
      blocks.push({ type: 'heading', level: headingLevel(line), text: headingText(line) });
      i += 1;
      continue;
    }

    if (isQuote(line)) {
      const quoteLines = [];
      while (i < lines.length && isQuote(lines[i])) {
        quoteLines.push(stripQuote(lines[i]));
        i += 1;
      }
      blocks.push({ type: 'blockquote', text: quoteLines.join('\n') });
      continue;
    }

    if (isUnordered(line)) {
      const items = [];
      while (i < lines.length && isUnordered(lines[i])) {
        items.push(stripUnordered(lines[i]));
        i += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    if (isOrdered(line)) {
      const items = [];
      while (i < lines.length && isOrdered(lines[i])) {
        items.push(stripOrdered(lines[i]));
        i += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    if (isTableStartAt(i)) {
      const headerCells = splitTableRow(lines[i]);
      const delimiterCells = splitTableRow(lines[i + 1]);
      const columnCount = Math.max(headerCells.length, delimiterCells.length);
      const normalizeRow = (cells) => {
        const list = Array.isArray(cells) ? cells : [];
        if (list.length > columnCount) {
          const prefix = list.slice(0, Math.max(0, columnCount - 1));
          const tail = list.slice(Math.max(0, columnCount - 1)).join(' | ');
          return [...prefix, tail];
        }
        if (list.length < columnCount) {
          return [...list, ...Array(columnCount - list.length).fill('')];
        }
        return list;
      };
      const header = normalizeRow(headerCells);
      const alignments = normalizeRow(delimiterCells).map((cell) => {
        const t = String(cell || '').trim();
        const starts = t.startsWith(':');
        const ends = t.endsWith(':');
        if (starts && ends) return 'center';
        if (ends) return 'right';
        return 'left';
      });

      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim()) {
        const rowLine = lines[i];
        if (!rowLine.includes('|')) break;
        if (isTableStartAt(i)) break;
        rows.push(normalizeRow(splitTableRow(rowLine)));
        i += 1;
      }
      blocks.push({ type: 'table', header, alignments, rows });
      continue;
    }

    if (isHr(line)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const paragraph = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !isSpecialAt(i)) {
      paragraph.push(lines[i]);
      i += 1;
    }
    const mermaidBlocks = splitMermaidParagraph(paragraph);
    if (mermaidBlocks) {
      mermaidBlocks.forEach((blk) => blocks.push(blk));
    } else {
      blocks.push({ type: 'p', text: paragraph.join('\n') });
    }
  }

  return blocks;
}

function splitInlineByCode(text) {
  const raw = String(text ?? '');
  const out = [];
  const re = /`([^`]+)`/g;
  let last = 0;
  let match;
  while ((match = re.exec(raw))) {
    if (match.index > last) out.push({ type: 'text', value: raw.slice(last, match.index) });
    out.push({ type: 'code', value: match[1] });
    last = match.index + match[0].length;
  }
  if (last < raw.length) out.push({ type: 'text', value: raw.slice(last) });
  return out;
}

function splitInlineByLinks(text) {
  const raw = String(text ?? '');
  const out = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let match;
  while ((match = re.exec(raw))) {
    if (match.index > last) out.push({ type: 'text', value: raw.slice(last, match.index) });
    out.push({ type: 'link', label: match[1], href: match[2] });
    last = match.index + match[0].length;
  }
  if (last < raw.length) out.push({ type: 'text', value: raw.slice(last) });
  return out;
}

function splitInlineByStrong(text) {
  const raw = String(text ?? '');
  const out = [];
  const re = /\*\*([\s\S]+?)\*\*/g;
  let last = 0;
  let match;
  while ((match = re.exec(raw))) {
    if (match.index > last) out.push({ type: 'text', value: raw.slice(last, match.index) });
    out.push({ type: 'strong', value: match[1] });
    last = match.index + match[0].length;
  }
  if (last < raw.length) out.push({ type: 'text', value: raw.slice(last) });
  return out;
}

function splitInlineByStrike(text) {
  const raw = String(text ?? '');
  const out = [];
  const re = /~~([\s\S]+?)~~/g;
  let last = 0;
  let match;
  while ((match = re.exec(raw))) {
    if (match.index > last) out.push({ type: 'text', value: raw.slice(last, match.index) });
    out.push({ type: 'del', value: match[1] });
    last = match.index + match[0].length;
  }
  if (last < raw.length) out.push({ type: 'text', value: raw.slice(last) });
  return out;
}

function splitInlineByEm(text) {
  const raw = String(text ?? '');
  const out = [];
  const re = /\*([^*]+?)\*/g;
  let last = 0;
  let match;
  while ((match = re.exec(raw))) {
    if (match.index > last) out.push({ type: 'text', value: raw.slice(last, match.index) });
    out.push({ type: 'em', value: match[1] });
    last = match.index + match[0].length;
  }
  if (last < raw.length) out.push({ type: 'text', value: raw.slice(last) });
  return out;
}

function renderInlineNodes(text) {
  const tokens = [];
  splitInlineByCode(text).forEach((segment) => {
    if (segment.type !== 'text') {
      tokens.push(segment);
      return;
    }
    splitInlineByLinks(segment.value).forEach((linkSeg) => {
      if (linkSeg.type !== 'text') {
        tokens.push(linkSeg);
        return;
      }
      splitInlineByStrong(linkSeg.value).forEach((strongSeg) => {
        if (strongSeg.type !== 'text') {
          tokens.push(strongSeg);
          return;
        }
        splitInlineByStrike(strongSeg.value).forEach((strikeSeg) => {
          if (strikeSeg.type !== 'text') {
            tokens.push(strikeSeg);
            return;
          }
          splitInlineByEm(strikeSeg.value).forEach((emSeg) => tokens.push(emSeg));
        });
      });
    });
  });

  return tokens.map((token, idx) => {
    if (token.type === 'code') {
      return (
        <code
          key={idx}
          style={{
            fontFamily: 'SFMono-Regular, Consolas, Menlo, monospace',
            fontSize: '0.95em',
            background: 'var(--ds-code-inline-bg)',
            border: '1px solid var(--ds-code-inline-border)',
            padding: '0 6px',
            borderRadius: 6,
          }}
        >
          {token.value}
        </code>
      );
    }
    if (token.type === 'strong') {
      return (
        <Text key={idx} strong>
          {token.value}
        </Text>
      );
    }
    if (token.type === 'del') {
      return (
        <Text key={idx} delete>
          {token.value}
        </Text>
      );
    }
    if (token.type === 'em') {
      return (
        <Text key={idx} italic>
          {token.value}
        </Text>
      );
    }
    if (token.type === 'link') {
      const href = String(token.href || '').trim();
      const safe =
        href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:');
      if (!safe) return <Text key={idx}>{token.label}</Text>;
      return (
        <a key={idx} href={href} target="_blank" rel="noreferrer">
          {token.label}
        </a>
      );
    }
    return <React.Fragment key={idx}>{token.value}</React.Fragment>;
  });
}

function renderInlineWithBreaks(text) {
  const lines = String(text ?? '').split('\n');
  return lines.map((line, idx) => (
    <React.Fragment key={idx}>
      {renderInlineNodes(line)}
      {idx < lines.length - 1 ? <br /> : null}
    </React.Fragment>
  ));
}

function renderBlockContent(block) {
  if (!block) return null;
  if (block.type === 'hr') {
    return (
      <hr
        style={{
          border: 'none',
          borderTop: '1px solid var(--ds-panel-border)',
          margin: '10px 0',
        }}
      />
    );
  }
  if (block.type === 'code') {
    const lang = block.language ? String(block.language).trim() : '';
    const normalized = lang.toLowerCase();
    if (normalized === 'mermaid' || normalized === 'mmd' || (!normalized && looksLikeMermaid(block.text))) {
      return <MermaidDiagram text={block.text} />;
    }
    const rawCode = typeof block.text === 'string' ? block.text : String(block.text ?? '');
    const hasLongLine = rawCode.split('\n').some((line) => line.length > 200);
    const wrapCode = hasLongLine;
    return (
      <CodeBlock
        text={block.text}
        maxHeight={320}
        highlight
        language={lang || undefined}
        wrap={wrapCode}
        showLineNumbers={!wrapCode}
        disableScroll
      />
    );
  }
  if (block.type === 'mermaid') {
    return <MermaidDiagram text={block.text} />;
  }
  if (block.type === 'heading') {
    const level = Math.min(Math.max(Number(block.level) || 1, 1), 6);
    const fontSize = level === 1 ? 16 : level === 2 ? 15 : level === 3 ? 14 : 13;
    return (
      <div style={{ fontWeight: 600, fontSize, margin: '6px 0 2px' }}>
        {renderInlineNodes(block.text)}
      </div>
    );
  }
  if (block.type === 'blockquote') {
    return (
      <div
        style={{
          borderLeft: '3px solid var(--ds-blockquote-border)',
          paddingLeft: 10,
          margin: '6px 0',
          color: 'var(--ds-blockquote-text)',
        }}
      >
        {renderInlineWithBreaks(block.text)}
      </div>
    );
  }
  if (block.type === 'ul' || block.type === 'ol') {
    const ListTag = block.type === 'ol' ? 'ol' : 'ul';
    return (
      <ListTag style={{ paddingLeft: 20, margin: '6px 0' }}>
        {(Array.isArray(block.items) ? block.items : []).map((item, itemIdx) => {
          const raw = typeof item === 'string' ? item : String(item ?? '');
          const taskMatch = raw.match(/^\[(x| )\]\s+/i);
          if (taskMatch) {
            const checked = String(taskMatch[1]).toLowerCase() === 'x';
            const rest = raw.replace(/^\[(x| )\]\s+/i, '');
            return (
              <li key={itemIdx} style={{ margin: '2px 0', listStyle: 'none' }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={checked} disabled style={{ marginTop: 3 }} />
                  <span>{renderInlineWithBreaks(rest)}</span>
                </label>
              </li>
            );
          }
          return (
            <li key={itemIdx} style={{ margin: '2px 0' }}>
              {renderInlineWithBreaks(raw)}
            </li>
          );
        })}
      </ListTag>
    );
  }
  if (block.type === 'p') {
    return (
      <div style={{ margin: '6px 0', lineHeight: '1.65' }}>
        {renderInlineWithBreaks(block.text)}
      </div>
    );
  }
  if (block.type === 'table') {
    const header = Array.isArray(block.header) ? block.header : [];
    const alignments = Array.isArray(block.alignments) ? block.alignments : [];
    const rows = Array.isArray(block.rows) ? block.rows : [];
    const columnCount = header.length;
    return (
      <div style={{ margin: '8px 0', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              {header.map((cell, colIdx) => (
                <th
                  key={colIdx}
                  style={{
                    textAlign: alignments[colIdx] || 'left',
                    fontWeight: 650,
                    padding: '8px 10px',
                    background: 'var(--ds-subtle-bg)',
                    borderBottom: '1px solid var(--ds-panel-border)',
                    borderRight: colIdx < columnCount - 1 ? '1px solid var(--ds-panel-border)' : undefined,
                    verticalAlign: 'top',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {renderInlineWithBreaks(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => {
              const cells = Array.isArray(row) ? row : [];
              return (
                <tr key={rowIdx}>
                  {cells.map((cell, colIdx) => (
                    <td
                      key={colIdx}
                      style={{
                        textAlign: alignments[colIdx] || 'left',
                        padding: '8px 10px',
                        borderBottom: '1px solid var(--ds-panel-border)',
                        borderRight: colIdx < columnCount - 1 ? '1px solid var(--ds-panel-border)' : undefined,
                        verticalAlign: 'top',
                        wordBreak: 'break-word',
                      }}
                    >
                      {renderInlineWithBreaks(cell)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  return null;
}

export function MarkdownBlock({ text, maxHeight = 260, alwaysExpanded = false, container = true, copyable = false }) {
  const [expanded, setExpanded] = useState(alwaysExpanded);
  useEffect(() => {
    setExpanded(alwaysExpanded);
  }, [alwaysExpanded]);

  if (text === null || text === undefined) return <Text type="secondary">无内容</Text>;
  const content = typeof text === 'string' ? text : String(text);
  const lineCount = content.split('\n').length;
  const tooLong = content.length > 1200 || lineCount > 26;
  const limited = !(alwaysExpanded || expanded);

  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);
  const panelStyle = container
    ? {
        background: 'var(--ds-panel-bg)',
        border: '1px solid var(--ds-panel-border)',
        borderRadius: 10,
        padding: '10px 12px',
      }
    : { background: 'transparent', border: 'none', borderRadius: 0, padding: 0 };

  const canCopy = copyable && Boolean(content.trim());

  const onCopy = async () => {
    if (!canCopy) return;
    try {
      await copyPlainText(content);
      message.success('已复制');
    } catch (err) {
      message.error(err?.message || '复制失败');
    }
  };

  return (
    <Space direction="vertical" size={4} style={{ width: '100%', minWidth: 0 }}>
      <div
        style={{
          ...panelStyle,
          maxHeight: limited ? maxHeight : undefined,
          overflowY: limited ? 'auto' : 'visible',
          overflowX: 'auto',
          maxWidth: '100%',
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
        }}
      >
        {blocks.length === 0
          ? <Text type="secondary">无内容</Text>
          : blocks.map((block, idx) => <React.Fragment key={idx}>{renderBlockContent(block)}</React.Fragment>)}
      </div>
      {canCopy || (tooLong && !alwaysExpanded) ? (
        <Space size={8} wrap style={{ width: '100%', justifyContent: 'flex-end' }}>
          {canCopy ? (
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={onCopy}
              title="复制"
              aria-label="复制"
            />
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
