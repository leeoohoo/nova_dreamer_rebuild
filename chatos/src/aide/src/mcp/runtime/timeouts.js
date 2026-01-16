const NO_TIMEOUT_MS = 2_147_483_647; // ~24.8 days (max safe setTimeout)

function parseTimeoutMs(value, fallback, min = 1000, max = 30 * 60 * 1000) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
    return parsed;
  }
  return fallback;
}

const getDefaultToolTimeoutMs = () =>
  parseTimeoutMs(process.env.MODEL_CLI_MCP_TIMEOUT_MS, 10 * 60 * 1000, 1000, 30 * 60 * 1000);
const getDefaultToolMaxTimeoutMs = () =>
  parseTimeoutMs(
    process.env.MODEL_CLI_MCP_MAX_TIMEOUT_MS,
    20 * 60 * 1000,
    getDefaultToolTimeoutMs(),
    30 * 60 * 1000
  );

function withNoTimeoutOptions(options) {
  const base = options && typeof options === 'object' ? options : {};
  return {
    ...base,
    timeout: NO_TIMEOUT_MS,
    maxTotalTimeout: NO_TIMEOUT_MS,
    resetTimeoutOnProgress: true,
  };
}

function shouldDisableToolTimeout(serverName, toolName) {
  const server = String(serverName || '').toLowerCase();
  const tool = String(toolName || '').toLowerCase();
  if (!server || !tool) return false;
  if (server === 'ui_prompter') return true;
  if (server === 'task_manager' && tool === 'add_task') return true;
  if (
    server === 'code_writer' &&
    (tool === 'write_file' || tool === 'edit_file' || tool === 'apply_patch' || tool === 'delete_path')
  ) {
    return true;
  }
  if (server === 'shell_tasks' && tool === 'run_shell_command') return true;
  return false;
}

function maybeForceUiPrompterTimeout({ server, tool, args }) {
  if (server !== 'ui_prompter') return args;
  if (!tool) return args;
  if (!args || typeof args !== 'object') return args;
  return { ...args, timeout_ms: NO_TIMEOUT_MS };
}

export {
  NO_TIMEOUT_MS,
  getDefaultToolTimeoutMs,
  getDefaultToolMaxTimeoutMs,
  maybeForceUiPrompterTimeout,
  parseTimeoutMs,
  shouldDisableToolTimeout,
  withNoTimeoutOptions,
};
