import { spawn } from 'child_process';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function resolveChromeDevtoolsMcpBin() {
  const pkgPath = require.resolve('chrome-devtools-mcp/package.json');
  // eslint-disable-next-line import/no-dynamic-require
  const pkg = require(pkgPath);
  const bin = pkg?.bin;
  let relativeBin = '';
  if (typeof bin === 'string') {
    relativeBin = bin;
  } else if (bin && typeof bin === 'object') {
    relativeBin = bin['chrome-devtools-mcp'] || Object.values(bin)[0] || '';
  }
  if (!relativeBin) {
    throw new Error('chrome-devtools-mcp package.json 缺少可执行 bin 配置');
  }
  return path.resolve(path.dirname(pkgPath), relativeBin);
}

function main() {
  let binPath = '';
  try {
    binPath = resolveChromeDevtoolsMcpBin();
  } catch (err) {
    const message = err?.message || String(err);
    // MCP stdio server must not write to stdout; keep diagnostics on stderr.
    console.error(`[chrome_devtools] chrome-devtools-mcp 不可用：${message}`);
    console.error(
      '[chrome_devtools] 该 MCP server 需要 Node ^20.19（桌面端打包时会内置；CLI 请升级 Node 并重新安装依赖）。'
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const child = spawn(process.execPath, [binPath, ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code) => {
    process.exit(typeof code === 'number' ? code : 0);
  });
  child.on('error', (err) => {
    console.error(`[chrome_devtools] 启动 chrome-devtools-mcp 失败：${err?.message || String(err)}`);
    process.exit(1);
  });
}

main();

