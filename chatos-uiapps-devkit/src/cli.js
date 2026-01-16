import { cmdInit } from './commands/init.js';
import { cmdValidate } from './commands/validate.js';
import { cmdPack } from './commands/pack.js';
import { cmdInstall } from './commands/install.js';
import { cmdDev } from './commands/dev.js';

import { parseArgs } from './lib/args.js';

function printHelp() {
  // Keep it short; detailed docs live in README and generated project.
  // eslint-disable-next-line no-console
  console.log(`chatos-uiapp

Usage:
  chatos-uiapp init <dir> [--template <name>] [--force] [--plugin-id <id>] [--name <name>] [--app-id <appId>] [--version <semver>]
  chatos-uiapp init --list-templates
  chatos-uiapp dev [--port 4399] [--app <appId>] [--plugin-dir <path>]
  chatos-uiapp validate [--plugin-dir <path>]
  chatos-uiapp pack [--out <zipPath>] [--plugin-dir <path>]
  chatos-uiapp install [--host-app chatos] [--state-dir <path>] [--plugin-dir <path>]

Examples:
  chatos-uiapp init my-app
  chatos-uiapp init my-app --template notepad
  chatos-uiapp init --list-templates
  chatos-uiapp dev --port 4399
  chatos-uiapp install --host-app chatos
`);
}

export async function runCli(argv) {
  const { positionals, flags } = parseArgs(argv);
  const cmd = String(positionals[0] || '').trim();

  if (!cmd || cmd === 'help' || cmd === '--help' || flags.help) {
    printHelp();
    return;
  }

  try {
    if (cmd === 'init') return await cmdInit({ positionals: positionals.slice(1), flags });
    if (cmd === 'dev') return await cmdDev({ positionals: positionals.slice(1), flags });
    if (cmd === 'validate') return await cmdValidate({ positionals: positionals.slice(1), flags });
    if (cmd === 'pack') return await cmdPack({ positionals: positionals.slice(1), flags });
    if (cmd === 'install') return await cmdInstall({ positionals: positionals.slice(1), flags });

    throw new Error(`Unknown command: ${cmd}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[chatos-uiapp] ${err?.message || String(err)}`);
    process.exitCode = 1;
  }
}
