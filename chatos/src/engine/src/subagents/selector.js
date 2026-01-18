export function selectAgent(manager, options = {}) {
  if (!manager) return null;
  if (options.agentId) {
    const direct = manager.getAgent(options.agentId);
    if (direct) {
      return direct;
    }
  }
  const agents = manager.listAgents();
  if (agents.length === 0) {
    return null;
  }
  let candidates = agents;
  if (options.category) {
    const normalize = (text) =>
      String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    const normalizedCategory = normalize(options.category);
    const synonyms = {
      java: ['spring', 'springboot', 'jvm'],
      spring: ['springboot', 'java'],
      springboot: ['spring', 'java'],
      python: ['py'],
      js: ['javascript', 'node', 'ts', 'typescript'],
      javascript: ['node', 'ts', 'typescript', 'js'],
    };
    const needles = [
      normalizedCategory,
      ...(synonyms[normalizedCategory] || []),
    ]
      .map((s) => normalize(s))
      .filter(Boolean);
    const filtered = agents.filter((agent) => {
      const haystacks = [agent.pluginId, agent.pluginName, agent.name]
        .filter(Boolean)
        .map((s) => normalize(s));
      return needles.some((needle) => haystacks.some((h) => h.includes(needle)));
    });
    // 如果没有匹配，回退到全部 agent，避免因分类词不一致而找不到
    if (filtered.length > 0) {
      candidates = filtered;
    }
  }
  const skillSet = new Set(
    Array.isArray(options.skills) ? options.skills.map((entry) => entry.toLowerCase()) : []
  );
  if (skillSet.size === 0) {
    const fallback = manager.getAgent(candidates[0].id);
    return fallback;
  }
  let best = null;
  let bestScore = -1;
  candidates.forEach((agent) => {
    const available = agent.skills || [];
    const score = available.reduce((acc, skill) => {
      if (!skill || !skill.id) return acc;
      return skillSet.has(skill.id.toLowerCase()) ? acc + 1 : acc;
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      best = agent;
    }
  });
  if (!best) {
    best = candidates[0];
  }
  return manager.getAgent(best.id);
}
