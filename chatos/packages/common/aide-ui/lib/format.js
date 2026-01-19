export function formatDateTime(ts) {
  if (!ts) return '-';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return String(ts);
  return date.toLocaleString();
}

export function formatBytes(bytes) {
  if (bytes === undefined || bytes === null) return '-';
  const value = Number(bytes);
  if (!Number.isFinite(value)) return String(bytes);
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

export function truncateText(text, max = 180) {
  if (text === undefined || text === null) return '';
  const value = String(text);
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

export function formatJson(value) {
  if (value === undefined || value === null) return '';
  const decodeEscapes = (text) =>
    text
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '  ')
      .replace(/\\r/g, '\r')
      .replace(/\\\\/g, '\\');

  const stringify = (input) => decodeEscapes(JSON.stringify(input, null, 2));

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return stringify(JSON.parse(value));
      } catch {
        // fall through
      }
    }
    return decodeEscapes(value);
  }

  try {
    return stringify(value);
  } catch {
    return decodeEscapes(String(value));
  }
}

