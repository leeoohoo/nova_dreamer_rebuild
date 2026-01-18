const COLON_COMMANDS = [
  'help',
  'models',
  'use',
  'reset',
  'save',
  'exit',
  'quit',
  'q',
];

const SLASH_COMMANDS = [
  'model',
  'prompt',
  'summary',
  'mcp',
  'mcp_set',
  'mcp_tools',
  'tool',
  'sub',
];

export function getCommandCompleter(context = {}) {
  return (line) => {
    const input = line; 

    // 1. Colon commands
    if (input.startsWith(':')) {
      const hits = COLON_COMMANDS.map((c) => `:${c}`).filter((c) => c.startsWith(input));
      return [hits.length ? hits : [], input];
    }

  // 2. Slash commands
  if (input.startsWith('/')) {
    // Check if it's a sub-command like "/sub "
    if (input.startsWith('/sub ')) {
      const rest = input.slice(5); // remove "/sub "
        // If we are in "/sub <something>", we are completing the subcommand
        const tokens = rest.split(/\s+/);
        // If the user typed "/sub install ", tokens is ["install", ""]
        // If the user typed "/sub install", tokens is ["install"]
        
        // Case: /sub <subcommand>
        if (tokens.length <= 1 && !input.endsWith(' ')) {
          // Completing the subcommand itself
          const subCmd = tokens[0] || '';
          const SUB_COMMANDS = ['install', 'uninstall', 'list', 'agents', 'run', 'marketplace', 'help'];
          const hits = SUB_COMMANDS.filter((c) => c.startsWith(subCmd));
          // We need to return the whole line or the substring?
          // readline expects [matches, substring_to_match]
          // If we return matches as just "install", "list", and substring as "ins", it replaces "ins" with "install".
          // The line becomes "/sub install". correct.
          return [hits.length ? hits : [], subCmd];
        }

        // Case: /sub <subcommand> <arg>
        // If tokens.length > 1 or (tokens.length === 1 and input ends with space)
        const subCmd = tokens[0];
        const argPrefix = tokens.length > 1 ? tokens[tokens.length - 1] : '';
        
        // Only complete if we are on the second token
        // If tokens is ["install", ""] (user typed "/sub install "), we complete the empty arg
        
        if (['install', 'uninstall', 'run', 'use'].includes(subCmd)) {
           const manager = context.subAgents;
           if (!manager) return [[], argPrefix];

           let candidates = [];
           if (subCmd === 'install') {
             // List all marketplace plugins (maybe filter installed? User said "show uninstalled")
             // Let's show all but prioritize or just list all IDs.
             const market = manager.listMarketplace() || [];
             const installed = new Set(manager.listInstalledPlugins().map(p => p.id));
             // Filter to uninstalled ones for better UX, or all?
             // User said: "当我输入 install 就展示我没有安装的 agent 列表"
             // So let's complete uninstalled ones primarily.
             candidates = market
               .filter(p => !installed.has(p.id))
               .map(p => p.id);
           } else if (subCmd === 'uninstall' || subCmd === 'remove') {
             const installed = manager.listInstalledPlugins() || [];
             candidates = installed.map(p => p.id);
           } else if (subCmd === 'run' || subCmd === 'use') {
             // List agents
             const agents = manager.listAgents() || [];
             candidates = agents.map(a => a.id);
           }

           const hits = candidates.filter(c => c.startsWith(argPrefix));
           return [hits.length ? hits : [], argPrefix];
      }
      
      return [[], argPrefix];
    }

    const manager = context.subAgents;
    if (manager) {
      const commandPatterns = manager
        .listCommands()
        .map((cmd) => `/${cmd.pluginId}:${cmd.id}`);
      const cmdHits = commandPatterns.filter((c) => c.startsWith(input));
      if (cmdHits.length > 0) {
        return [cmdHits, input];
      }
    }

    // Basic slash command completion (top level)
    const hits = SLASH_COMMANDS.map((c) => `/${c}`).filter((c) => c.startsWith(input));
    return [hits.length ? hits : [], input];
  }

    return [[], input];
  };
}
