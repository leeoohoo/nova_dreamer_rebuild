import { execSync } from 'child_process';

export function createDarwinTerminalPlatform() {
  return {
    ensureUtf8Console: () => () => {},

    createChatReadlineInput: () => ({ input: process.stdin, close: null }),

    getTerminalControlPollIntervalMs: () => 800,

    getProcessGroupId: (pid) => {
      const num = Number(pid);
      if (!Number.isFinite(num) || num <= 0) return null;
      try {
        const out = execSync(`ps -o pgid= -p ${num}`, { encoding: 'utf8' });
        const parsed = Number(String(out || '').trim());
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      } catch {
        return null;
      }
    },
  };
}

