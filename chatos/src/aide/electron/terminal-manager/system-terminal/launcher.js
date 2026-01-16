import { darwinSystemTerminalLauncher } from './darwin.js';
import { unsupportedSystemTerminalLauncher } from './unsupported.js';
import { win32SystemTerminalLauncher } from './win32.js';

export function getSystemTerminalLauncher(platform = process.platform) {
  if (platform === 'win32') return win32SystemTerminalLauncher;
  if (platform === 'darwin') return darwinSystemTerminalLauncher;
  return unsupportedSystemTerminalLauncher;
}

