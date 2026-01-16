import { execSync } from 'child_process';

const UTF8_CODE_PAGE = 65001;

function getWindowsActiveCodePage() {
  try {
    const output = execSync('chcp', { stdio: ['ignore', 'pipe', 'ignore'] });
    const text = Buffer.isBuffer(output) ? output.toString('ascii') : String(output || '');
    const match = text.match(/(\d+)/);
    if (!match) return null;
    const codePage = Number(match[1]);
    return Number.isFinite(codePage) && codePage > 0 ? codePage : null;
  } catch {
    return null;
  }
}

function setWindowsCodePage(codePage) {
  execSync(`chcp ${codePage}`, { stdio: 'ignore' });
}

export function ensureWindowsUtf8Console() {
  if (process.platform !== 'win32') {
    return () => {};
  }
  if (process.env.MODEL_CLI_DISABLE_WIN_UTF8 === '1') {
    return () => {};
  }
  if (!process.stdout || !process.stdout.isTTY) {
    return () => {};
  }
  const original = getWindowsActiveCodePage();
  if (!original || original === UTF8_CODE_PAGE) {
    return () => {};
  }

  try {
    setWindowsCodePage(UTF8_CODE_PAGE);
  } catch {
    // Keep the warning ASCII-only so it can display even when the current code page is misconfigured.
    console.error(
      `[model-cli] Detected Windows code page ${original}; UTF-8 output may be garbled. Try: chcp 65001`
    );
    return () => {};
  }

  const restore = () => {
    try {
      setWindowsCodePage(original);
    } catch {
      // ignore
    }
  };

  process.once('exit', restore);
  return restore;
}

