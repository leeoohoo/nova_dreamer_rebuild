import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, 'src', 'chat', 'terminal.js');
let content = fs.readFileSync(filePath, 'utf8');

// Replace writeStatus function with retry mechanism
const newWriteStatus = `  const writeStatus = ({ state, currentMessage } = {}) => {
    const payload = {
      runId: rid,
      pid: process.pid,
      state: state || 'idle',
      currentMessage: typeof currentMessage === 'string' ? currentMessage : '',
      updatedAt: new Date().toISOString(),
    };
    const json = \`\${JSON.stringify(payload)}\\n\`;
    if (json === lastStatusText) {
      return payload;
    }
    lastStatusText = json;

    // Retry up to 3 times with exponential backoff for critical states
    const isCritical = state === 'exited' || state === 'running';
    const maxRetries = isCritical ? 3 : 1;
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 10ms, 40ms, 160ms
        const delay = Math.pow(4, attempt - 1) * 10;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
      }
      try {
        const tmpPath = \`\${statusPath}.tmp\`;
        fs.writeFileSync(tmpPath, json, 'utf8');
        fs.renameSync(tmpPath, statusPath);
        // Success
        return payload;
      } catch (err) {
        lastError = err;
        // Continue to retry
      }
    }
    // All retries failed, ignore error as before
    return payload;
  };`;

// Find the writeStatus function (from line 30 to line 51)
// Use regex to replace
const lines = content.split('\n');
let startIdx = -1;
let endIdx = -1;
let braceCount = 0;
let inFunction = false;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const writeStatus = ({ state, currentMessage } = {}) => {')) {
    startIdx = i;
    inFunction = true;
    braceCount = 0;
  }
  if (inFunction) {
    // Count braces to find end (simple approach)
    for (const ch of lines[i]) {
      if (ch === '{') braceCount++;
      if (ch === '}') braceCount--;
    }
    if (braceCount === 0 && startIdx !== -1) {
      endIdx = i;
      break;
    }
  }
}

if (startIdx !== -1 && endIdx !== -1) {
  // Replace lines from startIdx to endIdx with newWriteStatus split by lines
  const newLines = newWriteStatus.split('\n');
  lines.splice(startIdx, endIdx - startIdx + 1, ...newLines);
  const newContent = lines.join('\n');
  fs.writeFileSync(filePath, newContent, 'utf8');
  console.log('Replaced writeStatus function');
} else {
  console.error('Could not find writeStatus function');
  process.exit(1);
}