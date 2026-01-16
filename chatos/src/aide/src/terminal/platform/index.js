/**
 * @typedef {Object} TerminalPlatform
 * @property {() => (() => void)} ensureUtf8Console
 * @property {() => ({ input: NodeJS.ReadableStream, close: (() => void) | null })} createChatReadlineInput
 * @property {() => number} getTerminalControlPollIntervalMs
 * @property {(pid: number) => (number | null)} getProcessGroupId
 */

import { createPosixTerminalPlatform } from './posix.js';
import { createWin32TerminalPlatform } from './win32.js';
import { createDarwinTerminalPlatform } from './darwin.js';
import { createLinuxTerminalPlatform } from './linux.js';

/**
 * @returns {TerminalPlatform}
 */
export function getTerminalPlatform(platform = process.platform) {
  if (platform === 'win32') {
    return createWin32TerminalPlatform();
  }
  if (platform === 'darwin') {
    return createDarwinTerminalPlatform();
  }
  if (platform === 'linux') {
    return createLinuxTerminalPlatform();
  }
  return createPosixTerminalPlatform();
}

export const terminalPlatform = getTerminalPlatform();
