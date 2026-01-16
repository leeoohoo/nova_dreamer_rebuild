import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, 'src', 'chat', 'terminal.js');
let content = fs.readFileSync(filePath, 'utf8');

// Replace the writeStatus function with simpler retry logic
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

    // Retry up to 3 times for critical states (exited, running)
    const isCritical = state === 'exited' || state === 'running';
    const maxAttempts = isCritical ? 3 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const tmpPath = \`\${statusPath}.tmp\`;
        fs.writeFileSync(tmpPath, json, 'utf8');
        fs.renameSync(tmpPath, statusPath);
        return payload;
      } catch {
        // Ignore error and retry if attempts remain
        if (attempt === maxAttempts - 1) {
          // Last attempt failed, silently ignore as before
        }
      }
    }
    return payload;
  };`;

// Find the writeStatus function (lines 30-68)
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
  const newLines = newWriteStatus.split('\n');
  lines.splice(startIdx, endIdx - startIdx + 1, ...newLines);
  const newContent = lines.join('\n');
  fs.writeFileSync(filePath, newContent, 'utf8');
  console.log('Updated writeStatus with simpler retry logic');
} else {
  console.error('Could not find writeStatus function');
  process.exit(1);
}