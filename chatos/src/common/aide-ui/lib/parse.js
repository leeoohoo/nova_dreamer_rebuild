import YAML from 'yaml';

export function parseJsonSafe(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function parseYamlSafe(text, fallback) {
  try {
    return YAML.parse(text);
  } catch {
    return fallback;
  }
}

export function parseEvents(content = '') {
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  const entries = [];
  lines.forEach((line) => {
    const parsed = parseJsonSafe(line, null);
    if (parsed) entries.push(parsed);
  });
  return entries;
}

export function parseTasks(raw) {
  const parsed = parseJsonSafe(raw || '[]', []);
  if (Array.isArray(parsed.tasks)) return parsed.tasks;
  if (Array.isArray(parsed)) return parsed;
  return [];
}

