export function applySecretsToProcessEnv(services) {
  const secretService = services?.secrets;
  if (!secretService || typeof secretService.list !== 'function') {
    return;
  }
  const isWindows = process.platform === 'win32';
  const listEnvKeys = (envName) => {
    const name = typeof envName === 'string' ? envName.trim() : '';
    if (!name) return [];
    if (!isWindows) {
      return Object.prototype.hasOwnProperty.call(process.env, name) ? [name] : [];
    }
    const needle = name.toLowerCase();
    return Object.keys(process.env).filter((key) => key.toLowerCase() === needle);
  };
  const readEnvValue = (envName) => {
    const keys = listEnvKeys(envName);
    for (const key of keys) {
      const raw = process.env[key];
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (value) return value;
    }
    return '';
  };
  const secrets = secretService.list() || [];
  secrets.forEach((secret) => {
    const name = typeof secret?.name === 'string' ? secret.name.trim() : '';
    const value = typeof secret?.value === 'string' ? secret.value.trim() : '';
    if (!name || !value) return;
    const override = secret?.override === true;
    const current = readEnvValue(name);
    if (!override && current) return;
    if (isWindows) {
      const keys = new Set([...listEnvKeys(name), name]);
      keys.forEach((key) => {
        process.env[key] = value;
      });
      return;
    }
    process.env[name] = value;
  });
}

