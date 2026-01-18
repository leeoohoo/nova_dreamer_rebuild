function parsePositiveInt(value) {
  const text = typeof value === 'string' ? value.trim() : value;
  const num = Number.parseInt(String(text ?? ''), 10);
  if (!Number.isFinite(num)) return null;
  if (num <= 0) return null;
  return num;
}

export function resolveConcurrency(value, fallback = 1) {
  const resolved = parsePositiveInt(value) ?? parsePositiveInt(fallback) ?? 1;
  return Math.max(1, Math.floor(resolved));
}

export async function mapAllSettledWithConcurrency(items, concurrency, mapper) {
  const list = Array.isArray(items) ? items : [];
  if (typeof mapper !== 'function') {
    throw new TypeError('mapAllSettledWithConcurrency: mapper must be a function');
  }
  if (list.length === 0) return [];

  const limit = resolveConcurrency(concurrency, 1);
  const results = new Array(list.length);
  let nextIndex = 0;

  const workerCount = Math.min(limit, list.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= list.length) return;

      try {
        const value = await mapper(list[index], index);
        results[index] = { status: 'fulfilled', value };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });

  await Promise.all(workers);
  return results;
}

