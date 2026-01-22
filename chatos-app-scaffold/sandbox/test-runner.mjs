import path from 'node:path';
import { runTest } from './test-mcp-server.mjs';
import { createMockHost } from './mock-host-api.mjs';
import { sleep } from '../src/lib/utils.mjs';

const main = async () => {
  const rootDir = path.resolve(process.cwd());
  const host = await createMockHost({ rootDir });

  const results = await runTest({ rootDir });
  await sleep(300);
  const sessions = await host.backend.invoke('sessions.list');
  const tasks = await host.backend.invoke('tasks.list');

  console.log('init', results.init);
  console.log('tools', results.list);
  console.log('call', results.call);
  console.log('ui_prompt_result', results.result);
  console.log('sessions', sessions);
  console.log('tasks', tasks);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
