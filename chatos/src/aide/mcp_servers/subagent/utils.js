function serializeAgent(agent) {
  const pluginCategory = agent.pluginCategory || agent.category || agent.pluginId;
  const pluginDescription = agent.pluginDescription || '';
  const matchScore =
    typeof agent._score === 'number' && Number.isFinite(agent._score)
      ? Number(agent._score.toFixed(3))
      : null;
  return {
    id: agent.id,
    name: agent.name,
    plugin: agent.pluginId,
    plugin_name: agent.pluginName,
    plugin_category: pluginCategory,
    category: pluginCategory,
    plugin_description: pluginDescription,
    model: agent.model || null,
    skills: (agent.skills || []).map((s) => s.id),
    default_skills: agent.defaultSkills || [],
    default_command: agent.defaultCommand || null,
    commands: (agent.commands || []).map((c) =>
      typeof c === 'string'
        ? { id: c, name: c }
        : { id: c.id || c.name, name: c.name || c.id, description: c.description || '' }
    ),
    description: agent.description || '',
    ...(matchScore !== null ? { match_score: matchScore } : {}),
  };
}

function normalizeSkills(skills) {
  return Array.isArray(skills)
    ? skills.map((s) => String(s || '').trim()).filter(Boolean)
    : [];
}

function filterAgents(list, { filterCategory, query } = {}) {
  const tokens = tokenizeQuery(query);
  const category = normalizeText(filterCategory).trim();
  const ranked = [];
  list.forEach((agent) => {
    if (!matchesCategory(agent, category)) {
      return;
    }
    if (tokens.length === 0) {
      ranked.push({ agent, score: 0, tieBreaker: agent.name || agent.id || '' });
      return;
    }
    const { score, matched } = scoreAgent(agent, tokens);
    if (matched === 0) {
      return;
    }
    ranked.push({
      agent,
      score,
      tieBreaker: agent.name || agent.id || '',
    });
  });
  ranked.sort((a, b) => b.score - a.score || a.tieBreaker.localeCompare(b.tieBreaker));
  return ranked.map(({ agent, score }) => ({ ...agent, _score: score }));
}

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).toLowerCase();
}

function tokenizeQuery(query) {
  const normalized = normalizeText(query).trim();
  if (!normalized) return [];
  return normalized.split(/[\s,/|]+/).filter(Boolean);
}

function matchesCategory(agent, category) {
  if (!category) return true;
  const haystack = [
    agent.pluginId,
    agent.pluginName,
    agent.pluginCategory,
    agent.category,
    agent.pluginDescription,
  ]
    .map((item) => normalizeText(item).trim())
    .filter(Boolean);
  return haystack.some((text) => text.includes(category));
}

function buildSearchFields(agent) {
  const skills = Array.isArray(agent.skills) ? agent.skills : [];
  const commands = Array.isArray(agent.commands) ? agent.commands : [];
  const fields = [];
  const push = (text, weight) => {
    if (!text) return;
    fields.push({ text: normalizeText(text), weight });
  };
  push(agent.id, 10);
  push(agent.name, 10);
  push(agent.pluginId, 8);
  push(agent.pluginName, 8);
  push(agent.pluginCategory, 7);
  push(agent.pluginDescription, 6);
  push(agent.description, 6);
  (agent.defaultSkills || []).forEach((skillId) => push(skillId, 5));
  skills.forEach((skill) => {
    push(skill.id, 5);
    push(skill.name, 5);
    push(skill.description, 4);
  });
  commands.forEach((cmd) => {
    if (typeof cmd === 'string') {
      push(cmd, 4);
    } else {
      push(cmd.id, 4);
      push(cmd.name, 4);
      push(cmd.description, 3);
    }
  });
  return fields;
}

function scoreAgent(agent, tokens) {
  const fields = buildSearchFields(agent);
  if (tokens.length === 0 || fields.length === 0) {
    return { score: 0, matched: 0 };
  }
  let matched = 0;
  let score = 0;

  tokens.forEach((token) => {
    let best = 0;
    fields.forEach(({ text, weight }) => {
      if (!text) return;
      const candidate = scoreTokenAgainstText(token, text, weight);
      if (candidate > best) {
        best = candidate;
      }
    });
    if (best > 0) {
      matched += 1;
      score += best;
    }
  });

  if (matched > 0) {
    const coverage = matched / tokens.length;
    score += coverage * 2; // small boost for covering more query tokens
  }

  return { score, matched };
}

function scoreTokenAgainstText(token, text, weight) {
  if (!token || !text) return 0;
  if (text === token) {
    return weight + 3;
  }
  const boundaryRegex = new RegExp(`\\b${escapeRegex(token)}\\b`);
  if (boundaryRegex.test(text)) {
    return weight + 2;
  }
  if (text.includes(token)) {
    return Math.max(1, weight - 2);
  }
  return 0;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


function withTaskTracking(systemPrompt, internalPrompt = '') {
  const trackingBlock = [
    'Task tracking rules:',
    '- First action: call mcp_task_manager_add_task (title=concise ask, details=context/acceptance). Mention the task ID in your reply.',
    '- Progress: use mcp_task_manager_update_task; completion: call mcp_task_manager_complete_task with a completion note (what was delivered + validation). If you lack access, say so.',
  ].join('\n');
  const promptText = (systemPrompt || '').trim();
  const combinedText = `${internalPrompt || ''}\n${promptText}`;
  if (combinedText.includes('mcp_task_manager_add_task')) {
    return promptText;
  }
  return `${trackingBlock}\n\n${promptText}`.trim();
}

function withSubagentGuardrails(systemPrompt) {
  const guardrail =
    'Tooling guard: sub-agents cannot call invoke_sub_agent, mcp_subagent_router_* or other sub-agent routing tools (ignore any earlier instructions suggesting that). Complete the task directly with available project/shell/task tools.';
  const prompt = typeof systemPrompt === 'string' ? systemPrompt.trim() : '';
  return [prompt, guardrail].filter(Boolean).join('\n\n');
}

function parseArgs(input) {
  const result = { _: [] };
  for (let i = 0; i < input.length; i += 1) {
    const token = input[i];
    if (!token.startsWith('-')) {
      result._.push(token);
      continue;
    }
    const isLong = token.startsWith('--');
    const key = isLong ? token.slice(2) : token.slice(1);
    if (!key) continue;
    const [name, inline] = key.split('=');
    if (inline !== undefined) {
      result[name] = inline;
      continue;
    }
    const next = input[i + 1];
    if (next && !next.startsWith('-')) {
      result[name] = next;
      i += 1;
    } else {
      result[name] = true;
    }
  }
  return result;
}

function jsonTextResponse(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}


export { serializeAgent, normalizeSkills, filterAgents, withTaskTracking, withSubagentGuardrails, parseArgs, jsonTextResponse };
