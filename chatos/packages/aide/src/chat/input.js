import readline from 'readline';
import * as colors from '../colors.js';

function createInputCollector(rl, options = {}) {
  if (!rl || typeof rl.on !== 'function') {
    throw new Error('createInputCollector expects a readline interface.');
  }
  const defaultPrompt = options.prompt || '';
  const contPrompt = options.contPrompt || defaultPrompt;
  const mergeDelayMs = Number.isFinite(options.mergeDelayMs) ? Number(options.mergeDelayMs) : 80;
  const settleRounds = Number.isFinite(options.settleRounds) ? Number(options.settleRounds) : 2;
  const keepAliveOnClose = options.keepAliveOnClose === true;
  const promptWidths = {
    first: visibleLength(defaultPrompt),
    cont: visibleLength(contPrompt),
  };
  const buffered = [];
  const waiters = [];
  let closed = false;
  let inputEnded = false;

  const takeBuffered = () => buffered.splice(0, buffered.length);
  const showPrompt = (promptText = defaultPrompt) => {
    if (inputEnded) return;
    try {
      rl.setPrompt(promptText);
      rl.prompt();
    } catch {
      // ignore prompt errors (stdin may be unavailable in UI-bridge mode)
    }
  };
  const nextLine = () =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error('Input closed'));
        return;
      }
      if (buffered.length > 0) {
        resolve(buffered.shift());
        return;
      }
      waiters.push((line) => {
        if (line === null) {
          reject(new Error('Input closed'));
        } else {
          resolve(line);
        }
      });
    });

  rl.on('line', (line) => {
    const normalized = typeof line === 'string' ? line : '';
    if (waiters.length > 0) {
      const resume = waiters.shift();
      resume(normalized);
    } else {
      buffered.push(normalized);
    }
  });
  rl.on('close', () => {
    inputEnded = true;
    if (keepAliveOnClose) {
      return;
    }
    closed = true;
    while (waiters.length > 0) {
      const resume = waiters.shift();
      resume(null);
    }
  });

  const ask = async (promptText) => {
    showPrompt(promptText);
    const line = await nextLine();
    return line.trim();
  };

  const readMessage = async () => {
    showPrompt(defaultPrompt);
    const lines = [];
    let multiline = false;
    let lastWasEmpty = false;
    while (true) {
      const line = await nextLine();
      lines.push(line);

      // 合并同一轮粘贴产生的额外行，避免逐行发送
      const extras = await drainWithDelay(takeBuffered, mergeDelayMs);
      if (extras.length > 0) {
        lines.push(...extras);
        multiline = true;
      }

      // 再等待几轮，避免粘贴行晚到导致被当成单行
      let followups = [];
      if (!multiline && lines.length === 1) {
        followups = await collectWithSettling(settleRounds, mergeDelayMs);
        if (followups.length > 0) {
          lines.push(...followups);
          multiline = true;
        }
      }

      // 单行输入：在等待窗口内未收到额外行，直接发送
      if (!multiline && lines.length === 1) {
        const text = line.trim();
        return {
          text,
          meta: {
            multiline: false,
            lineCount: 1,
            charCount: text.length,
          },
        };
      }

      multiline = multiline || lines.length > 1;
      if (multiline) {
        const pasteFinished = (extras.length > 0 || followups.length > 0) && buffered.length === 0;
        const endedByBlank = lastWasEmpty && line === '';
        if (pasteFinished || endedByBlank) {
          while (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop();
          }
          const merged = lines.join('\n').trim();
          const meta = {
            multiline: true,
            lineCount: lines.length,
            charCount: merged.length,
          };
          clearEcho(lines, promptWidths);
          return { text: merged, meta };
        }
        lastWasEmpty = line === '';
        showPrompt(contPrompt);
      }
    }
  };

  return { ask, readMessage };

  async function collectWithSettling(rounds, delayMs) {
    const collected = [];
    for (let i = 0; i < rounds; i += 1) {
      const chunk = await drainWithDelay(takeBuffered, delayMs);
      if (chunk.length > 0) {
        collected.push(...chunk);
        // 顺手清理可能积压的行，避免下一轮重复
        const immediate = takeBuffered();
        if (immediate.length > 0) {
          collected.push(...immediate);
        }
      } else if (collected.length === 0) {
        // 如果目前没收集到行，再试下一轮
        continue;
      }
    }
    return collected;
  }

function clearEcho(lines, widths) {
  if (!process.stdout.isTTY || !Array.isArray(lines) || lines.length === 0) {
    return;
  }
  const cols = Math.max(20, Number(process.stdout.columns) || 80);
  const totalRows = lines.reduce((sum, line, idx) => {
    const promptLen = idx === 0 ? widths.first : widths.cont;
    const contentLen = String(line || '').length;
    const rows = Math.max(1, Math.ceil((promptLen + contentLen) / cols));
    return sum + rows;
  }, 0);
  if (totalRows <= 0) {
    return;
  }
  readline.moveCursor(process.stdout, 0, -totalRows);
  for (let i = 0; i < totalRows; i += 1) {
    readline.clearLine(process.stdout, 0);
    if (i < totalRows - 1) {
      readline.moveCursor(process.stdout, 0, 1);
    }
  }
  readline.moveCursor(process.stdout, 0, -totalRows + 1);
  readline.cursorTo(process.stdout, 0);
}

function visibleLength(text) {
  return stripAnsi(String(text || '')).length;
}

function stripAnsi(str) {
  return String(str || '').replace(/\x1b\[[0-9;]*m/g, '');
}

}


async function runComposeBox({ initialText, meta = {}, inputBox }) {
  let message = initialText || '';
  let lineCount = meta.lineCount || (message ? message.split(/\r?\n/).length : 0);
  let charCount = meta.charCount ?? message.length;
  let tag = `[Pasted content: ${charCount} chars / ${lineCount} lines]`;
  renderComposeBanner(tag, lineCount, charCount);
  while (true) {
    const next = await inputBox.readMessage();
    const entry = next?.text ?? '';
    const entryMeta = next?.meta || {};
    const trimmed = (entry || '').trim().toLowerCase();
    if (!entryMeta.multiline && trimmed === '' && entry === '') {
      // 直接回车发送
      return message;
    }
    if (!entryMeta.multiline && ['view', '/view', 'v', '/v', 'show'].includes(trimmed)) {
      console.log(colors.dim('\n' + (message || '<empty>')));
      renderComposeBanner(tag, lineCount, charCount, { hint: '回车发送；继续输入可追加；cancel 放弃。' });
      continue;
    }
    if (!entryMeta.multiline && ['cancel', '/cancel', 'c', 'exit', 'quit'].includes(trimmed)) {
      console.log(colors.yellow('已取消本次输入。'));
      return '';
    }
    // 其他输入视为追加内容
    message = message ? `${message}\n${entry}` : entry;
    lineCount = message.split(/\r?\n/).length;
    charCount = message.length;
    tag = `[Pasted content: ${charCount} chars / ${lineCount} lines]`;
    renderComposeBanner(tag, lineCount, charCount, { hint: '已追加，回车发送；view 查看；cancel 取消。' });
  }
}

function renderComposeBanner(tag, lineCount, charCount, options = {}) {
  const hint =
    options.hint ||
    '回车发送；输入补充内容并回车追加；view 查看全文；cancel 取消。';
  const header = `╭──────── 输入框 (${lineCount} 行 / ${charCount} 字符) ────────`;
  const footer = '╰───────────────────────────────────────────────';
  console.log(colors.cyan(`\n${header}`));
  console.log(colors.cyan(`│ ${tag}`));
  console.log(colors.dim(`│ ${hint}`));
  console.log(colors.cyan(footer));
}

async function drainWithDelay(drainFn, delayMs) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return drainFn();
}

export { createInputCollector, runComposeBox };
