import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, 'src', 'chat-loop.js');
let content = fs.readFileSync(filePath, 'utf8');

// Find the line with rl.on('SIGINT'
const lines = content.split('\n');
let insertIndex = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("rl.on('SIGINT'")) {
    insertIndex = i + 1;
    break;
  }
}

if (insertIndex !== -1) {
  const newLines = [
    '    try {',
    '      terminalControl?.writeStatus({ state: \'exited\' });',
    '    } catch {}'
  ];
  lines.splice(insertIndex, 0, ...newLines);
  const newContent = lines.join('\n');
  fs.writeFileSync(filePath, newContent, 'utf8');
  console.log('Inserted status update at line', insertIndex);
} else {
  console.error('Could not find SIGINT handler');
  process.exit(1);
}