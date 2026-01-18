export function createToolHistory(limit = 20) {
  const entries = [];
  let counter = 1;
  return {
    add(tool, content) {
      const id = `T${counter++}`;
      entries.push({ id, tool, content, timestamp: new Date() });
      if (entries.length > limit) {
        entries.shift();
      }
      return id;
    },
    list() {
      return entries.slice().reverse();
    },
    get(id) {
      if (!id) return null;
      const target = id.trim().toLowerCase();
      return entries.find((entry) => entry.id.toLowerCase() === target) || null;
    },
  };
}

