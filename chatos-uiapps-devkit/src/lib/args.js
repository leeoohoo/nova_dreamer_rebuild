export function parseArgs(argv) {
  const raw = Array.isArray(argv) ? argv.slice(2) : [];
  const flags = {};
  const positionals = [];

  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i];
    if (!token) continue;

    if (token === '--') {
      positionals.push(...raw.slice(i + 1));
      break;
    }

    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      const key = (eq >= 0 ? token.slice(2, eq) : token.slice(2)).trim();
      const value = eq >= 0 ? token.slice(eq + 1) : raw[i + 1];
      if (!key) continue;

      if (eq < 0 && value && !value.startsWith('-')) {
        flags[key] = value;
        i += 1;
      } else if (eq >= 0) {
        flags[key] = value;
      } else {
        flags[key] = true;
      }
      continue;
    }

    if (token.startsWith('-') && token.length > 1) {
      const key = token.slice(1).trim();
      const value = raw[i + 1];
      if (value && !value.startsWith('-')) {
        flags[key] = value;
        i += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }

    positionals.push(token);
  }

  return { positionals, flags };
}

