import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, 'src', 'chat-loop.js');
let content = fs.readFileSync(filePath, 'utf8');

// Replace the cleanup hooks section with safer version
const newCleanupCode = `  // Setup global cleanup hooks for process exit and uncaught errors
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

    // Handle uncaught exceptions - update status then propagate
    const originalUncaughtExceptionListeners = process.listeners('uncaughtException').slice();
    process.removeAllListeners('uncaughtException');
    process.on('uncaughtException', (err) => {
      try {
        terminalControl?.writeStatus({ state: 'exited' });
      } catch {}
      // Call original listeners
      for (const listener of originalUncaughtExceptionListeners) {
        try {
          listener(err);
        } catch {}
      }
      // If no listeners were present, default behavior
      if (originalUncaughtExceptionListeners.length === 0) {
        console.error('Uncaught Exception:', err);
        process.exit(1);
      }
    });

    // Handle unhandled rejections - update status then propagate
    const originalUnhandledRejectionListeners = process.listeners('unhandledRejection').slice();
    process.removeAllListeners('unhandledRejection');
    process.on('unhandledRejection', (reason, promise) => {
      try {
        terminalControl?.writeStatus({ state: 'exited' });
      } catch {}
      // Call original listeners
      for (const listener of originalUnhandledRejectionListeners) {
        try {
          listener(reason, promise);
        } catch {}
      }
      // If no listeners were present, default behavior
      if (originalUnhandledRejectionListeners.length === 0) {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      }
    });
  };

  // Register hooks now that terminalControl is available
  registerCleanupHooks();`;

// Find the cleanup hooks section (lines 128-177)
const lines = content.split('\n');
let startIdx = -1;
let endIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('// Setup global cleanup hooks for process exit and uncaught errors')) {
    startIdx = i;
    // Find the line after registerCleanupHooks();
    for (let j = i; j < lines.length; j++) {
      if (lines[j].includes('registerCleanupHooks();')) {
        endIdx = j;
        break;
      }
    }
    break;
  }
}

if (startIdx !== -1 && endIdx !== -1) {
  // Replace from startIdx to endIdx
  const newLines = newCleanupCode.split('\n');
  lines.splice(startIdx, endIdx - startIdx + 1, ...newLines);
  const newContent = lines.join('\n');
  fs.writeFileSync(filePath, newContent, 'utf8');
  console.log('Updated cleanup hooks with safer implementation');
} else {
  console.error('Could not find cleanup hooks section');
  process.exit(1);
}