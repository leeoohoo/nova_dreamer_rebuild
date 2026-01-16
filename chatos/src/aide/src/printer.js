import * as colors from './colors.js';
import { renderMarkdown } from './markdown.js';

const DEFAULT_TOOL_PREVIEW_LIMIT =
  Number(process.env.MODEL_CLI_TOOL_PREVIEW_LIMIT || '') || 6000;

export function createResponsePrinter(model, streamEnabled, options = {}) {
  let buffer = '';
  let reasoningBuffer = '';
  let reasoningStreamActive = false;
  let reasoningShownInStream = false;
  const streamShowRaw = process.env.MODEL_CLI_STREAM_RAW === '1';
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let spinnerIndex = 0;
  let previewInterval = null;
  let previewLineActive = false;
  const activeTools = new Map();
  let toolLineVisible = false;
  const toolPreviewLimit = DEFAULT_TOOL_PREVIEW_LIMIT;

  // Cool spinner for initial thinking/connecting state
  const coolSpinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const colorsList = [colors.cyan, colors.blue, colors.magenta];
  let coolSpinnerInterval = null;

  const startCoolSpinner = () => {
    if (!streamEnabled || streamShowRaw || coolSpinnerInterval || previewInterval || reasoningShownInStream) {
      return;
    }
    let frameIndex = 0;
    coolSpinnerInterval = setInterval(() => {
      const frame = coolSpinnerFrames[frameIndex % coolSpinnerFrames.length];
      const colorFn = colorsList[Math.floor(frameIndex / 3) % colorsList.length];
      const text = colorFn(` ${frame} AI 正在思考... (按 ESC 取消)`);
      process.stdout.write(`\r\x1b[K${text}`);
      frameIndex++;
    }, 80);
  };

  const stopCoolSpinner = () => {
    if (coolSpinnerInterval) {
      clearInterval(coolSpinnerInterval);
      coolSpinnerInterval = null;
      process.stdout.write('\r\x1b[K'); // Clear line
    }
  };

  const formatActiveTools = () => {
    if (activeTools.size === 0) return '';
    const entries = Array.from(activeTools.entries()).map(([tool, count]) =>
      `${tool}${count > 1 ? `×${count}` : ''}`
    );
    return entries.join(', ');
  };
  const clearToolLine = () => {
    if (!streamEnabled || !toolLineVisible) {
      return;
    }
    process.stdout.write('\r\x1b[K');
    toolLineVisible = false;
  };
  const updateToolStatus = () => {
    if (!streamEnabled) return;
    const summary = formatActiveTools();
    if (!summary) {
      clearToolLine();
      return;
    }
    const line = colors.dim(`[tools] ${summary} … (/tool 查看详情)`);
    process.stdout.write(`\r\x1b[K${line}`);
    toolLineVisible = true;
  };
  const noteToolStart = (tool) => {
    activeTools.set(tool, (activeTools.get(tool) || 0) + 1);
    updateToolStatus();
  };
  const noteToolDone = (tool) => {
    if (!activeTools.has(tool)) return;
    const next = activeTools.get(tool) - 1;
    if (next > 0) {
      activeTools.set(tool, next);
    } else {
      activeTools.delete(tool);
    }
    updateToolStatus();
  };
  if (streamEnabled) {
    console.log(colors.magenta(`\n[${model}]`));
    startCoolSpinner(); // Start cool spinner immediately
  }
  const registerToolResult =
    typeof options.registerToolResult === 'function' ? options.registerToolResult : null;
  const ensureReasoningClosed = () => {
    stopCoolSpinner();
    stopPreviewLine();
    if (streamEnabled && reasoningStreamActive) {
      process.stdout.write('\n');
      reasoningStreamActive = false;
    }
  };
  const startPreviewLine = () => {
    stopCoolSpinner(); // Ensure cool spinner is off when preview starts
    if (!streamEnabled || streamShowRaw || previewInterval) {
      return;
    }
    previewInterval = setInterval(() => {
      const frame = spinnerFrames[spinnerIndex % spinnerFrames.length];
      spinnerIndex += 1;
      const previewText = buffer.slice(-80).replace(/\s+/g, ' ');
      const line = colors.dim(`[${frame}] ${previewText || '流式接收中…'}`);
      process.stdout.write(`\r\x1b[K${line}`);
      previewLineActive = true;
    }, 150);
  };
  const stopPreviewLine = () => {
    if (previewInterval) {
      clearInterval(previewInterval);
      previewInterval = null;
    }
    if (previewLineActive) {
      process.stdout.write('\r\x1b[K');
      previewLineActive = false;
    }
  };
  const printReasoningBlock = () => {
    if (!reasoningBuffer) {
      return;
    }
    console.log(colors.dim('\n[thinking]'));
    console.log(colors.dim(reasoningBuffer));
    console.log('');
  };
  const printToolInfo = (text) => {
    if (streamEnabled) {
      stopCoolSpinner();
      ensureReasoningClosed();
      clearToolLine();
    }
    console.log(text);
    updateToolStatus();
  };
  return {
    onToken: (chunk) => {
      if (!chunk) return;
      stopCoolSpinner(); // Stop spinner on first token
      buffer += chunk;
      if (streamEnabled) {
        if (reasoningStreamActive) {
          ensureReasoningClosed();
        }
        if (streamShowRaw) {
          process.stdout.write(chunk);
        } else {
          startPreviewLine();
        }
      }
    },
    onReasoning: (chunk) => {
      if (!chunk) return;
      stopCoolSpinner();
      reasoningBuffer += chunk;
      if (streamEnabled) {
        stopPreviewLine();
        reasoningShownInStream = true;
        if (!reasoningStreamActive) {
          reasoningStreamActive = true;
          process.stdout.write(colors.dim('\n[thinking]\n'));
        }
        process.stdout.write(colors.dim(chunk));
      }
    },
    onToolCall: ({ tool, args }) => {
      stopCoolSpinner(); // Stop spinner when tool starts
      stopPreviewLine();
      if (streamEnabled && reasoningStreamActive) {
        ensureReasoningClosed();
      }
      const writePreview = formatFileWritePreview(tool, args, toolPreviewLimit);
      if (writePreview) {
        printToolInfo(writePreview);
      }
      noteToolStart(tool);
    },
    onToolResult: ({ tool, result }) => {
      const normalized = formatToolResult(result);
      let storedContent = normalized;
      let hint = colors.dim('执行完成，使用 /tool 查看输出。');
      if (shouldHideToolResult(tool)) {
        const summary = formatHiddenToolSummary(normalized);
        storedContent = summary.historyText;
        hint = colors.dim(summary.preview);
      }
      const entryId = registerToolResult ? registerToolResult(tool, storedContent) : null;
      const label = colors.green(`↳ ${tool}`);
      const suffix = entryId ? `${hint} ${colors.dim(`(/tool ${entryId})`)}` : hint;
      printToolInfo(`${label} ${suffix}`);
      noteToolDone(tool);
    },
    onAbort: () => {
      stopCoolSpinner();
      stopPreviewLine();
      if (streamEnabled) {
        ensureReasoningClosed();
        clearToolLine();
        process.stdout.write('\r\x1b[K');
      }
    },
    onComplete: (finalText) => {
      stopCoolSpinner();
      stopPreviewLine();
      if (streamEnabled) {
        ensureReasoningClosed();
        clearToolLine();
        const formattedSource = finalText || buffer;
        if (formattedSource) {
          console.log(renderMarkdown(formattedSource));
          console.log('');
        }
      }
      if (reasoningBuffer && (!streamEnabled || !reasoningShownInStream)) {
        printReasoningBlock();
      }
      if (streamEnabled) {
        if (!buffer && !finalText) {
          process.stdout.write(colors.dim('[no text]'));
        }
        process.stdout.write('\n');
      } else {
        const output = finalText || buffer || colors.dim('[no text]');
        printResponse(model, output);
      }
    },
  };
}

function printResponse(model, text) {
  const border = '-'.repeat(Math.min(60, Math.max(10, model.length + 4)));
  const formatted = renderMarkdown(text || '');
  console.log(`\n${colors.magenta(`[${model}]`)}\n${border}\n${formatted}\n`);
}

function formatToolResult(result) {
  if (typeof result === 'string') {
    return result;
  }
  if (result === null || result === undefined) {
    return '';
  }
  if (typeof result === 'object') {
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }
  return String(result);
}

function shouldHideToolResult(toolName) {
  if (!toolName) {
    return false;
  }
  const normalized = String(toolName).toLowerCase();
  return /(^|_)search(_|$)/.test(normalized);
}

function formatHiddenToolSummary(originalText) {
  const files = extractSearchFiles(originalText);
  if (files.length === 0) {
    const message = '搜索命中内容已隐藏（未识别到具体文件）。';
    return {
      preview: message,
      historyText: `${message}\n原始搜索结果未在终端显示。`,
    };
  }
  const formatted = files.map((file) => `  - ${file}`).join('\n');
  const preview = `搜索命中内容已隐藏，仅记录涉及文件：\n${formatted}`;
  return {
    preview,
    historyText: `${preview}\n原始搜索结果未在终端显示。`,
  };
}

function extractSearchFiles(text) {
  if (!text) {
    return [];
  }
  const seen = new Set();
  const lines = text.split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('[')) {
      return;
    }
    const match = trimmed.match(/^([^:\s][^:]*)\s*:(\d+)/);
    if (match && match[1]) {
      const file = match[1].trim();
      if (file && !seen.has(file)) {
        seen.add(file);
      }
    }
  });
  return Array.from(seen);
}

function formatFileWritePreview(toolName, args = {}, limit = DEFAULT_TOOL_PREVIEW_LIMIT) {
  if (!isFileWriteTool(toolName)) {
    return null;
  }
  const safeArgs = args && typeof args === 'object' ? args : {};
  const targetPath = safeArgs.path ? String(safeArgs.path) : '';
  const label = colors.green(`↳ ${toolName}`);
  const lines = [];
  if (isApplyPatchTool(toolName)) {
    const patchText = decodePatchPayload(safeArgs);
    const { text, truncated, omitted, originalLength } = truncateForPreview(patchText, limit);
    const metaParts = [];
    if (targetPath) metaParts.push(targetPath);
    if (originalLength) metaParts.push(`${originalLength} chars`);
    lines.push(`${label} ${colors.dim(metaParts.join(' · ') || 'apply_patch')}`);
    if (text) {
      lines.push(renderMarkdown(ensureCodeFence(text, 'diff')));
    }
    if (truncated) {
      lines.push(colors.dim(`(预览已截断 ${omitted} chars，完整补丁仍会执行)`));
    }
    return lines.join('\n');
  }
  if (isEditFileTool(toolName)) {
    const oldString = safeArgs.old_string ? String(safeArgs.old_string) : '';
    const newString = safeArgs.new_string ? String(safeArgs.new_string) : '';
    const expected = safeArgs.expected_replacements ? String(safeArgs.expected_replacements) : '';
    const metaParts = [];
    if (targetPath) metaParts.push(targetPath);
    if (expected) metaParts.push(`expected=${expected}`);
    lines.push(`${label} ${colors.dim(metaParts.join(' · ') || 'edit_file')}`);

    const lang = guessLanguageFromPath(targetPath);
    const perBlockLimit = Math.max(200, Math.floor(limit / 2));

    if (oldString) {
      const { text, truncated, omitted } = truncateForPreview(oldString, perBlockLimit);
      lines.push(colors.dim('--- old_string ---'));
      lines.push(renderMarkdown(ensureCodeFence(text, lang)));
      if (truncated) {
        lines.push(colors.dim(`(old_string 预览已截断 ${omitted} chars)`));
      }
    } else {
      lines.push(colors.dim('--- old_string ---'));
      lines.push(colors.dim('<empty> (create file)'));
    }

    if (newString) {
      const { text, truncated, omitted } = truncateForPreview(newString, perBlockLimit);
      lines.push(colors.dim('--- new_string ---'));
      lines.push(renderMarkdown(ensureCodeFence(text, lang)));
      if (truncated) {
        lines.push(colors.dim(`(new_string 预览已截断 ${omitted} chars)`));
      }
    } else {
      lines.push(colors.dim('--- new_string ---'));
      lines.push(colors.dim('<empty>'));
    }

    return lines.join('\n');
  }
  const payload = decodeWritePayload(safeArgs);
  const { text, truncated, omitted, originalLength } = truncateForPreview(payload, limit);
  const mode = safeArgs.mode ? String(safeArgs.mode) : 'overwrite';
  const metaParts = [];
  if (targetPath) metaParts.push(targetPath);
  metaParts.push(mode);
  if (text || originalLength) {
    const displayLength =
      text && originalLength && text.length !== originalLength
        ? `${text.length}/${originalLength} chars`
        : `${text ? text.length : originalLength} chars`;
    metaParts.push(displayLength);
  }
  lines.push(`${label} ${colors.dim(metaParts.filter(Boolean).join(' · '))}`);
  if (text) {
    const lang = guessLanguageFromPath(targetPath);
    lines.push(renderMarkdown(ensureCodeFence(text, lang)));
  }
  if (truncated) {
    lines.push(colors.dim(`(预览已截断 ${omitted} chars，完整内容已写入文件)`));
  }
  return lines.join('\n');
}

function isFileWriteTool(toolName) {
  if (!toolName) return false;
  const normalized = String(toolName).toLowerCase();
  return normalized.includes('write_file') || normalized.includes('apply_patch') || normalized.includes('edit_file');
}

function isApplyPatchTool(toolName) {
  if (!toolName) return false;
  return String(toolName).toLowerCase().includes('apply_patch');
}

function isEditFileTool(toolName) {
  if (!toolName) return false;
  return String(toolName).toLowerCase().includes('edit_file');
}

function decodeWritePayload(args = {}) {
  const encoding = args.encoding || 'plain';
  if (typeof args.contents_base64 === 'string' && args.contents_base64.length > 0) {
    return decodeWithEncoding(args.contents_base64, 'base64');
  }
  if (Array.isArray(args.chunks) && args.chunks.length > 0) {
    return args.chunks
      .map((chunk) => decodeWithEncoding(chunk?.content || '', chunk?.encoding || encoding))
      .join('');
  }
  if (typeof args.contents === 'string') {
    return decodeWithEncoding(args.contents, encoding);
  }
  return '';
}

function decodePatchPayload(args = {}) {
  const encoding = args.encoding || 'plain';
  if (typeof args.patch_base64 === 'string' && args.patch_base64.length > 0) {
    return decodeWithEncoding(args.patch_base64, 'base64');
  }
  if (Array.isArray(args.chunks) && args.chunks.length > 0) {
    return args.chunks
      .map((chunk) => decodeWithEncoding(chunk?.content || '', chunk?.encoding || encoding))
      .join('');
  }
  if (typeof args.patch === 'string') {
    return decodeWithEncoding(args.patch, encoding);
  }
  return '';
}

function decodeWithEncoding(value, encoding = 'plain') {
  const text = value === undefined || value === null ? '' : String(value);
  if (String(encoding).toLowerCase() === 'base64') {
    try {
      return Buffer.from(text, 'base64').toString('utf8');
    } catch {
      return text;
    }
  }
  return text;
}

function truncateForPreview(rawText, limit = DEFAULT_TOOL_PREVIEW_LIMIT) {
  const text = typeof rawText === 'string' ? rawText : '';
  const originalLength = text.length;
  const max = Number.isFinite(limit) && limit > 0 ? limit : null;
  if (!max || originalLength <= max) {
    return { text, truncated: false, omitted: 0, originalLength };
  }
  return {
    text: text.slice(0, max),
    truncated: true,
    omitted: originalLength - max,
    originalLength,
  };
}

function ensureCodeFence(content, language = '') {
  if (!content) return '';
  const trimmed = content.trimEnd();
  if (/```/.test(trimmed)) {
    return trimmed;
  }
  const lang = language ? language.trim() : '';
  return ['```' + lang, trimmed, '```'].join('\n');
}

function guessLanguageFromPath(pathValue = '') {
  if (!pathValue) return '';
  const match = String(pathValue).match(/\.([^.\\/]+)$/);
  const ext = match ? match[1].toLowerCase() : '';
  const map = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    tsx: 'tsx',
    jsx: 'jsx',
    json: 'json',
    md: 'markdown',
    markdown: 'markdown',
    yml: 'yaml',
    yaml: 'yaml',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    htm: 'html',
    vue: 'vue',
    svelte: 'svelte',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    php: 'php',
    cs: 'csharp',
    cpp: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    c: 'c',
    h: 'c',
    sql: 'sql',
    toml: 'toml',
    ini: 'ini',
    env: 'bash',
  };
  return map[ext] || '';
}
