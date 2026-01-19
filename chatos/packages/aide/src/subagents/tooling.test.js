import assert from 'node:assert/strict';
import test from 'node:test';

import { filterSubagentTools, withSubagentGuardrails } from './tooling.js';

test('filterSubagentTools blocks nested sub-agent tools', () => {
  const filtered = filterSubagentTools(
    [
      'invoke_sub_agent',
      'mcp_subagent_router_run_sub_agent',
      'mcp_task_manager_add_task',
      'mcp_project_files_read_file',
      'get_current_time',
    ],
    { allowMcpPrefixes: ['mcp_task_manager_'] }
  );

  assert.deepEqual(filtered.sort(), ['get_current_time', 'mcp_task_manager_add_task'].sort());
});

test('withSubagentGuardrails mentions subagent router tools', () => {
  const text = withSubagentGuardrails('base prompt');
  assert.ok(text.includes('mcp_subagent_router_'));
});
