import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, 'src', 'chat', 'terminal.js');
let content = fs.readFileSync(filePath, 'utf8');

// Find hardKillCurrentRunFromSignal function and modify it
const lines = content.split('\n');
let startIdx = -1;
let endIdx = -1;
let braceCount = 0;
let inFunction = false;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('function hardKillCurrentRunFromSignal() {')) {
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

if (startIdx === -1 || endIdx === -1) {
  console.error('Could not find hardKillCurrentRunFromSignal function');
  process.exit(1);
}

// Build new function lines
const newFunctionLines = [];
let skipPgidBlock = false;
let skipSelfKill = false;
for (let i = startIdx; i <= endIdx; i++) {
  const line = lines[i];
  
  // Skip the entire pgid block (lines containing if (pgid) { ... })
  if (line.includes('if (pgid) {')) {
    skipPgidBlock = true;
  }
  if (skipPgidBlock) {
    if (line.includes('}') && line.includes('// fall back below')) {
      // This is the closing brace of the if block, skip it too
      skipPgidBlock = false;
      continue;
    }
    continue;
  }
  
  // Skip self kill lines
  if (line.includes('process.kill(process.pid, \'SIGKILL\');')) {
    skipSelfKill = true;
  }
  if (skipSelfKill) {
    // Skip the try-catch block around self kill
    if (line.includes('} catch {') || line.includes('// ignore')) {
      // continue skipping
      continue;
    }
    if (line.includes('}') && !line.includes('try')) {
      // End of try-catch block
      skipSelfKill = false;
      continue;
    }
    continue;
  }
  
  newFunctionLines.push(line);
}

// Replace the function in original lines
lines.splice(startIdx, endIdx - startIdx + 1, ...newFunctionLines);
const newContent = lines.join('\n');
fs.writeFileSync(filePath, newContent, 'utf8');
console.log('Modified hardKillCurrentRunFromSignal: removed pgid kill and self kill');