import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, 'src', 'chat-loop.js');
let content = fs.readFileSync(filePath, 'utf8');

// Find the line after terminalControl definition (line around 126)
const lines = content.split('\n');
let insertIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('terminalControl?.writeStatus({ state: \'idle\' });')) {
    // Insert after this line
    insertIdx = i + 1;
    break;
  }
}

if (insertIdx === -1) {
  console.error('Could not find terminalControl idle write line');
  process.exit(1);
}

// Define cleanup hooks
const cleanupCode = `
  // Setup global cleanup hooks for process exit and uncaught errors
  let cleanupHooksRegistered = false;
  const registerCleanupHooks = () => {
    if (cleanupHooksRegistered) return;
    cleanupHooksRegistered = true;

    // Update terminal status on normal exit
    process.on('exit', (code) => {
      try {
        terminalControl?.writeStatus({ state: 'exited' });
      } catch {}
    });

    // Handle uncaught exceptions - update status then rethrow
    const originalUncaughtException = process.listeners('uncaughtException').length > 0 
      ? process.listeners('uncaughtException')[0] 
      : null;
    process.removeAllListeners('uncaughtException');
    process.on('uncaughtException', (err) => {
      try {
        terminalControl?.writeStatus({ state: 'exited' });
      } catch {}
      if (originalUncaughtException) {
        originalUncaughtException(err);
      } else {
        // Default behavior: log and exit
        console.error('Uncaught Exception:', err);
        process.exit(1);
      }
    });

    // Handle unhandled rejections - update status then default
    const originalUnhandledRejection = process.listeners('unhandledRejection').length > 0
      ? process.listeners('unhandledRejection')[0]
      : null;
    process.removeAllListeners('unhandledRejection');
    process.on('unhandledRejection', (reason, promise) => {
      try {
        terminalControl?.writeStatus({ state: 'exited' });
      } catch {}
      if (originalUnhandledRejection) {
        originalUnhandledRejection(reason, promise);
      } else {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      }
    });
  };

  // Register hooks now that terminalControl is available
  registerCleanupHooks();
`;

lines.splice(insertIdx, 0, cleanupCode);
const newContent = lines.join('\n');
fs.writeFileSync(filePath, newContent, 'utf8');
console.log('Added cleanup hooks after terminalControl initialization');